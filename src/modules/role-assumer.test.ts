import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { assumeRole, resetSTSClient, RoleAssumptionError } from './role-assumer.js';
import { resetConfig } from './config.js';

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
      eventSource: 'isb-deployer',
      logLevel: 'INFO' as const,
    })),
  };
});

describe('role-assumer', () => {
  let mockSTSClient: any;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    resetSTSClient();
    resetConfig();

    // Setup mock STS client
    mockSend = vi.fn();
    mockSTSClient = {
      send: mockSend,
    };
    vi.mocked(STSClient).mockImplementation(() => mockSTSClient);
  });

  afterEach(() => {
    resetSTSClient();
    resetConfig();
  });

  describe('assumeRole', () => {
    it('should successfully assume a role and return credentials', async () => {
      const mockCredentials = {
        AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
        Expiration: new Date('2025-12-03T23:00:00Z'),
      };

      mockSend.mockResolvedValue({
        Credentials: mockCredentials,
      });

      const result = await assumeRole('123456789012');

      expect(result).toEqual({
        accessKeyId: mockCredentials.AccessKeyId,
        secretAccessKey: mockCredentials.SecretAccessKey,
        sessionToken: mockCredentials.SessionToken,
        expiration: mockCredentials.Expiration,
      });
    });

    it('should construct the correct role ARN', async () => {
      const mockCredentials = {
        AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
      };

      mockSend.mockResolvedValue({
        Credentials: mockCredentials,
      });

      await assumeRole('987654321098');

      expect(AssumeRoleCommand).toHaveBeenCalledWith({
        RoleArn: 'arn:aws:iam::987654321098:role/InnovationSandbox-ndx-DeployerRole',
        RoleSessionName: 'innovation-sandbox-deployer',
        DurationSeconds: 3600,
      });
    });

    it('should set the correct session name for audit trail', async () => {
      const mockCredentials = {
        AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
      };

      mockSend.mockResolvedValue({
        Credentials: mockCredentials,
      });

      await assumeRole('123456789012');

      expect(AssumeRoleCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          RoleSessionName: 'innovation-sandbox-deployer',
        })
      );
    });

    it('should set session duration to 1 hour (3600 seconds)', async () => {
      const mockCredentials = {
        AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
      };

      mockSend.mockResolvedValue({
        Credentials: mockCredentials,
      });

      await assumeRole('123456789012');

      expect(AssumeRoleCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          DurationSeconds: 3600,
        })
      );
    });

    it('should work with different account IDs', async () => {
      const mockCredentials = {
        AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
      };

      mockSend.mockResolvedValue({
        Credentials: mockCredentials,
      });

      // First account
      await assumeRole('111111111111');
      expect(AssumeRoleCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          RoleArn: 'arn:aws:iam::111111111111:role/InnovationSandbox-ndx-DeployerRole',
        })
      );

      // Second account
      await assumeRole('222222222222');
      expect(AssumeRoleCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          RoleArn: 'arn:aws:iam::222222222222:role/InnovationSandbox-ndx-DeployerRole',
        })
      );
    });

    it('should reuse STS client (singleton pattern)', async () => {
      const mockCredentials = {
        AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
      };

      mockSend.mockResolvedValue({
        Credentials: mockCredentials,
      });

      // Call twice
      await assumeRole('123456789012');
      await assumeRole('987654321098');

      // STS client should only be created once
      expect(STSClient).toHaveBeenCalledTimes(1);
      // But send should be called twice
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw RoleAssumptionError when STS returns no credentials', async () => {
      mockSend.mockResolvedValue({
        Credentials: undefined,
      });

      await expect(assumeRole('123456789012')).rejects.toThrow(RoleAssumptionError);
      await expect(assumeRole('123456789012')).rejects.toThrow(
        'STS AssumeRole succeeded but did not return credentials'
      );
    });

    it('should throw RoleAssumptionError when AccessKeyId is missing', async () => {
      mockSend.mockResolvedValue({
        Credentials: {
          SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
        },
      });

      await expect(assumeRole('123456789012')).rejects.toThrow(RoleAssumptionError);
      await expect(assumeRole('123456789012')).rejects.toThrow(
        'returned incomplete credentials'
      );
    });

    it('should throw RoleAssumptionError when SecretAccessKey is missing', async () => {
      mockSend.mockResolvedValue({
        Credentials: {
          AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
        },
      });

      await expect(assumeRole('123456789012')).rejects.toThrow(RoleAssumptionError);
      await expect(assumeRole('123456789012')).rejects.toThrow(
        'returned incomplete credentials'
      );
    });

    it('should throw RoleAssumptionError when SessionToken is missing', async () => {
      mockSend.mockResolvedValue({
        Credentials: {
          AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      });

      await expect(assumeRole('123456789012')).rejects.toThrow(RoleAssumptionError);
      await expect(assumeRole('123456789012')).rejects.toThrow(
        'returned incomplete credentials'
      );
    });

    it('should handle AccessDenied error from STS', async () => {
      const stsError = new Error('User is not authorized to perform: sts:AssumeRole');
      stsError.name = 'AccessDenied';

      mockSend.mockRejectedValue(stsError);

      await expect(assumeRole('123456789012')).rejects.toThrow(RoleAssumptionError);
      await expect(assumeRole('123456789012')).rejects.toThrow('AccessDenied');
      await expect(assumeRole('123456789012')).rejects.toThrow(
        'not authorized to perform: sts:AssumeRole'
      );
    });

    it('should handle InvalidParameterValue error from STS', async () => {
      const stsError = new Error('Invalid role ARN');
      stsError.name = 'InvalidParameterValue';

      mockSend.mockRejectedValue(stsError);

      await expect(assumeRole('123456789012')).rejects.toThrow(RoleAssumptionError);
      await expect(assumeRole('123456789012')).rejects.toThrow('InvalidParameterValue');
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

    it('should include role ARN in error messages', async () => {
      const stsError = new Error('Role not found');
      stsError.name = 'NoSuchEntity';

      mockSend.mockRejectedValue(stsError);

      await expect(assumeRole('123456789012')).rejects.toThrow(
        'arn:aws:iam::123456789012:role/InnovationSandbox-ndx-DeployerRole'
      );
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
      const mockCredentials = {
        AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
        // No Expiration field
      };

      mockSend.mockResolvedValue({
        Credentials: mockCredentials,
      });

      const result = await assumeRole('123456789012');

      expect(result.accessKeyId).toBe(mockCredentials.AccessKeyId);
      expect(result.secretAccessKey).toBe(mockCredentials.SecretAccessKey);
      expect(result.sessionToken).toBe(mockCredentials.SessionToken);
      expect(result.expiration).toBeUndefined();
    });
  });

  describe('resetSTSClient', () => {
    it('should reset the STS client singleton', async () => {
      const mockCredentials = {
        AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SessionToken: 'FwoGZXIvYXdzEBYaDCvEXAMPLETOKEN',
      };

      mockSend.mockResolvedValue({
        Credentials: mockCredentials,
      });

      // First call
      await assumeRole('123456789012');
      expect(STSClient).toHaveBeenCalledTimes(1);

      // Reset
      resetSTSClient();

      // Second call should create a new client
      await assumeRole('123456789012');
      expect(STSClient).toHaveBeenCalledTimes(2);
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
