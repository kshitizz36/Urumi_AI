// K8s client init. Auto-detects in-cluster vs kubeconfig.
// Exports coreApi, appsApi, networkingApi singletons.

import * as k8s from '@kubernetes/client-node';
import { logger } from '../../utils/logger.js';

class K8sClientManager {
    private kubeConfig: k8s.KubeConfig;
    private _coreApi: k8s.CoreV1Api | null = null;
    private _appsApi: k8s.AppsV1Api | null = null;
    private _networkingApi: k8s.NetworkingV1Api | null = null;
    private _customApi: k8s.CustomObjectsApi | null = null;

    constructor() {
        this.kubeConfig = new k8s.KubeConfig();
        this.loadConfiguration();
    }

    private loadConfiguration(): void {
        try {
            if (process.env.KUBECONFIG) {
                // Use specific kubeconfig file
                logger.info({ path: process.env.KUBECONFIG }, 'Loading kubeconfig from file');
                this.kubeConfig.loadFromFile(process.env.KUBECONFIG);
            } else if (this.isInCluster()) {
                // Running inside Kubernetes pod
                logger.info('Loading in-cluster configuration');
                this.kubeConfig.loadFromCluster();
            } else {
                // Default to ~/.kube/config
                logger.info('Loading default kubeconfig');
                this.kubeConfig.loadFromDefault();
            }

            const context = this.kubeConfig.getCurrentContext();
            logger.info({ context }, 'Kubernetes client initialized');
        } catch (error) {
            logger.error({ err: error }, 'Failed to load Kubernetes configuration');
            throw new Error('Unable to initialize Kubernetes client. Check your KUBECONFIG or cluster access.');
        }
    }

    private isInCluster(): boolean {
        // In-cluster config uses mounted ServiceAccount
        return (
            process.env.KUBERNETES_SERVICE_HOST !== undefined &&
            process.env.KUBERNETES_SERVICE_PORT !== undefined
        );
    }

    get coreApi(): k8s.CoreV1Api {
        if (!this._coreApi) {
            this._coreApi = this.kubeConfig.makeApiClient(k8s.CoreV1Api);
        }
        return this._coreApi;
    }

    get appsApi(): k8s.AppsV1Api {
        if (!this._appsApi) {
            this._appsApi = this.kubeConfig.makeApiClient(k8s.AppsV1Api);
        }
        return this._appsApi;
    }

    get networkingApi(): k8s.NetworkingV1Api {
        if (!this._networkingApi) {
            this._networkingApi = this.kubeConfig.makeApiClient(k8s.NetworkingV1Api);
        }
        return this._networkingApi;
    }

    get customApi(): k8s.CustomObjectsApi {
        if (!this._customApi) {
            this._customApi = this.kubeConfig.makeApiClient(k8s.CustomObjectsApi);
        }
        return this._customApi;
    }

    get rawConfig(): k8s.KubeConfig {
        return this.kubeConfig;
    }

    get clusterName(): string {
        return this.kubeConfig.getCurrentCluster()?.name || 'unknown';
    }

    async healthCheck(): Promise<{ healthy: boolean; message: string }> {
        try {
            await this.coreApi.listNamespace(undefined, undefined, undefined, undefined, undefined, 1);
            return { healthy: true, message: 'Kubernetes API reachable' };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { healthy: false, message: `Kubernetes API unreachable: ${message}` };
        }
    }
}

export const k8sClient = new K8sClientManager();

// Export typed APIs for convenience
export const coreApi = () => k8sClient.coreApi;
export const appsApi = () => k8sClient.appsApi;
export const networkingApi = () => k8sClient.networkingApi;
export const customApi = () => k8sClient.customApi;
