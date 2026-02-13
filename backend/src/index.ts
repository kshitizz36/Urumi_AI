// Express server setup with middleware, routes, and graceful shutdown for K8s.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import storeRoutes from './api/routes/stores.js';
import healthRoutes from './api/routes/health.js';
import {
    requestLogger,
    notFoundHandler,
    errorHandler,
} from './api/middleware/error.js';
import { globalLimiter } from './api/middleware/rateLimit.js';
import { auditLogger } from './services/audit/auditLogger.js';
import { initDatabase, closeDatabasePool } from './services/database/index.js';

const app = express();

// Trust first proxy (nginx / k8s ingress) so rate-limit sees real client IP
app.set('trust proxy', 1);

app.use(helmet());

// CORS configuration
app.use(cors({
    origin: config.nodeEnv === 'production'
        ? ['https://dashboard.urumi.ai']
        : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));

app.use(globalLimiter);
app.use(requestLogger);

app.use('/health', healthRoutes);
app.use('/api/stores', storeRoutes);

// Audit log endpoint
app.get('/api/audit', (_req, res) => {
    const { storeId, limit } = _req.query;
    const entries = auditLogger.getEntries({
        storeId: storeId as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
    });
    const stats = auditLogger.getStats();
    res.json({ success: true, data: { entries, stats } });
});

// API info endpoint
app.get('/api', (_req, res) => {
    res.json({
        name: 'Urumi Platform API',
        version: '1.0.0',
        description: 'Kubernetes-native store provisioning platform',
        endpoints: {
            stores: '/api/stores',
            health: '/health',
        },
    });
});

app.use(notFoundHandler);
app.use(errorHandler);

// Initialize database and start server
async function startServer() {
    try {
        await initDatabase();
        logger.info('Database initialized');
    } catch (err) {
        logger.fatal({ err }, 'Failed to initialize database  exiting');
        process.exit(1);
    }

    const server = app.listen(config.port, () => {
        logger.info({
            port: config.port,
            env: config.nodeEnv,
            cluster: 'pending',
        }, `🚀 Urumi Platform API started on port ${config.port}`);
    });

    // Graceful shutdown  K8s sends SIGTERM before SIGKILL
    async function gracefulShutdown(signal: string) {
        logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

        server.close(async (err) => {
            if (err) {
                logger.error({ err }, 'Error closing server');
                process.exit(1);
            }

            logger.info('HTTP server closed');

            // Close database pool
            await closeDatabasePool();

            logger.info('Graceful shutdown complete');
            process.exit(0);
        });

        // Force shutdown after 25 seconds (before K8s SIGKILL at 30s)
        setTimeout(() => {
            logger.error('Forced shutdown due to timeout');
            process.exit(1);
        }, 25000);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer();

process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled promise rejection');
    // Don't exit - let the error handler deal with it
});

export default app;
