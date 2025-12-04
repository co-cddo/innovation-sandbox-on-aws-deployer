import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, getLogger, resetLogger, type EventType, type LoggerContext } from './logger.js';

describe('Logger module', () => {
  // Mock console.log to capture output
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetLogger();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    resetLogger();
  });

  describe('Logger instantiation', () => {
    it('should create logger with default INFO log level', () => {
      const logger = new Logger();

      logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('INFO');
      expect(logEntry.message).toBe('test message');
    });

    it('should create logger with DEBUG log level', () => {
      const logger = new Logger('DEBUG');

      logger.debug('debug message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('DEBUG');
    });

    it('should create logger with WARN log level', () => {
      const logger = new Logger('WARN');

      logger.warn('warning message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('WARN');
    });

    it('should create logger with ERROR log level', () => {
      const logger = new Logger('ERROR');

      logger.error('error message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('ERROR');
    });
  });

  describe('setContext/clearContext/getContext', () => {
    it('should set correlation ID in context', () => {
      const logger = new Logger();
      const context: LoggerContext = { correlationId: 'lease-123' };

      logger.setContext(context);
      logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.correlationId).toBe('lease-123');
    });

    it('should set multiple context fields', () => {
      const logger = new Logger();
      const context: LoggerContext = {
        correlationId: 'lease-456',
        accountId: '123456789012',
        region: 'us-west-2',
      };

      logger.setContext(context);
      logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.correlationId).toBe('lease-456');
      expect(logEntry.accountId).toBe('123456789012');
      expect(logEntry.region).toBe('us-west-2');
    });

    it('should get current context', () => {
      const logger = new Logger();
      const context: LoggerContext = { correlationId: 'lease-789' };

      logger.setContext(context);
      const retrievedContext = logger.getContext();

      expect(retrievedContext).toEqual(context);
    });

    it('should return copy of context, not reference', () => {
      const logger = new Logger();
      const context: LoggerContext = { correlationId: 'lease-111' };

      logger.setContext(context);
      const retrievedContext = logger.getContext();
      retrievedContext.correlationId = 'modified';

      const contextAgain = logger.getContext();
      expect(contextAgain.correlationId).toBe('lease-111');
    });

    it('should clear context', () => {
      const logger = new Logger();
      logger.setContext({ correlationId: 'lease-222' });

      logger.clearContext();
      logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.correlationId).toBeUndefined();
    });

    it('should persist context across multiple log calls', () => {
      const logger = new Logger();
      logger.setContext({ correlationId: 'lease-333' });

      logger.info('first message');
      logger.warn('second message');
      logger.error('third message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(3);
      const log1 = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const log2 = JSON.parse(consoleLogSpy.mock.calls[1][0]);
      const log3 = JSON.parse(consoleLogSpy.mock.calls[2][0]);

      expect(log1.correlationId).toBe('lease-333');
      expect(log2.correlationId).toBe('lease-333');
      expect(log3.correlationId).toBe('lease-333');
    });
  });

  describe('log level methods', () => {
    it('should log DEBUG message', () => {
      const logger = new Logger('DEBUG');

      logger.debug('debug message', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('DEBUG');
      expect(logEntry.message).toBe('debug message');
      expect(logEntry.key).toBe('value');
    });

    it('should log INFO message', () => {
      const logger = new Logger('INFO');

      logger.info('info message', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('INFO');
      expect(logEntry.message).toBe('info message');
      expect(logEntry.key).toBe('value');
    });

    it('should log WARN message', () => {
      const logger = new Logger('WARN');

      logger.warn('warning message', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('WARN');
      expect(logEntry.message).toBe('warning message');
      expect(logEntry.key).toBe('value');
    });

    it('should log ERROR message', () => {
      const logger = new Logger('ERROR');

      logger.error('error message', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('ERROR');
      expect(logEntry.message).toBe('error message');
      expect(logEntry.key).toBe('value');
    });

    it('should log without metadata', () => {
      const logger = new Logger('INFO');

      logger.info('simple message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.message).toBe('simple message');
      expect(logEntry.timestamp).toBeDefined();
      expect(logEntry.level).toBe('INFO');
    });
  });

  describe('log level filtering', () => {
    it('should not output DEBUG logs when level is INFO', () => {
      const logger = new Logger('INFO');

      logger.debug('debug message');
      logger.info('info message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('INFO');
    });

    it('should not output DEBUG or INFO logs when level is WARN', () => {
      const logger = new Logger('WARN');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('WARN');
    });

    it('should only output ERROR logs when level is ERROR', () => {
      const logger = new Logger('ERROR');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('ERROR');
    });

    it('should output all logs when level is DEBUG', () => {
      const logger = new Logger('DEBUG');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(4);
      const levels = consoleLogSpy.mock.calls.map((call) => {
        return JSON.parse(call[0]).level;
      });
      expect(levels).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
    });

    it('should allow changing log level dynamically', () => {
      const logger = new Logger('ERROR');

      logger.info('should not appear');
      expect(consoleLogSpy).toHaveBeenCalledTimes(0);

      logger.setLogLevel('INFO');
      logger.info('should appear');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('INFO');
    });
  });

  describe('sensitive data redaction', () => {
    it('should redact password field', () => {
      const logger = new Logger('INFO');

      logger.info('test message', { password: 'secret123' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.password).toBe('[REDACTED]');
    });

    it('should redact secret field', () => {
      const logger = new Logger('INFO');

      logger.info('test message', { secret: 'my-secret-key' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.secret).toBe('[REDACTED]');
    });

    it('should redact token field', () => {
      const logger = new Logger('INFO');

      logger.info('test message', { token: 'bearer-token-123' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.token).toBe('[REDACTED]');
    });

    it('should redact apiKey field', () => {
      const logger = new Logger('INFO');

      logger.info('test message', { apiKey: 'api-key-456' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.apiKey).toBe('[REDACTED]');
    });

    it('should redact credentials field', () => {
      const logger = new Logger('INFO');

      logger.info('test message', { credentials: { user: 'admin', pass: 'secret' } });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.credentials).toBe('[REDACTED]');
    });

    it('should redact fields containing sensitive keywords (case-insensitive)', () => {
      const logger = new Logger('INFO');

      logger.info('test message', {
        userPassword: 'pass123',
        apiToken: 'token123',
        awsSecret: 'secret123',
        githubApiKey: 'key123',
        dbCredentials: 'creds',
      });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.userPassword).toBe('[REDACTED]');
      expect(logEntry.apiToken).toBe('[REDACTED]');
      expect(logEntry.awsSecret).toBe('[REDACTED]');
      expect(logEntry.githubApiKey).toBe('[REDACTED]');
      expect(logEntry.dbCredentials).toBe('[REDACTED]');
    });

    it('should not redact non-sensitive fields', () => {
      const logger = new Logger('INFO');

      logger.info('test message', {
        username: 'admin',
        email: 'test@example.com',
        accountId: '123456789012',
        region: 'us-west-2',
      });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.username).toBe('admin');
      expect(logEntry.email).toBe('test@example.com');
      expect(logEntry.accountId).toBe('123456789012');
      expect(logEntry.region).toBe('us-west-2');
    });

    it('should redact sensitive data in nested objects', () => {
      const logger = new Logger('INFO');

      logger.info('test message', {
        config: {
          apiKey: 'secret-key',
          endpoint: 'https://api.example.com',
          auth: {
            password: 'nested-password',
            username: 'user',
          },
        },
      });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.config.apiKey).toBe('[REDACTED]');
      expect(logEntry.config.endpoint).toBe('https://api.example.com');
      expect(logEntry.config.auth.password).toBe('[REDACTED]');
      expect(logEntry.config.auth.username).toBe('user');
    });

    it('should handle arrays without redacting', () => {
      const logger = new Logger('INFO');

      logger.info('test message', {
        items: ['item1', 'item2', 'item3'],
      });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.items).toEqual(['item1', 'item2', 'item3']);
    });

    it('should handle null and undefined values', () => {
      const logger = new Logger('INFO');

      logger.info('test message', {
        nullValue: null,
        undefinedValue: undefined,
      });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.nullValue).toBeNull();
      expect(logEntry.undefinedValue).toBeUndefined();
    });
  });

  describe('event type tagging', () => {
    it('should include TRIGGER event type', () => {
      const logger = new Logger('INFO');

      logger.info('Processing started', { event: 'TRIGGER' as EventType });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.event).toBe('TRIGGER');
    });

    it('should include LOOKUP event type', () => {
      const logger = new Logger('INFO');

      logger.info('Looking up lease', { event: 'LOOKUP' as EventType });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.event).toBe('LOOKUP');
    });

    it('should include FETCH event type', () => {
      const logger = new Logger('INFO');

      logger.info('Fetching template', { event: 'FETCH' as EventType });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.event).toBe('FETCH');
    });

    it('should include DEPLOY event type', () => {
      const logger = new Logger('INFO');

      logger.info('Deploying stack', { event: 'DEPLOY' as EventType });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.event).toBe('DEPLOY');
    });

    it('should include COMPLETE event type', () => {
      const logger = new Logger('INFO');

      logger.info('Deployment complete', { event: 'COMPLETE' as EventType });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.event).toBe('COMPLETE');
    });

    it('should include event type along with other metadata', () => {
      const logger = new Logger('INFO');

      logger.info('Deploying stack', {
        event: 'DEPLOY' as EventType,
        stackName: 'my-stack',
        accountId: '123456789012',
      });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.event).toBe('DEPLOY');
      expect(logEntry.stackName).toBe('my-stack');
      expect(logEntry.accountId).toBe('123456789012');
    });
  });

  describe('JSON output format', () => {
    it('should output valid JSON', () => {
      const logger = new Logger('INFO');

      logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0][0];

      // Should parse without error
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should include timestamp in ISO format', () => {
      const logger = new Logger('INFO');

      logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logEntry.timestamp).toBeDefined();
      expect(new Date(logEntry.timestamp).toISOString()).toBe(logEntry.timestamp);
    });

    it('should include all required fields', () => {
      const logger = new Logger('INFO');

      logger.info('test message', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logEntry).toHaveProperty('timestamp');
      expect(logEntry).toHaveProperty('level');
      expect(logEntry).toHaveProperty('message');
      expect(logEntry.key).toBe('value');
    });

    it('should merge context and metadata in output', () => {
      const logger = new Logger('INFO');
      logger.setContext({ correlationId: 'lease-999', env: 'production' });

      logger.info('test message', { requestId: 'req-123', action: 'deploy' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logEntry.correlationId).toBe('lease-999');
      expect(logEntry.env).toBe('production');
      expect(logEntry.requestId).toBe('req-123');
      expect(logEntry.action).toBe('deploy');
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance from getLogger', () => {
      const logger1 = getLogger('INFO');
      const logger2 = getLogger('DEBUG');

      expect(logger1).toBe(logger2);
    });

    it('should create logger with specified log level on first call', () => {
      const logger = getLogger('DEBUG');

      logger.debug('debug message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('DEBUG');
    });

    it('should ignore log level on subsequent calls', () => {
      const logger1 = getLogger('ERROR');
      const logger2 = getLogger('DEBUG');

      // Should still be ERROR level
      logger2.warn('warning message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(0);
    });

    it('should preserve context across getLogger calls', () => {
      const logger1 = getLogger('INFO');
      logger1.setContext({ correlationId: 'lease-001' });

      const logger2 = getLogger();
      logger2.info('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.correlationId).toBe('lease-001');
    });
  });

  describe('resetLogger', () => {
    it('should clear singleton instance', () => {
      const logger1 = getLogger('ERROR');
      logger1.setContext({ correlationId: 'lease-old' });

      resetLogger();

      const logger2 = getLogger('DEBUG');
      logger2.debug('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe('DEBUG');
      expect(logEntry.correlationId).toBeUndefined();
    });

    it('should allow creating new logger with different level', () => {
      getLogger('INFO');
      resetLogger();
      const logger = getLogger('ERROR');

      logger.warn('warning message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(0);
    });
  });
});
