// Advanced Retry Strategies for Resilient Operations
// Provides multiple retry patterns with jitter and backoff

export interface RetryOptions {
  maxRetries: number;
  strategy: 'exponential' | 'linear' | 'fibonacci' | 'decorrelated';
  baseDelay: number;      // Base delay in milliseconds
  maxDelay: number;       // Maximum delay cap
  jitter: boolean;        // Add randomization to prevent thundering herd
  factor?: number;        // Multiplier for exponential backoff
  onRetry?: (error: Error, attempt: number, nextDelay: number) => void | Promise<void>;
  shouldRetry?: (error: Error, attempt: number) => boolean;
  abortSignal?: AbortSignal;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public attempts: number,
    public lastError: Error,
    public errors: Error[]
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

// Fibonacci sequence for fibonacci strategy
const FIBONACCI_SEQUENCE = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];

// Default retry options
const DEFAULT_OPTIONS: Partial<RetryOptions> = {
  maxRetries: 3,
  strategy: 'exponential',
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: true,
  factor: 2
};

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate delay based on strategy
function calculateDelay(
  attempt: number,
  options: Required<RetryOptions>
): number {
  let delay: number;

  switch (options.strategy) {
    case 'exponential':
      delay = options.baseDelay * Math.pow(options.factor || 2, attempt);
      break;
    
    case 'linear':
      delay = options.baseDelay * (attempt + 1);
      break;
    
    case 'fibonacci':
      const fibIndex = Math.min(attempt, FIBONACCI_SEQUENCE.length - 1);
      delay = options.baseDelay * FIBONACCI_SEQUENCE[fibIndex];
      break;
    
    case 'decorrelated':
      // Decorrelated jitter backoff (recommended by AWS)
      const prevDelay = attempt === 0 ? 0 : options.baseDelay * Math.pow(2, attempt - 1);
      delay = Math.random() * Math.min(options.maxDelay, prevDelay * 3);
      delay = Math.max(options.baseDelay, delay);
      break;
    
    default:
      delay = options.baseDelay;
  }

  // Apply max delay cap
  delay = Math.min(delay, options.maxDelay);

  // Apply jitter if enabled (except for decorrelated which has built-in randomization)
  if (options.jitter && options.strategy !== 'decorrelated') {
    // Add ±25% jitter
    const jitterRange = delay * 0.25;
    delay = delay - jitterRange + (Math.random() * jitterRange * 2);
  }

  return Math.round(delay);
}

// Main retry function
export async function retryWithStrategy<T>(
  operation: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  const opts: Required<RetryOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
    factor: options?.factor || 2,
    onRetry: options?.onRetry || (() => {}),
    shouldRetry: options?.shouldRetry || (() => true),
    abortSignal: options?.abortSignal || undefined
  } as Required<RetryOptions>;

  const errors: Error[] = [];
  
  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    try {
      // Check abort signal
      if (opts.abortSignal?.aborted) {
        throw new Error('Operation aborted');
      }

      // Try the operation
      return await operation();
      
    } catch (error) {
      const err = error as Error;
      errors.push(err);

      // Check if we should retry
      if (!opts.shouldRetry(err, attempt)) {
        throw new RetryError(
          `Operation failed and retry condition not met: ${err.message}`,
          attempt + 1,
          err,
          errors
        );
      }

      // Check if this was the last attempt
      if (attempt === opts.maxRetries - 1) {
        throw new RetryError(
          `Operation failed after ${opts.maxRetries} attempts: ${err.message}`,
          opts.maxRetries,
          err,
          errors
        );
      }

      // Calculate next delay
      const nextDelay = calculateDelay(attempt, opts);
      
      // Call onRetry callback
      await opts.onRetry(err, attempt, nextDelay);

      // Wait before next attempt
      await sleep(nextDelay);
    }
  }

  // This should never be reached
  throw new Error('Retry logic error');
}

// Convenience functions for specific strategies
export const retryExponential = <T>(
  operation: () => Promise<T>,
  options?: Partial<Omit<RetryOptions, 'strategy'>>
) => retryWithStrategy(operation, { ...options, strategy: 'exponential' });

export const retryLinear = <T>(
  operation: () => Promise<T>,
  options?: Partial<Omit<RetryOptions, 'strategy'>>
) => retryWithStrategy(operation, { ...options, strategy: 'linear' });

export const retryFibonacci = <T>(
  operation: () => Promise<T>,
  options?: Partial<Omit<RetryOptions, 'strategy'>>
) => retryWithStrategy(operation, { ...options, strategy: 'fibonacci' });

export const retryDecorrelated = <T>(
  operation: () => Promise<T>,
  options?: Partial<Omit<RetryOptions, 'strategy'>>
) => retryWithStrategy(operation, { ...options, strategy: 'decorrelated' });

// Helper to determine if an error is retryable
export function isRetryableError(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();
  
  // Network errors
  if (errorMessage.includes('network') || 
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('enotfound')) {
    return true;
  }

  // Rate limit errors
  if (errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('429')) {
    return true;
  }

  // Temporary server errors
  if (errorMessage.includes('500') ||
      errorMessage.includes('502') ||
      errorMessage.includes('503') ||
      errorMessage.includes('504')) {
    return true;
  }

  // API-specific temporary errors
  if (errorMessage.includes('temporarily unavailable') ||
      errorMessage.includes('service unavailable') ||
      errorMessage.includes('gateway timeout')) {
    return true;
  }

  return false;
}

// Retry with specific conditions for external APIs
export async function retryExternalAPI<T>(
  operation: () => Promise<T>,
  apiName: string,
  options?: Partial<RetryOptions>
): Promise<T> {
  return retryWithStrategy(operation, {
    maxRetries: 3,
    strategy: 'decorrelated',
    baseDelay: 1000,
    maxDelay: 30000,
    jitter: true,
    ...options,
    onRetry: async (error, attempt, nextDelay) => {
      console.log(`${apiName} retry ${attempt + 1}: ${error.message} (waiting ${nextDelay}ms)`);
      if (options?.onRetry) {
        await options.onRetry(error, attempt, nextDelay);
      }
    },
    shouldRetry: (error, attempt) => {
      // Check custom condition first
      if (options?.shouldRetry && !options.shouldRetry(error, attempt)) {
        return false;
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        console.log(`${apiName} error not retryable: ${error.message}`);
        return false;
      }

      return true;
    }
  });
}

// Batch retry for multiple operations
export async function retryBatch<T>(
  operations: Array<() => Promise<T>>,
  options?: Partial<RetryOptions> & { concurrency?: number }
): Promise<Array<{ success: boolean; result?: T; error?: Error }>> {
  const concurrency = options?.concurrency || 3;
  const results: Array<{ success: boolean; result?: T; error?: Error }> = [];
  
  // Process in batches
  for (let i = 0; i < operations.length; i += concurrency) {
    const batch = operations.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (operation) => {
        try {
          const result = await retryWithStrategy(operation, options);
          return { success: true, result };
        } catch (error) {
          return { success: false, error: error as Error };
        }
      })
    );
    results.push(...batchResults);
  }
  
  return results;
}