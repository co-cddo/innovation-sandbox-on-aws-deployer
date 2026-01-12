import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DeployerError,
  ConfigurationError,
  ValidationError,
  ErrorCode,
  DEFAULT_RETRY_CONFIG,
  calculateBackoff,
  sleep,
  withRetry,
} from './errors.js';

describe('errors module', () => {
  describe('DeployerError', () => {
    it('should create error with default values', () => {
      const error = new DeployerError('Test error');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.cause).toBeUndefined();
      expect(error.isRetryable).toBe(false);
      expect(error.name).toBe('DeployerError');
    });

    it('should create error with custom values', () => {
      const cause = new Error('Underlying error');
      const error = new DeployerError(
        'Custom error',
        ErrorCode.GITHUB_RATE_LIMITED,
        429,
        cause,
        true
      );

      expect(error.message).toBe('Custom error');
      expect(error.code).toBe(ErrorCode.GITHUB_RATE_LIMITED);
      expect(error.statusCode).toBe(429);
      expect(error.cause).toBe(cause);
      expect(error.isRetryable).toBe(true);
    });

    it('should be an instance of Error', () => {
      const error = new DeployerError('Test');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DeployerError);
    });

    describe('toJSON', () => {
      it('should serialize error without cause', () => {
        const error = new DeployerError('Test error', ErrorCode.CONFIG_INVALID, 400);
        const json = error.toJSON();

        expect(json.name).toBe('DeployerError');
        expect(json.message).toBe('Test error');
        expect(json.code).toBe(ErrorCode.CONFIG_INVALID);
        expect(json.statusCode).toBe(400);
        expect(json.isRetryable).toBe(false);
        expect(json.cause).toBeUndefined();
        expect(json.stack).toBeDefined();
      });

      it('should serialize error with cause', () => {
        const cause = new Error('Root cause');
        const error = new DeployerError('Wrapper error', ErrorCode.AWS_API_ERROR, 500, cause);
        const json = error.toJSON();

        expect(json.cause).toEqual({
          name: 'Error',
          message: 'Root cause',
        });
      });
    });
  });

  describe('ConfigurationError', () => {
    it('should create with correct defaults', () => {
      const error = new ConfigurationError('Config missing');

      expect(error.name).toBe('ConfigurationError');
      expect(error.code).toBe(ErrorCode.CONFIG_INVALID);
      expect(error.statusCode).toBe(500);
      expect(error.isRetryable).toBe(false);
    });

    it('should accept a cause', () => {
      const cause = new Error('Parse failed');
      const error = new ConfigurationError('Invalid config', cause);

      expect(error.cause).toBe(cause);
    });

    it('should be instance of DeployerError', () => {
      const error = new ConfigurationError('Test');
      expect(error).toBeInstanceOf(DeployerError);
    });
  });

  describe('ValidationError', () => {
    it('should create with correct defaults', () => {
      const error = new ValidationError('Invalid input');

      expect(error.name).toBe('ValidationError');
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.statusCode).toBe(400);
      expect(error.isRetryable).toBe(false);
      expect(error.field).toBeUndefined();
    });

    it('should accept field and cause', () => {
      const cause = new Error('Type mismatch');
      const error = new ValidationError('Invalid email', 'email', cause);

      expect(error.field).toBe('email');
      expect(error.cause).toBe(cause);
    });

    it('should be instance of DeployerError', () => {
      const error = new ValidationError('Test');
      expect(error).toBeInstanceOf(DeployerError);
    });
  });

  describe('DEFAULT_RETRY_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(1000);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000);
      expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBe(0.1);
    });
  });

  describe('calculateBackoff', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should calculate exponential backoff', () => {
      const config = { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0 };

      expect(calculateBackoff(0, config)).toBe(1000); // 1000 * 2^0 = 1000
      expect(calculateBackoff(1, config)).toBe(2000); // 1000 * 2^1 = 2000
      expect(calculateBackoff(2, config)).toBe(4000); // 1000 * 2^2 = 4000
      expect(calculateBackoff(3, config)).toBe(8000); // 1000 * 2^3 = 8000
    });

    it('should cap at maxDelayMs', () => {
      const config = { ...DEFAULT_RETRY_CONFIG, maxDelayMs: 5000, jitterFactor: 0 };

      expect(calculateBackoff(0, config)).toBe(1000);
      expect(calculateBackoff(1, config)).toBe(2000);
      expect(calculateBackoff(2, config)).toBe(4000);
      expect(calculateBackoff(3, config)).toBe(5000); // Capped
      expect(calculateBackoff(10, config)).toBe(5000); // Still capped
    });

    it('should apply jitter', () => {
      // With random = 0.5, jitter factor = 0.1
      // jitter = delay * 0.1 * (0.5 * 2 - 1) = delay * 0.1 * 0 = 0
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const delay = calculateBackoff(0, DEFAULT_RETRY_CONFIG);
      expect(delay).toBe(1000); // No jitter when random is 0.5

      // With random = 1, jitter = delay * 0.1 * (1 * 2 - 1) = delay * 0.1
      vi.spyOn(Math, 'random').mockReturnValue(1);
      const delayWithMaxJitter = calculateBackoff(0, DEFAULT_RETRY_CONFIG);
      expect(delayWithMaxJitter).toBe(1100); // 1000 + 100

      // With random = 0, jitter = delay * 0.1 * (0 * 2 - 1) = -delay * 0.1
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const delayWithMinJitter = calculateBackoff(0, DEFAULT_RETRY_CONFIG);
      expect(delayWithMinJitter).toBe(900); // 1000 - 100
    });

    it('should use default config if not provided', () => {
      const delay = calculateBackoff(0);
      expect(delay).toBeGreaterThanOrEqual(900);
      expect(delay).toBeLessThanOrEqual(1100);
    });
  });

  describe('sleep', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve after specified duration', async () => {
      const promise = sleep(1000);

      vi.advanceTimersByTime(999);
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(1);
      await promise;

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('withRetry', () => {
    it('should return result on first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable DeployerError', async () => {
      const retryableError = new DeployerError(
        'Temporary error',
        ErrorCode.GITHUB_RATE_LIMITED,
        429,
        undefined,
        true
      );
      const fn = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      // Use minimal delays to make test fast
      const config = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, jitterFactor: 0 };
      const result = await withRetry(fn, config);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable DeployerError', async () => {
      const nonRetryableError = new DeployerError(
        'Not retryable',
        ErrorCode.CONFIG_INVALID,
        400,
        undefined,
        false
      );
      const fn = vi.fn().mockRejectedValue(nonRetryableError);

      await expect(withRetry(fn)).rejects.toThrow('Not retryable');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw after max attempts', async () => {
      const retryableError = new DeployerError(
        'Always fails',
        ErrorCode.GITHUB_RATE_LIMITED,
        429,
        undefined,
        true
      );
      const fn = vi.fn().mockRejectedValue(retryableError);
      const config = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, jitterFactor: 0 };

      await expect(withRetry(fn, config)).rejects.toThrow('Always fails');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use custom shouldRetry function', async () => {
      const customError = new Error('Custom retryable');
      const fn = vi.fn().mockRejectedValueOnce(customError).mockResolvedValue('success');

      const shouldRetry = vi.fn().mockReturnValue(true);
      const config = { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 10, jitterFactor: 0 };

      const result = await withRetry(fn, config, shouldRetry);

      expect(result).toBe('success');
      expect(shouldRetry).toHaveBeenCalledWith(customError);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should convert non-Error throws to Error', async () => {
      const fn = vi.fn().mockRejectedValue('string error');

      await expect(withRetry(fn)).rejects.toThrow('string error');
    });

    it('should not retry on last attempt', async () => {
      const retryableError = new DeployerError(
        'Fails',
        ErrorCode.GITHUB_RATE_LIMITED,
        429,
        undefined,
        true
      );
      const fn = vi.fn().mockRejectedValue(retryableError);
      const config = { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 10, jitterFactor: 0 };

      await expect(withRetry(fn, config)).rejects.toThrow('Fails');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('ErrorCode enum', () => {
    it('should have all expected error codes', () => {
      expect(ErrorCode.CONFIG_INVALID).toBe('CONFIG_INVALID');
      expect(ErrorCode.CONFIG_MISSING).toBe('CONFIG_MISSING');
      expect(ErrorCode.GITHUB_RATE_LIMITED).toBe('GITHUB_RATE_LIMITED');
      expect(ErrorCode.GITHUB_NOT_FOUND).toBe('GITHUB_NOT_FOUND');
      expect(ErrorCode.GITHUB_FORBIDDEN).toBe('GITHUB_FORBIDDEN');
      expect(ErrorCode.GITHUB_API_ERROR).toBe('GITHUB_API_ERROR');
      expect(ErrorCode.TEMPLATE_NOT_FOUND).toBe('TEMPLATE_NOT_FOUND');
      expect(ErrorCode.TEMPLATE_INVALID).toBe('TEMPLATE_INVALID');
      expect(ErrorCode.TEMPLATE_RESOLUTION_FAILED).toBe('TEMPLATE_RESOLUTION_FAILED');
      expect(ErrorCode.CDK_SYNTHESIS_FAILED).toBe('CDK_SYNTHESIS_FAILED');
      expect(ErrorCode.CDK_VERSION_DETECTION_FAILED).toBe('CDK_VERSION_DETECTION_FAILED');
      expect(ErrorCode.CDK_DEPENDENCY_INSTALL_FAILED).toBe('CDK_DEPENDENCY_INSTALL_FAILED');
      expect(ErrorCode.CDK_BOOTSTRAP_FAILED).toBe('CDK_BOOTSTRAP_FAILED');
      expect(ErrorCode.SCENARIO_FETCH_FAILED).toBe('SCENARIO_FETCH_FAILED');
      expect(ErrorCode.SCENARIO_INVALID).toBe('SCENARIO_INVALID');
      expect(ErrorCode.CLOUDFORMATION_FAILED).toBe('CLOUDFORMATION_FAILED');
      expect(ErrorCode.CLOUDFORMATION_VALIDATION_FAILED).toBe('CLOUDFORMATION_VALIDATION_FAILED');
      expect(ErrorCode.STS_ASSUME_ROLE_FAILED).toBe('STS_ASSUME_ROLE_FAILED');
      expect(ErrorCode.AWS_API_ERROR).toBe('AWS_API_ERROR');
      expect(ErrorCode.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
      expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    });
  });
});
