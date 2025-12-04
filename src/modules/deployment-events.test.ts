import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  emitDeploymentSuccess,
  emitDeploymentFailure,
  categorizeError,
  type DeploymentSuccessDetail,
  type DeploymentFailureDetail,
  type FailureCategory,
} from './deployment-events.js';
import type { Logger } from './logger.js';

// Mock the event-emitter module
vi.mock('./event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

import { emitEvent } from './event-emitter.js';

describe('deployment-events module', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  describe('emitDeploymentSuccess', () => {
    it('should emit success event with all fields present', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        stackName: 'basic-vpc-lease-12345',
        stackId: 'arn:aws:cloudformation:us-west-2:123456789012:stack/basic-vpc-lease-12345/guid',
        templateName: 'basic-vpc',
        action: 'created',
        timestamp: '2025-12-03T12:00:00.000Z',
      };

      await emitDeploymentSuccess(detail, mockLogger);

      // Verify emitEvent was called with correct parameters
      expect(emitEvent).toHaveBeenCalledTimes(1);
      expect(emitEvent).toHaveBeenCalledWith('Deployment Succeeded', detail);

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith('Emitting deployment success event', {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        stackName: 'basic-vpc-lease-12345',
        action: 'created',
        hasTemplateName: true,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Deployment success event emitted successfully',
        {
          leaseId: 'lease-12345',
          stackName: 'basic-vpc-lease-12345',
        }
      );
    });

    it('should emit success event without optional templateName', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-67890',
        accountId: '987654321098',
        stackName: 'test-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:987654321098:stack/test-stack/guid',
        action: 'exists',
        timestamp: '2025-12-03T13:00:00.000Z',
      };

      await emitDeploymentSuccess(detail, mockLogger);

      // Verify emitEvent was called with detail (no templateName)
      expect(emitEvent).toHaveBeenCalledWith('Deployment Succeeded', detail);

      // Verify logging shows hasTemplateName: false
      expect(mockLogger.info).toHaveBeenCalledWith('Emitting deployment success event', {
        leaseId: 'lease-67890',
        accountId: '987654321098',
        stackName: 'test-stack',
        action: 'exists',
        hasTemplateName: false,
      });
    });

    it('should emit success event with action=created', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-111',
        accountId: '111111111111',
        stackName: 'new-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:111111111111:stack/new-stack/guid',
        templateName: 'example',
        action: 'created',
        timestamp: '2025-12-03T14:00:00.000Z',
      };

      await emitDeploymentSuccess(detail, mockLogger);

      expect(emitEvent).toHaveBeenCalledWith('Deployment Succeeded', detail);
      expect(mockLogger.info).toHaveBeenCalledWith('Emitting deployment success event', {
        leaseId: 'lease-111',
        accountId: '111111111111',
        stackName: 'new-stack',
        action: 'created',
        hasTemplateName: true,
      });
    });

    it('should emit success event with action=exists', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-222',
        accountId: '222222222222',
        stackName: 'existing-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:222222222222:stack/existing-stack/guid',
        action: 'exists',
        timestamp: '2025-12-03T15:00:00.000Z',
      };

      await emitDeploymentSuccess(detail, mockLogger);

      expect(emitEvent).toHaveBeenCalledWith('Deployment Succeeded', detail);
    });

    it('should emit success event with action=skipped', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-333',
        accountId: '333333333333',
        stackName: 'in-progress-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:333333333333:stack/in-progress-stack/guid',
        action: 'skipped',
        timestamp: '2025-12-03T16:00:00.000Z',
      };

      await emitDeploymentSuccess(detail, mockLogger);

      expect(emitEvent).toHaveBeenCalledWith('Deployment Succeeded', detail);
    });

    it('should work without logger provided', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-444',
        accountId: '444444444444',
        stackName: 'no-logger-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:444444444444:stack/no-logger-stack/guid',
        action: 'created',
        timestamp: '2025-12-03T17:00:00.000Z',
      };

      // Should not throw even without logger
      await expect(emitDeploymentSuccess(detail)).resolves.toBeUndefined();

      expect(emitEvent).toHaveBeenCalledWith('Deployment Succeeded', detail);
    });

    it('should handle emitEvent errors gracefully with logger', async () => {
      const emitError = new Error('EventBridge service unavailable');
      vi.mocked(emitEvent).mockRejectedValue(emitError);

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-555',
        accountId: '555555555555',
        stackName: 'error-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:555555555555:stack/error-stack/guid',
        action: 'created',
        timestamp: '2025-12-03T18:00:00.000Z',
      };

      // Should not throw - errors are caught and logged
      await expect(emitDeploymentSuccess(detail, mockLogger)).resolves.toBeUndefined();

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to emit deployment success event - continuing anyway',
        {
          error: 'EventBridge service unavailable',
          leaseId: 'lease-555',
          stackName: 'error-stack',
        }
      );

      // Verify initial info log was still called
      expect(mockLogger.info).toHaveBeenCalledWith('Emitting deployment success event', {
        leaseId: 'lease-555',
        accountId: '555555555555',
        stackName: 'error-stack',
        action: 'created',
        hasTemplateName: false,
      });
    });

    it('should handle emitEvent errors gracefully without logger', async () => {
      const emitError = new Error('EventBridge quota exceeded');
      vi.mocked(emitEvent).mockRejectedValue(emitError);

      // Mock console.error to verify it's called
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-666',
        accountId: '666666666666',
        stackName: 'no-logger-error-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:666666666666:stack/no-logger-error-stack/guid',
        action: 'created',
        timestamp: '2025-12-03T19:00:00.000Z',
      };

      // Should not throw even without logger
      await expect(emitDeploymentSuccess(detail)).resolves.toBeUndefined();

      // Verify console.error was called with JSON log entry
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const loggedMessage = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(loggedMessage).toMatchObject({
        level: 'ERROR',
        message: 'Failed to emit deployment success event',
        error: 'EventBridge quota exceeded',
        leaseId: 'lease-666',
      });
      expect(loggedMessage.timestamp).toBeDefined();

      consoleErrorSpy.mockRestore();
    });

    it('should handle non-Error objects thrown by emitEvent', async () => {
      // Sometimes errors aren't Error instances
      vi.mocked(emitEvent).mockRejectedValue('String error message');

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-777',
        accountId: '777777777777',
        stackName: 'non-error-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:777777777777:stack/non-error-stack/guid',
        action: 'created',
        timestamp: '2025-12-03T20:00:00.000Z',
      };

      await expect(emitDeploymentSuccess(detail, mockLogger)).resolves.toBeUndefined();

      // Verify error was logged as 'Unknown error'
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to emit deployment success event - continuing anyway',
        {
          error: 'Unknown error',
          leaseId: 'lease-777',
          stackName: 'non-error-stack',
        }
      );
    });

    it('should include leaseId in all log entries', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-correlation-test',
        accountId: '888888888888',
        stackName: 'correlation-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:888888888888:stack/correlation-stack/guid',
        action: 'created',
        timestamp: '2025-12-03T21:00:00.000Z',
      };

      await emitDeploymentSuccess(detail, mockLogger);

      // Both log calls should include leaseId for correlation
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        1,
        'Emitting deployment success event',
        expect.objectContaining({ leaseId: 'lease-correlation-test' })
      );

      expect(mockLogger.info).toHaveBeenNthCalledWith(
        2,
        'Deployment success event emitted successfully',
        expect.objectContaining({ leaseId: 'lease-correlation-test' })
      );
    });

    it('should include stackName in all log entries', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-999',
        accountId: '999999999999',
        stackName: 'stack-name-test',
        stackId: 'arn:aws:cloudformation:us-west-2:999999999999:stack/stack-name-test/guid',
        action: 'created',
        timestamp: '2025-12-03T22:00:00.000Z',
      };

      await emitDeploymentSuccess(detail, mockLogger);

      // Both log calls should include stackName
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        1,
        'Emitting deployment success event',
        expect.objectContaining({ stackName: 'stack-name-test' })
      );

      expect(mockLogger.info).toHaveBeenNthCalledWith(
        2,
        'Deployment success event emitted successfully',
        expect.objectContaining({ stackName: 'stack-name-test' })
      );
    });

    it('should pass complete detail object to emitEvent', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: DeploymentSuccessDetail = {
        leaseId: 'lease-complete',
        accountId: '000000000000',
        stackName: 'complete-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:000000000000:stack/complete-stack/guid',
        templateName: 'complete-template',
        action: 'created',
        timestamp: '2025-12-03T23:00:00.000Z',
      };

      await emitDeploymentSuccess(detail, mockLogger);

      // Verify the complete detail object is passed through
      expect(emitEvent).toHaveBeenCalledWith('Deployment Succeeded', {
        leaseId: 'lease-complete',
        accountId: '000000000000',
        stackName: 'complete-stack',
        stackId: 'arn:aws:cloudformation:us-west-2:000000000000:stack/complete-stack/guid',
        templateName: 'complete-template',
        action: 'created',
        timestamp: '2025-12-03T23:00:00.000Z',
      });
    });
  });

  describe('categorizeError', () => {
    it('should categorize validation errors by error type', () => {
      const category = categorizeError({
        errorType: 'ValidationError',
        errorMessage: 'Template format is incorrect',
      });
      expect(category).toBe('validation');
    });

    it('should categorize validation errors by error code', () => {
      const category = categorizeError({
        errorCode: 'InvalidParameterValue',
        errorMessage: 'Parameter value is invalid',
      });
      expect(category).toBe('validation');
    });

    it('should categorize validation errors by message keywords', () => {
      const category = categorizeError({
        errorMessage: 'Invalid template structure detected',
      });
      expect(category).toBe('validation');
    });

    it('should categorize malformed template errors', () => {
      const category = categorizeError({
        errorMessage: 'Malformed CloudFormation template',
      });
      expect(category).toBe('validation');
    });

    it('should categorize permission errors by error code', () => {
      const category = categorizeError({
        errorCode: 'AccessDenied',
        errorMessage: 'User does not have permission',
      });
      expect(category).toBe('permission');
    });

    it('should categorize unauthorized errors', () => {
      const category = categorizeError({
        errorCode: 'UnauthorizedOperation',
        errorMessage: 'Not authorized to perform this action',
      });
      expect(category).toBe('permission');
    });

    it('should categorize permission errors by message keywords', () => {
      const category = categorizeError({
        errorMessage: 'Access denied for this operation',
      });
      expect(category).toBe('permission');
    });

    it('should categorize forbidden errors', () => {
      const category = categorizeError({
        errorMessage: 'Forbidden: insufficient permissions',
      });
      expect(category).toBe('permission');
    });

    it('should categorize resource not found errors', () => {
      const category = categorizeError({
        errorCode: 'ResourceNotFoundException',
        errorMessage: 'The specified resource was not found',
      });
      expect(category).toBe('resource');
    });

    it('should categorize limit exceeded errors', () => {
      const category = categorizeError({
        errorCode: 'LimitExceeded',
        errorMessage: 'Account limit for stacks exceeded',
      });
      expect(category).toBe('resource');
    });

    it('should categorize quota exceeded errors', () => {
      const category = categorizeError({
        errorMessage: 'Quota exceeded for VPCs in this region',
      });
      expect(category).toBe('resource');
    });

    it('should categorize insufficient capacity errors', () => {
      const category = categorizeError({
        errorMessage: 'Insufficient capacity to fulfill request',
      });
      expect(category).toBe('resource');
    });

    it('should categorize network timeout errors', () => {
      const category = categorizeError({
        errorCode: 'RequestTimeout',
        errorMessage: 'Request timed out',
      });
      expect(category).toBe('network');
    });

    it('should categorize connection errors', () => {
      const category = categorizeError({
        errorMessage: 'Connection refused to remote endpoint',
      });
      expect(category).toBe('network');
    });

    it('should categorize network unreachable errors', () => {
      const category = categorizeError({
        errorMessage: 'Network unreachable',
      });
      expect(category).toBe('network');
    });

    it('should categorize unknown errors', () => {
      const category = categorizeError({
        errorMessage: 'Something unexpected happened',
      });
      expect(category).toBe('unknown');
    });

    it('should handle empty error details', () => {
      const category = categorizeError({
        errorMessage: '',
      });
      expect(category).toBe('unknown');
    });

    it('should be case-insensitive for error matching', () => {
      const category1 = categorizeError({
        errorMessage: 'VALIDATION ERROR DETECTED',
      });
      expect(category1).toBe('validation');

      const category2 = categorizeError({
        errorMessage: 'Access Denied',
      });
      expect(category2).toBe('permission');
    });
  });

  describe('emitDeploymentFailure', () => {
    it('should emit failure event with all fields present', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        errorMessage: 'Template validation failed',
        errorType: 'ValidationError',
        errorCode: 'InvalidTemplate',
        failureCategory: 'validation',
        stackName: 'basic-vpc-lease-12345',
        templateName: 'basic-vpc',
      };

      await emitDeploymentFailure(detail, mockLogger);

      // Verify emitEvent was called with correct parameters
      expect(emitEvent).toHaveBeenCalledTimes(1);
      expect(emitEvent).toHaveBeenCalledWith(
        'Deployment Failed',
        expect.objectContaining({
          ...detail,
          timestamp: expect.any(String),
        })
      );

      // Verify timestamp is ISO 8601 format
      const callArgs = vi.mocked(emitEvent).mock.calls[0][1] as DeploymentFailureDetail;
      expect(callArgs.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify logging
      expect(mockLogger.error).toHaveBeenCalledWith('Emitting deployment failure event', {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        errorMessage: 'Template validation failed',
        errorType: 'ValidationError',
        errorCode: 'InvalidTemplate',
        failureCategory: 'validation',
        hasStackName: true,
        hasTemplateName: true,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Deployment failure event emitted successfully',
        {
          leaseId: 'lease-12345',
          failureCategory: 'validation',
        }
      );
    });

    it('should emit failure event with only required fields', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-67890',
        accountId: '987654321098',
        errorMessage: 'Deployment failed unexpectedly',
        failureCategory: 'unknown',
      };

      await emitDeploymentFailure(detail, mockLogger);

      expect(emitEvent).toHaveBeenCalledWith(
        'Deployment Failed',
        expect.objectContaining({
          ...detail,
          timestamp: expect.any(String),
        })
      );

      expect(mockLogger.error).toHaveBeenCalledWith('Emitting deployment failure event', {
        leaseId: 'lease-67890',
        accountId: '987654321098',
        errorMessage: 'Deployment failed unexpectedly',
        errorType: undefined,
        errorCode: undefined,
        failureCategory: 'unknown',
        hasStackName: false,
        hasTemplateName: false,
      });
    });

    it('should emit failure event with validation category', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-111',
        accountId: '111111111111',
        errorMessage: 'Invalid parameter format',
        failureCategory: 'validation',
      };

      await emitDeploymentFailure(detail, mockLogger);

      expect(emitEvent).toHaveBeenCalledWith(
        'Deployment Failed',
        expect.objectContaining({
          failureCategory: 'validation',
        })
      );
    });

    it('should emit failure event with permission category', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-222',
        accountId: '222222222222',
        errorMessage: 'Access denied',
        errorCode: 'AccessDenied',
        failureCategory: 'permission',
      };

      await emitDeploymentFailure(detail, mockLogger);

      expect(emitEvent).toHaveBeenCalledWith(
        'Deployment Failed',
        expect.objectContaining({
          failureCategory: 'permission',
        })
      );
    });

    it('should emit failure event with resource category', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-333',
        accountId: '333333333333',
        errorMessage: 'Stack limit exceeded',
        failureCategory: 'resource',
      };

      await emitDeploymentFailure(detail, mockLogger);

      expect(emitEvent).toHaveBeenCalledWith(
        'Deployment Failed',
        expect.objectContaining({
          failureCategory: 'resource',
        })
      );
    });

    it('should emit failure event with network category', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-444',
        accountId: '444444444444',
        errorMessage: 'Request timed out',
        failureCategory: 'network',
      };

      await emitDeploymentFailure(detail, mockLogger);

      expect(emitEvent).toHaveBeenCalledWith(
        'Deployment Failed',
        expect.objectContaining({
          failureCategory: 'network',
        })
      );
    });

    it('should emit failure event with unknown category', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-555',
        accountId: '555555555555',
        errorMessage: 'Mysterious error occurred',
        failureCategory: 'unknown',
      };

      await emitDeploymentFailure(detail, mockLogger);

      expect(emitEvent).toHaveBeenCalledWith(
        'Deployment Failed',
        expect.objectContaining({
          failureCategory: 'unknown',
        })
      );
    });

    it('should work without logger provided', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-666',
        accountId: '666666666666',
        errorMessage: 'Test error',
        failureCategory: 'unknown',
      };

      // Should not throw even without logger
      await expect(emitDeploymentFailure(detail)).resolves.toBeUndefined();

      expect(emitEvent).toHaveBeenCalledWith(
        'Deployment Failed',
        expect.objectContaining({
          ...detail,
          timestamp: expect.any(String),
        })
      );
    });

    it('should handle emitEvent errors gracefully with logger', async () => {
      const emitError = new Error('EventBridge service unavailable');
      vi.mocked(emitEvent).mockRejectedValue(emitError);

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-777',
        accountId: '777777777777',
        errorMessage: 'Original deployment error',
        failureCategory: 'validation',
        stackName: 'test-stack',
      };

      // Should not throw - errors are caught and logged
      await expect(emitDeploymentFailure(detail, mockLogger)).resolves.toBeUndefined();

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to emit deployment failure event - continuing anyway',
        {
          error: 'EventBridge service unavailable',
          leaseId: 'lease-777',
          originalError: 'Original deployment error',
        }
      );

      // Verify initial error log was still called
      expect(mockLogger.error).toHaveBeenCalledWith('Emitting deployment failure event', {
        leaseId: 'lease-777',
        accountId: '777777777777',
        errorMessage: 'Original deployment error',
        errorType: undefined,
        errorCode: undefined,
        failureCategory: 'validation',
        hasStackName: true,
        hasTemplateName: false,
      });
    });

    it('should handle emitEvent errors gracefully without logger', async () => {
      const emitError = new Error('EventBridge quota exceeded');
      vi.mocked(emitEvent).mockRejectedValue(emitError);

      // Mock console.error to verify it's called
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-888',
        accountId: '888888888888',
        errorMessage: 'Original error',
        failureCategory: 'unknown',
      };

      // Should not throw even without logger
      await expect(emitDeploymentFailure(detail)).resolves.toBeUndefined();

      // Verify console.error was called with JSON log entry
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const loggedMessage = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(loggedMessage).toMatchObject({
        level: 'ERROR',
        message: 'Failed to emit deployment failure event',
        error: 'EventBridge quota exceeded',
        leaseId: 'lease-888',
      });
      expect(loggedMessage.timestamp).toBeDefined();

      consoleErrorSpy.mockRestore();
    });

    it('should handle non-Error objects thrown by emitEvent', async () => {
      // Sometimes errors aren't Error instances
      vi.mocked(emitEvent).mockRejectedValue('String error message');

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-999',
        accountId: '999999999999',
        errorMessage: 'Deployment failed',
        failureCategory: 'unknown',
      };

      await expect(emitDeploymentFailure(detail, mockLogger)).resolves.toBeUndefined();

      // Verify error was logged as 'Unknown error'
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to emit deployment failure event - continuing anyway',
        {
          error: 'Unknown error',
          leaseId: 'lease-999',
          originalError: 'Deployment failed',
        }
      );
    });

    it('should include leaseId in all log entries', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-correlation-test',
        accountId: '000000000000',
        errorMessage: 'Test error',
        failureCategory: 'validation',
      };

      await emitDeploymentFailure(detail, mockLogger);

      // Both log calls should include leaseId for correlation
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Emitting deployment failure event',
        expect.objectContaining({ leaseId: 'lease-correlation-test' })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Deployment failure event emitted successfully',
        expect.objectContaining({ leaseId: 'lease-correlation-test' })
      );
    });

    it('should include partial deployment info when available', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-partial',
        accountId: '123456789012',
        errorMessage: 'Stack creation failed midway',
        errorType: 'ResourceError',
        failureCategory: 'resource',
        stackName: 'partially-created-stack',
        // No templateName - partial info
      };

      await emitDeploymentFailure(detail, mockLogger);

      const callArgs = vi.mocked(emitEvent).mock.calls[0][1] as DeploymentFailureDetail;
      expect(callArgs.stackName).toBe('partially-created-stack');
      expect(callArgs.templateName).toBeUndefined();
      expect(callArgs.leaseId).toBe('lease-partial');

      expect(mockLogger.error).toHaveBeenCalledWith('Emitting deployment failure event', {
        leaseId: 'lease-partial',
        accountId: '123456789012',
        errorMessage: 'Stack creation failed midway',
        errorType: 'ResourceError',
        errorCode: undefined,
        failureCategory: 'resource',
        hasStackName: true,
        hasTemplateName: false,
      });
    });

    it('should pass complete detail object to emitEvent', async () => {
      vi.mocked(emitEvent).mockResolvedValue();

      const detail: Omit<DeploymentFailureDetail, 'timestamp'> = {
        leaseId: 'lease-complete',
        accountId: '111111111111',
        errorMessage: 'Complete failure details',
        errorType: 'CompleteError',
        errorCode: 'COMPLETE_ERR',
        failureCategory: 'validation',
        stackName: 'complete-stack',
        templateName: 'complete-template',
      };

      await emitDeploymentFailure(detail, mockLogger);

      // Verify the complete detail object is passed through with timestamp
      const callArgs = vi.mocked(emitEvent).mock.calls[0][1] as DeploymentFailureDetail;
      expect(callArgs).toMatchObject({
        leaseId: 'lease-complete',
        accountId: '111111111111',
        errorMessage: 'Complete failure details',
        errorType: 'CompleteError',
        errorCode: 'COMPLETE_ERR',
        failureCategory: 'validation',
        stackName: 'complete-stack',
        templateName: 'complete-template',
      });
      expect(callArgs.timestamp).toBeDefined();
    });
  });
});
