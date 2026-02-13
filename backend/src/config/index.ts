// App config from env vars, validated with Zod at startup.
// Fails fast if required config is missing.

import { z } from 'zod';

const configSchema = z.object({
    // Server settings
    port: z.coerce.number().min(1).max(65535).default(3001),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    // Database settings
    databaseUrl: z.string().url().optional().default('postgresql://urumi:urumi@localhost:5432/urumi'),

    // Kubernetes settings
    kubeconfig: z.string().optional(),
    kubeNamespace: z.string().default('urumi-platform'),

    // Store provisioning settings
    storeDomain: z.string().default('localhost'),
    storeIngressClass: z.string().default('nginx'),

    // Timeouts (in milliseconds)
    mysqlReadyTimeout: z.coerce.number().default(90000),       // 1.5 minutes
    wordpressReadyTimeout: z.coerce.number().default(180000),  // 3 minutes
    healthCheckTimeout: z.coerce.number().default(30000),     // 30 seconds

    // Resource defaults
    mysqlStorageSize: z.string().default('1Gi'),
    wordpressStorageSize: z.string().default('2Gi'),

    // Retry settings
    maxRetries: z.coerce.number().default(3),
    retryDelayMs: z.coerce.number().default(1000),
});

type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
    const rawConfig = {
        port: process.env.PORT,
        nodeEnv: process.env.NODE_ENV,
        logLevel: process.env.LOG_LEVEL,
        databaseUrl: process.env.DATABASE_URL,
        kubeconfig: process.env.KUBECONFIG,
        kubeNamespace: process.env.KUBE_NAMESPACE,
        storeDomain: process.env.STORE_DOMAIN,
        storeIngressClass: process.env.STORE_INGRESS_CLASS,
        mysqlReadyTimeout: process.env.MYSQL_READY_TIMEOUT,
        wordpressReadyTimeout: process.env.WORDPRESS_READY_TIMEOUT,
        healthCheckTimeout: process.env.HEALTH_CHECK_TIMEOUT,
        mysqlStorageSize: process.env.MYSQL_STORAGE_SIZE,
        wordpressStorageSize: process.env.WORDPRESS_STORAGE_SIZE,
        maxRetries: process.env.MAX_RETRIES,
        retryDelayMs: process.env.RETRY_DELAY_MS,
    };

    const result = configSchema.safeParse(rawConfig);

    if (!result.success) {
        const errors = result.error.issues
            .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
            .join('\n');

        throw new Error(
            `Configuration validation failed:\n${errors}\n\n` +
            `Please check your environment variables.`
        );
    }

    return Object.freeze(result.data);
}

export const config = loadConfig();
export type { Config };
