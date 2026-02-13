// In-memory audit log tracking store create/delete actions.
// Queryable by storeId, exposed via GET /api/audit.
// TODO: persist to postgres in prod.

import { logger } from '../../utils/logger.js';

export const AuditAction = {
    STORE_CREATE_REQUESTED: 'store.create.requested',
    STORE_CREATE_STARTED: 'store.create.started',
    STORE_CREATE_SUCCEEDED: 'store.create.succeeded',
    STORE_CREATE_FAILED: 'store.create.failed',
    STORE_DELETE_REQUESTED: 'store.delete.requested',
    STORE_DELETE_SUCCEEDED: 'store.delete.succeeded',
    STORE_DELETE_FAILED: 'store.delete.failed',
    STORE_STATUS_CHANGED: 'store.status.changed',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
    id: string;
    timestamp: Date;
    action: AuditAction;
    storeId?: string;
    storeName?: string;
    engine?: string;
    sourceIp?: string;
    details?: Record<string, unknown>;
    duration?: number; // ms for completed actions
}

class AuditLogger {
    private entries: AuditEntry[] = [];
    private counter = 0;
    private log = logger.child({ service: 'AuditLogger' });

    record(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
        const auditEntry: AuditEntry = {
            ...entry,
            id: `audit-${++this.counter}`,
            timestamp: new Date(),
        };

        this.entries.push(auditEntry);

        // Also log structured for external log aggregation
        this.log.info({
            audit: true,
            action: auditEntry.action,
            storeId: auditEntry.storeId,
            storeName: auditEntry.storeName,
            engine: auditEntry.engine,
            sourceIp: auditEntry.sourceIp,
            details: auditEntry.details,
            duration: auditEntry.duration,
        }, `AUDIT: ${auditEntry.action}`);

        return auditEntry;
    }

    getEntries(filters?: {
        storeId?: string;
        action?: AuditAction;
        limit?: number;
    }): AuditEntry[] {
        let results = [...this.entries];

        if (filters?.storeId) {
            results = results.filter(e => e.storeId === filters.storeId);
        }
        if (filters?.action) {
            results = results.filter(e => e.action === filters.action);
        }

        // Most recent first
        results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        if (filters?.limit) {
            results = results.slice(0, filters.limit);
        }

        return results;
    }

    getStats(): {
        totalActions: number;
        storesCreated: number;
        storesDeleted: number;
        storesFailed: number;
    } {
        return {
            totalActions: this.entries.length,
            storesCreated: this.entries.filter(e => e.action === AuditAction.STORE_CREATE_SUCCEEDED).length,
            storesDeleted: this.entries.filter(e => e.action === AuditAction.STORE_DELETE_SUCCEEDED).length,
            storesFailed: this.entries.filter(e => e.action === AuditAction.STORE_CREATE_FAILED).length,
        };
    }
}

// Export singleton
export const auditLogger = new AuditLogger();
