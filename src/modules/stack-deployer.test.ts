import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudFormationClient, CreateStackCommand } from '@aws-sdk/client-cloudformation';
import {
  deployStack,
  StackDeploymentError,
  type DeployStackInput,
  type CloudFormationParameter,
} from './stack-deployer.js';
import type { AssumedRoleCredentials } from './role-assumer.js';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-cloudformation', () => {
  const actualCommand = vi.fn();
  return {
    CloudFormationClient: vi.fn(() => ({
      send: vi.fn(),
    })),
    CreateStackCommand: actualCommand,
  };
});

describe('stack-deployer', () => {
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
    vi.mocked(CloudFormationClient).mockImplementation(() => mockCFClient);
  });

  describe('deployStack', () => {
    it('should successfully deploy a stack and return stack ID', async () => {
      const mockStackId = 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        StackId: mockStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      const result = await deployStack(input);

      expect(result).toEqual({
        stackId: mockStackId,
      });
    });

    it('should create CloudFormation client with correct credentials', async () => {
      const mockStackId = 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        StackId: mockStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await deployStack(input);

      expect(CloudFormationClient).toHaveBeenCalledWith({
        credentials: {
          accessKeyId: mockCredentials.accessKeyId,
          secretAccessKey: mockCredentials.secretAccessKey,
          sessionToken: mockCredentials.sessionToken,
        },
      });
    });

    it('should call CreateStackCommand with correct parameters', async () => {
      const mockStackId = 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        StackId: mockStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await deployStack(input);

      expect(CreateStackCommand).toHaveBeenCalledWith({
        StackName: 'test-stack',
        TemplateBody: mockTemplateBody,
        Parameters: undefined,
        Capabilities: ['CAPABILITY_NAMED_IAM'],
      });
    });

    it('should enable CAPABILITY_NAMED_IAM for IAM resource creation', async () => {
      const mockStackId = 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        StackId: mockStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await deployStack(input);

      expect(CreateStackCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Capabilities: ['CAPABILITY_NAMED_IAM'],
        })
      );
    });

    it('should deploy stack with parameters when provided', async () => {
      const mockStackId = 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        StackId: mockStackId,
      });

      const parameters: CloudFormationParameter[] = [
        { ParameterKey: 'Environment', ParameterValue: 'production' },
        { ParameterKey: 'BucketName', ParameterValue: 'my-test-bucket' },
      ];

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        parameters,
        credentials: mockCredentials,
      };

      await deployStack(input);

      expect(CreateStackCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Parameters: parameters,
        })
      );
    });

    it('should deploy stack without parameters when not provided', async () => {
      const mockStackId = 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        StackId: mockStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await deployStack(input);

      expect(CreateStackCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Parameters: undefined,
        })
      );
    });

    it('should create a new client instance per call (no singleton)', async () => {
      const mockStackId = 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        StackId: mockStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack-1',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      // First call
      await deployStack(input);

      // Second call
      await deployStack({ ...input, stackName: 'test-stack-2' });

      // Should create two separate client instances
      expect(CloudFormationClient).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw StackDeploymentError when StackId is missing from response', async () => {
      mockSend.mockResolvedValue({
        // No StackId in response
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await expect(deployStack(input)).rejects.toThrow(StackDeploymentError);
      await expect(deployStack(input)).rejects.toThrow(
        'did not return a StackId for stack test-stack'
      );
    });

    it('should handle AlreadyExistsException error', async () => {
      const cfnError = new Error('Stack [test-stack] already exists');
      cfnError.name = 'AlreadyExistsException';

      mockSend.mockRejectedValue(cfnError);

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await expect(deployStack(input)).rejects.toThrow(StackDeploymentError);
      await expect(deployStack(input)).rejects.toThrow('already exists');
      await expect(deployStack(input)).rejects.toThrow('test-stack');
    });

    it('should handle InsufficientCapabilitiesException error', async () => {
      const cfnError = new Error('Requires capabilities: [CAPABILITY_AUTO_EXPAND]');
      cfnError.name = 'InsufficientCapabilitiesException';

      mockSend.mockRejectedValue(cfnError);

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await expect(deployStack(input)).rejects.toThrow(StackDeploymentError);
      await expect(deployStack(input)).rejects.toThrow('additional capabilities');
      await expect(deployStack(input)).rejects.toThrow('CAPABILITY_NAMED_IAM');
    });

    it('should handle ValidationError for invalid template', async () => {
      const cfnError = new Error('Template format error: JSON not well-formed');
      cfnError.name = 'ValidationError';

      mockSend.mockRejectedValue(cfnError);

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: 'invalid-json',
        credentials: mockCredentials,
      };

      await expect(deployStack(input)).rejects.toThrow(StackDeploymentError);
      await expect(deployStack(input)).rejects.toThrow('Invalid CloudFormation template');
      await expect(deployStack(input)).rejects.toThrow('test-stack');
    });

    it('should handle LimitExceededException error', async () => {
      const cfnError = new Error('Maximum number of stacks exceeded');
      cfnError.name = 'LimitExceededException';

      mockSend.mockRejectedValue(cfnError);

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await expect(deployStack(input)).rejects.toThrow(StackDeploymentError);
      await expect(deployStack(input)).rejects.toThrow('limit exceeded');
      await expect(deployStack(input)).rejects.toThrow('test-stack');
    });

    it('should handle TokenAlreadyExistsException error', async () => {
      const cfnError = new Error('Client request token already exists');
      cfnError.name = 'TokenAlreadyExistsException';

      mockSend.mockRejectedValue(cfnError);

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await expect(deployStack(input)).rejects.toThrow(StackDeploymentError);
      await expect(deployStack(input)).rejects.toThrow('token already exists');
      await expect(deployStack(input)).rejects.toThrow('test-stack');
    });

    it('should handle generic AWS errors', async () => {
      const cfnError = new Error('Network timeout');
      cfnError.name = 'NetworkingError';

      mockSend.mockRejectedValue(cfnError);

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await expect(deployStack(input)).rejects.toThrow(StackDeploymentError);
      await expect(deployStack(input)).rejects.toThrow('NetworkingError');
      await expect(deployStack(input)).rejects.toThrow('Network timeout');
    });

    it('should handle unknown errors gracefully', async () => {
      mockSend.mockRejectedValue('unknown error string');

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await expect(deployStack(input)).rejects.toThrow(StackDeploymentError);
      await expect(deployStack(input)).rejects.toThrow('Unknown error deploying stack');
    });

    it('should preserve original error in StackDeploymentError', async () => {
      const originalError = new Error('Original CloudFormation error');
      originalError.name = 'CFNError';

      mockSend.mockRejectedValue(originalError);

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      try {
        await deployStack(input);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(StackDeploymentError);
        expect((error as StackDeploymentError).originalError).toBe(originalError);
      }
    });

    it('should include stack name in error messages', async () => {
      const cfnError = new Error('Some CloudFormation error');
      cfnError.name = 'SomeError';

      mockSend.mockRejectedValue(cfnError);

      const input: DeployStackInput = {
        stackName: 'my-important-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await expect(deployStack(input)).rejects.toThrow('my-important-stack');
    });

    it('should work with different credential sets', async () => {
      const mockStackId = 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        StackId: mockStackId,
      });

      const credentials1: AssumedRoleCredentials = {
        accessKeyId: 'AKIA1111111111111111',
        secretAccessKey: 'secret1',
        sessionToken: 'token1',
      };

      const credentials2: AssumedRoleCredentials = {
        accessKeyId: 'AKIA2222222222222222',
        secretAccessKey: 'secret2',
        sessionToken: 'token2',
      };

      // Deploy with first credentials
      await deployStack({
        stackName: 'stack-1',
        templateBody: mockTemplateBody,
        credentials: credentials1,
      });

      expect(CloudFormationClient).toHaveBeenCalledWith({
        credentials: {
          accessKeyId: credentials1.accessKeyId,
          secretAccessKey: credentials1.secretAccessKey,
          sessionToken: credentials1.sessionToken,
        },
      });

      // Deploy with second credentials
      await deployStack({
        stackName: 'stack-2',
        templateBody: mockTemplateBody,
        credentials: credentials2,
      });

      expect(CloudFormationClient).toHaveBeenCalledWith({
        credentials: {
          accessKeyId: credentials2.accessKeyId,
          secretAccessKey: credentials2.secretAccessKey,
          sessionToken: credentials2.sessionToken,
        },
      });
    });

    it('should handle complex templates with nested resources', async () => {
      const mockStackId = 'arn:aws:cloudformation:eu-west-2:123456789012:stack/complex-stack/xyz789';

      mockSend.mockResolvedValue({
        StackId: mockStackId,
      });

      const complexTemplate = JSON.stringify({
        AWSTemplateFormatVersion: '2010-09-09',
        Description: 'Complex template with IAM resources',
        Resources: {
          MyRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
              AssumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  {
                    Effect: 'Allow',
                    Principal: { Service: 'lambda.amazonaws.com' },
                    Action: 'sts:AssumeRole',
                  },
                ],
              },
            },
          },
        },
      });

      const input: DeployStackInput = {
        stackName: 'complex-stack',
        templateBody: complexTemplate,
        credentials: mockCredentials,
      };

      const result = await deployStack(input);

      expect(result.stackId).toBe(mockStackId);
      expect(CreateStackCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TemplateBody: complexTemplate,
          Capabilities: ['CAPABILITY_NAMED_IAM'],
        })
      );
    });

    it('should send command to CloudFormation client', async () => {
      const mockStackId = 'arn:aws:cloudformation:eu-west-2:123456789012:stack/test-stack/abc123';

      mockSend.mockResolvedValue({
        StackId: mockStackId,
      });

      const input: DeployStackInput = {
        stackName: 'test-stack',
        templateBody: mockTemplateBody,
        credentials: mockCredentials,
      };

      await deployStack(input);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(Object));
    });
  });

  describe('StackDeploymentError', () => {
    it('should be an instance of Error', () => {
      const error = new StackDeploymentError('Test error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct name property', () => {
      const error = new StackDeploymentError('Test error');
      expect(error.name).toBe('StackDeploymentError');
    });

    it('should preserve error message', () => {
      const message = 'Failed to deploy stack';
      const error = new StackDeploymentError(message);
      expect(error.message).toBe(message);
    });

    it('should store original error if provided', () => {
      const originalError = new Error('Original');
      const error = new StackDeploymentError('Wrapped error', originalError);
      expect(error.originalError).toBe(originalError);
    });

    it('should work without original error', () => {
      const error = new StackDeploymentError('Error without original');
      expect(error.originalError).toBeUndefined();
    });
  });
});
