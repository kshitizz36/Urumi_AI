// Deploys WordPress + WooCommerce into a store namespace.
// Creates Deployment, PVC, Service, and Ingress with store-specific hostname.

import * as k8s from '@kubernetes/client-node';
import { coreApi, appsApi, networkingApi } from './client.js';
import { logger } from '../../utils/logger.js';
import { withRetry, isRetryableK8sError, isK8sStatusCode } from '../../utils/retry.js';
import { getStoreLabels, StoreLabels } from './namespace.js';
import { config } from '../../config/index.js';
import crypto from 'crypto';

export interface WordPressDeploymentConfig {
    namespace: string;
    storeId: string;
    storeName: string;
    mysqlHost: string;
    mysqlSecretName: string;
    storageSize?: string;
}

export class WordPressService {
    private log = logger.child({ service: 'WordPressService' });

    async deploy(cfg: WordPressDeploymentConfig): Promise<{
        url: string;
        adminUrl: string;
    }> {
        const log = this.log.child({ storeId: cfg.storeId, namespace: cfg.namespace });
        const labels: StoreLabels = {
            storeId: cfg.storeId,
            storeName: cfg.storeName,
            engine: 'woocommerce',
        };

        log.info('Starting WordPress deployment');

        // Calculate URLs
        const hostname = `store-${cfg.storeId}.${config.storeDomain}`;
        const url = `http://${hostname}`;
        const adminUrl = `${url}/wp-admin`;

        // 1. Create admin credentials Secret
        const adminSecretName = 'wordpress-admin-secret';
        await this.createAdminSecret(cfg.namespace, adminSecretName, labels);

        // 2. Create PVC for wp-content
        await this.createPVC(cfg, labels);

        // 3. Create Deployment
        await this.createDeployment(cfg, labels, hostname, adminSecretName);

        // 4. Create Service
        await this.createService(cfg.namespace, labels);

        // 5. Create Ingress
        await this.createIngress(cfg.namespace, labels, hostname);

        log.info({ url, adminUrl }, 'WordPress deployment completed');

        return { url, adminUrl };
    }

    private async createAdminSecret(
        namespace: string,
        name: string,
        labels: StoreLabels
    ): Promise<void> {
        const log = this.log.child({ namespace });

        const secret: k8s.V1Secret = {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: {
                name,
                namespace,
                labels: {
                    ...getStoreLabels(labels),
                    'app.kubernetes.io/component': 'application',
                },
            },
            type: 'Opaque',
            stringData: {
                'admin-user': 'admin',
                'admin-password': this.generatePassword(),
                'admin-email': 'admin@urumi.ai',
            },
        };

        await withRetry(
            async () => {
                try {
                    await coreApi().createNamespacedSecret(namespace, secret);
                    log.info('Admin secret created');
                } catch (error: unknown) {
                    if (isK8sStatusCode(error, 409)) {
                        log.info('Admin secret already exists');
                        return;
                    }
                    throw error;
                }
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying admin secret creation');
                },
            }
        );
    }

    private async createPVC(
        cfg: WordPressDeploymentConfig,
        labels: StoreLabels
    ): Promise<void> {
        const log = this.log.child({ namespace: cfg.namespace });

        const pvc: k8s.V1PersistentVolumeClaim = {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: {
                name: 'wordpress-content',
                namespace: cfg.namespace,
                labels: {
                    ...getStoreLabels(labels),
                    'app.kubernetes.io/component': 'application',
                },
            },
            spec: {
                accessModes: ['ReadWriteOnce'],
                resources: {
                    requests: {
                        storage: cfg.storageSize || config.wordpressStorageSize,
                    },
                },
            },
        };

        await withRetry(
            async () => {
                try {
                    await coreApi().createNamespacedPersistentVolumeClaim(cfg.namespace, pvc);
                    log.info('PVC created');
                } catch (error: unknown) {
                    if (isK8sStatusCode(error, 409)) {
                        log.info('PVC already exists');
                        return;
                    }
                    throw error;
                }
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying PVC creation');
                },
            }
        );
    }

    private async createDeployment(
        cfg: WordPressDeploymentConfig,
        labels: StoreLabels,
        hostname: string,
        adminSecretName: string
    ): Promise<void> {
        const log = this.log.child({ namespace: cfg.namespace });
        const k8sLabels = {
            ...getStoreLabels(labels),
            'app.kubernetes.io/component': 'application',
            'app.kubernetes.io/name': 'wordpress',
        };

        const deployment: k8s.V1Deployment = {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: {
                name: 'wordpress',
                namespace: cfg.namespace,
                labels: k8sLabels,
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        'app.kubernetes.io/name': 'wordpress',
                        'urumi.ai/store-id': cfg.storeId,
                    },
                },
                template: {
                    metadata: {
                        labels: k8sLabels,
                    },
                    spec: {
                        securityContext: {
                            fsGroup: 1001,
                        },
                        containers: [
                            {
                                name: 'wordpress',
                                image: 'bitnami/wordpress:6.7.2-debian-12-r2',
                                ports: [
                                    { containerPort: 8080, name: 'http' },
                                    { containerPort: 8443, name: 'https' },
                                ],
                                env: [
                                    // Database
                                    { name: 'WORDPRESS_DATABASE_HOST', value: cfg.mysqlHost },
                                    { name: 'WORDPRESS_DATABASE_PORT_NUMBER', value: '3306' },
                                    { name: 'WORDPRESS_DATABASE_NAME', value: 'wordpress' },
                                    {
                                        name: 'WORDPRESS_DATABASE_USER',
                                        valueFrom: {
                                            secretKeyRef: { name: cfg.mysqlSecretName, key: 'wordpress-user' },
                                        },
                                    },
                                    {
                                        name: 'WORDPRESS_DATABASE_PASSWORD',
                                        valueFrom: {
                                            secretKeyRef: { name: cfg.mysqlSecretName, key: 'wordpress-password' },
                                        },
                                    },
                                    // Site config
                                    { name: 'WORDPRESS_BLOG_NAME', value: cfg.storeName },
                                    { name: 'WORDPRESS_SITE_URL', value: `http://${hostname}` },
                                    // Admin
                                    {
                                        name: 'WORDPRESS_USERNAME',
                                        valueFrom: {
                                            secretKeyRef: { name: adminSecretName, key: 'admin-user' },
                                        },
                                    },
                                    {
                                        name: 'WORDPRESS_PASSWORD',
                                        valueFrom: {
                                            secretKeyRef: { name: adminSecretName, key: 'admin-password' },
                                        },
                                    },
                                    {
                                        name: 'WORDPRESS_EMAIL',
                                        valueFrom: {
                                            secretKeyRef: { name: adminSecretName, key: 'admin-email' },
                                        },
                                    },
                                    // WooCommerce setup
                                    { name: 'WORDPRESS_PLUGINS', value: 'woocommerce' },
                                    // Skip wizard for faster setup
                                    { name: 'WORDPRESS_SKIP_BOOTSTRAP', value: 'no' },
                                ],
                                resources: {
                                    requests: { cpu: '100m', memory: '256Mi' },
                                    limits: { cpu: '500m', memory: '512Mi' },
                                },
                                volumeMounts: [
                                    { name: 'wordpress-content', mountPath: '/bitnami/wordpress' },
                                ],
                                readinessProbe: {
                                    httpGet: {
                                        path: '/wp-login.php',
                                        port: 8080,
                                    },
                                    initialDelaySeconds: 15,
                                    periodSeconds: 5,
                                    timeoutSeconds: 5,
                                    failureThreshold: 10,
                                },
                                livenessProbe: {
                                    tcpSocket: {
                                        port: 8080,
                                    },
                                    initialDelaySeconds: 30,
                                    periodSeconds: 10,
                                    timeoutSeconds: 3,
                                },
                            },
                        ],
                        volumes: [
                            {
                                name: 'wordpress-content',
                                persistentVolumeClaim: { claimName: 'wordpress-content' },
                            },
                        ],
                    },
                },
            },
        };

        await withRetry(
            async () => {
                try {
                    await appsApi().createNamespacedDeployment(cfg.namespace, deployment);
                    log.info('Deployment created');
                } catch (error: unknown) {
                    if (isK8sStatusCode(error, 409)) {
                        log.info('Deployment already exists');
                        return;
                    }
                    throw error;
                }
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying Deployment creation');
                },
            }
        );
    }

    private async createService(
        namespace: string,
        labels: StoreLabels
    ): Promise<void> {
        const log = this.log.child({ namespace });

        const service: k8s.V1Service = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: {
                name: 'wordpress',
                namespace,
                labels: {
                    ...getStoreLabels(labels),
                    'app.kubernetes.io/component': 'application',
                },
            },
            spec: {
                type: 'ClusterIP',
                selector: {
                    'app.kubernetes.io/name': 'wordpress',
                    'urumi.ai/store-id': labels.storeId,
                },
                ports: [
                    { port: 80, targetPort: 8080, name: 'http' },
                ],
            },
        };

        await withRetry(
            async () => {
                try {
                    await coreApi().createNamespacedService(namespace, service);
                    log.info('Service created');
                } catch (error: unknown) {
                    if (isK8sStatusCode(error, 409)) {
                        log.info('Service already exists');
                        return;
                    }
                    throw error;
                }
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying Service creation');
                },
            }
        );
    }

    private async createIngress(
        namespace: string,
        labels: StoreLabels,
        hostname: string
    ): Promise<void> {
        const log = this.log.child({ namespace, hostname });

        const ingress: k8s.V1Ingress = {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'Ingress',
            metadata: {
                name: 'wordpress',
                namespace,
                labels: {
                    ...getStoreLabels(labels),
                    'app.kubernetes.io/component': 'application',
                },
                annotations: {
                    'nginx.ingress.kubernetes.io/proxy-body-size': '50m',
                    'nginx.ingress.kubernetes.io/proxy-read-timeout': '300',
                },
            },
            spec: {
                ingressClassName: config.storeIngressClass,
                rules: [
                    {
                        host: hostname,
                        http: {
                            paths: [
                                {
                                    path: '/',
                                    pathType: 'Prefix',
                                    backend: {
                                        service: {
                                            name: 'wordpress',
                                            port: { number: 80 },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        };

        await withRetry(
            async () => {
                try {
                    await networkingApi().createNamespacedIngress(namespace, ingress);
                    log.info('Ingress created');
                } catch (error: unknown) {
                    if (isK8sStatusCode(error, 409)) {
                        log.info('Ingress already exists');
                        return;
                    }
                    throw error;
                }
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying Ingress creation');
                },
            }
        );
    }

    async waitForReady(namespace: string, timeoutMs: number): Promise<void> {
        const log = this.log.child({ namespace });
        const startTime = Date.now();

        log.info({ timeoutMs }, 'Waiting for WordPress to be ready');

        while (Date.now() - startTime < timeoutMs) {
            try {
                const response = await appsApi().readNamespacedDeployment('wordpress', namespace);
                const deployment = response.body;

                const readyReplicas = deployment.status?.readyReplicas || 0;
                const desiredReplicas = deployment.spec?.replicas || 1;

                if (readyReplicas >= desiredReplicas) {
                    log.info({ readyReplicas }, 'WordPress is ready');
                    return;
                }

                log.debug({ readyReplicas, desiredReplicas }, 'WordPress not ready yet');
            } catch (error) {
                log.debug({ err: error }, 'Error checking WordPress status');
            }

            await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        throw new Error(`WordPress not ready after ${timeoutMs}ms`);
    }

    private generatePassword(): string {
        return crypto.randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    }
}

// Export singleton
export const wordpressService = new WordPressService();
