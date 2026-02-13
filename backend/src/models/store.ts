// Store model and in-memory store. States: pending → provisioning → ready | failed.
// Uses Zod for request validation.

import { z } from 'zod';

export const StoreStatus = {
    PENDING: 'pending',
    PROVISIONING: 'provisioning',
    READY: 'ready',
    FAILED: 'failed',
    DELETING: 'deleting',
    DELETED: 'deleted',
} as const;

export type StoreStatus = (typeof StoreStatus)[keyof typeof StoreStatus];

export const ProvisioningPhase = {
    NAMESPACE: 'namespace',
    DATABASE: 'database',
    APPLICATION: 'application',
    VALIDATION: 'validation',
} as const;

export type ProvisioningPhase = (typeof ProvisioningPhase)[keyof typeof ProvisioningPhase];

export const StoreEngine = {
    WOOCOMMERCE: 'woocommerce',
    MEDUSA: 'medusa', // Stubbed for architecture demonstration
} as const;

export type StoreEngine = (typeof StoreEngine)[keyof typeof StoreEngine];

export const createStoreSchema = z.object({
    name: z
        .string()
        .min(3, 'Store name must be at least 3 characters')
        .max(50, 'Store name must be at most 50 characters')
        .regex(/^[a-z0-9-]+$/, 'Store name can only contain lowercase letters, numbers, and hyphens'),
    engine: z
        .enum([StoreEngine.WOOCOMMERCE, StoreEngine.MEDUSA])
        .default(StoreEngine.WOOCOMMERCE),
});

export type CreateStoreRequest = z.infer<typeof createStoreSchema>;

export interface Store {
    // Identity
    id: string;                    // UUID
    name: string;                  // User-provided name
    namespace: string;             // K8s namespace (store-{id})
    engine: StoreEngine;           // woocommerce | medusa

    // Status
    status: StoreStatus;
    phase?: ProvisioningPhase;     // Current phase during provisioning
    errorMessage?: string;         // Error details if failed
    errorPhase?: ProvisioningPhase; // Phase where error occurred

    // Endpoints (populated when ready)
    url?: string;                  // Store frontend URL
    adminUrl?: string;             // Store admin URL

    // Resource info
    mysqlReady: boolean;
    wordpressReady: boolean;

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
    readyAt?: Date;                // When store became ready
    deletedAt?: Date;              // Soft delete timestamp

    // Metadata
    provisioningDurationMs?: number; // Time from pending to ready
}

export interface StoreUpdate {
    status?: StoreStatus;
    phase?: ProvisioningPhase;
    errorMessage?: string;
    errorPhase?: ProvisioningPhase;
    url?: string;
    adminUrl?: string;
    mysqlReady?: boolean;
    wordpressReady?: boolean;
    readyAt?: Date;
    deletedAt?: Date;
    provisioningDurationMs?: number;
}

export interface StoreListResponse {
    stores: Store[];
    total: number;
    page: number;
    pageSize: number;
}

export interface StoreFilter {
    status?: StoreStatus;
    engine?: StoreEngine;
    search?: string;
    page?: number;
    pageSize?: number;
}

export function getNamespaceName(storeId: string): string {
    return `store-${storeId}`;
}

export function getStoreUrl(storeId: string, domain: string): string {
    // For local dev: store-abc123.localhost
    // For prod: store-abc123.stores.example.com
    return `http://store-${storeId}.${domain}`;
}

export function getAdminUrl(storeId: string, domain: string): string {
    return `${getStoreUrl(storeId, domain)}/wp-admin`;
}

export function canTransitionTo(current: StoreStatus, target: StoreStatus): boolean {
    const validTransitions: Record<StoreStatus, StoreStatus[]> = {
        [StoreStatus.PENDING]: [StoreStatus.PROVISIONING, StoreStatus.FAILED, StoreStatus.DELETING],
        [StoreStatus.PROVISIONING]: [StoreStatus.READY, StoreStatus.FAILED],
        [StoreStatus.READY]: [StoreStatus.DELETING],
        [StoreStatus.FAILED]: [StoreStatus.DELETING, StoreStatus.PROVISIONING], // Retry allowed
        [StoreStatus.DELETING]: [StoreStatus.DELETED, StoreStatus.FAILED],
        [StoreStatus.DELETED]: [], // Terminal state
    };

    return validTransitions[current]?.includes(target) ?? false;
}

export function isTerminalState(status: StoreStatus): boolean {
    return status === StoreStatus.DELETED;
}

export function isActiveState(status: StoreStatus): boolean {
    const activeStates: StoreStatus[] = [StoreStatus.PENDING, StoreStatus.PROVISIONING, StoreStatus.DELETING];
    return activeStates.includes(status);
}
