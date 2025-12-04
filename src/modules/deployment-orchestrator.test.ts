import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deployWithParameters,
  DeploymentOrchestrationError,
  type DeploymentInput,
  type Logger,
} from './deployment-orchestrator.js';
import type { LeaseDetails } from './lease-lookup.js';
import type { AssumedRoleCredentials } from './role-assumer.js';
import type { CloudFormationParameter } from './stack-deployer.js';
import { StackStatus } from './stack-manager.js';

// Mock the dependencies
vi.mock('./parameter-mapper.js', () => ({
  mapParameters: vi.fn(),
}));

vi.mock('./stack-manager.js', async () => {
  const actual = await vi.importActual<typeof import('./stack-manager.js')>(
    './stack-manager.js'
  );
  return {
    ...actual,
    deployOrUpdateStack: vi.fn(),
  };
});

import { mapParameters } from './parameter-mapper.js';
import { deployOrUpdateStack } from './stack-manager.js';

describe('deployment-orchestrator', () => {
  // Common test fixtures
  const mockCredentials: AssumedRoleCredentials = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    sessionToken: 'FwoGZXIvYXdzEBYaDJ...',
  };

  const mockLeaseDetails: LeaseDetails = {
    leaseId: 'lease-12345',
    accountId: '123456789012',
    templateName: 'basic-vpc',
    budgetAmount: 1000,
    status: 'active',
    expirationDate: '2025-12-31T23:59:59Z',
    requesterEmail: 'user@example.com',
  };

  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deployWithParameters', () => {
    it('should successfully deploy stack with mapped parameters', async () => {
      const templateParameters = ['LeaseId', 'AccountId', 'Budget'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
        { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
        { ParameterKey: 'Budget', ParameterValue: '1000' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack',
        credentials: mockCredentials,
      };

      const result = await deployWithParameters(input, mockLogger);

      expect(result).toEqual({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        parametersUsed: 3,
        parametersSkipped: 0,
      });

      expect(mapParameters).toHaveBeenCalledWith(mockLeaseDetails, templateParameters);
      expect(deployOrUpdateStack).toHaveBeenCalledWith({
        stackName: 'test-stack',
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        parameters: mappedParams,
        credentials: mockCredentials,
      });
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle template with no parameters gracefully', async () => {
      vi.mocked(mapParameters).mockReturnValue([]);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters: [],
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-no-params',
        credentials: mockCredentials,
      };

      const result = await deployWithParameters(input, mockLogger);

      expect(result).toEqual({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        parametersUsed: 0,
        parametersSkipped: 0,
      });

      expect(deployOrUpdateStack).toHaveBeenCalledWith({
        stackName: 'test-stack-no-params',
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        parameters: undefined,
        credentials: mockCredentials,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Stack 'test-stack-no-params' has no parameters to map - deploying without parameters"
      );
    });

    it('should handle partial parameter mapping', async () => {
      const templateParameters = ['LeaseId', 'AccountId', 'Budget', 'UnknownParam', 'Status'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
        { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
        { ParameterKey: 'Budget', ParameterValue: '1000' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-partial',
        credentials: mockCredentials,
      };

      const result = await deployWithParameters(input, mockLogger);

      expect(result).toEqual({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        parametersUsed: 3,
        parametersSkipped: 2,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Stack 'test-stack-partial' skipped 2 parameters (no mapping or no value)"
      );
    });

    it('should merge custom parameters with mapped parameters', async () => {
      const templateParameters = ['LeaseId', 'AccountId'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
        { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-custom',
        credentials: mockCredentials,
        customParameters: {
          Environment: 'production',
          Region: 'eu-west-2',
        },
      };

      const result = await deployWithParameters(input, mockLogger);

      expect(result.parametersUsed).toBe(4);

      // Verify deployOrUpdateStack was called with merged parameters
      const deployCall = vi.mocked(deployOrUpdateStack).mock.calls[0][0];
      expect(deployCall.parameters).toHaveLength(4);

      // Verify all parameters are present (order may vary due to Map)
      const paramKeys = deployCall.parameters?.map((p) => p.ParameterKey).sort();
      expect(paramKeys).toEqual(['AccountId', 'Environment', 'LeaseId', 'Region']);
    });

    it('should allow custom parameters to override mapped parameters', async () => {
      const templateParameters = ['LeaseId', 'AccountId'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
        { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-override',
        credentials: mockCredentials,
        customParameters: {
          AccountId: '999888777666', // Override mapped value
        },
      };

      const result = await deployWithParameters(input, mockLogger);

      expect(result.parametersUsed).toBe(2);

      // Verify the custom parameter overrode the mapped one
      const deployCall = vi.mocked(deployOrUpdateStack).mock.calls[0][0];
      const accountIdParam = deployCall.parameters?.find((p) => p.ParameterKey === 'AccountId');
      expect(accountIdParam?.ParameterValue).toBe('999888777666');
    });

    it('should log parameter names without exposing sensitive values', async () => {
      const templateParameters = ['LeaseId', 'RequesterEmail'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
        { ParameterKey: 'RequesterEmail', ParameterValue: 'sensitive@example.com' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-secure',
        credentials: mockCredentials,
      };

      await deployWithParameters(input, mockLogger);

      // Verify parameter names are logged but not values
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Stack 'test-stack-secure' deploying with 2 parameters: LeaseId, RequesterEmail",
        expect.objectContaining({
          parametersUsed: 2,
          parametersSkipped: 0,
        })
      );

      // Verify actual values are NOT in the logs
      const logCalls = vi.mocked(mockLogger.info).mock.calls.map((call) => JSON.stringify(call));
      const allLogs = logCalls.join(' ');
      expect(allLogs).not.toContain('sensitive@example.com');
    });

    it('should return existing stack when stack already exists', async () => {
      const templateParameters = ['LeaseId'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'exists',
        status: StackStatus.CREATE_COMPLETE,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'existing-stack',
        credentials: mockCredentials,
      };

      const result = await deployWithParameters(input, mockLogger);

      expect(result.action).toBe('exists');
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Stack 'existing-stack' deployment completed",
        expect.objectContaining({
          action: 'exists',
          status: StackStatus.CREATE_COMPLETE,
        })
      );
    });

    it('should skip deployment when stack is in progress', async () => {
      const templateParameters = ['LeaseId'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'skipped',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'in-progress-stack',
        credentials: mockCredentials,
      };

      const result = await deployWithParameters(input, mockLogger);

      expect(result.action).toBe('skipped');
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Stack 'in-progress-stack' deployment completed",
        expect.objectContaining({
          action: 'skipped',
          status: StackStatus.CREATE_IN_PROGRESS,
        })
      );
    });

    it('should throw DeploymentOrchestrationError when parameter mapping fails', async () => {
      const templateParameters = ['LeaseId'];

      vi.mocked(mapParameters).mockImplementation(() => {
        throw new Error('Parameter mapping error');
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-error',
        credentials: mockCredentials,
      };

      await expect(deployWithParameters(input, mockLogger)).rejects.toThrow(
        DeploymentOrchestrationError
      );
      await expect(deployWithParameters(input, mockLogger)).rejects.toThrow(
        /Failed to deploy stack 'test-stack-error'/
      );

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should throw DeploymentOrchestrationError when stack deployment fails', async () => {
      const templateParameters = ['LeaseId'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockRejectedValue(
        new Error('CloudFormation service error')
      );

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-fail',
        credentials: mockCredentials,
      };

      await expect(deployWithParameters(input, mockLogger)).rejects.toThrow(
        DeploymentOrchestrationError
      );
      await expect(deployWithParameters(input, mockLogger)).rejects.toThrow(
        /Failed to deploy stack 'test-stack-fail'/
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to deploy stack 'test-stack-fail'"),
        expect.objectContaining({
          stackName: 'test-stack-fail',
          leaseId: mockLeaseDetails.leaseId,
        })
      );
    });

    it('should work without logger (use default console logger)', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const templateParameters = ['LeaseId'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-no-logger',
        credentials: mockCredentials,
      };

      const result = await deployWithParameters(input);

      expect(result.stackId).toBeDefined();
      expect(consoleLogSpy).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
      consoleDebugSpy.mockRestore();
    });

    it('should handle custom parameters from lease metadata', async () => {
      const leaseDetailsWithMetadata: LeaseDetails = {
        ...mockLeaseDetails,
        customMetadata: {
          Environment: 'staging',
          CostCenter: 'engineering',
        },
      };

      const templateParameters = ['LeaseId'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: leaseDetailsWithMetadata,
        stackName: 'test-stack-metadata',
        credentials: mockCredentials,
        customParameters: {
          Environment: 'staging',
          CostCenter: 'engineering',
        },
      };

      const result = await deployWithParameters(input, mockLogger);

      expect(result.parametersUsed).toBe(3); // LeaseId + 2 custom
    });

    it('should handle empty custom parameters object', async () => {
      const templateParameters = ['LeaseId'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-empty-custom',
        credentials: mockCredentials,
        customParameters: {},
      };

      const result = await deployWithParameters(input, mockLogger);

      expect(result.parametersUsed).toBe(1);
    });

    it('should preserve error context in DeploymentOrchestrationError', async () => {
      const templateParameters = ['LeaseId'];
      const originalError = new Error('Original error message');

      vi.mocked(mapParameters).mockImplementation(() => {
        throw originalError;
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-context',
        credentials: mockCredentials,
      };

      try {
        await deployWithParameters(input, mockLogger);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(DeploymentOrchestrationError);
        expect((error as DeploymentOrchestrationError).originalError).toBe(originalError);
        expect((error as DeploymentOrchestrationError).message).toContain('test-stack-context');
        expect((error as DeploymentOrchestrationError).message).toContain('lease-12345');
      }
    });

    it('should handle non-Error exceptions gracefully', async () => {
      const templateParameters = ['LeaseId'];

      vi.mocked(mapParameters).mockImplementation(() => {
        throw 'String error'; // Non-Error throw
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-non-error',
        credentials: mockCredentials,
      };

      await expect(deployWithParameters(input, mockLogger)).rejects.toThrow(
        DeploymentOrchestrationError
      );
      await expect(deployWithParameters(input, mockLogger)).rejects.toThrow(
        /Unknown error during deployment/
      );
    });

    it('should log context information on error', async () => {
      const templateParameters = ['LeaseId'];

      vi.mocked(mapParameters).mockImplementation(() => {
        throw new Error('Test error');
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-log-context',
        credentials: mockCredentials,
      };

      await expect(deployWithParameters(input, mockLogger)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          stackName: 'test-stack-log-context',
          leaseId: 'lease-12345',
        })
      );
    });

    it('should handle multiple custom parameters with special characters', async () => {
      const templateParameters = ['LeaseId'];
      const mappedParams: CloudFormationParameter[] = [
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
      ];

      vi.mocked(mapParameters).mockReturnValue(mappedParams);
      vi.mocked(deployOrUpdateStack).mockResolvedValue({
        stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/guid',
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });

      const input: DeploymentInput = {
        templateBody: '{"AWSTemplateFormatVersion":"2010-09-09"}',
        templateParameters,
        leaseDetails: mockLeaseDetails,
        stackName: 'test-stack-special-chars',
        credentials: mockCredentials,
        customParameters: {
          'Tag:Environment': 'production',
          'Tag:Cost-Center': 'eng-001',
          Version: '1.0.0-beta',
        },
      };

      const result = await deployWithParameters(input, mockLogger);

      expect(result.parametersUsed).toBe(4); // 1 mapped + 3 custom
      expect(result.action).toBe('created');
    });
  });
});
