import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AwsCredentialIdentity } from '@aws-sdk/types';

// Use vi.hoisted to ensure mock functions are available before mock factories run
const mocks = vi.hoisted(() => ({
  ssmSend: vi.fn(),
  cfnSend: vi.fn(),
}));

// Mock AWS SDK clients using proper class constructors
vi.mock('@aws-sdk/client-ssm', () => {
  return {
    SSMClient: class MockSSMClient {
      send = mocks.ssmSend;
    },
    GetParameterCommand: class MockGetParameterCommand {
      constructor(public input: unknown) {}
    },
    ParameterNotFound: class ParameterNotFound extends Error {
      constructor() {
        super('Parameter not found');
        this.name = 'ParameterNotFound';
      }
    },
  };
});

vi.mock('@aws-sdk/client-cloudformation', () => {
  return {
    CloudFormationClient: class MockCloudFormationClient {
      send = mocks.cfnSend;
    },
    DescribeStacksCommand: class MockDescribeStacksCommand {
      constructor(public input: unknown) {}
    },
    CreateStackCommand: class MockCreateStackCommand {
      constructor(public input: unknown) {}
    },
    UpdateStackCommand: class MockUpdateStackCommand {
      constructor(public input: unknown) {}
    },
    StackStatus: {
      CREATE_COMPLETE: 'CREATE_COMPLETE',
      CREATE_IN_PROGRESS: 'CREATE_IN_PROGRESS',
      CREATE_FAILED: 'CREATE_FAILED',
      UPDATE_COMPLETE: 'UPDATE_COMPLETE',
      UPDATE_IN_PROGRESS: 'UPDATE_IN_PROGRESS',
      UPDATE_ROLLBACK_COMPLETE: 'UPDATE_ROLLBACK_COMPLETE',
      UPDATE_ROLLBACK_FAILED: 'UPDATE_ROLLBACK_FAILED',
      ROLLBACK_COMPLETE: 'ROLLBACK_COMPLETE',
      ROLLBACK_FAILED: 'ROLLBACK_FAILED',
      DELETE_COMPLETE: 'DELETE_COMPLETE',
      DELETE_FAILED: 'DELETE_FAILED',
    },
  };
});

// Define StackStatus locally for test assertions
const StackStatus = {
  CREATE_COMPLETE: 'CREATE_COMPLETE',
  CREATE_IN_PROGRESS: 'CREATE_IN_PROGRESS',
  CREATE_FAILED: 'CREATE_FAILED',
  UPDATE_COMPLETE: 'UPDATE_COMPLETE',
  UPDATE_IN_PROGRESS: 'UPDATE_IN_PROGRESS',
  UPDATE_ROLLBACK_COMPLETE: 'UPDATE_ROLLBACK_COMPLETE',
  UPDATE_ROLLBACK_FAILED: 'UPDATE_ROLLBACK_FAILED',
  ROLLBACK_COMPLETE: 'ROLLBACK_COMPLETE',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  DELETE_COMPLETE: 'DELETE_COMPLETE',
  DELETE_FAILED: 'DELETE_FAILED',
} as const;

describe('cdk-bootstrapper module', () => {
  const mockCredentials: AwsCredentialIdentity = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    sessionToken: 'session-token',
  };

  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setContext: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkBootstrapStatus', () => {
    it('should return version when bootstrap parameter exists', async () => {
      mocks.ssmSend.mockResolvedValueOnce({
        Parameter: {
          Value: '21',
        },
      });

      const { checkBootstrapStatus } = await import('./cdk-bootstrapper.js');
      const result = await checkBootstrapStatus(mockCredentials, 'us-east-1', mockLogger as any);

      expect(result).toBe(21);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'CDK bootstrap detected',
        expect.objectContaining({ version: 21 })
      );
    });

    it('should return null when bootstrap parameter does not exist', async () => {
      const paramNotFound = new Error('Parameter not found');
      paramNotFound.name = 'ParameterNotFound';
      mocks.ssmSend.mockRejectedValueOnce(paramNotFound);

      const { checkBootstrapStatus } = await import('./cdk-bootstrapper.js');
      const result = await checkBootstrapStatus(mockCredentials, 'us-east-1', mockLogger as any);

      expect(result).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith('CDK bootstrap not found', expect.any(Object));
    });

    it('should throw on other SSM errors', async () => {
      const otherError = new Error('Access denied');
      otherError.name = 'AccessDeniedException';
      mocks.ssmSend.mockRejectedValueOnce(otherError);

      const { checkBootstrapStatus } = await import('./cdk-bootstrapper.js');

      await expect(
        checkBootstrapStatus(mockCredentials, 'us-east-1', mockLogger as any)
      ).rejects.toThrow('Access denied');
    });
  });

  describe('bootstrapAccount', () => {
    it('should create CDKToolkit stack when it does not exist', async () => {
      // First call: describe stack throws "does not exist"
      const notFoundError = new Error('Stack CDKToolkit does not exist');
      mocks.cfnSend.mockRejectedValueOnce(notFoundError);

      // Second call: create stack succeeds
      mocks.cfnSend.mockResolvedValueOnce({});

      // Third call: describe stack returns complete
      mocks.cfnSend.mockResolvedValueOnce({
        Stacks: [
          {
            StackName: 'CDKToolkit',
            StackStatus: StackStatus.CREATE_COMPLETE,
          },
        ],
      });

      const { bootstrapAccount } = await import('./cdk-bootstrapper.js');
      await bootstrapAccount(mockCredentials, '123456789012', 'us-east-1', mockLogger as any);

      expect(mockLogger.info).toHaveBeenCalledWith('CDKToolkit stack does not exist, will create');
      expect(mockLogger.info).toHaveBeenCalledWith('Creating CDKToolkit stack');
    });

    it('should update CDKToolkit stack when it exists', async () => {
      // First call: describe stack returns existing stack
      mocks.cfnSend.mockResolvedValueOnce({
        Stacks: [
          {
            StackName: 'CDKToolkit',
            StackStatus: StackStatus.CREATE_COMPLETE,
          },
        ],
      });

      // Second call: update stack succeeds
      mocks.cfnSend.mockResolvedValueOnce({});

      // Third call: describe stack returns update complete
      mocks.cfnSend.mockResolvedValueOnce({
        Stacks: [
          {
            StackName: 'CDKToolkit',
            StackStatus: StackStatus.UPDATE_COMPLETE,
          },
        ],
      });

      const { bootstrapAccount } = await import('./cdk-bootstrapper.js');
      await bootstrapAccount(mockCredentials, '123456789012', 'us-east-1', mockLogger as any);

      expect(mockLogger.info).toHaveBeenCalledWith('Updating CDKToolkit stack');
    });

    it('should handle "No updates" gracefully', async () => {
      // First call: describe stack returns existing stack
      mocks.cfnSend.mockResolvedValueOnce({
        Stacks: [
          {
            StackName: 'CDKToolkit',
            StackStatus: StackStatus.UPDATE_COMPLETE,
          },
        ],
      });

      // Second call: update stack throws "No updates"
      const noUpdatesError = new Error('No updates are to be performed');
      mocks.cfnSend.mockRejectedValueOnce(noUpdatesError);

      const { bootstrapAccount } = await import('./cdk-bootstrapper.js');

      // Should not throw
      await bootstrapAccount(mockCredentials, '123456789012', 'us-east-1', mockLogger as any);

      expect(mockLogger.info).toHaveBeenCalledWith('CDKToolkit stack is already up to date');
    });

    it('should wait when stack is in progress', async () => {
      // First call: describe stack returns in progress
      mocks.cfnSend.mockResolvedValueOnce({
        Stacks: [
          {
            StackName: 'CDKToolkit',
            StackStatus: StackStatus.UPDATE_IN_PROGRESS,
          },
        ],
      });

      // Second call: describe stack returns complete (for wait)
      mocks.cfnSend.mockResolvedValueOnce({
        Stacks: [
          {
            StackName: 'CDKToolkit',
            StackStatus: StackStatus.UPDATE_COMPLETE,
          },
        ],
      });

      const { bootstrapAccount } = await import('./cdk-bootstrapper.js');
      await bootstrapAccount(mockCredentials, '123456789012', 'us-east-1', mockLogger as any);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'CDKToolkit stack is being updated, waiting',
        expect.any(Object)
      );
    });
  });

  describe('ensureBootstrapped', () => {
    it('should bootstrap when not bootstrapped', async () => {
      // checkBootstrapStatus returns null
      const paramNotFound = new Error('Parameter not found');
      paramNotFound.name = 'ParameterNotFound';
      mocks.ssmSend.mockRejectedValueOnce(paramNotFound);

      // bootstrapAccount flow
      const notFoundError = new Error('Stack CDKToolkit does not exist');
      mocks.cfnSend.mockRejectedValueOnce(notFoundError);
      mocks.cfnSend.mockResolvedValueOnce({});
      mocks.cfnSend.mockResolvedValueOnce({
        Stacks: [
          {
            StackName: 'CDKToolkit',
            StackStatus: StackStatus.CREATE_COMPLETE,
          },
        ],
      });

      const { ensureBootstrapped } = await import('./cdk-bootstrapper.js');
      await ensureBootstrapped(mockCredentials, '123456789012', 'us-east-1', mockLogger as any);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Account not bootstrapped, bootstrapping now',
        expect.any(Object)
      );
    });

    it('should bootstrap when version is too old', async () => {
      // checkBootstrapStatus returns old version (5)
      mocks.ssmSend.mockResolvedValueOnce({
        Parameter: { Value: '5' },
      });

      // bootstrapAccount flow
      mocks.cfnSend.mockResolvedValueOnce({
        Stacks: [
          {
            StackName: 'CDKToolkit',
            StackStatus: StackStatus.UPDATE_COMPLETE,
          },
        ],
      });
      mocks.cfnSend.mockResolvedValueOnce({});
      mocks.cfnSend.mockResolvedValueOnce({
        Stacks: [
          {
            StackName: 'CDKToolkit',
            StackStatus: StackStatus.UPDATE_COMPLETE,
          },
        ],
      });

      const { ensureBootstrapped } = await import('./cdk-bootstrapper.js');
      await ensureBootstrapped(mockCredentials, '123456789012', 'us-east-1', mockLogger as any);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Bootstrap version too old, upgrading',
        expect.objectContaining({ currentVersion: 5 })
      );
    });

    it('should skip bootstrap when version is sufficient', async () => {
      // checkBootstrapStatus returns sufficient version (21)
      mocks.ssmSend.mockResolvedValueOnce({
        Parameter: { Value: '21' },
      });

      const { ensureBootstrapped } = await import('./cdk-bootstrapper.js');
      await ensureBootstrapped(mockCredentials, '123456789012', 'us-east-1', mockLogger as any);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Account already bootstrapped',
        expect.objectContaining({ version: 21 })
      );
      // Should not call CloudFormation at all
      expect(mocks.cfnSend).not.toHaveBeenCalled();
    });
  });
});
