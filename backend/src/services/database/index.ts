// PostgreSQL connection pool and store persistence layer.
// Replaces in-memory Map with durable storage that survives pod restarts.

import pg from 'pg';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import {
    Store,
    StoreStatus,
    StoreEngine,
    ProvisioningPhase,
} from '../../models/store.js';

const log = logger.child({ service: 'Database' });

const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    log.error({ err }, 'Unexpected PostgreSQL pool error');
});

// ============================================================================
// Schema initialization  runs on startup
// ============================================================================
export async function initDatabase(): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS stores (
                id              VARCHAR(16) PRIMARY KEY,
                name            VARCHAR(64) NOT NULL,
                namespace       VARCHAR(128) NOT NULL,
                engine          VARCHAR(32) NOT NULL DEFAULT 'woocommerce',
                status          VARCHAR(32) NOT NULL DEFAULT 'pending',
                phase           VARCHAR(32),
                url             TEXT,
                admin_url       TEXT,
                mysql_ready     BOOLEAN NOT NULL DEFAULT FALSE,
                wordpress_ready BOOLEAN NOT NULL DEFAULT FALSE,
                error_message   TEXT,
                error_phase     VARCHAR(32),
                provisioning_duration_ms INTEGER,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ready_at        TIMESTAMPTZ,
                deleted_at      TIMESTAMPTZ
            );

            CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);
            CREATE INDEX IF NOT EXISTS idx_stores_created_at ON stores(created_at DESC);
        `);
        log.info('Database schema initialized');
    } finally {
        client.release();
    }
}

// ============================================================================
// Store CRUD operations
// ============================================================================
export class StoreRepository {
    async create(store: Store): Promise<Store> {
        await pool.query(
            `INSERT INTO stores (id, name, namespace, engine, status, phase,
                mysql_ready, wordpress_ready, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                store.id,
                store.name,
                store.namespace,
                store.engine,
                store.status,
                store.phase || null,
                store.mysqlReady,
                store.wordpressReady,
                store.createdAt,
                store.updatedAt,
            ]
        );
        return store;
    }

    async update(id: string, updates: Partial<Store>): Promise<Store | null> {
        const setClauses: string[] = [];
        const values: unknown[] = [];
        let paramIdx = 1;

        const fieldMap: Record<string, string> = {
            status: 'status',
            phase: 'phase',
            url: 'url',
            adminUrl: 'admin_url',
            mysqlReady: 'mysql_ready',
            wordpressReady: 'wordpress_ready',
            errorMessage: 'error_message',
            errorPhase: 'error_phase',
            provisioningDurationMs: 'provisioning_duration_ms',
            readyAt: 'ready_at',
            deletedAt: 'deleted_at',
        };

        for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
            if (jsKey in updates) {
                setClauses.push(`${dbCol} = $${paramIdx}`);
                values.push((updates as Record<string, unknown>)[jsKey] ?? null);
                paramIdx++;
            }
        }

        // Always update timestamp
        setClauses.push(`updated_at = $${paramIdx}`);
        values.push(new Date());
        paramIdx++;

        // WHERE clause
        values.push(id);

        const result = await pool.query(
            `UPDATE stores SET ${setClauses.join(', ')} WHERE id = $${paramIdx}
             RETURNING *`,
            values
        );

        return result.rows[0] ? this.rowToStore(result.rows[0]) : null;
    }

    async findById(id: string): Promise<Store | null> {
        const result = await pool.query(
            'SELECT * FROM stores WHERE id = $1',
            [id]
        );
        return result.rows[0] ? this.rowToStore(result.rows[0]) : null;
    }

    async findAll(): Promise<Store[]> {
        const result = await pool.query(
            `SELECT * FROM stores WHERE status != $1
             ORDER BY created_at DESC`,
            [StoreStatus.DELETED]
        );
        return result.rows.map((row) => this.rowToStore(row));
    }

    async softDelete(id: string): Promise<void> {
        await pool.query(
            `UPDATE stores SET status = $1, deleted_at = NOW(), updated_at = NOW()
             WHERE id = $2`,
            [StoreStatus.DELETED, id]
        );
    }

    private rowToStore(row: Record<string, unknown>): Store {
        return {
            id: row.id as string,
            name: row.name as string,
            namespace: row.namespace as string,
            engine: row.engine as StoreEngine,
            status: row.status as StoreStatus,
            phase: (row.phase as ProvisioningPhase) || undefined,
            url: (row.url as string) || undefined,
            adminUrl: (row.admin_url as string) || undefined,
            mysqlReady: row.mysql_ready as boolean,
            wordpressReady: row.wordpress_ready as boolean,
            errorMessage: (row.error_message as string) || undefined,
            errorPhase: (row.error_phase as ProvisioningPhase) || undefined,
            provisioningDurationMs: (row.provisioning_duration_ms as number) || undefined,
            createdAt: new Date(row.created_at as string),
            updatedAt: new Date(row.updated_at as string),
            readyAt: row.ready_at ? new Date(row.ready_at as string) : undefined,
            deletedAt: row.deleted_at ? new Date(row.deleted_at as string) : undefined,
        };
    }
}

// Health check
export async function checkDatabaseHealth(): Promise<boolean> {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch {
        return false;
    }
}

// Graceful shutdown
export async function closeDatabasePool(): Promise<void> {
    await pool.end();
    log.info('Database pool closed');
}

// Singletons
export const storeRepository = new StoreRepository();
