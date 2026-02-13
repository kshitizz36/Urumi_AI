// Manages per-store K8s namespaces with ResourceQuota, LimitRange, and NetworkPolicy.
// Namespace-per-store gives clean isolation and cascading deletes.

import * as k8s from '@kubernetes/client-node';
import { coreApi, networkingApi } from './client.js';
import { logger } from '../../utils/logger.js';
import { withRetry, isRetryableK8sError, isK8sStatusCode } from '../../utils/retry.js';

export interface StoreLabels {
    storeId: string;
    storeName: string;
    engine: string;
}

export function getStoreLabels(labels: StoreLabels): Record<string, string> {
    return {
        'app.kubernetes.io/managed-by': 'urumi-platform',
        'app.kubernetes.io/part-of': labels.storeId,
        'urumi.ai/store-id': labels.storeId,
        'urumi.ai/store-name': labels.storeName,
        'urumi.ai/engine': labels.engine,
    };
}

export class NamespaceService {
    private log = logger.child({ service: 'NamespaceService' });

    async createNamespace(
        name: string,
        labels: StoreLabels
    ): Promise<k8s.V1Namespace> {
        const log = this.log.child({ namespace: name, storeId: labels.storeId });

        // Check if namespace already exists (idempotent)
        const existing = await this.getNamespace(name);
        if (existing) {
            log.info('Namespace already exists, skipping creation');
            return existing;
        }

        log.info('Creating namespace');

        const namespaceSpec: k8s.V1Namespace = {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: {
                name,
                labels: getStoreLabels(labels),
                annotations: {
                    'urumi.ai/created-at': new Date().toISOString(),
                },
            },
        };

        const namespace = await withRetry(
            async () => {
                const response = await coreApi().createNamespace(namespaceSpec);
                return response.body;
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying namespace creation');
                },
            }
        );

        log.info('Namespace created successfully');

        // Apply ResourceQuota
        await this.applyResourceQuota(name, labels);

        // Apply LimitRange
        await this.applyLimitRange(name, labels);

        // Apply NetworkPolicy (deny-by-default + allow ingress controller)
        await this.applyNetworkPolicy(name, labels);

        return namespace;
    }

    async getNamespace(name: string): Promise<k8s.V1Namespace | null> {
        try {
            const response = await coreApi().readNamespace(name);
            return response.body;
        } catch (error: unknown) {
            // @kubernetes/client-node throws HttpError with statusCode property
            // The message is generic "HTTP request failed", so check statusCode
            if (isK8sStatusCode(error, 404)) {
                return null;
            }
            throw error;
        }
    }

    async deleteNamespace(name: string): Promise<void> {
        const log = this.log.child({ namespace: name });

        // Check if namespace exists
        const existing = await this.getNamespace(name);
        if (!existing) {
            log.info('Namespace does not exist, nothing to delete');
            return;
        }

        log.info('Deleting namespace (cascading to all resources)');

        await withRetry(
            async () => {
                await coreApi().deleteNamespace(
                    name,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    // Foreground propagation = wait for children to be deleted
                    'Foreground'
                );
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying namespace deletion');
                },
            }
        );

        log.info('Namespace deletion initiated');
    }

    async waitForDeletion(name: string, timeoutMs: number = 60000): Promise<void> {
        const log = this.log.child({ namespace: name });
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const ns = await this.getNamespace(name);
            if (!ns) {
                log.info('Namespace fully deleted');
                return;
            }

            log.debug({ phase: ns.status?.phase }, 'Waiting for namespace deletion');
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        throw new Error(`Namespace ${name} deletion timed out after ${timeoutMs}ms`);
    }

    private async applyResourceQuota(
        namespace: string,
        labels: StoreLabels
    ): Promise<void> {
        const log = this.log.child({ namespace });

        const quota: k8s.V1ResourceQuota = {
            apiVersion: 'v1',
            kind: 'ResourceQuota',
            metadata: {
                name: 'store-quota',
                namespace,
                labels: getStoreLabels(labels),
            },
            spec: {
                hard: {
                    // CPU limits
                    'requests.cpu': '500m',
                    'limits.cpu': '2',
                    // Memory limits  
                    'requests.memory': '512Mi',
                    'limits.memory': '2Gi',
                    // Storage limits
                    'requests.storage': '5Gi',
                    'persistentvolumeclaims': '3',
                    // Object count limits
                    pods: '10',
                    services: '5',
                    secrets: '10',
                    configmaps: '10',
                },
            },
        };

        await withRetry(
            async () => {
                await coreApi().createNamespacedResourceQuota(namespace, quota);
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying ResourceQuota creation');
                },
            }
        );

        log.info('ResourceQuota applied');
    }

    private async applyLimitRange(
        namespace: string,
        labels: StoreLabels
    ): Promise<void> {
        const log = this.log.child({ namespace });

        const limitRange: k8s.V1LimitRange = {
            apiVersion: 'v1',
            kind: 'LimitRange',
            metadata: {
                name: 'store-limits',
                namespace,
                labels: getStoreLabels(labels),
            },
            spec: {
                limits: [
                    {
                        type: 'Container',
                        // Note: K8s client uses _default (underscored) property name
                        _default: {
                            cpu: '500m',
                            memory: '512Mi',
                        },
                        defaultRequest: {
                            cpu: '100m',
                            memory: '128Mi',
                        },
                        min: {
                            cpu: '50m',
                            memory: '64Mi',
                        },
                        max: {
                            cpu: '1',
                            memory: '1Gi',
                        },
                    },
                ],
            },
        };

        await withRetry(
            async () => {
                await coreApi().createNamespacedLimitRange(namespace, limitRange);
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying LimitRange creation');
                },
            }
        );

        log.info('LimitRange applied');
    }

    async listStoreNamespaces(): Promise<k8s.V1Namespace[]> {
        const response = await coreApi().listNamespace(
            undefined,
            undefined,
            undefined,
            undefined,
            'app.kubernetes.io/managed-by=urumi-platform'
        );
        return response.body.items;
    }

    // NetworkPolicy: deny-by-default, allow ingress-nginx + intra-namespace
    private async applyNetworkPolicy(
        namespace: string,
        labels: StoreLabels
    ): Promise<void> {
        const log = this.log.child({ namespace });

        const policy: k8s.V1NetworkPolicy = {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'NetworkPolicy',
            metadata: {
                name: 'store-isolation',
                namespace,
                labels: getStoreLabels(labels),
            },
            spec: {
                // Apply to all pods in this namespace
                podSelector: {},
                policyTypes: ['Ingress', 'Egress'],
                ingress: [
                    {
                        // Allow traffic from nginx ingress controller
                        from: [
                            {
                                namespaceSelector: {
                                    matchLabels: {
                                        'kubernetes.io/metadata.name': 'ingress-nginx',
                                    },
                                },
                            },
                        ],
                    },
                    {
                        // Allow intra-namespace traffic (wordpress <-> mysql)
                        from: [
                            {
                                podSelector: {},
                            },
                        ],
                    },
                ],
                egress: [
                    {
                        // Allow DNS resolution
                        to: [
                            {
                                namespaceSelector: {},
                                podSelector: {
                                    matchLabels: { 'k8s-app': 'kube-dns' },
                                },
                            },
                        ],
                        ports: [
                            { port: 53, protocol: 'UDP' },
                            { port: 53, protocol: 'TCP' },
                        ],
                    },
                    {
                        // Allow intra-namespace traffic
                        to: [
                            {
                                podSelector: {},
                            },
                        ],
                    },
                    {
                        // Allow outbound HTTPS (for plugin downloads, updates)
                        ports: [
                            { port: 80, protocol: 'TCP' },
                            { port: 443, protocol: 'TCP' },
                        ],
                    },
                ],
            },
        };

        await withRetry(
            async () => {
                try {
                    await networkingApi().createNamespacedNetworkPolicy(namespace, policy);
                    log.info('NetworkPolicy applied');
                } catch (error: unknown) {
                    if (isK8sStatusCode(error, 409)) {
                        log.info('NetworkPolicy already exists');
                        return;
                    }
                    throw error;
                }
            },
            {
                maxRetries: 3,
                shouldRetry: isRetryableK8sError,
                onRetry: (err, attempt) => {
                    log.warn({ err, attempt }, 'Retrying NetworkPolicy creation');
                },
            }
        );
    }
}

export const namespaceService = new NamespaceService();
