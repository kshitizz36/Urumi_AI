// Wraps async operations with a timeout to prevent indefinite hangs.
// Critical for K8s API calls that can stall forever.

export class TimeoutError extends Error {
    public readonly timeoutMs: number;
    public readonly operation: string;

    constructor(message: string, timeoutMs: number, operation?: string) {
        super(message);
        this.name = 'TimeoutError';
        this.timeoutMs = timeoutMs;
        this.operation = operation || 'unknown';

        Error.captureStackTrace(this, TimeoutError);
    }
}

export async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message?: string,
    onTimeout?: () => void | Promise<void>
): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new TimeoutError(
                message || `Operation timed out after ${timeoutMs}ms`,
                timeoutMs
            ));
        }, timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutId!);
        return result;
    } catch (error) {
        clearTimeout(timeoutId!);

        // If it's a timeout error and we have cleanup, run it
        if (error instanceof TimeoutError && onTimeout) {
            try {
                await onTimeout();
            } catch (cleanupError) {
                // Log cleanup error but throw original timeout error
                console.error('Cleanup after timeout failed:', cleanupError);
            }
        }

        throw error;
    }
}

export function createDeadline(deadlineMs: number) {
    const startTime = Date.now();
    const absoluteDeadline = startTime + deadlineMs;

    return {
        /** Time remaining until deadline */
        get remaining(): number {
            return Math.max(0, absoluteDeadline - Date.now());
        },

        /** Check if deadline has passed */
        get expired(): boolean {
            return Date.now() >= absoluteDeadline;
        },

        /** Throw if deadline has passed */
        check(operation?: string): void {
            if (this.expired) {
                throw new TimeoutError(
                    `Deadline exceeded for ${operation || 'operation'}`,
                    deadlineMs,
                    operation
                );
            }
        },

        /** Wrap a promise with remaining time as timeout */
        async wrap<T>(promise: Promise<T>, operation?: string): Promise<T> {
            if (this.expired) {
                throw new TimeoutError(
                    `Deadline already exceeded for ${operation || 'operation'}`,
                    deadlineMs,
                    operation
                );
            }
            return withTimeout(
                promise,
                this.remaining,
                `Deadline exceeded for ${operation || 'operation'}`
            );
        },
    };
}
