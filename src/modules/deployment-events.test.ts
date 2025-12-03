import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  emitDeploymentSuccess,
  type DeploymentSuccessDetail,
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
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/basic-vpc-lease-12345/guid',
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
        stackId: 'arn:aws:cloudformation:eu-west-2:987654321098:stack/test-stack/guid',
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
        stackId: 'arn:aws:cloudformation:eu-west-2:111111111111:stack/new-stack/guid',
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
        stackId: 'arn:aws:cloudformation:eu-west-2:222222222222:stack/existing-stack/guid',
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
        stackId: 'arn:aws:cloudformation:eu-west-2:333333333333:stack/in-progress-stack/guid',
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
        stackId: 'arn:aws:cloudformation:eu-west-2:444444444444:stack/no-logger-stack/guid',
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
        stackId: 'arn:aws:cloudformation:eu-west-2:555555555555:stack/error-stack/guid',
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
        stackId:
          'arn:aws:cloudformation:eu-west-2:666666666666:stack/no-logger-error-stack/guid',
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
        stackId: 'arn:aws:cloudformation:eu-west-2:777777777777:stack/non-error-stack/guid',
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
        stackId:
          'arn:aws:cloudformation:eu-west-2:888888888888:stack/correlation-stack/guid',
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
        stackId: 'arn:aws:cloudformation:eu-west-2:999999999999:stack/stack-name-test/guid',
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
        stackId: 'arn:aws:cloudformation:eu-west-2:000000000000:stack/complete-stack/guid',
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
        stackId: 'arn:aws:cloudformation:eu-west-2:000000000000:stack/complete-stack/guid',
        templateName: 'complete-template',
        action: 'created',
        timestamp: '2025-12-03T23:00:00.000Z',
      });
    });
  });
});
