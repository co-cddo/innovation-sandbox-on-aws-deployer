import type { LogLevel } from '../types/index.js';

/**
 * Event types for key operations in the deployment workflow
 */
export type EventType = 'TRIGGER' | 'LOOKUP' | 'FETCH' | 'DEPLOY' | 'COMPLETE';

/**
 * Structured log entry format
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  event?: EventType;
  [key: string]: unknown;
}

/**
 * Sensitive field names that should be redacted from logs
 */
const SENSITIVE_FIELDS = ['password', 'secret', 'token', 'apiKey', 'credentials'];

/**
 * Logger context that can be set and used across log calls
 */
export interface LoggerContext {
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * Logger class for structured JSON logging
 *
 * Features:
 * - JSON-formatted output to stdout
 * - Support for DEBUG, INFO, WARN, ERROR levels
 * - Correlation ID (leaseId) tracking
 * - Event type tagging for key operations
 * - Automatic sensitive data redaction
 *
 * Usage:
 * ```typescript
 * const logger = new Logger('INFO');
 * logger.setContext({ correlationId: 'lease-123' });
 * logger.info('Processing started', { event: 'TRIGGER' });
 * logger.debug('Fetching template', { url: 'https://...' });
 * logger.error('Deployment failed', { error: err.message });
 * ```
 */
export class Logger {
  private logLevel: LogLevel;
  private context: LoggerContext = {};
  private readonly levelPriority: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  };

  /**
   * Creates a new logger instance
   * @param logLevel - Minimum log level to output (default: INFO)
   */
  constructor(logLevel: LogLevel = 'INFO') {
    this.logLevel = logLevel;
  }

  /**
   * Sets the logger context (e.g., correlation ID)
   * This context will be included in all subsequent log entries
   */
  setContext(context: LoggerContext): void {
    this.context = { ...context };
  }

  /**
   * Clears the logger context
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Gets the current logger context
   */
  getContext(): LoggerContext {
    return { ...this.context };
  }

  /**
   * Updates the log level
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Logs a DEBUG message
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log('DEBUG', message, metadata);
  }

  /**
   * Logs an INFO message
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.log('INFO', message, metadata);
  }

  /**
   * Logs a WARN message
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log('WARN', message, metadata);
  }

  /**
   * Logs an ERROR message
   */
  error(message: string, metadata?: Record<string, unknown>): void {
    this.log('ERROR', message, metadata);
  }

  /**
   * Internal log method that formats and outputs the log entry
   */
  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    // Check if this log level should be output
    if (this.levelPriority[level] < this.levelPriority[this.logLevel]) {
      return;
    }

    // Build the log entry
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...this.redactSensitiveData(metadata || {}),
    };

    // Output as JSON to stdout
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(logEntry));
  }

  /**
   * Redacts sensitive data from metadata
   * Looks for common sensitive field names and replaces their values
   */
  private redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      // Check if the key contains any sensitive field names (case-insensitive)
      const isSensitive = SENSITIVE_FIELDS.some((field) =>
        key.toLowerCase().includes(field.toLowerCase())
      );

      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recursively redact nested objects
        redacted[key] = this.redactSensitiveData(value as Record<string, unknown>);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }
}

/**
 * Singleton logger instance
 */
let loggerInstance: Logger | null = null;

/**
 * Gets the logger singleton, creating it with the specified log level on first access
 */
export function getLogger(logLevel?: LogLevel): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger(logLevel);
  }
  return loggerInstance;
}

/**
 * Resets the logger singleton (primarily for testing)
 */
export function resetLogger(): void {
  loggerInstance = null;
}
