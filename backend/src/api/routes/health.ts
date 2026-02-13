// Health check endpoints for K8s liveness/readiness probes.

import { Router, Request, Response } from 'express';
import { k8sClient } from '../../services/k8s/client.js';
import { checkDatabaseHealth } from '../../services/database/index.js';
import { logger } from '../../utils/logger.js';

const router = Router();

const startTime = Date.now();

router.get('/', (_req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
    });
});

// Liveness probe  only fails if process is stuck
router.get('/live', (_req: Request, res: Response) => {
    res.json({
        status: 'alive',
        timestamp: new Date().toISOString(),
    });
});

// Readiness probe  checks K8s API connectivity
router.get('/ready', async (_req: Request, res: Response) => {
    const checks: Record<string, { healthy: boolean; message: string }> = {};
    let allHealthy = true;

    try {
        const k8sHealth = await k8sClient.healthCheck();
        checks.kubernetes = k8sHealth;
        if (!k8sHealth.healthy) {
            allHealthy = false;
        }
    } catch (error) {
        checks.kubernetes = {
            healthy: false,
            message: error instanceof Error ? error.message : 'Unknown error',
        };
        allHealthy = false;
    }

    // Database health check
    try {
        const dbHealthy = await checkDatabaseHealth();
        checks.database = {
            healthy: dbHealthy,
            message: dbHealthy ? 'PostgreSQL connected' : 'PostgreSQL unreachable',
        };
        if (!dbHealthy) {
            allHealthy = false;
        }
    } catch (error) {
        checks.database = {
            healthy: false,
            message: error instanceof Error ? error.message : 'Unknown error',
        };
        allHealthy = false;
    }

    if (allHealthy) {
        res.json({
            status: 'ready',
            timestamp: new Date().toISOString(),
            checks,
        });
    } else {
        logger.warn({ checks }, 'Readiness check failed');
        res.status(503).json({
            status: 'not_ready',
            timestamp: new Date().toISOString(),
            checks,
        });
    }
});

router.get('/metrics', (_req: Request, res: Response) => {
    res.json({
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
        // TODO: Add store counts, provisioning metrics
    });
});

export default router;
