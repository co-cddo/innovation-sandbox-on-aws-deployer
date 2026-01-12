import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CloudFormationClient,
  DescribeStacksCommand,
  DeleteStackCommand,
} from '@aws-sdk/client-cloudformation';
import { CreateStackCommand } from '@aws-sdk/client-cloudformation';
import {
  getStackStatus,
  deployOrUpdateStack,
  StackManagementError,
  StackStatus,
  type StackStatusResult,
  type StackOperationResult,
} from './stack-manager.js';
import type { AssumedRoleCredentials } from './role-assumer.js';
import type { DeployStackInput } from './stack-deployer.js';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-cloudformation', () => {
  return {
    CloudFormationClient: vi.fn(function () {
      return { send: vi.fn() };
    }),
    DescribeStacksCommand: vi.fn(function (input: unknown) {
      return { input };
    }),
    DeleteStackCommand: vi.fn(function (input: unknown) {
      return { input };
    }),
    CreateStackCommand: vi.fn(function (input: unknown) {
      return { input };
    }),
  };
});

// Mock the deployStack function
vi.mock('./stack-deployer.js', async () => {
  const actual = await vi.importActual<typeof import('./stack-deployer.js')>('./stack-deployer.js');
  return {
    ...actual,
    deployStack: vi.fn(),
  };
});

describe('stack-manager', () => {
  let mockCFClient: any;
  let mockSend: ReturnType<typeof vi.fn>;

  const mockCredentials: AssumedRoleCredentials = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    sessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
    expiration: new Date('2025-12-03T23:00:00Z'),
  };

  const mockTemplateBody = JSON.stringify({
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Test template',
    Resources: {
      TestBucket: {
        Type: 'AWS::S3::Bucket',
      },
    },
  });

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock CloudFormation client
    mockSend = vi.fn();
    mockCFClient = {
      send: mockSend,
    };
    vi.mocked(CloudFormationClient).mockImplementation(function () {
      return mockCFClient;
    });

    // Clear console.log and console.warn spies
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('getStackStatus', () => {
    it('should return exists: false when stack does not exist', async () => {
      const error = new Error('Stack [test-stack] does not exist');
      error.name = 'ValidationError';
      mockSend.mockRejectedValue(error);

      const result = await getStackStatus('test-stack', mockCredentials);

      expect(result).toEqual({
        exists: false,
      });
    });

    it('should return stack status when stack exists', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'CREATE_COMPLETE',
            CreationTime: new Date('2025-12-03T20:00:00Z'),
          },
        ],
      });

      const result = await getStackStatus('test-stack', mockCredentials);

      expect(result).toEqual({
        exists: true,
        stackId: mockStackId,
        status: StackStatus.CREATE_COMPLETE,
      });
    });

    it('should call DescribeStacksCommand with correct parameters', async () => {
      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123',
            StackName: 'test-stack',
            StackStatus: 'CREATE_COMPLETE',
          },
        ],
      });

      await getStackStatus('test-stack', mockCredentials);

      expect(DescribeStacksCommand).toHaveBeenCalledWith({
        StackName: 'test-stack',
      });
    });

    it('should create CloudFormation client with correct credentials and us-east-1 region', async () => {
      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123',
            StackName: 'test-stack',
            StackStatus: 'CREATE_COMPLETE',
          },
        ],
      });

      await getStackStatus('test-stack', mockCredentials);

      expect(CloudFormationClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: mockCredentials.accessKeyId,
          secretAccessKey: mockCredentials.secretAccessKey,
          sessionToken: mockCredentials.sessionToken,
        },
      });
    });

    it('should return exists: false when Stacks array is empty', async () => {
      mockSend.mockResolvedValue({
        Stacks: [],
      });

      const result = await getStackStatus('test-stack', mockCredentials);

      expect(result).toEqual({
        exists: false,
      });
    });

    it('should throw StackManagementError when StackId is missing', async () => {
      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackName: 'test-stack',
            StackStatus: 'CREATE_COMPLETE',
            // Missing StackId
          },
        ],
      });

      await expect(getStackStatus('test-stack', mockCredentials)).rejects.toThrow(
        StackManagementError
      );
      await expect(getStackStatus('test-stack', mockCredentials)).rejects.toThrow('incomplete');
    });

    it('should throw StackManagementError when StackStatus is missing', async () => {
      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123',
            StackName: 'test-stack',
            // Missing StackStatus
          },
        ],
      });

      await expect(getStackStatus('test-stack', mockCredentials)).rejects.toThrow(
        StackManagementError
      );
    });

    it('should throw StackManagementError for non-ValidationError errors', async () => {
      const error = new Error('Network timeout');
      error.name = 'NetworkingError';
      mockSend.mockRejectedValue(error);

      await expect(getStackStatus('test-stack', mockCredentials)).rejects.toThrow(
        StackManagementError
      );
      await expect(getStackStatus('test-stack', mockCredentials)).rejects.toThrow('Network');
    });

    it('should handle UPDATE_COMPLETE status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'UPDATE_COMPLETE',
          },
        ],
      });

      const result = await getStackStatus('test-stack', mockCredentials);

      expect(result).toEqual({
        exists: true,
        stackId: mockStackId,
        status: StackStatus.UPDATE_COMPLETE,
      });
    });

    it('should handle CREATE_IN_PROGRESS status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'CREATE_IN_PROGRESS',
          },
        ],
      });

      const result = await getStackStatus('test-stack', mockCredentials);

      expect(result.status).toBe(StackStatus.CREATE_IN_PROGRESS);
    });

    it('should handle UPDATE_ROLLBACK_COMPLETE status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'UPDATE_ROLLBACK_COMPLETE',
          },
        ],
      });

      const result = await getStackStatus('test-stack', mockCredentials);

      expect(result.status).toBe(StackStatus.UPDATE_ROLLBACK_COMPLETE);
    });

    it('should preserve original error in StackManagementError', async () => {
      const originalError = new Error('Original error');
      originalError.name = 'TestError';
      mockSend.mockRejectedValue(originalError);

      try {
        await getStackStatus('test-stack', mockCredentials);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(StackManagementError);
        expect((error as StackManagementError).originalError).toBe(originalError);
      }
    });
  });

  describe('deployOrUpdateStack', () => {
    // Import is handled by vi.mock at the top of the file
    let mockDeployStack: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const { deployStack } = await import('./stack-deployer.js');
      mockDeployStack = vi.mocked(deployStack);
      mockDeployStack.mockClear();
    });

    it('should create new stack when stack does not exist', async () => {
      // Mock stack doesn't exist
      const error = new Error('Stack [test-stack] does not exist');
      error.name = 'ValidationError';
      mockSend.mockRejectedValue(error);

      // Mock deployStack success
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';
      mockDeployStack.mockResolvedValue({
        stackId: mockStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result).toEqual({
        stackId: mockStackId,
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });
      expect(mockDeployStack).toHaveBeenCalledWith(input);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('does not exist. Creating new stack')
      );
    });

    it('should return existing stack ID for CREATE_COMPLETE status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'CREATE_COMPLETE',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result).toEqual({
        stackId: mockStackId,
        action: 'exists',
        status: StackStatus.CREATE_COMPLETE,
      });
      expect(mockDeployStack).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('already exists with status CREATE_COMPLETE')
      );
    });

    it('should return existing stack ID for UPDATE_COMPLETE status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'UPDATE_COMPLETE',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result).toEqual({
        stackId: mockStackId,
        action: 'exists',
        status: StackStatus.UPDATE_COMPLETE,
      });
      expect(mockDeployStack).not.toHaveBeenCalled();
    });

    it('should skip deployment for CREATE_IN_PROGRESS status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'CREATE_IN_PROGRESS',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result).toEqual({
        stackId: mockStackId,
        action: 'skipped',
        status: StackStatus.CREATE_IN_PROGRESS,
      });
      expect(mockDeployStack).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('CREATE_IN_PROGRESS state. Skipping deployment')
      );
    });

    it('should skip deployment for UPDATE_IN_PROGRESS status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'UPDATE_IN_PROGRESS',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result).toEqual({
        stackId: mockStackId,
        action: 'skipped',
        status: StackStatus.UPDATE_IN_PROGRESS,
      });
      expect(mockDeployStack).not.toHaveBeenCalled();
    });

    it('should skip deployment for DELETE_IN_PROGRESS status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'DELETE_IN_PROGRESS',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result.action).toBe('skipped');
      expect(mockDeployStack).not.toHaveBeenCalled();
    });

    it('should delete and recreate stack for ROLLBACK_COMPLETE status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';
      const newStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/def456';
      const stackNotExistError = Object.assign(
        new Error('Stack with id test-stack does not exist'),
        { name: 'ValidationError' }
      );

      // First call: describe stack (ROLLBACK_COMPLETE)
      // Second call: delete stack
      // Third call: describe stack during poll (stack doesn't exist - deletion complete)
      // Fourth call: final status check (stack doesn't exist)
      mockSend
        .mockResolvedValueOnce({
          Stacks: [
            {
              StackId: mockStackId,
              StackName: 'test-stack',
              StackStatus: 'ROLLBACK_COMPLETE',
            },
          ],
        })
        .mockResolvedValueOnce({}) // DeleteStack response
        .mockRejectedValueOnce(stackNotExistError) // First poll: stack doesn't exist
        .mockRejectedValueOnce(stackNotExistError); // Final status check: stack doesn't exist

      mockDeployStack.mockResolvedValue({
        stackId: newStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result).toEqual({
        stackId: newStackId,
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });
      expect(DeleteStackCommand).toHaveBeenCalledWith({
        StackName: 'test-stack',
      });
      expect(mockDeployStack).toHaveBeenCalledWith(input);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('ROLLBACK_COMPLETE state. Deleting stack')
      );
    });

    it('should handle UPDATE_ROLLBACK_COMPLETE status as updatable', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'UPDATE_ROLLBACK_COMPLETE',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result).toEqual({
        stackId: mockStackId,
        action: 'exists',
        status: StackStatus.UPDATE_ROLLBACK_COMPLETE,
      });
      expect(mockDeployStack).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE_ROLLBACK_COMPLETE state. Stack is updatable')
      );
    });

    it('should create new stack for DELETE_COMPLETE status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';
      const newStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/new789';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'DELETE_COMPLETE',
          },
        ],
      });

      mockDeployStack.mockResolvedValue({
        stackId: newStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result).toEqual({
        stackId: newStackId,
        action: 'created',
        status: StackStatus.CREATE_IN_PROGRESS,
      });
      expect(mockDeployStack).toHaveBeenCalledWith(input);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('DELETE_COMPLETE state. Treating as non-existent')
      );
    });

    it('should handle CREATE_FAILED status with warning', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'CREATE_FAILED',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result).toEqual({
        stackId: mockStackId,
        action: 'exists',
        status: StackStatus.CREATE_FAILED,
      });
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('unexpected state: CREATE_FAILED')
      );
    });

    it('should throw StackManagementError when stack data is incomplete', async () => {
      mockSend.mockResolvedValue({
        Stacks: [
          {
            // Missing StackId and StackStatus
            StackName: 'test-stack',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      try {
        await deployOrUpdateStack(input);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(StackManagementError);
        expect((error as Error).message).toContain('incomplete');
      }
    });

    it('should throw StackManagementError when delete fails for ROLLBACK_COMPLETE', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend
        .mockResolvedValueOnce({
          Stacks: [
            {
              StackId: mockStackId,
              StackName: 'test-stack',
              StackStatus: 'ROLLBACK_COMPLETE',
            },
          ],
        })
        .mockRejectedValueOnce(new Error('Delete failed'));

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      try {
        await deployOrUpdateStack(input);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(StackManagementError);
        expect((error as Error).message).toContain('Failed to delete stack');
      }
    });

    it('should skip deployment for ROLLBACK_IN_PROGRESS status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'ROLLBACK_IN_PROGRESS',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result.action).toBe('skipped');
      expect(result.status).toBe(StackStatus.ROLLBACK_IN_PROGRESS);
    });

    it('should skip deployment for UPDATE_ROLLBACK_IN_PROGRESS status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result.action).toBe('skipped');
    });

    it('should pass parameters to deployStack when creating new stack', async () => {
      const error = new Error('Stack does not exist');
      error.name = 'ValidationError';
      mockSend.mockRejectedValue(error);

      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';
      mockDeployStack.mockResolvedValue({
        stackId: mockStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        parameters: [
          { ParameterKey: 'Environment', ParameterValue: 'production' },
          { ParameterKey: 'BucketName', ParameterValue: 'my-bucket' },
        ],
        credentials: mockCredentials,
      };

      await deployOrUpdateStack(input);

      expect(mockDeployStack).toHaveBeenCalledWith(input);
    });

    it('should handle IMPORT_IN_PROGRESS status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'IMPORT_IN_PROGRESS',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result.action).toBe('skipped');
      expect(result.status).toBe(StackStatus.IMPORT_IN_PROGRESS);
    });

    it('should handle REVIEW_IN_PROGRESS status', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        Stacks: [
          {
            StackId: mockStackId,
            StackName: 'test-stack',
            StackStatus: 'REVIEW_IN_PROGRESS',
          },
        ],
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployOrUpdateStack(input);

      expect(result.action).toBe('skipped');
    });

    it('should use correct credentials and us-east-1 region for delete operation', async () => {
      const mockStackId = 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123';
      const stackNotExistError = Object.assign(
        new Error('Stack with id test-stack does not exist'),
        { name: 'ValidationError' }
      );

      mockSend
        .mockResolvedValueOnce({
          Stacks: [
            {
              StackId: mockStackId,
              StackName: 'test-stack',
              StackStatus: 'ROLLBACK_COMPLETE',
            },
          ],
        })
        .mockResolvedValueOnce({}) // DeleteStack response
        .mockRejectedValueOnce(stackNotExistError) // First poll: stack doesn't exist
        .mockRejectedValueOnce(stackNotExistError); // Final status check: stack doesn't exist

      mockDeployStack.mockResolvedValue({
        stackId: 'new-stack-id',
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await deployOrUpdateStack(input);

      // Verify CloudFormation client was created with correct credentials and region
      expect(CloudFormationClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: mockCredentials.accessKeyId,
          secretAccessKey: mockCredentials.secretAccessKey,
          sessionToken: mockCredentials.sessionToken,
        },
      });
    });
  });

  describe('StackManagementError', () => {
    it('should be an instance of Error', () => {
      const error = new StackManagementError('Test error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct name property', () => {
      const error = new StackManagementError('Test error');
      expect(error.name).toBe('StackManagementError');
    });

    it('should preserve error message', () => {
      const message = 'Failed to manage stack';
      const error = new StackManagementError(message);
      expect(error.message).toBe(message);
    });

    it('should store original error if provided', () => {
      const originalError = new Error('Original');
      const error = new StackManagementError('Wrapped error', originalError);
      expect(error.originalError).toBe(originalError);
    });

    it('should work without original error', () => {
      const error = new StackManagementError('Error without original');
      expect(error.originalError).toBeUndefined();
    });
  });

  describe('StackStatus enum', () => {
    it('should contain all expected status values', () => {
      expect(StackStatus.CREATE_IN_PROGRESS).toBe('CREATE_IN_PROGRESS');
      expect(StackStatus.CREATE_COMPLETE).toBe('CREATE_COMPLETE');
      expect(StackStatus.CREATE_FAILED).toBe('CREATE_FAILED');
      expect(StackStatus.ROLLBACK_IN_PROGRESS).toBe('ROLLBACK_IN_PROGRESS');
      expect(StackStatus.ROLLBACK_COMPLETE).toBe('ROLLBACK_COMPLETE');
      expect(StackStatus.UPDATE_IN_PROGRESS).toBe('UPDATE_IN_PROGRESS');
      expect(StackStatus.UPDATE_COMPLETE).toBe('UPDATE_COMPLETE');
      expect(StackStatus.UPDATE_ROLLBACK_COMPLETE).toBe('UPDATE_ROLLBACK_COMPLETE');
      expect(StackStatus.DELETE_IN_PROGRESS).toBe('DELETE_IN_PROGRESS');
      expect(StackStatus.DELETE_COMPLETE).toBe('DELETE_COMPLETE');
    });
  });
});
