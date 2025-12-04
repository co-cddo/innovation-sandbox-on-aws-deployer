import { describe, it, expect } from 'vitest';
import { mapParameters } from './parameter-mapper.js';
import type { LeaseDetails } from './lease-lookup.js';

describe('parameter-mapper', () => {
  describe('mapParameters', () => {
    it('should map all common parameters when all lease attributes are present', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        templateName: 'basic-vpc',
        budgetAmount: 1000,
        status: 'active',
        expirationDate: '2025-12-31T23:59:59Z',
        requesterEmail: 'user@example.com',
      };

      const templateParameters = [
        'LeaseId',
        'AccountId',
        'Budget',
        'RequesterEmail',
        'ExpirationDate',
        'TemplateName',
        'Status',
      ];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
        { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
        { ParameterKey: 'Budget', ParameterValue: '1000' },
        { ParameterKey: 'RequesterEmail', ParameterValue: 'user@example.com' },
        { ParameterKey: 'ExpirationDate', ParameterValue: '2025-12-31T23:59:59Z' },
        { ParameterKey: 'TemplateName', ParameterValue: 'basic-vpc' },
        { ParameterKey: 'Status', ParameterValue: 'active' },
      ]);
    });

    it('should map required fields only when minimal lease details provided', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-minimal',
        accountId: '999888777666',
      };

      const templateParameters = ['LeaseId', 'AccountId'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-minimal' },
        { ParameterKey: 'AccountId', ParameterValue: '999888777666' },
      ]);
    });

    it('should skip unmapped parameters gracefully', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
      };

      const templateParameters = [
        'LeaseId',
        'AccountId',
        'UnknownParameter',
        'AnotherUnmappedParam',
      ];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
        { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
      ]);
    });

    it('should skip parameters when lease attribute is undefined', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        budgetAmount: undefined,
        requesterEmail: undefined,
      };

      const templateParameters = ['LeaseId', 'AccountId', 'Budget', 'RequesterEmail'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
        { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
      ]);
    });

    it('should handle numeric budget values by converting to string', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        budgetAmount: 5000.50,
      };

      const templateParameters = ['Budget', 'BudgetAmount'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Budget', ParameterValue: '5000.5' },
        { ParameterKey: 'BudgetAmount', ParameterValue: '5000.5' },
      ]);
    });

    it('should handle zero as a valid budget value', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        budgetAmount: 0,
      };

      const templateParameters = ['Budget'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Budget', ParameterValue: '0' },
      ]);
    });

    it('should return empty array when no parameters are in template', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        budgetAmount: 1000,
      };

      const templateParameters: string[] = [];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([]);
    });

    it('should handle alternative parameter name mappings for AccountId', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
      };

      const templateParameters = ['Account', 'AWSAccountId', 'AwsAccountId'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Account', ParameterValue: '123456789012' },
        { ParameterKey: 'AWSAccountId', ParameterValue: '123456789012' },
        { ParameterKey: 'AwsAccountId', ParameterValue: '123456789012' },
      ]);
    });

    it('should handle alternative parameter name mappings for Email', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        requesterEmail: 'test@example.com',
      };

      const templateParameters = ['Email', 'UserEmail', 'RequesterEmail'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Email', ParameterValue: 'test@example.com' },
        { ParameterKey: 'UserEmail', ParameterValue: 'test@example.com' },
        { ParameterKey: 'RequesterEmail', ParameterValue: 'test@example.com' },
      ]);
    });

    it('should handle alternative parameter name mappings for Expiration', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        expirationDate: '2025-12-31T23:59:59Z',
      };

      const templateParameters = ['Expiration', 'LeaseExpiration', 'ExpirationDate'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Expiration', ParameterValue: '2025-12-31T23:59:59Z' },
        { ParameterKey: 'LeaseExpiration', ParameterValue: '2025-12-31T23:59:59Z' },
        { ParameterKey: 'ExpirationDate', ParameterValue: '2025-12-31T23:59:59Z' },
      ]);
    });

    it('should handle alternative parameter name mappings for LeaseId', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-67890',
        accountId: '123456789012',
      };

      const templateParameters = ['Lease', 'LeaseId'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Lease', ParameterValue: 'lease-67890' },
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-67890' },
      ]);
    });

    it('should handle alternative parameter name mappings for Template', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        templateName: 'advanced-networking',
      };

      const templateParameters = ['Template', 'TemplateName'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Template', ParameterValue: 'advanced-networking' },
        { ParameterKey: 'TemplateName', ParameterValue: 'advanced-networking' },
      ]);
    });

    it('should handle alternative parameter name mappings for Status', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        status: 'pending',
      };

      const templateParameters = ['Status', 'LeaseStatus'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Status', ParameterValue: 'pending' },
        { ParameterKey: 'LeaseStatus', ParameterValue: 'pending' },
      ]);
    });

    it('should skip empty string values', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        templateName: '',
        requesterEmail: '',
      };

      const templateParameters = [
        'LeaseId',
        'AccountId',
        'TemplateName',
        'RequesterEmail',
      ];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
        { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
      ]);
    });

    it('should handle mixed scenario with some mapped, some unmapped, some missing values', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-complex',
        accountId: '555444333222',
        budgetAmount: 750,
        // status is undefined
        // requesterEmail is undefined
      };

      const templateParameters = [
        'LeaseId',        // mapped, has value
        'AccountId',      // mapped, has value
        'Budget',         // mapped, has value
        'Status',         // mapped, no value (should skip)
        'RequesterEmail', // mapped, no value (should skip)
        'UnknownParam',   // not mapped (should skip)
      ];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-complex' },
        { ParameterKey: 'AccountId', ParameterValue: '555444333222' },
        { ParameterKey: 'Budget', ParameterValue: '750' },
      ]);
    });

    it('should handle case where all parameters are unmapped or missing values', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
      };

      const templateParameters = [
        'Budget',          // mapped but no value
        'Status',          // mapped but no value
        'UnknownParam1',   // not mapped
        'UnknownParam2',   // not mapped
      ];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([]);
    });

    it('should handle boolean-like values in additional attributes', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        status: 'active',
      };

      const templateParameters = ['Status'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Status', ParameterValue: 'active' },
      ]);
    });

    it('should preserve parameter order from template', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        budgetAmount: 100,
        status: 'active',
      };

      const templateParameters = ['Status', 'Budget', 'AccountId', 'LeaseId'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Status', ParameterValue: 'active' },
        { ParameterKey: 'Budget', ParameterValue: '100' },
        { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
      ]);
    });

    it('should handle large budget numbers correctly', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        budgetAmount: 999999.99,
      };

      const templateParameters = ['Budget'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Budget', ParameterValue: '999999.99' },
      ]);
    });

    it('should handle negative budget numbers (edge case)', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        budgetAmount: -100,
      };

      const templateParameters = ['Budget'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'Budget', ParameterValue: '-100' },
      ]);
    });

    it('should handle ISO date format in expirationDate', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        expirationDate: '2025-12-31T23:59:59.999Z',
      };

      const templateParameters = ['ExpirationDate'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'ExpirationDate', ParameterValue: '2025-12-31T23:59:59.999Z' },
      ]);
    });

    it('should handle special characters in email addresses', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        requesterEmail: 'user+tag@example.co.uk',
      };

      const templateParameters = ['RequesterEmail'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'RequesterEmail', ParameterValue: 'user+tag@example.co.uk' },
      ]);
    });

    it('should handle null values by skipping them', () => {
      const leaseDetails: LeaseDetails = {
        leaseId: 'lease-12345',
        accountId: '123456789012',
        budgetAmount: null as any, // Simulate null from DynamoDB
        requesterEmail: null as any,
      };

      const templateParameters = ['LeaseId', 'AccountId', 'Budget', 'RequesterEmail'];

      const result = mapParameters(leaseDetails, templateParameters);

      expect(result).toEqual([
        { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
        { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
      ]);
    });
  });
});
