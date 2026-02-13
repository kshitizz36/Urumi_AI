// Deploys MySQL via StatefulSet into a store namespace.
// Single replica with PVC. WooCommerce requires MySQL, not Postgres.

import * as k8s from '@kubernetes/client-node';
import { coreApi, appsApi } from './client.js';
import { logger } from '../../utils/logger.js';
import { withRetry, isRetryableK8sError, isK8sStatusCode } from '../../utils/retry.js';
import { getStoreLabels, StoreLabels } from './namespace.js';
import { config } from '../../config/index.js';
import crypto from 'crypto';

export interface MySQLDeploymentConfig {
    namespace: string;
    storeId: string;
    storeName: string;
    storageSize?: string;  // e.g., "1Gi"
}

export class MySQLService {
    private log = logger.child({ service: 'MySQLService' });

    async deploy(cfg: MySQLDeploymentConfig): Promise<{
        host: string;
        port: number;
        database: string;
        username: string;
        secretName: string;
    }> {
        const log = this.log.child({ storeId: cfg.storeId, namespace: cfg.namespace });
        const labels: StoreLabels = {
            storeId: cfg.storeId,
            storeName: cfg.storeName,
            engine: 'woocommerce',
        };

        log.info('Starting MySQL deployment');

        // 1. Create Secret with credentials
        const secretName = 'mysql-secret';
        const password = this.generatePassword();
        await this.createSecret(cfg.namespace, secretName, password, labels);

        // 2. Create StatefulSet
        await this.createStatefulSet(cfg, labels);

        // 3. Create Headless Service
        await this.createService(cfg.namespace, labels);

        log.info('MySQL deployment completed');

        // Return connection info
        return {
            host: `mysql.${cfg.namespace}.svc.cluster.local`,
            port: 3306,
            database: 'wordpress',
            username: 'wordpress',
            secretName,
        };
    }

    private async createSecret(
        namespace: string,
        name: string,
        password: string,
        labels: StoreLabels
    ): Promise<void> {
        const log = this.log.child({ namespace, secret: name });

        const secret: k8s.V1Secret = {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: {
                name,
                namespace,
                labels: {
                    ...getStoreLabels(labels),
                    'app.kubernetes.io/component': 'database',
                },
            },
            type: 'Opaque',
            stringData: {
                'root-password': this.generatePassword(), // Separate root password
                'wordpress-password': password,
                'wordpress-user': 'wordpress',
                'wordpress-database': 'wordpress',
            },
        };

        await withRetry(
            async () => {
                try {
                    await coreApi().createNamespacedSecret(namespace, secret);
                    log.info('Secret created');
                } catch (error: unknown) {
                    // If already exists, that's fine (idempotent)
                    if (isK8sStatusCode(error, 409)) {
                        log.info('Secret already exists');
                        return;
                    }
                    throw error;
                }
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying Secret creation');
                },
            }
        );
    }

    private async createStatefulSet(
        cfg: MySQLDeploymentConfig,
        labels: StoreLabels
    ): Promise<void> {
        const log = this.log.child({ namespace: cfg.namespace });
        const k8sLabels = {
            ...getStoreLabels(labels),
            'app.kubernetes.io/component': 'database',
            'app.kubernetes.io/name': 'mysql',
        };

        const statefulSet: k8s.V1StatefulSet = {
            apiVersion: 'apps/v1',
            kind: 'StatefulSet',
            metadata: {
                name: 'mysql',
                namespace: cfg.namespace,
                labels: k8sLabels,
            },
            spec: {
                serviceName: 'mysql',
                replicas: 1,
                selector: {
                    matchLabels: {
                        'app.kubernetes.io/name': 'mysql',
                        'urumi.ai/store-id': cfg.storeId,
                    },
                },
                template: {
                    metadata: {
                        labels: k8sLabels,
                    },
                    spec: {
                        securityContext: {
                            fsGroup: 999,
                        },
                        containers: [
                            {
                                name: 'mysql',
                                image: 'mysql:8.0',
                                ports: [{ containerPort: 3306, name: 'mysql' }],
                                env: [
                                    {
                                        name: 'MYSQL_ROOT_PASSWORD',
                                        valueFrom: {
                                            secretKeyRef: { name: 'mysql-secret', key: 'root-password' },
                                        },
                                    },
                                    {
                                        name: 'MYSQL_DATABASE',
                                        valueFrom: {
                                            secretKeyRef: { name: 'mysql-secret', key: 'wordpress-database' },
                                        },
                                    },
                                    {
                                        name: 'MYSQL_USER',
                                        valueFrom: {
                                            secretKeyRef: { name: 'mysql-secret', key: 'wordpress-user' },
                                        },
                                    },
                                    {
                                        name: 'MYSQL_PASSWORD',
                                        valueFrom: {
                                            secretKeyRef: { name: 'mysql-secret', key: 'wordpress-password' },
                                        },
                                    },
                                ],
                                resources: {
                                    requests: { cpu: '100m', memory: '256Mi' },
                                    limits: { cpu: '500m', memory: '512Mi' },
                                },
                                volumeMounts: [
                                    { name: 'data', mountPath: '/var/lib/mysql' },
                                ],
                // Readiness probe  simple ping without auth (MySQL allows localhost root)
                                readinessProbe: {
                                    exec: {
                                        command: [
                                            'mysqladmin',
                                            'ping',
                                            '-h',
                                            'localhost',
                                        ],
                                    },
                                    initialDelaySeconds: 10,
                                    periodSeconds: 3,
                                    timeoutSeconds: 3,
                                },
                // Liveness probe
                                livenessProbe: {
                                    exec: {
                                        command: [
                                            'mysqladmin',
                                            'ping',
                                            '-h',
                                            'localhost',
                                        ],
                                    },
                                    initialDelaySeconds: 30,
                                    periodSeconds: 10,
                                    timeoutSeconds: 5,
                                },
                            },
                        ],
                    },
                },
                // PVC template
                volumeClaimTemplates: [
                    {
                        metadata: {
                            name: 'data',
                            labels: k8sLabels,
                        },
                        spec: {
                            accessModes: ['ReadWriteOnce'],
                            resources: {
                                requests: {
                                    storage: cfg.storageSize || config.mysqlStorageSize,
                                },
                            },
                        },
                    },
                ],
            },
        };

        await withRetry(
            async () => {
                try {
                    await appsApi().createNamespacedStatefulSet(cfg.namespace, statefulSet);
                    log.info('StatefulSet created');
                } catch (error: unknown) {
                    if (isK8sStatusCode(error, 409)) {
                        log.info('StatefulSet already exists');
                        return;
                    }
                    throw error;
                }
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying StatefulSet creation');
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
                name: 'mysql',
                namespace,
                labels: {
                    ...getStoreLabels(labels),
                    'app.kubernetes.io/component': 'database',
                },
            },
            spec: {
                clusterIP: 'None',
                selector: {
                    'app.kubernetes.io/name': 'mysql',
                    'urumi.ai/store-id': labels.storeId,
                },
                ports: [
                    { port: 3306, targetPort: 3306, name: 'mysql' },
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

    async waitForReady(namespace: string, timeoutMs: number): Promise<void> {
        const log = this.log.child({ namespace });
        const startTime = Date.now();

        log.info({ timeoutMs }, 'Waiting for MySQL to be ready');

        while (Date.now() - startTime < timeoutMs) {
            try {
                const response = await appsApi().readNamespacedStatefulSet('mysql', namespace);
                const sts = response.body;

                const readyReplicas = sts.status?.readyReplicas || 0;
                const desiredReplicas = sts.spec?.replicas || 1;

                if (readyReplicas >= desiredReplicas) {
                    log.info({ readyReplicas }, 'MySQL is ready');
                    return;
                }

                log.debug({ readyReplicas, desiredReplicas }, 'MySQL not ready yet');
            } catch (error) {
                log.debug({ err: error }, 'Error checking MySQL status');
            }

            await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        throw new Error(`MySQL not ready after ${timeoutMs}ms`);
    }

    private generatePassword(): string {
        return crypto.randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    }
}

// Export singleton
export const mysqlService = new MySQLService();
