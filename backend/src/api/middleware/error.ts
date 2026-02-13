// Central error handler. Maps error types to HTTP status codes + JSON responses.

import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger.js';
import { TimeoutError } from '../../utils/timeout.js';
import { ZodError } from 'zod';
import { config } from '../../config/index.js';

export class AppError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly isOperational: boolean;
    public readonly details?: unknown;

    constructor(
        message: string,
        statusCode: number = 500,
        code: string = 'INTERNAL_ERROR',
        isOperational: boolean = true,
        details?: unknown
    ) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = isOperational;
        this.details = details;

        Error.captureStackTrace(this, this.constructor);
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string, id?: string) {
        const message = id
            ? `${resource} with ID '${id}' not found`
            : `${resource} not found`;
        super(message, 404, 'NOT_FOUND');
    }
}

export class ValidationError extends AppError {
    constructor(message: string, details?: unknown) {
        super(message, 400, 'VALIDATION_ERROR', true, details);
    }
}

export class K8sApiError extends AppError {
    constructor(message: string, details?: unknown) {
        super(message, 502, 'K8S_API_ERROR', true, details);
    }
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const log = logger.child({
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration,
        });

        if (res.statusCode >= 500) {
            log.error('Request completed with server error');
        } else if (res.statusCode >= 400) {
            log.warn('Request completed with client error');
        } else {
            log.info('Request completed');
        }
    });

    next();
}

export function notFoundHandler(req: Request, res: Response, _next: NextFunction) {
    res.status(404).json({
        success: false,
        error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${req.path} not found`,
        },
    });
}

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
) {
    if (res.headersSent) {
        return next(err);
    }

    const log = logger.child({
        method: req.method,
        path: req.path,
        errorName: err.name,
    });

    let statusCode = 500;
    let errorCode = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown = undefined;

    if (err instanceof AppError) {
        statusCode = err.statusCode;
        errorCode = err.code;
        message = err.message;
        details = err.details;

        if (err.isOperational) {
            log.warn({ err }, 'Operational error');
        } else {
            log.error({ err }, 'Programming error');
        }

    } else if (err instanceof TimeoutError) {
        statusCode = 504;
        errorCode = 'TIMEOUT';
        message = err.message;
        details = { operation: err.operation, timeoutMs: err.timeoutMs };
        log.warn({ err }, 'Timeout error');

    } else if (err instanceof ZodError) {
        statusCode = 400;
        errorCode = 'VALIDATION_ERROR';
        message = 'Request validation failed';
        details = err.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
        }));
        log.warn({ err }, 'Validation error');

    } else if (err.message.includes('404') || err.message.includes('not found')) {
        statusCode = 404;
        errorCode = 'NOT_FOUND';
        message = err.message;
        log.warn({ err }, 'Not found error');

    } else if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT')) {
        statusCode = 502;
        errorCode = 'CONNECTION_ERROR';
        message = 'Failed to connect to external service';
        log.error({ err }, 'Connection error');

    } else {
        log.error({ err }, 'Unhandled error');
    }

    const response: Record<string, unknown> = {
        success: false,
        error: {
            code: errorCode,
            message,
        },
    };

    if (details) {
        (response.error as Record<string, unknown>).details = details;
    }

    if (config.nodeEnv === 'development') {
        (response.error as Record<string, unknown>).stack = err.stack;
    }

    res.status(statusCode).json(response);
}
