// Store type definitions shared across the frontend.

export type StoreStatus =
    | 'pending'
    | 'provisioning'
    | 'ready'
    | 'failed'
    | 'deleting'
    | 'deleted';

export type StoreEngine = 'woocommerce' | 'medusa';

export type ProvisioningPhase =
    | 'namespace'
    | 'database'
    | 'application'
    | 'validation';

export interface Store {
    id: string;
    name: string;
    namespace: string;
    engine: StoreEngine;
    status: StoreStatus;
    phase?: ProvisioningPhase;
    errorMessage?: string;
    errorPhase?: ProvisioningPhase;
    url?: string;
    adminUrl?: string;
    mysqlReady: boolean;
    wordpressReady: boolean;
    createdAt: string;
    updatedAt: string;
    readyAt?: string;
    deletedAt?: string;
    provisioningDurationMs?: number;
}

export interface CreateStoreRequest {
    name: string;
    engine?: StoreEngine;
}

export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
}

export interface StoreListResponse {
    stores: Store[];
    total: number;
}
