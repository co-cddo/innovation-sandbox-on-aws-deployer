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
      awsRegion: 'us-west-2',
      githubRepo: 'co-cddo/ndx_try_aws_scenarios',
      githubBranch: 'main',
      githubPath: 'cloudformation/scenarios',
      leaseTableName: 'isb-leases-test',
      eventSource: 'innovation-sandbox',
      logLevel: 'INFO' as const,
    })),
  };
});

describe('lease-lookup', () => {
  let mockDynamoDBClient: { send: ReturnType<typeof vi.fn> };
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
    vi.mocked(DynamoDBClient).mockImplementation(() => mockDynamoDBClient as unknown as DynamoDBClient);
  });

  afterEach(() => {
    resetDynamoDBClient();
    resetConfig();
  });

  describe('lookupLease', () => {
    // ISB DynamoDB schema uses:
    // - userEmail as HASH key
    // - uuid as RANGE key
    // - awsAccountId for target account
    // - originalLeaseTemplateName for template
    // - maxSpend for budget

    it('should successfully lookup a lease and return details', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'f2d3eb78-907a-4c20-8127-7ce45758836d' },
        awsAccountId: { S: '123456789012' },
        originalLeaseTemplateName: { S: 'basic-vpc' },
        maxSpend: { N: '500' },
        status: { S: 'Active' },
        expirationDate: { S: '2025-12-31T23:59:59Z' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('user@example.gov.uk', 'f2d3eb78-907a-4c20-8127-7ce45758836d');

      expect(result).toMatchObject({
        leaseId: 'f2d3eb78-907a-4c20-8127-7ce45758836d',
        accountId: '123456789012',
        templateName: 'basic-vpc',
        budgetAmount: 500,
        status: 'Active',
        expirationDate: '2025-12-31T23:59:59Z',
        userEmail: 'user@example.gov.uk',
      });
    });

    it('should query DynamoDB with correct composite key parameters', async () => {
      const mockItem = {
        userEmail: { S: 'test@example.gov.uk' },
        uuid: { S: 'lease-67890' },
        awsAccountId: { S: '987654321098' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      await lookupLease('test@example.gov.uk', 'lease-67890');

      expect(GetItemCommand).toHaveBeenCalledWith({
        TableName: 'isb-leases-test',
        Key: {
          userEmail: { S: 'test@example.gov.uk' },
          uuid: { S: 'lease-67890' },
        },
      });
    });

    it('should use the configured table name from environment', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-12345' },
        awsAccountId: { S: '123456789012' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      await lookupLease('user@example.gov.uk', 'lease-12345');

      expect(GetItemCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'isb-leases-test',
        })
      );
    });

    it('should handle lease with minimal required fields', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-minimal' },
        awsAccountId: { S: '111111111111' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-minimal');

      expect(result.leaseId).toBe('lease-minimal');
      expect(result.accountId).toBe('111111111111');
      expect(result.templateName).toBeUndefined();
      expect(result.budgetAmount).toBeUndefined();
    });

    it('should handle lease with optional fields missing', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-partial' },
        awsAccountId: { S: '222222222222' },
        originalLeaseTemplateName: { S: 'ec2-instance' },
        // maxSpend, status, expirationDate missing
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-partial');

      expect(result.leaseId).toBe('lease-partial');
      expect(result.accountId).toBe('222222222222');
      expect(result.templateName).toBe('ec2-instance');
      expect(result.budgetAmount).toBeUndefined();
      expect(result.status).toBeUndefined();
      expect(result.expirationDate).toBeUndefined();
    });

    it('should handle lease with additional custom attributes', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-custom' },
        awsAccountId: { S: '333333333333' },
        originalLeaseTemplateName: { S: 's3-bucket' },
        customField1: { S: 'custom-value-1' },
        customField2: { N: '42' },
        customField3: { BOOL: true },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-custom');

      expect(result.leaseId).toBe('lease-custom');
      expect(result.accountId).toBe('333333333333');
      expect(result.customField1).toBe('custom-value-1');
      expect(result.customField2).toBe(42);
      expect(result.customField3).toBe(true);
    });

    it('should handle different lease IDs for same user', async () => {
      const mockItem1 = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-aaa' },
        awsAccountId: { S: '111111111111' },
      };

      const mockItem2 = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-bbb' },
        awsAccountId: { S: '222222222222' },
      };

      mockSend
        .mockResolvedValueOnce({ Item: mockItem1 })
        .mockResolvedValueOnce({ Item: mockItem2 });

      const result1 = await lookupLease('user@example.gov.uk', 'lease-aaa');
      expect(result1.leaseId).toBe('lease-aaa');

      const result2 = await lookupLease('user@example.gov.uk', 'lease-bbb');
      expect(result2.leaseId).toBe('lease-bbb');
    });

    it('should reuse DynamoDB client (singleton pattern)', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-12345' },
        awsAccountId: { S: '123456789012' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      // Call twice
      await lookupLease('user@example.gov.uk', 'lease-12345');
      await lookupLease('user@example.gov.uk', 'lease-67890');

      // DynamoDB client should only be created once
      expect(DynamoDBClient).toHaveBeenCalledTimes(1);
      // But send should be called twice
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw LeaseLookupError when lease is not found (no Item)', async () => {
      mockSend.mockResolvedValue({
        Item: undefined,
      });

      await expect(lookupLease('user@example.gov.uk', 'lease-notfound')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('user@example.gov.uk', 'lease-notfound')).rejects.toThrow(
        'Lease not found: lease-notfound for user user@example.gov.uk'
      );
    });

    it('should throw LeaseLookupError when lease is not found (null Item)', async () => {
      mockSend.mockResolvedValue({
        Item: null,
      });

      await expect(lookupLease('user@example.gov.uk', 'lease-null')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('user@example.gov.uk', 'lease-null')).rejects.toThrow(
        'Lease not found: lease-null for user user@example.gov.uk'
      );
    });

    it('should throw LeaseLookupError when uuid is missing in response', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        // uuid missing
        awsAccountId: { S: '123456789012' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      await expect(lookupLease('user@example.gov.uk', 'lease-bad')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('user@example.gov.uk', 'lease-bad')).rejects.toThrow(
        'missing required fields (uuid or awsAccountId)'
      );
    });

    it('should throw LeaseLookupError when awsAccountId is missing in response', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-bad' },
        // awsAccountId missing
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      await expect(lookupLease('user@example.gov.uk', 'lease-bad')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('user@example.gov.uk', 'lease-bad')).rejects.toThrow(
        'missing required fields (uuid or awsAccountId)'
      );
    });

    it('should handle ResourceNotFoundException from DynamoDB', async () => {
      const dynamoError = new Error('Requested resource not found');
      dynamoError.name = 'ResourceNotFoundException';

      mockSend.mockRejectedValue(dynamoError);

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow('ResourceNotFoundException');
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow('Requested resource not found');
    });

    it('should handle ValidationException from DynamoDB', async () => {
      const dynamoError = new Error('Invalid key structure');
      dynamoError.name = 'ValidationException';

      mockSend.mockRejectedValue(dynamoError);

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow('ValidationException');
    });

    it('should handle ProvisionedThroughputExceededException', async () => {
      const dynamoError = new Error('Rate limit exceeded');
      dynamoError.name = 'ProvisionedThroughputExceededException';

      mockSend.mockRejectedValue(dynamoError);

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(
        'ProvisionedThroughputExceededException'
      );
    });

    it('should handle InternalServerError from DynamoDB', async () => {
      const dynamoError = new Error('Internal server error');
      dynamoError.name = 'InternalServerError';

      mockSend.mockRejectedValue(dynamoError);

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow('InternalServerError');
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      networkError.name = 'NetworkingError';

      mockSend.mockRejectedValue(networkError);

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow('NetworkingError');
    });

    it('should handle unknown errors gracefully', async () => {
      mockSend.mockRejectedValue('unknown error string');

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(LeaseLookupError);
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow('Unknown error looking up lease');
    });

    it('should include lease ID, user email and table name in error messages', async () => {
      const dynamoError = new Error('Table access denied');
      dynamoError.name = 'AccessDeniedException';

      mockSend.mockRejectedValue(dynamoError);

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow('lease-12345');
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow('user@example.gov.uk');
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow('isb-leases-test');
    });

    it('should preserve original error in LeaseLookupError', async () => {
      const originalError = new Error('Original DynamoDB error');
      originalError.name = 'DynamoDBError';

      mockSend.mockRejectedValue(originalError);

      try {
        await lookupLease('user@example.gov.uk', 'lease-12345');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LeaseLookupError);
        expect((error as LeaseLookupError).originalError).toBe(originalError);
      }
    });

    it('should handle lease with budget as number zero', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-zero-budget' },
        awsAccountId: { S: '444444444444' },
        maxSpend: { N: '0' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-zero-budget');

      expect(result.budgetAmount).toBe(0);
    });

    it('should handle lease with large budget amount', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-large-budget' },
        awsAccountId: { S: '555555555555' },
        maxSpend: { N: '1000000' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-large-budget');

      expect(result.budgetAmount).toBe(1000000);
    });

    it('should handle lease with various status values', async () => {
      const statuses = ['Active', 'Pending', 'Expired', 'Frozen'];

      for (const status of statuses) {
        const mockItem = {
          userEmail: { S: 'user@example.gov.uk' },
          uuid: { S: `lease-${status.toLowerCase()}` },
          awsAccountId: { S: '666666666666' },
          status: { S: status },
        };

        mockSend.mockResolvedValue({
          Item: mockItem,
        });

        const result = await lookupLease('user@example.gov.uk', `lease-${status.toLowerCase()}`);
        expect(result.status).toBe(status);
      }
    });

    it('should handle empty string values in optional fields', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-empty-strings' },
        awsAccountId: { S: '777777777777' },
        originalLeaseTemplateName: { S: '' },
        status: { S: '' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-empty-strings');

      expect(result.templateName).toBe('');
      expect(result.status).toBe('');
    });
  });

  describe('resetDynamoDBClient', () => {
    it('should reset the DynamoDB client singleton', async () => {
      const mockItem = {
        userEmail: { S: 'user@example.gov.uk' },
        uuid: { S: 'lease-12345' },
        awsAccountId: { S: '123456789012' },
      };

      mockSend.mockResolvedValue({
        Item: mockItem,
      });

      // First call
      await lookupLease('user@example.gov.uk', 'lease-12345');
      expect(DynamoDBClient).toHaveBeenCalledTimes(1);

      // Reset
      resetDynamoDBClient();

      // Second call should create a new client
      await lookupLease('user@example.gov.uk', 'lease-12345');
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
