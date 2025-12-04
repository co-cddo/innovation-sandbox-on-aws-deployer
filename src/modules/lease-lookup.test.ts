import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { lookupLease, resetDynamoDBClient, LeaseLookupError } from './lease-lookup.js';
import { resetConfig } from './config.js';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-dynamodb', () => {
  const actualCommand = vi.fn();
  return {
    DynamoDBClient: vi.fn(() => ({
      send: vi.fn(),
    })),
    GetItemCommand: actualCommand,
  };
});

// Mock the config module
vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js');
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      targetRoleName: 'InnovationSandbox-ndx-DeployerRole',
      awsRegion: 'eu-west-2',
      githubRepo: 'co-cddo/ndx_try_aws_scenarios',
      githubBranch: 'main',
      githubPath: 'cloudformation/scenarios',
      leaseTableName: 'isb-leases-test',
      eventSource: 'isb-deployer',
      logLevel: 'INFO' as const,
    })),
  };
});

describe('lease-lookup', () => {
  let mockDynamoDBClient: any;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    resetDynamoDBClient();
    resetConfig();

    // Setup mock DynamoDB client
    mockSend = vi.fn();
    mockDynamoDBClient = {
      send: mockSend,
    };
    vi.mocked(DynamoDBClient).mockImplementation(() => mockDynamoDBClient);
  });

  afterEach(() => {
    resetDynamoDBClient();
    resetConfig();
  });

  describe('lookupLease', () => {
    it('should successfully lookup a lease and return details', async () => {
      const mockItem = {
        leaseId: { S: 'lease-12345' },
        accountId: { S: '123456789012' },
        templateName: { S: 'basic-vpc' },
        budgetAmount: { N: '500' },
        status: { S: 'active' },
        expirationDate: { S: '2025-12-31T23:59:59Z' },
        requesterEmail: { S: 'user@example.com' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('lease-12345');

      expect(result).toEqual({
        leaseId: 'lease-12345',
        accountId: '123456789012',
        templateName: 'basic-vpc',
        budgetAmount: 500,
        status: 'active',
        expirationDate: '2025-12-31T23:59:59Z',
        requesterEmail: 'user@example.com',
      });
    });

    it('should query DynamoDB with correct parameters', async () => {
      const mockItem = {
        leaseId: { S: 'lease-67890' },
        accountId: { S: '987654321098' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      await lookupLease('lease-67890');

      expect(GetItemCommand).toHaveBeenCalledWith({
        TableName: 'isb-leases-test',
        Key: {
          leaseId: { S: 'lease-67890' },
        },
      });
    });

    it('should use the configured table name from environment', async () => {
      const mockItem = {
        leaseId: { S: 'lease-12345' },
        accountId: { S: '123456789012' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      await lookupLease('lease-12345');

      expect(GetItemCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'isb-leases-test',
        })
      );
    });

    it('should handle lease with minimal required fields', async () => {
      const mockItem = {
        leaseId: { S: 'lease-minimal' },
        accountId: { S: '111111111111' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('lease-minimal');

      expect(result.leaseId).toBe('lease-minimal');
      expect(result.accountId).toBe('111111111111');
      expect(result.templateName).toBeUndefined();
      expect(result.budgetAmount).toBeUndefined();
    });

    it('should handle lease with optional fields missing', async () => {
      const mockItem = {
        leaseId: { S: 'lease-partial' },
        accountId: { S: '222222222222' },
        templateName: { S: 'ec2-instance' },
        // budgetAmount, status, expirationDate, requesterEmail missing
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('lease-partial');

      expect(result.leaseId).toBe('lease-partial');
      expect(result.accountId).toBe('222222222222');
      expect(result.templateName).toBe('ec2-instance');
      expect(result.budgetAmount).toBeUndefined();
      expect(result.status).toBeUndefined();
      expect(result.expirationDate).toBeUndefined();
      expect(result.requesterEmail).toBeUndefined();
    });

    it('should handle lease with additional custom attributes', async () => {
      const mockItem = {
        leaseId: { S: 'lease-custom' },
        accountId: { S: '333333333333' },
        templateName: { S: 's3-bucket' },
        customField1: { S: 'custom-value-1' },
        customField2: { N: '42' },
        customField3: { BOOL: true },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('lease-custom');

      expect(result.leaseId).toBe('lease-custom');
      expect(result.accountId).toBe('333333333333');
      expect(result.customField1).toBe('custom-value-1');
      expect(result.customField2).toBe(42);
      expect(result.customField3).toBe(true);
    });

    it('should handle different lease IDs', async () => {
      const mockItem1 = {
        leaseId: { S: 'lease-aaa' },
        accountId: { S: '111111111111' },
      };

      const mockItem2 = {
        leaseId: { S: 'lease-bbb' },
        accountId: { S: '222222222222' },
      };

      mockSend
        .mockResolvedValueOnce({ Item: mockItem1 })
        .mockResolvedValueOnce({ Item: mockItem2 });

      const result1 = await lookupLease('lease-aaa');
      expect(result1.leaseId).toBe('lease-aaa');

      const result2 = await lookupLease('lease-bbb');
      expect(result2.leaseId).toBe('lease-bbb');
    });

    it('should reuse DynamoDB client (singleton pattern)', async () => {
      const mockItem = {
        leaseId: { S: 'lease-12345' },
        accountId: { S: '123456789012' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      // Call twice
      await lookupLease('lease-12345');
      await lookupLease('lease-67890');

      // DynamoDB client should only be created once
      expect(DynamoDBClient).toHaveBeenCalledTimes(1);
      // But send should be called twice
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw LeaseLookupError when lease is not found (no Item)', async () => {
      mockSend.mockResolvedValue({
        Item: undefined,
      });

      await expect(lookupLease('lease-notfound')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('lease-notfound')).rejects.toThrow(
        'Lease not found: lease-notfound'
      );
    });

    it('should throw LeaseLookupError when lease is not found (null Item)', async () => {
      mockSend.mockResolvedValue({
        Item: null,
      });

      await expect(lookupLease('lease-null')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('lease-null')).rejects.toThrow('Lease not found: lease-null');
    });

    it('should throw LeaseLookupError when leaseId is missing in response', async () => {
      const mockItem = {
        // leaseId missing
        accountId: { S: '123456789012' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      await expect(lookupLease('lease-bad')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('lease-bad')).rejects.toThrow(
        'missing required fields (leaseId or accountId)'
      );
    });

    it('should throw LeaseLookupError when accountId is missing in response', async () => {
      const mockItem = {
        leaseId: { S: 'lease-bad' },
        // accountId missing
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      await expect(lookupLease('lease-bad')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('lease-bad')).rejects.toThrow(
        'missing required fields (leaseId or accountId)'
      );
    });

    it('should handle ResourceNotFoundException from DynamoDB', async () => {
      const dynamoError = new Error('Requested resource not found');
      dynamoError.name = 'ResourceNotFoundException';

      mockSend.mockRejectedValue(dynamoError);

      await expect(lookupLease('lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('lease-12345')).rejects.toThrow('ResourceNotFoundException');
      await expect(lookupLease('lease-12345')).rejects.toThrow('Requested resource not found');
    });

    it('should handle ValidationException from DynamoDB', async () => {
      const dynamoError = new Error('Invalid key structure');
      dynamoError.name = 'ValidationException';

      mockSend.mockRejectedValue(dynamoError);

      await expect(lookupLease('lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('lease-12345')).rejects.toThrow('ValidationException');
    });

    it('should handle ProvisionedThroughputExceededException', async () => {
      const dynamoError = new Error('Rate limit exceeded');
      dynamoError.name = 'ProvisionedThroughputExceededException';

      mockSend.mockRejectedValue(dynamoError);

      await expect(lookupLease('lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('lease-12345')).rejects.toThrow(
        'ProvisionedThroughputExceededException'
      );
    });

    it('should handle InternalServerError from DynamoDB', async () => {
      const dynamoError = new Error('Internal server error');
      dynamoError.name = 'InternalServerError';

      mockSend.mockRejectedValue(dynamoError);

      await expect(lookupLease('lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('lease-12345')).rejects.toThrow('InternalServerError');
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      networkError.name = 'NetworkingError';

      mockSend.mockRejectedValue(networkError);

      await expect(lookupLease('lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('lease-12345')).rejects.toThrow('NetworkingError');
    });

    it('should handle unknown errors gracefully', async () => {
      mockSend.mockRejectedValue('unknown error string');

      await expect(lookupLease('lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('lease-12345')).rejects.toThrow('Unknown error looking up lease');
    });

    it('should include lease ID and table name in error messages', async () => {
      const dynamoError = new Error('Table access denied');
      dynamoError.name = 'AccessDeniedException';

      mockSend.mockRejectedValue(dynamoError);

      await expect(lookupLease('lease-12345')).rejects.toThrow('lease-12345');
      await expect(lookupLease('lease-12345')).rejects.toThrow('isb-leases-test');
    });

    it('should preserve original error in LeaseLookupError', async () => {
      const originalError = new Error('Original DynamoDB error');
      originalError.name = 'DynamoDBError';

      mockSend.mockRejectedValue(originalError);

      try {
        await lookupLease('lease-12345');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LeaseLookupError);
        expect((error as LeaseLookupError).originalError).toBe(originalError);
      }
    });

    it('should handle lease with budget as number zero', async () => {
      const mockItem = {
        leaseId: { S: 'lease-zero-budget' },
        accountId: { S: '444444444444' },
        budgetAmount: { N: '0' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('lease-zero-budget');

      expect(result.budgetAmount).toBe(0);
    });

    it('should handle lease with large budget amount', async () => {
      const mockItem = {
        leaseId: { S: 'lease-large-budget' },
        accountId: { S: '555555555555' },
        budgetAmount: { N: '1000000' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('lease-large-budget');

      expect(result.budgetAmount).toBe(1000000);
    });

    it('should handle lease with various status values', async () => {
      const statuses = ['active', 'pending', 'expired', 'terminated'];

      for (const status of statuses) {
        const mockItem = {
          leaseId: { S: `lease-${status}` },
          accountId: { S: '666666666666' },
          status: { S: status },
        };

        mockSend.mockResolvedValue({
          Item: mockItem,
        });

        const result = await lookupLease(`lease-${status}`);
        expect(result.status).toBe(status);
      }
    });

    it('should handle empty string values in optional fields', async () => {
      const mockItem = {
        leaseId: { S: 'lease-empty-strings' },
        accountId: { S: '777777777777' },
        templateName: { S: '' },
        status: { S: '' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('lease-empty-strings');

      expect(result.templateName).toBe('');
      expect(result.status).toBe('');
    });
  });

  describe('resetDynamoDBClient', () => {
    it('should reset the DynamoDB client singleton', async () => {
      const mockItem = {
        leaseId: { S: 'lease-12345' },
        accountId: { S: '123456789012' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      // First call
      await lookupLease('lease-12345');
      expect(DynamoDBClient).toHaveBeenCalledTimes(1);

      // Reset
      resetDynamoDBClient();

      // Second call should create a new client
      await lookupLease('lease-12345');
      expect(DynamoDBClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('LeaseLookupError', () => {
    it('should be an instance of Error', () => {
      const error = new LeaseLookupError('Test error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct name property', () => {
      const error = new LeaseLookupError('Test error');
      expect(error.name).toBe('LeaseLookupError');
    });

    it('should preserve error message', () => {
      const message = 'Failed to lookup lease';
      const error = new LeaseLookupError(message);
      expect(error.message).toBe(message);
    });

    it('should store original error if provided', () => {
      const originalError = new Error('Original');
      const error = new LeaseLookupError('Wrapped error', originalError);
      expect(error.originalError).toBe(originalError);
    });
  });
});
