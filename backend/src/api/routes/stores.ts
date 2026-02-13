// Store CRUD routes: POST /api/stores, GET /api/stores, DELETE /api/stores/:id

import { Router, Request, Response, NextFunction } from 'express';
import { createStoreSchema } from '../../models/store.js';
import { provisioningOrchestrator } from '../../services/provisioning/orchestrator.js';
import { logger } from '../../utils/logger.js';
import { storeCreationLimiter, storeDeletionLimiter } from '../middleware/rateLimit.js';
import { auditLogger, AuditAction } from '../../services/audit/auditLogger.js';

const router = Router();

router.post('/', storeCreationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const log = logger.child({ route: 'POST /stores' });

    try {
        // Validate request body
        const parseResult = createStoreSchema.safeParse(req.body);
        if (!parseResult.success) {
            const errors = parseResult.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            }));

            log.warn({ errors }, 'Validation failed');

            res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid request body',
                    details: errors,
                },
            });
            return;
        }

        // Audit: creation requested
        auditLogger.record({
            action: AuditAction.STORE_CREATE_REQUESTED,
            storeName: parseResult.data.name,
            engine: parseResult.data.engine,
            sourceIp: req.ip || req.socket.remoteAddress,
        });

        log.info({ request: parseResult.data }, 'Creating store');

        // Start provisioning in the background  returns immediately
        const result = await provisioningOrchestrator.createStore(parseResult.data);

        log.info({ storeId: result.store.id }, 'Store provisioning started');

        res.status(202).json({
            success: true,
            data: {
                store: result.store,
                message: 'Store provisioning started. Poll GET /api/stores for live status.',
            },
        });

    } catch (error) {
        next(error);
    }
});

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    const log = logger.child({ route: 'GET /stores' });

    try {
        const stores = await provisioningOrchestrator.listStores();

        log.info({ count: stores.length }, 'Listed stores');

        res.status(200).json({
            success: true,
            data: {
                stores,
                total: stores.length,
            },
        });

    } catch (error) {
        next(error);
    }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const log = logger.child({ route: 'GET /stores/:id', storeId: req.params.id });

    try {
        const store = await provisioningOrchestrator.getStore(req.params.id);

        if (!store) {
            log.warn('Store not found');

            res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: `Store ${req.params.id} not found`,
                },
            });
            return;
        }

        res.status(200).json({
            success: true,
            data: { store },
        });

    } catch (error) {
        next(error);
    }
});

router.delete('/:id', storeDeletionLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const log = logger.child({ route: 'DELETE /stores/:id', storeId: req.params.id });

    try {
        // Audit: deletion requested
        auditLogger.record({
            action: AuditAction.STORE_DELETE_REQUESTED,
            storeId: req.params.id,
            sourceIp: req.ip || req.socket.remoteAddress,
        });

        log.info('Deleting store');

        const result = await provisioningOrchestrator.deleteStore(req.params.id);

        if (result.success) {
            log.info('Store deleted successfully');

            // Audit: deletion succeeded
            auditLogger.record({
                action: AuditAction.STORE_DELETE_SUCCEEDED,
                storeId: req.params.id,
                sourceIp: req.ip || req.socket.remoteAddress,
            });

            res.status(200).json({
                success: true,
                data: {
                    message: 'Store deleted successfully',
                    storeId: req.params.id,
                },
            });
        } else if (result.error === 'Store not found') {
            res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: `Store ${req.params.id} not found`,
                },
            });
        } else {
            log.error({ error: result.error }, 'Store deletion failed');

            res.status(500).json({
                success: false,
                error: {
                    code: 'DELETION_FAILED',
                    message: result.error || 'Store deletion failed',
                    storeId: req.params.id,
                },
            });
        }

    } catch (error) {
        next(error);
    }
});

export default router;
