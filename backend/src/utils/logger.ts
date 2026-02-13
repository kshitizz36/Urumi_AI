// Pino-based structured JSON logger. Use child loggers for per-request/per-store context.

import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
    level: config.logLevel,

    redact: {
        paths: ['password', 'secret', 'token', 'authorization', '*.password', '*.secret'],
        censor: '[REDACTED]',
    },

    formatters: {
        level: (label) => ({ level: label }),
        bindings: (bindings) => ({
            pid: bindings.pid,
            host: bindings.hostname,
            service: 'urumi-api',
        }),
    },

    timestamp: pino.stdTimeFunctions.isoTime,

    base: {
        env: config.nodeEnv,
    },

    // Pretty print in development
    transport: config.nodeEnv === 'development'
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        }
        : undefined,
});

export function createStoreLogger(storeId: string) {
    return logger.child({ storeId });
}

export function createRequestLogger(requestId: string) {
    return logger.child({ requestId });
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
