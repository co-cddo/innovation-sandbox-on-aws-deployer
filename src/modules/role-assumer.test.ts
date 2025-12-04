import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { assumeRole, resetSTSClient, RoleAssumptionError } from './role-assumer.js';
import { resetConfig } from './config.js';

// Hub account ID used by ISB for intermediate role
const HUB_ACCOUNT_ID = '568672915267';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-sts', () => {
  const actualCommand = vi.fn();
  return {
    STSClient: vi.fn(() => ({
      send: vi.fn(),
    })),
    AssumeRoleCommand: actualCommand,
  };
});

// Mock the config module
vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js');
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      targetRoleName: 'InnovationSandbox-ndx-DeployerRole',
      awsRegion: 'us-west-2',
      githubRepo: 'co-cddo/ndx_try_aws_scenarios',
      githubBranch: 'main',
      githubPath: 'cloudformation/scenarios',
      leaseTableName: 'test-table',
      eventSource: 'innovation-sandbox',
      logLevel: 'INFO' as const,
    })),
  };
});

describe('role-assumer', () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    resetSTSClient();
    resetConfig();

    // Setup mock STS client - returns different creds for each call
    mockSend = vi.fn();
    vi.mocked(STSClient).mockImplementation(() => ({
      send: mockSend,
    }) as unknown as STSClient);
  });

  afterEach(() => {
    resetSTSClient();
    resetConfig();
  });

  describe('assumeRole', () => {
    // ISB uses a double role chain:
    // 1. Lambda -> IntermediateRole (hub account 568672915267)
    // 2. IntermediateRole -> SandboxAccountRole (target account)

    const mockIntermediateCredentials = {
      AccessKeyId: 'ASIA_INTERMEDIATE_KEY',
      SecretAccessKey: 'IntermediateSecret123',
      SessionToken: 'IntermediateSessionToken',
      Expiration: new Date('2025-12-03T22:00:00Z'),
    };

    const mockSandboxCredentials = {
      AccessKeyId: 'ASIA_SANDBOX_KEY',
      SecretAccessKey: 'SandboxSecret456',
      SessionToken: 'SandboxSessionToken',
      Expiration: new Date('2025-12-03T23:00:00Z'),
    };

    it('should successfully perform double role chain and return sandbox credentials', async () => {
      // First call returns intermediate creds, second returns sandbox creds
      mockSend
        .mockResolvedValueOnce({ Credentials: mockIntermediateCredentials })
        .mockResolvedValueOnce({ Credentials: mockSandboxCredentials });

      const result = await assumeRole('831494785845');

      // Should return the sandbox credentials (second hop)
      expect(result).toEqual({
        accessKeyId: mockSandboxCredentials.AccessKeyId,
        secretAccessKey: mockSandboxCredentials.SecretAccessKey,
        sessionToken: mockSandboxCredentials.SessionToken,
        expiration: mockSandboxCredentials.Expiration,
      });
    });

    it('should first assume IntermediateRole in hub account', async () => {
      mockSend
        .mockResolvedValueOnce({ Credentials: mockIntermediateCredentials })
        .mockResolvedValueOnce({ Credentials: mockSandboxCredentials });

      await assumeRole('831494785845');

      // First call should be to IntermediateRole in hub account
      expect(AssumeRoleCommand).toHaveBeenNthCalledWith(1, {
        RoleArn: `arn:aws:iam::${HUB_ACCOUNT_ID}:role/InnovationSandbox-ndx-IntermediateRole`,
        RoleSessionName: 'isb-deployer-intermediate',
        DurationSeconds: 3600,
      });
    });

    it('should then assume SandboxAccountRole in target account', async () => {
      mockSend
        .mockResolvedValueOnce({ Credentials: mockIntermediateCredentials })
        .mockResolvedValueOnce({ Credentials: mockSandboxCredentials });

      await assumeRole('987654321098');

      // Second call should be to SandboxAccountRole in target account
      expect(AssumeRoleCommand).toHaveBeenNthCalledWith(2, {
        RoleArn: 'arn:aws:iam::987654321098:role/InnovationSandbox-ndx-SandboxAccountRole',
        RoleSessionName: 'isb-deployer-sandbox',
        DurationSeconds: 3600,
      });
    });

    it('should make exactly two AssumeRole calls', async () => {
      mockSend
        .mockResolvedValueOnce({ Credentials: mockIntermediateCredentials })
        .mockResolvedValueOnce({ Credentials: mockSandboxCredentials });

      await assumeRole('123456789012');

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(AssumeRoleCommand).toHaveBeenCalledTimes(2);
    });

    it('should work with different target account IDs', async () => {
      mockSend
        .mockResolvedValueOnce({ Credentials: mockIntermediateCredentials })
        .mockResolvedValueOnce({ Credentials: mockSandboxCredentials });

      await assumeRole('111222333444');

      // First call always goes to hub account
      expect(AssumeRoleCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({
        RoleArn: `arn:aws:iam::${HUB_ACCOUNT_ID}:role/InnovationSandbox-ndx-IntermediateRole`,
      }));

      // Second call goes to target account
      expect(AssumeRoleCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
        RoleArn: 'arn:aws:iam::111222333444:role/InnovationSandbox-ndx-SandboxAccountRole',
      }));
    });

    it('should throw RoleAssumptionError when intermediate role assumption fails', async () => {
      const stsError = new Error('Access denied for IntermediateRole');
      stsError.name = 'AccessDenied';

      mockSend.mockRejectedValue(stsError);

      await expect(assumeRole('123456789012')).rejects.toThrow(RoleAssumptionError);
      await expect(assumeRole('123456789012')).rejects.toThrow('Failed to assume role chain');
    });

    it('should throw RoleAssumptionError when sandbox role assumption fails', async () => {
      const stsError = new Error('Access denied for SandboxAccountRole');
      stsError.name = 'AccessDenied';

      mockSend
        .mockResolvedValueOnce({ Credentials: mockIntermediateCredentials })
        .mockRejectedValueOnce(stsError);

      await expect(assumeRole('123456789012')).rejects.toThrow(RoleAssumptionError);
      await expect(assumeRole('123456789012')).rejects.toThrow('Failed to assume role chain');
    });

    it('should throw RoleAssumptionError when intermediate credentials are missing', async () => {
      mockSend.mockResolvedValue({ Credentials: undefined });

      await expect(assumeRole('123456789012')).rejects.toThrow(
        /did not return credentials/
      );
    });

    it('should throw RoleAssumptionError when sandbox credentials are missing', async () => {
      mockSend
        .mockResolvedValueOnce({ Credentials: mockIntermediateCredentials })
        .mockResolvedValueOnce({ Credentials: undefined });

      await expect(assumeRole('123456789012')).rejects.toThrow(
        /did not return credentials/
      );
    });

    it('should throw RoleAssumptionError when AccessKeyId is missing', async () => {
      mockSend
        .mockResolvedValueOnce({ Credentials: mockIntermediateCredentials })
        .mockResolvedValueOnce({
          Credentials: {
            SecretAccessKey: 'secret',
            SessionToken: 'token',
          },
        });

      await expect(assumeRole('123456789012')).rejects.toThrow(
        /incomplete credentials/
      );
    });

    it('should include account ID in error messages', async () => {
      const stsError = new Error('Role not found');
      stsError.name = 'NoSuchEntity';

      mockSend.mockRejectedValue(stsError);

      await expect(assumeRole('123456789012')).rejects.toThrow('account 123456789012');
    });

    it('should preserve original error in RoleAssumptionError', async () => {
      const originalError = new Error('Original STS error');
      originalError.name = 'STSError';

      mockSend.mockRejectedValue(originalError);

      try {
        await assumeRole('123456789012');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RoleAssumptionError);
        expect((error as RoleAssumptionError).originalError).toBe(originalError);
      }
    });

    it('should handle credentials without expiration timestamp', async () => {
      const credsWithoutExpiration = {
        AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
        // No Expiration field
      };

      mockSend
        .mockResolvedValueOnce({ Credentials: mockIntermediateCredentials })
        .mockResolvedValueOnce({ Credentials: credsWithoutExpiration });

      const result = await assumeRole('123456789012');

      expect(result.accessKeyId).toBe(credsWithoutExpiration.AccessKeyId);
      expect(result.expiration).toBeUndefined();
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      networkError.name = 'NetworkingError';

      mockSend.mockRejectedValue(networkError);

      await expect(assumeRole('123456789012')).rejects.toThrow(RoleAssumptionError);
      await expect(assumeRole('123456789012')).rejects.toThrow('NetworkingError');
    });

    it('should handle unknown errors gracefully', async () => {
      mockSend.mockRejectedValue('unknown error string');

      await expect(assumeRole('123456789012')).rejects.toThrow(RoleAssumptionError);
      await expect(assumeRole('123456789012')).rejects.toThrow('Unknown error assuming role');
    });
  });

  describe('resetSTSClient', () => {
    it('should be a no-op (clients are created per-request)', () => {
      // resetSTSClient is now a no-op since clients are created per-request
      // for role chaining. This test just verifies it doesn't throw.
      expect(() => resetSTSClient()).not.toThrow();
    });
  });

  describe('RoleAssumptionError', () => {
    it('should be an instance of Error', () => {
      const error = new RoleAssumptionError('Test error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct name property', () => {
      const error = new RoleAssumptionError('Test error');
      expect(error.name).toBe('RoleAssumptionError');
    });

    it('should preserve error message', () => {
      const message = 'Failed to assume role';
      const error = new RoleAssumptionError(message);
      expect(error.message).toBe(message);
    });

    it('should store original error if provided', () => {
      const originalError = new Error('Original');
      const error = new RoleAssumptionError('Wrapped error', originalError);
      expect(error.originalError).toBe(originalError);
    });
  });
});
