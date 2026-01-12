/**
 * Error Module
 *
 * Provides a consistent error hierarchy for the ISB Deployer.
 * All custom errors extend DeployerError for unified error handling.
 */

/**
 * Error codes for categorizing error types
 */
export enum ErrorCode {
  // Configuration errors (1xxx)
  CONFIG_INVALID = 'CONFIG_INVALID',
  CONFIG_MISSING = 'CONFIG_MISSING',

  // GitHub API errors (2xxx)
  GITHUB_RATE_LIMITED = 'GITHUB_RATE_LIMITED',
  GITHUB_NOT_FOUND = 'GITHUB_NOT_FOUND',
  GITHUB_FORBIDDEN = 'GITHUB_FORBIDDEN',
  GITHUB_API_ERROR = 'GITHUB_API_ERROR',

  // Template errors (3xxx)
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',
  TEMPLATE_INVALID = 'TEMPLATE_INVALID',
  TEMPLATE_RESOLUTION_FAILED = 'TEMPLATE_RESOLUTION_FAILED',

  // CDK errors (4xxx)
  CDK_SYNTHESIS_FAILED = 'CDK_SYNTHESIS_FAILED',
  CDK_VERSION_DETECTION_FAILED = 'CDK_VERSION_DETECTION_FAILED',
  CDK_DEPENDENCY_INSTALL_FAILED = 'CDK_DEPENDENCY_INSTALL_FAILED',
  CDK_BOOTSTRAP_FAILED = 'CDK_BOOTSTRAP_FAILED',

  // Scenario fetch errors (5xxx)
  SCENARIO_FETCH_FAILED = 'SCENARIO_FETCH_FAILED',
  SCENARIO_INVALID = 'SCENARIO_INVALID',

  // CloudFormation errors (6xxx)
  CLOUDFORMATION_FAILED = 'CLOUDFORMATION_FAILED',
  CLOUDFORMATION_VALIDATION_FAILED = 'CLOUDFORMATION_VALIDATION_FAILED',

  // AWS/STS errors (7xxx)
  STS_ASSUME_ROLE_FAILED = 'STS_ASSUME_ROLE_FAILED',
  AWS_API_ERROR = 'AWS_API_ERROR',

  // General errors (9xxx)
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

/**
 * Base error class for all ISB Deployer errors
 *
 * Provides consistent error structure with:
 * - Error codes for programmatic handling
 * - Cause chaining for error context preservation
 * - HTTP-like status codes for API responses
 * - Serialization support for logging
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (error instanceof DeployerError) {
 *     console.error(`[${error.code}] ${error.message}`);
 *     if (error.isRetryable) {
 *       // Implement retry logic
 *     }
 *   }
 * }
 * ```
 */
export class DeployerError extends Error {
  /**
   * Creates a new DeployerError
   *
   * @param message - Human-readable error description
   * @param code - Error code for categorization
   * @param statusCode - HTTP-like status code (4xx for client, 5xx for server errors)
   * @param cause - Underlying error that caused this error
   * @param isRetryable - Whether the operation can be retried
   */
  constructor(
    message: string,
    public readonly code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    public readonly statusCode: number = 500,
    public readonly cause?: Error,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'DeployerError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DeployerError);
    }
  }

  /**
   * Converts error to a plain object for logging/serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      isRetryable: this.isRetryable,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
          }
        : undefined,
      stack: this.stack,
    };
  }
}

/**
 * Configuration error - thrown when config is missing or invalid
 */
export class ConfigurationError extends DeployerError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.CONFIG_INVALID, 500, cause, false);
    this.name = 'ConfigurationError';
  }
}

/**
 * Validation error - thrown when input validation fails
 */
export class ValidationError extends DeployerError {
  constructor(
    message: string,
    public readonly field?: string,
    cause?: Error
  ) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, cause, false);
    this.name = 'ValidationError';
  }
}

/**
 * Retry configuration for transient errors
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay in milliseconds between retries */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Jitter factor (0-1) to add randomness to delays */
  jitterFactor: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.1,
};

/**
 * Calculates exponential backoff delay with jitter
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter: delay * (1 ± jitterFactor)
  const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);

  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleeps for the specified duration
 *
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with retry logic for transient errors
 *
 * @param fn - Async function to retry
 * @param config - Retry configuration
 * @param shouldRetry - Function to determine if error is retryable (default: checks isRetryable property)
 * @returns Result of the function
 * @throws The last error if all retries fail
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchFromGitHub(url),
 *   { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000, jitterFactor: 0.1 },
 *   (error) => error instanceof GitHubRateLimitError
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  shouldRetry?: (error: Error) => boolean
): Promise<T> {
  const isRetryable = shouldRetry ?? ((error: Error) => error instanceof DeployerError && error.isRetryable);

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt < config.maxAttempts - 1 && isRetryable(lastError)) {
        const delay = calculateBackoff(attempt, config);
        await sleep(delay);
        continue;
      }

      // No more retries or not retryable
      throw lastError;
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError ?? new Error('Retry failed with no error');
}
