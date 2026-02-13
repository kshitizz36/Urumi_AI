// Per-IP rate limiting. Stricter on store creation/deletion (expensive K8s ops).

import rateLimit from 'express-rate-limit';

// Global write limiter  only counts POST/PUT/DELETE (mutating ops).
// GET requests (polling, listing) are free  they're read-only.
// Health probes are also skipped.
export const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'GET' || req.path.startsWith('/health'),
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later.',
        },
    },
});

// 5 creations / 10 min  provisioning is expensive
export const storeCreationLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many store creation requests. Max 5 stores per 10 minutes.',
        },
    },
});

// 10 deletions / 10 min
export const storeDeletionLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many store deletion requests. Max 10 deletions per 10 minutes.',
        },
    },
});
