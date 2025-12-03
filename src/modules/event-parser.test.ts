import { describe, it, expect } from 'vitest';
import { parseLeaseEvent } from './event-parser.js';
import type { LeaseEventDetail } from '../types/index.js';

describe('event-parser module', () => {
  describe('parseLeaseEvent', () => {
    describe('valid events', () => {
      it('should parse valid event with all required fields', () => {
        const event = {
          version: '0',
          id: 'event-123',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          account: '123456789012',
          time: '2024-01-01T00:00:00Z',
          region: 'eu-west-2',
          detail: {
            leaseId: 'lease-abc-123',
            accountId: '987654321098',
            status: 'Approved',
          },
        };

        const result: LeaseEventDetail = parseLeaseEvent(event);

        expect(result).toEqual({
          leaseId: 'lease-abc-123',
          accountId: '987654321098',
          status: 'Approved',
          templateName: undefined,
        });
      });

      it('should parse valid event with templateName present', () => {
        const event = {
          version: '0',
          id: 'event-456',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          account: '123456789012',
          time: '2024-01-01T00:00:00Z',
          region: 'eu-west-2',
          detail: {
            leaseId: 'lease-xyz-789',
            accountId: '111222333444',
            status: 'Approved',
            templateName: 'ec2-instance',
          },
        };

        const result: LeaseEventDetail = parseLeaseEvent(event);

        expect(result).toEqual({
          leaseId: 'lease-xyz-789',
          accountId: '111222333444',
          status: 'Approved',
          templateName: 'ec2-instance',
        });
      });

      it('should ignore extra properties in detail', () => {
        const event = {
          version: '0',
          id: 'event-789',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          account: '123456789012',
          time: '2024-01-01T00:00:00Z',
          region: 'eu-west-2',
          detail: {
            leaseId: 'lease-extra-001',
            accountId: '555666777888',
            status: 'Approved',
            templateName: 's3-bucket',
            extraField1: 'should be ignored',
            extraField2: 123,
            extraField3: { nested: 'object' },
          },
        };

        const result: LeaseEventDetail = parseLeaseEvent(event);

        expect(result).toEqual({
          leaseId: 'lease-extra-001',
          accountId: '555666777888',
          status: 'Approved',
          templateName: 's3-bucket',
        });
      });

      it('should treat empty string templateName as undefined', () => {
        const event = {
          version: '0',
          id: 'event-empty-template',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          account: '123456789012',
          time: '2024-01-01T00:00:00Z',
          region: 'eu-west-2',
          detail: {
            leaseId: 'lease-001',
            accountId: '999888777666',
            status: 'Approved',
            templateName: '',
          },
        };

        const result: LeaseEventDetail = parseLeaseEvent(event);

        expect(result.templateName).toBeUndefined();
      });

      it('should treat whitespace-only templateName as undefined', () => {
        const event = {
          version: '0',
          id: 'event-whitespace-template',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          account: '123456789012',
          time: '2024-01-01T00:00:00Z',
          region: 'eu-west-2',
          detail: {
            leaseId: 'lease-002',
            accountId: '888777666555',
            status: 'Approved',
            templateName: '   ',
          },
        };

        const result: LeaseEventDetail = parseLeaseEvent(event);

        expect(result.templateName).toBeUndefined();
      });

      it('should accept different status values', () => {
        const statuses = ['Approved', 'Pending', 'Active', 'Rejected'];

        for (const status of statuses) {
          const event = {
            version: '0',
            id: `event-${status}`,
            'detail-type': 'Lease Event',
            source: 'innovation-sandbox',
            account: '123456789012',
            time: '2024-01-01T00:00:00Z',
            region: 'eu-west-2',
            detail: {
              leaseId: 'lease-status-test',
              accountId: '123456789012',
              status: status,
            },
          };

          const result = parseLeaseEvent(event);
          expect(result.status).toBe(status);
        }
      });

      it('should trim whitespace from valid string fields', () => {
        const event = {
          version: '0',
          id: 'event-trim',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          account: '123456789012',
          time: '2024-01-01T00:00:00Z',
          region: 'eu-west-2',
          detail: {
            leaseId: '  lease-trim-001  ',
            accountId: '  999888777666  ',
            status: '  Approved  ',
            templateName: '  ec2-instance  ',
          },
        };

        const result: LeaseEventDetail = parseLeaseEvent(event);

        // The function validates using trim() but returns original values
        expect(result.leaseId).toBe('  lease-trim-001  ');
        expect(result.accountId).toBe('  999888777666  ');
        expect(result.status).toBe('  Approved  ');
        expect(result.templateName).toBe('  ec2-instance  ');
      });
    });

    describe('invalid event structure', () => {
      it('should throw error when event is null', () => {
        expect(() => parseLeaseEvent(null)).toThrow('Event must be an object');
      });

      it('should throw error when event is undefined', () => {
        expect(() => parseLeaseEvent(undefined)).toThrow('Event must be an object');
      });

      it('should throw error when event is a string', () => {
        expect(() => parseLeaseEvent('not an object')).toThrow('Event must be an object');
      });

      it('should throw error when event is a number', () => {
        expect(() => parseLeaseEvent(123)).toThrow('Event must be an object');
      });

      it('should throw error when event is a boolean', () => {
        expect(() => parseLeaseEvent(true)).toThrow('Event must be an object');
      });

      it('should throw error when event is an array', () => {
        expect(() => parseLeaseEvent([1, 2, 3])).toThrow('Event must be an object');
      });

      it('should throw error when event is an empty array', () => {
        expect(() => parseLeaseEvent([])).toThrow('Event must be an object');
      });
    });

    describe('missing or invalid detail property', () => {
      it('should throw error when detail property is missing', () => {
        const event = {
          version: '0',
          id: 'event-no-detail',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });

      it('should throw error when detail is null', () => {
        const event = {
          version: '0',
          id: 'event-null-detail',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: null,
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });

      it('should throw error when detail is not an object (string)', () => {
        const event = {
          version: '0',
          id: 'event-string-detail',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: 'not an object',
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });

      it('should throw error when detail is not an object (number)', () => {
        const event = {
          version: '0',
          id: 'event-number-detail',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: 123,
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });

      it('should throw error when detail is an array', () => {
        const event = {
          version: '0',
          id: 'event-array-detail',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: ['item1', 'item2'],
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });

      it('should throw error when detail is undefined', () => {
        const event = {
          version: '0',
          id: 'event-undefined-detail',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: undefined,
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });
    });

    describe('missing or invalid leaseId', () => {
      it('should throw error when leaseId is missing', () => {
        const event = {
          version: '0',
          id: 'event-no-lease-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            accountId: '123456789012',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty leaseId'
        );
      });

      it('should throw error when leaseId is empty string', () => {
        const event = {
          version: '0',
          id: 'event-empty-lease-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: '',
            accountId: '123456789012',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty leaseId'
        );
      });

      it('should throw error when leaseId is whitespace-only', () => {
        const event = {
          version: '0',
          id: 'event-whitespace-lease-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: '   ',
            accountId: '123456789012',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty leaseId'
        );
      });

      it('should throw error when leaseId is not a string (number)', () => {
        const event = {
          version: '0',
          id: 'event-number-lease-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 123,
            accountId: '123456789012',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty leaseId'
        );
      });

      it('should throw error when leaseId is not a string (null)', () => {
        const event = {
          version: '0',
          id: 'event-null-lease-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: null,
            accountId: '123456789012',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty leaseId'
        );
      });

      it('should throw error when leaseId is not a string (object)', () => {
        const event = {
          version: '0',
          id: 'event-object-lease-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: { id: 'lease-123' },
            accountId: '123456789012',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty leaseId'
        );
      });
    });

    describe('missing or invalid accountId', () => {
      it('should throw error when accountId is missing', () => {
        const event = {
          version: '0',
          id: 'event-no-account-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty accountId'
        );
      });

      it('should throw error when accountId is empty string', () => {
        const event = {
          version: '0',
          id: 'event-empty-account-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty accountId'
        );
      });

      it('should throw error when accountId is whitespace-only', () => {
        const event = {
          version: '0',
          id: 'event-whitespace-account-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '   ',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty accountId'
        );
      });

      it('should throw error when accountId is not a string (number)', () => {
        const event = {
          version: '0',
          id: 'event-number-account-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: 123456789012,
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty accountId'
        );
      });

      it('should throw error when accountId is not a string (null)', () => {
        const event = {
          version: '0',
          id: 'event-null-account-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: null,
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty accountId'
        );
      });

      it('should throw error when accountId is not a string (boolean)', () => {
        const event = {
          version: '0',
          id: 'event-boolean-account-id',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: true,
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty accountId'
        );
      });
    });

    describe('missing or invalid status', () => {
      it('should throw error when status is missing', () => {
        const event = {
          version: '0',
          id: 'event-no-status',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty status'
        );
      });

      it('should throw error when status is empty string', () => {
        const event = {
          version: '0',
          id: 'event-empty-status',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
            status: '',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty status'
        );
      });

      it('should throw error when status is whitespace-only', () => {
        const event = {
          version: '0',
          id: 'event-whitespace-status',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
            status: '   ',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty status'
        );
      });

      it('should throw error when status is not a string (number)', () => {
        const event = {
          version: '0',
          id: 'event-number-status',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
            status: 1,
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty status'
        );
      });

      it('should throw error when status is not a string (null)', () => {
        const event = {
          version: '0',
          id: 'event-null-status',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
            status: null,
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty status'
        );
      });

      it('should throw error when status is not a string (object)', () => {
        const event = {
          version: '0',
          id: 'event-object-status',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
            status: { value: 'Approved' },
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty status'
        );
      });
    });

    describe('optional templateName validation', () => {
      it('should accept undefined templateName', () => {
        const event = {
          version: '0',
          id: 'event-undefined-template',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
            status: 'Approved',
            templateName: undefined,
          },
        };

        const result = parseLeaseEvent(event);
        expect(result.templateName).toBeUndefined();
      });

      it('should treat null templateName as undefined', () => {
        const event = {
          version: '0',
          id: 'event-null-template',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
            status: 'Approved',
            templateName: null,
          },
        };

        const result = parseLeaseEvent(event);
        expect(result.templateName).toBeUndefined();
      });

      it('should treat number templateName as undefined', () => {
        const event = {
          version: '0',
          id: 'event-number-template',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
            status: 'Approved',
            templateName: 123,
          },
        };

        const result = parseLeaseEvent(event);
        expect(result.templateName).toBeUndefined();
      });

      it('should treat boolean templateName as undefined', () => {
        const event = {
          version: '0',
          id: 'event-boolean-template',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
            status: 'Approved',
            templateName: true,
          },
        };

        const result = parseLeaseEvent(event);
        expect(result.templateName).toBeUndefined();
      });

      it('should treat object templateName as undefined', () => {
        const event = {
          version: '0',
          id: 'event-object-template',
          'detail-type': 'Lease Approved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            accountId: '123456789012',
            status: 'Approved',
            templateName: { name: 'ec2-instance' },
          },
        };

        const result = parseLeaseEvent(event);
        expect(result.templateName).toBeUndefined();
      });
    });

    describe('edge cases', () => {
      it('should parse minimal valid event', () => {
        const event = {
          detail: {
            leaseId: 'lease-minimal',
            accountId: '000000000000',
            status: 'Active',
          },
        };

        const result = parseLeaseEvent(event);

        expect(result).toEqual({
          leaseId: 'lease-minimal',
          accountId: '000000000000',
          status: 'Active',
          templateName: undefined,
        });
      });

      it('should handle very long string values', () => {
        const longString = 'a'.repeat(10000);
        const event = {
          detail: {
            leaseId: longString,
            accountId: longString,
            status: longString,
            templateName: longString,
          },
        };

        const result = parseLeaseEvent(event);

        expect(result.leaseId).toBe(longString);
        expect(result.accountId).toBe(longString);
        expect(result.status).toBe(longString);
        expect(result.templateName).toBe(longString);
      });

      it('should handle special characters in string values', () => {
        const event = {
          detail: {
            leaseId: 'lease-!@#$%^&*()_+-=[]{}|;:,.<>?',
            accountId: '账户-123-αβγδ-🎉',
            status: 'Approved ✓',
            templateName: 'template/with/slashes',
          },
        };

        const result = parseLeaseEvent(event);

        expect(result.leaseId).toBe('lease-!@#$%^&*()_+-=[]{}|;:,.<>?');
        expect(result.accountId).toBe('账户-123-αβγδ-🎉');
        expect(result.status).toBe('Approved ✓');
        expect(result.templateName).toBe('template/with/slashes');
      });

      it('should handle newlines and tabs in string values', () => {
        const event = {
          detail: {
            leaseId: 'lease\nwith\nnewlines',
            accountId: 'account\twith\ttabs',
            status: 'Status\r\nwith\r\ncrlf',
            templateName: 'template\n\twith\n\tmixed',
          },
        };

        const result = parseLeaseEvent(event);

        // These should all pass validation since they have non-whitespace characters
        expect(result.leaseId).toBe('lease\nwith\nnewlines');
        expect(result.accountId).toBe('account\twith\ttabs');
        expect(result.status).toBe('Status\r\nwith\r\ncrlf');
        expect(result.templateName).toBe('template\n\twith\n\tmixed');
      });

      it('should parse event with only tabs as whitespace (invalid)', () => {
        const event = {
          detail: {
            leaseId: '\t\t\t',
            accountId: '123456789012',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty leaseId'
        );
      });

      it('should parse event with only newlines as whitespace (invalid)', () => {
        const event = {
          detail: {
            leaseId: 'lease-123',
            accountId: '\n\n\n',
            status: 'Approved',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty accountId'
        );
      });
    });
  });
});
