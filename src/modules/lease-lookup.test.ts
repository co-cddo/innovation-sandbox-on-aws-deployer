import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lookupLease, resetISBClient, LeaseLookupError } from './lease-lookup.js';

// Mock the ISB client
vi.mock('@co-cddo/isb-client', () => {
  const mockFetchLeaseByKey = vi.fn();
  return {
    createISBClient: vi.fn(() => ({
      fetchLeaseByKey: mockFetchLeaseByKey,
      resetTokenCache: vi.fn(),
    })),
    __mockFetchLeaseByKey: mockFetchLeaseByKey,
  };
});

// Get reference to the mock function
import { createISBClient } from '@co-cddo/isb-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockModule = (await import('@co-cddo/isb-client')) as any;
const mockFetchLeaseByKey: ReturnType<typeof vi.fn> = mockModule.__mockFetchLeaseByKey;

describe('lease-lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetISBClient();
  });

  afterEach(() => {
    resetISBClient();
  });

  describe('lookupLease', () => {
    it('should successfully lookup a lease and return details', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: 'f2d3eb78-907a-4c20-8127-7ce45758836d',
        awsAccountId: '123456789012',
        originalLeaseTemplateName: 'basic-vpc',
        maxSpend: 500,
        status: 'Active',
        expirationDate: '2025-12-31T23:59:59Z',
      });

      const result = await lookupLease(
        'user@example.gov.uk',
        'f2d3eb78-907a-4c20-8127-7ce45758836d'
      );

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

    it('should call ISB API with correct parameters', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'test@example.gov.uk',
        uuid: 'lease-67890',
        awsAccountId: '987654321098',
      });

      await lookupLease('test@example.gov.uk', 'lease-67890');

      expect(mockFetchLeaseByKey).toHaveBeenCalledWith(
        'test@example.gov.uk',
        'lease-67890',
        'lease-67890' // correlationId = leaseId
      );
    });

    it('should handle lease with minimal required fields', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: 'lease-minimal',
        awsAccountId: '111111111111',
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-minimal');

      expect(result.leaseId).toBe('lease-minimal');
      expect(result.accountId).toBe('111111111111');
      expect(result.templateName).toBeUndefined();
      expect(result.budgetAmount).toBeUndefined();
    });

    it('should handle lease with optional fields missing', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: 'lease-partial',
        awsAccountId: '222222222222',
        originalLeaseTemplateName: 'ec2-instance',
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
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: 'lease-custom',
        awsAccountId: '333333333333',
        originalLeaseTemplateName: 's3-bucket',
        customField1: 'custom-value-1',
        customField2: 42,
        customField3: true,
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-custom');

      expect(result.leaseId).toBe('lease-custom');
      expect(result.accountId).toBe('333333333333');
      expect(result.customField1).toBe('custom-value-1');
      expect(result.customField2).toBe(42);
      expect(result.customField3).toBe(true);
    });

    it('should handle different lease IDs for same user', async () => {
      mockFetchLeaseByKey
        .mockResolvedValueOnce({
          userEmail: 'user@example.gov.uk',
          uuid: 'lease-aaa',
          awsAccountId: '111111111111',
        })
        .mockResolvedValueOnce({
          userEmail: 'user@example.gov.uk',
          uuid: 'lease-bbb',
          awsAccountId: '222222222222',
        });

      const result1 = await lookupLease('user@example.gov.uk', 'lease-aaa');
      expect(result1.leaseId).toBe('lease-aaa');

      const result2 = await lookupLease('user@example.gov.uk', 'lease-bbb');
      expect(result2.leaseId).toBe('lease-bbb');
    });

    it('should reuse ISB client (singleton pattern)', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: 'lease-12345',
        awsAccountId: '123456789012',
      });

      // Call twice
      await lookupLease('user@example.gov.uk', 'lease-12345');
      await lookupLease('user@example.gov.uk', 'lease-67890');

      // ISB client should only be created once
      expect(createISBClient).toHaveBeenCalledTimes(1);
      // But fetchLeaseByKey should be called twice
      expect(mockFetchLeaseByKey).toHaveBeenCalledTimes(2);
    });

    it('should throw LeaseLookupError when lease is not found (null result)', async () => {
      mockFetchLeaseByKey.mockResolvedValue(null);

      await expect(lookupLease('user@example.gov.uk', 'lease-notfound')).rejects.toThrow(
        LeaseLookupError
      );
      await expect(lookupLease('user@example.gov.uk', 'lease-notfound')).rejects.toThrow(
        'Lease not found: lease-notfound for user user@example.gov.uk'
      );
    });

    it('should throw LeaseLookupError when uuid is missing in response', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        awsAccountId: '123456789012',
      });

      await expect(lookupLease('user@example.gov.uk', 'lease-bad')).rejects.toThrow(
        LeaseLookupError
      );
      await expect(lookupLease('user@example.gov.uk', 'lease-bad')).rejects.toThrow(
        'missing required fields (uuid or awsAccountId)'
      );
    });

    it('should throw LeaseLookupError when awsAccountId is missing in response', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: 'lease-bad',
      });

      await expect(lookupLease('user@example.gov.uk', 'lease-bad')).rejects.toThrow(
        LeaseLookupError
      );
      await expect(lookupLease('user@example.gov.uk', 'lease-bad')).rejects.toThrow(
        'missing required fields (uuid or awsAccountId)'
      );
    });

    it('should handle API errors', async () => {
      const apiError = new Error('API Gateway timeout');
      apiError.name = 'TimeoutError';

      mockFetchLeaseByKey.mockRejectedValue(apiError);

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(
        LeaseLookupError
      );
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(
        'TimeoutError'
      );
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(
        'API Gateway timeout'
      );
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      networkError.name = 'NetworkingError';

      mockFetchLeaseByKey.mockRejectedValue(networkError);

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(
        LeaseLookupError
      );
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(
        'NetworkingError'
      );
    });

    it('should handle unknown errors gracefully', async () => {
      mockFetchLeaseByKey.mockRejectedValue('unknown error string');

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(
        LeaseLookupError
      );
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(
        'Unknown error looking up lease'
      );
    });

    it('should include lease ID and user email in error messages', async () => {
      const apiError = new Error('Access denied');
      apiError.name = 'AccessDeniedException';

      mockFetchLeaseByKey.mockRejectedValue(apiError);

      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(
        'lease-12345'
      );
      await expect(lookupLease('user@example.gov.uk', 'lease-12345')).rejects.toThrow(
        'user@example.gov.uk'
      );
    });

    it('should preserve original error in LeaseLookupError', async () => {
      const originalError = new Error('Original API error');
      originalError.name = 'APIError';

      mockFetchLeaseByKey.mockRejectedValue(originalError);

      try {
        await lookupLease('user@example.gov.uk', 'lease-12345');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LeaseLookupError);
        expect((error as LeaseLookupError).originalError).toBe(originalError);
      }
    });

    it('should handle lease with budget as number zero', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: 'lease-zero-budget',
        awsAccountId: '444444444444',
        maxSpend: 0,
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-zero-budget');

      expect(result.budgetAmount).toBe(0);
    });

    it('should handle lease with large budget amount', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: 'lease-large-budget',
        awsAccountId: '555555555555',
        maxSpend: 1000000,
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-large-budget');

      expect(result.budgetAmount).toBe(1000000);
    });

    it('should handle lease with various status values', async () => {
      const statuses = ['Active', 'Pending', 'Expired', 'Frozen'];

      for (const status of statuses) {
        mockFetchLeaseByKey.mockResolvedValue({
          userEmail: 'user@example.gov.uk',
          uuid: `lease-${status.toLowerCase()}`,
          awsAccountId: '666666666666',
          status,
        });

        const result = await lookupLease('user@example.gov.uk', `lease-${status.toLowerCase()}`);
        expect(result.status).toBe(status);
      }
    });

    it('should handle empty string values in optional fields', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: 'lease-empty-strings',
        awsAccountId: '777777777777',
        originalLeaseTemplateName: '',
        status: '',
      });

      const result = await lookupLease('user@example.gov.uk', 'lease-empty-strings');

      expect(result.templateName).toBe('');
      expect(result.status).toBe('');
    });
  });

  describe('resetISBClient', () => {
    it('should reset the ISB client singleton', async () => {
      mockFetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: 'lease-12345',
        awsAccountId: '123456789012',
      });

      // First call
      await lookupLease('user@example.gov.uk', 'lease-12345');
      expect(createISBClient).toHaveBeenCalledTimes(1);

      // Reset
      resetISBClient();

      // Second call should create a new client
      await lookupLease('user@example.gov.uk', 'lease-12345');
      expect(createISBClient).toHaveBeenCalledTimes(2);
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
