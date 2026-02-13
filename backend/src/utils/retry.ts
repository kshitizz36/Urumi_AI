// Retry with exponential backoff + jitter for transient K8s/network failures.
// Only retries 5xx and network errors, not 4xx.

export function getK8sErrorStatusCode(error: unknown): number | undefined {
    if (typeof error === 'object' && error !== null) {
        const err = error as any;
        return err.statusCode ?? err.response?.statusCode ?? err.body?.code;
    }
    return undefined;
}

export function isK8sStatusCode(error: unknown, code: number): boolean {
    return getK8sErrorStatusCode(error) === code;
}

export interface RetryOptions {
    /** Maximum number of retry attempts (not counting initial attempt) */
    maxRetries?: number;

    /** Initial delay in milliseconds before first retry */
    initialDelayMs?: number;

    /** Maximum delay between retries (caps exponential growth) */
    maxDelayMs?: number;

    /** Multiplier for exponential backoff */
    backoffMultiplier?: number;

    /** Add random jitter to prevent thundering herd */
    jitter?: boolean;

    /** Function to determine if error is retryable */
    shouldRetry?: (error: Error) => boolean;

    /** Callback on each retry (for logging) */
    onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true,
    shouldRetry: () => true,
    onRetry: () => { },
};

export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Check if this is the last attempt
            if (attempt === opts.maxRetries) {
                break;
            }

            if (!opts.shouldRetry(lastError)) {
                throw lastError;
            }

            let delayMs = opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt);
            delayMs = Math.min(delayMs, opts.maxDelayMs);

            if (opts.jitter) {
                const jitterFactor = 0.75 + Math.random() * 0.5;
                delayMs = Math.floor(delayMs * jitterFactor);
            }

            opts.onRetry(lastError, attempt + 1, delayMs);
            await sleep(delayMs);
        }
    }

    // All retries exhausted
    throw lastError!;
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retryable: 429, 5xx, network errors. Not retryable: 4xx.
export function isRetryableK8sError(error: Error): boolean {
    if (error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ENOTFOUND')) {
        return true;
    }

    const statusMatch = error.message.match(/code[:\s]+(\d{3})/i);
    if (statusMatch) {
        const statusCode = parseInt(statusMatch[1], 10);
        return [429, 500, 502, 503, 504].includes(statusCode);
    }

    if (error.message.includes('too many requests') ||
        error.message.includes('service unavailable') ||
        error.message.includes('temporarily unavailable')) {
        return true;
    }

    return false;
}

export function createRetrier(baseOptions: RetryOptions) {
    return <T>(fn: () => Promise<T>, overrides: RetryOptions = {}): Promise<T> => {
        return withRetry(fn, { ...baseOptions, ...overrides });
    };
}
