// Orchestrates end-to-end store provisioning on K8s.
// Phases: namespace → mysql → wordpress → validation
// Each phase is checkpointed; on failure the namespace is cleaned up.

import { v4 as uuidv4 } from 'uuid';
import { createStoreLogger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { createDeadline } from '../../utils/timeout.js';
import { namespaceService } from '../k8s/namespace.js';
import { mysqlService } from '../k8s/mysql.js';
import { wordpressService } from '../k8s/wordpress.js';
import { wooCommerceSetupService } from '../k8s/woocommerce-setup.js';
import { auditLogger, AuditAction } from '../audit/auditLogger.js';
import { storeRepository } from '../database/index.js';
import {
    Store,
    StoreStatus,
    StoreEngine,
    ProvisioningPhase,
    CreateStoreRequest,
    getNamespaceName,
} from '../../models/store.js';

export interface ProvisioningResult {
    success: boolean;
    store: Store;
    error?: string;
    phase?: ProvisioningPhase;
}

// PostgreSQL-backed store storage (replaces in-memory Map)
const storeStorage = storeRepository;

export class ProvisioningOrchestrator {
    // Logger is created per-operation with store context

    async createStore(request: CreateStoreRequest): Promise<ProvisioningResult> {
        // Guard: MedusaJS is stubbed  not yet implemented
        if (request.engine === StoreEngine.MEDUSA) {
            return {
                success: false,
                store: {
                    id: 'n/a',
                    name: request.name,
                    namespace: 'n/a',
                    engine: request.engine,
                    status: StoreStatus.FAILED,
                    mysqlReady: false,
                    wordpressReady: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    errorMessage: 'MedusaJS engine is not yet implemented. Architecture supports it  see ARCHITECTURE.md for the extension plan.',
                },
                error: 'MedusaJS engine is not yet implemented',
            };
        }

        // Abuse prevention: max 10 active stores
        const allStores = await storeStorage.findAll();
        const activeStores = allStores.filter(
            s => s.status !== StoreStatus.FAILED && s.status !== StoreStatus.DELETED
        );
        if (activeStores.length >= 10) {
            return {
                success: false,
                store: {
                    id: 'n/a',
                    name: request.name,
                    namespace: 'n/a',
                    engine: request.engine,
                    status: StoreStatus.FAILED,
                    mysqlReady: false,
                    wordpressReady: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    errorMessage: 'Maximum number of active stores (10) reached. Delete existing stores before creating new ones.',
                },
                error: 'Max stores limit reached',
            };
        }

        // Generate unique store ID
        const storeId = uuidv4().slice(0, 8); // Short ID for readability
        const namespace = getNamespaceName(storeId);
        const log = createStoreLogger(storeId);

        log.info({ request }, 'Starting store provisioning');

        // Create store record in provisioning state
        const store = await storeStorage.create({
            id: storeId,
            name: request.name,
            namespace,
            engine: request.engine,
            status: StoreStatus.PROVISIONING,
            phase: ProvisioningPhase.NAMESPACE,
            mysqlReady: false,
            wordpressReady: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Fire-and-forget: provision in background
        this.provisionInBackground(storeId, request, namespace, log).catch((err) => {
            log.error({ err }, 'Unhandled error in background provisioning');
        });

        // Audit log
        auditLogger.record({
            action: AuditAction.STORE_CREATE_STARTED,
            storeId,
            storeName: request.name,
            engine: request.engine,
        });

        return { success: true, store };
    }

    private async provisionInBackground(
        storeId: string,
        request: CreateStoreRequest,
        namespace: string,
        log: ReturnType<typeof createStoreLogger>
    ): Promise<void> {
        const startTime = Date.now();

        try {
            // Create deadline for total provisioning time (5 min)
            const deadline = createDeadline(300000);

            // Phase 1: Namespace
            log.info({ phase: ProvisioningPhase.NAMESPACE }, 'Phase 1: Creating namespace');

            await deadline.wrap(
                namespaceService.createNamespace(namespace, {
                    storeId,
                    storeName: request.name,
                    engine: request.engine,
                }),
                'namespace creation'
            );

            await storeStorage.update(storeId, {
                phase: ProvisioningPhase.DATABASE,
            });

            // Phase 2: MySQL
            log.info({ phase: ProvisioningPhase.DATABASE }, 'Phase 2: Deploying MySQL');

            const mysqlInfo = await deadline.wrap(
                mysqlService.deploy({
                    namespace,
                    storeId,
                    storeName: request.name,
                }),
                'MySQL deployment'
            );

            // Wait for MySQL to be ready
            await deadline.wrap(
                mysqlService.waitForReady(namespace, config.mysqlReadyTimeout),
                'MySQL readiness'
            );

            await storeStorage.update(storeId, {
                mysqlReady: true,
                phase: ProvisioningPhase.APPLICATION,
            });

            // Phase 3: WordPress
            log.info({ phase: ProvisioningPhase.APPLICATION }, 'Phase 3: Deploying WordPress');

            const wpInfo = await deadline.wrap(
                wordpressService.deploy({
                    namespace,
                    storeId,
                    storeName: request.name,
                    mysqlHost: mysqlInfo.host,
                    mysqlSecretName: mysqlInfo.secretName,
                }),
                'WordPress deployment'
            );

            // Wait for WordPress to be ready
            await deadline.wrap(
                wordpressService.waitForReady(namespace, config.wordpressReadyTimeout),
                'WordPress readiness'
            );

            await storeStorage.update(storeId, {
                wordpressReady: true,
                phase: ProvisioningPhase.VALIDATION,
            });

            // Phase 4: Validation + WooCommerce setup
            log.info({ phase: ProvisioningPhase.VALIDATION }, 'Phase 4: Validating store');

            // Auto-configure WooCommerce (COD payment + sample products)
            const hostname = `store-${storeId}.${config.storeDomain}`;
            await wooCommerceSetupService.setup({
                namespace,
                storeId,
                hostname,
            });

            const provisioningDuration = Date.now() - startTime;

            // Update to READY
            await storeStorage.update(storeId, {
                status: StoreStatus.READY,
                phase: undefined,
                url: wpInfo.url,
                adminUrl: wpInfo.adminUrl,
                readyAt: new Date(),
                provisioningDurationMs: provisioningDuration,
            });

            log.info(
                { duration: provisioningDuration, url: wpInfo.url },
                'Store provisioned successfully'
            );

            // Audit log
            auditLogger.record({
                action: AuditAction.STORE_CREATE_SUCCEEDED,
                storeId,
                storeName: request.name,
                engine: request.engine,
                duration: provisioningDuration,
                details: { url: wpInfo.url, adminUrl: wpInfo.adminUrl },
            });

        } catch (error) {
            // Handle provisioning failure
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const currentStore = await storeStorage.findById(storeId);
            const failedPhase = currentStore?.phase;

            log.error(
                { err: error, phase: failedPhase },
                'Store provisioning failed'
            );

            // Update store to failed state
            await storeStorage.update(storeId, {
                status: StoreStatus.FAILED,
                errorMessage,
                errorPhase: failedPhase,
            });

            // Audit log
            auditLogger.record({
                action: AuditAction.STORE_CREATE_FAILED,
                storeId,
                storeName: request.name,
                engine: request.engine,
                details: { error: errorMessage, phase: failedPhase },
            });

            // Cleanup: Delete namespace to cascade-delete all resources
            try {
                log.info('Cleaning up failed provisioning');
                await namespaceService.deleteNamespace(namespace);
            } catch (cleanupError) {
                log.error({ err: cleanupError }, 'Cleanup failed - manual intervention may be needed');
            }
        }
    }

    async deleteStore(storeId: string): Promise<{ success: boolean; error?: string }> {
        const log = createStoreLogger(storeId);

        const store = await storeStorage.findById(storeId);
        if (!store) {
            return { success: false, error: 'Store not found' };
        }

        if (store.status === StoreStatus.DELETED) {
            return { success: true }; // Already deleted
        }

        log.info('Starting store deletion');

        try {
            // Mark as deleting
            await storeStorage.update(storeId, {
                status: StoreStatus.DELETING,
            });

            // Delete namespace (cascades all resources)
            await namespaceService.deleteNamespace(store.namespace);

            // Wait for namespace to be fully deleted
            await namespaceService.waitForDeletion(store.namespace, 60000);

            // Mark as deleted (soft delete)
            await storeStorage.softDelete(storeId);

            log.info('Store deleted successfully');

            return { success: true };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error({ err: error }, 'Store deletion failed');

            // Revert to failed state if deletion fails
            await storeStorage.update(storeId, {
                status: StoreStatus.FAILED,
                errorMessage: `Deletion failed: ${errorMessage}`,
            });

            return { success: false, error: errorMessage };
        }
    }

    async getStore(storeId: string): Promise<Store | null> {
        return storeStorage.findById(storeId);
    }

    async listStores(): Promise<Store[]> {
        return storeStorage.findAll();
    }
}

// Export singleton
export const provisioningOrchestrator = new ProvisioningOrchestrator();
