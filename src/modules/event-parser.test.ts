import { describe, it, expect } from 'vitest';
import { parseLeaseEvent, ParsedLeaseEvent } from './event-parser.js';

describe('event-parser module', () => {
  describe('parseLeaseEvent', () => {
    describe('valid events', () => {
      it('should parse valid event with all required fields', () => {
        const event = {
          version: '0',
          id: 'event-123',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          account: '568672915267',
          time: '2024-01-01T00:00:00Z',
          region: 'us-west-2',
          detail: {
            leaseId: 'f2d3eb78-907a-4c20-8127-7ce45758836d',
            userEmail: 'user@example.gov.uk',
          },
        };

        const result: ParsedLeaseEvent = parseLeaseEvent(event);

        expect(result).toEqual({
          leaseId: 'f2d3eb78-907a-4c20-8127-7ce45758836d',
          userEmail: 'user@example.gov.uk',
          approvedBy: undefined,
        });
      });

      it('should parse valid event with approvedBy present', () => {
        const event = {
          version: '0',
          id: 'event-456',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          account: '568672915267',
          time: '2024-01-01T00:00:00Z',
          region: 'us-west-2',
          detail: {
            leaseId: 'lease-xyz-789',
            userEmail: 'admin@example.gov.uk',
            approvedBy: 'AUTO_APPROVED',
          },
        };

        const result: ParsedLeaseEvent = parseLeaseEvent(event);

        expect(result).toEqual({
          leaseId: 'lease-xyz-789',
          userEmail: 'admin@example.gov.uk',
          approvedBy: 'AUTO_APPROVED',
        });
      });

      it('should ignore extra properties in detail', () => {
        const event = {
          version: '0',
          id: 'event-789',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          account: '568672915267',
          time: '2024-01-01T00:00:00Z',
          region: 'us-west-2',
          detail: {
            leaseId: 'lease-extra-001',
            userEmail: 'test@example.gov.uk',
            approvedBy: 'admin@example.gov.uk',
            extraField1: 'should be ignored',
            extraField2: 123,
            extraField3: { nested: 'object' },
          },
        };

        const result: ParsedLeaseEvent = parseLeaseEvent(event);

        expect(result).toEqual({
          leaseId: 'lease-extra-001',
          userEmail: 'test@example.gov.uk',
          approvedBy: 'admin@example.gov.uk',
        });
      });

      it('should treat empty string approvedBy as undefined', () => {
        const event = {
          version: '0',
          id: 'event-empty-approver',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          account: '568672915267',
          time: '2024-01-01T00:00:00Z',
          region: 'us-west-2',
          detail: {
            leaseId: 'lease-001',
            userEmail: 'user@example.gov.uk',
            approvedBy: '',
          },
        };

        const result: ParsedLeaseEvent = parseLeaseEvent(event);

        expect(result.approvedBy).toBeUndefined();
      });

      it('should treat whitespace-only approvedBy as undefined', () => {
        const event = {
          version: '0',
          id: 'event-whitespace-approver',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          account: '568672915267',
          time: '2024-01-01T00:00:00Z',
          region: 'us-west-2',
          detail: {
            leaseId: 'lease-002',
            userEmail: 'user@example.gov.uk',
            approvedBy: '   ',
          },
        };

        const result: ParsedLeaseEvent = parseLeaseEvent(event);

        expect(result.approvedBy).toBeUndefined();
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
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });

      it('should throw error when detail is null', () => {
        const event = {
          version: '0',
          id: 'event-null-detail',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: null,
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });

      it('should throw error when detail is not an object (string)', () => {
        const event = {
          version: '0',
          id: 'event-string-detail',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: 'not an object',
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });

      it('should throw error when detail is not an object (number)', () => {
        const event = {
          version: '0',
          id: 'event-number-detail',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: 123,
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });

      it('should throw error when detail is an array', () => {
        const event = {
          version: '0',
          id: 'event-array-detail',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: ['item1', 'item2'],
        };

        expect(() => parseLeaseEvent(event)).toThrow('Event must contain a detail object');
      });

      it('should throw error when detail is undefined', () => {
        const event = {
          version: '0',
          id: 'event-undefined-detail',
          'detail-type': 'LeaseApproved',
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
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            userEmail: 'user@example.gov.uk',
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
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: '',
            userEmail: 'user@example.gov.uk',
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
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: '   ',
            userEmail: 'user@example.gov.uk',
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
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 123,
            userEmail: 'user@example.gov.uk',
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
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: null,
            userEmail: 'user@example.gov.uk',
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
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: { id: 'lease-123' },
            userEmail: 'user@example.gov.uk',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty leaseId'
        );
      });
    });

    describe('missing or invalid userEmail', () => {
      it('should throw error when userEmail is missing', () => {
        const event = {
          version: '0',
          id: 'event-no-user-email',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty userEmail'
        );
      });

      it('should throw error when userEmail is empty string', () => {
        const event = {
          version: '0',
          id: 'event-empty-user-email',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            userEmail: '',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty userEmail'
        );
      });

      it('should throw error when userEmail is whitespace-only', () => {
        const event = {
          version: '0',
          id: 'event-whitespace-user-email',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            userEmail: '   ',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty userEmail'
        );
      });

      it('should throw error when userEmail is not a string (number)', () => {
        const event = {
          version: '0',
          id: 'event-number-user-email',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            userEmail: 123456789012,
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty userEmail'
        );
      });

      it('should throw error when userEmail is not a string (null)', () => {
        const event = {
          version: '0',
          id: 'event-null-user-email',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            userEmail: null,
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty userEmail'
        );
      });

      it('should throw error when userEmail is not a string (boolean)', () => {
        const event = {
          version: '0',
          id: 'event-boolean-user-email',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            userEmail: true,
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty userEmail'
        );
      });
    });

    describe('optional approvedBy validation', () => {
      it('should accept undefined approvedBy', () => {
        const event = {
          version: '0',
          id: 'event-undefined-approver',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            userEmail: 'user@example.gov.uk',
            approvedBy: undefined,
          },
        };

        const result = parseLeaseEvent(event);
        expect(result.approvedBy).toBeUndefined();
      });

      it('should treat null approvedBy as undefined', () => {
        const event = {
          version: '0',
          id: 'event-null-approver',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            userEmail: 'user@example.gov.uk',
            approvedBy: null,
          },
        };

        const result = parseLeaseEvent(event);
        expect(result.approvedBy).toBeUndefined();
      });

      it('should treat number approvedBy as undefined', () => {
        const event = {
          version: '0',
          id: 'event-number-approver',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            userEmail: 'user@example.gov.uk',
            approvedBy: 123,
          },
        };

        const result = parseLeaseEvent(event);
        expect(result.approvedBy).toBeUndefined();
      });

      it('should treat boolean approvedBy as undefined', () => {
        const event = {
          version: '0',
          id: 'event-boolean-approver',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            userEmail: 'user@example.gov.uk',
            approvedBy: true,
          },
        };

        const result = parseLeaseEvent(event);
        expect(result.approvedBy).toBeUndefined();
      });

      it('should treat object approvedBy as undefined', () => {
        const event = {
          version: '0',
          id: 'event-object-approver',
          'detail-type': 'LeaseApproved',
          source: 'innovation-sandbox',
          detail: {
            leaseId: 'lease-123',
            userEmail: 'user@example.gov.uk',
            approvedBy: { email: 'admin@example.gov.uk' },
          },
        };

        const result = parseLeaseEvent(event);
        expect(result.approvedBy).toBeUndefined();
      });
    });

    describe('edge cases', () => {
      it('should parse minimal valid event', () => {
        const event = {
          detail: {
            leaseId: 'lease-minimal',
            userEmail: 'user@example.gov.uk',
          },
        };

        const result = parseLeaseEvent(event);

        expect(result).toEqual({
          leaseId: 'lease-minimal',
          userEmail: 'user@example.gov.uk',
          approvedBy: undefined,
        });
      });

      it('should handle very long string values', () => {
        const longString = 'a'.repeat(10000);
        const event = {
          detail: {
            leaseId: longString,
            userEmail: longString + '@example.gov.uk',
            approvedBy: longString,
          },
        };

        const result = parseLeaseEvent(event);

        expect(result.leaseId).toBe(longString);
        expect(result.userEmail).toBe(longString + '@example.gov.uk');
        expect(result.approvedBy).toBe(longString);
      });

      it('should handle special characters in string values', () => {
        const event = {
          detail: {
            leaseId: 'lease-!@#$%^&*()_+-=[]{}|;:,.<>?',
            userEmail: 'user+tag@example.gov.uk',
            approvedBy: 'AUTO_APPROVED',
          },
        };

        const result = parseLeaseEvent(event);

        expect(result.leaseId).toBe('lease-!@#$%^&*()_+-=[]{}|;:,.<>?');
        expect(result.userEmail).toBe('user+tag@example.gov.uk');
        expect(result.approvedBy).toBe('AUTO_APPROVED');
      });

      it('should parse event with only tabs as whitespace (invalid leaseId)', () => {
        const event = {
          detail: {
            leaseId: '\t\t\t',
            userEmail: 'user@example.gov.uk',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty leaseId'
        );
      });

      it('should parse event with only newlines as whitespace (invalid userEmail)', () => {
        const event = {
          detail: {
            leaseId: 'lease-123',
            userEmail: '\n\n\n',
          },
        };

        expect(() => parseLeaseEvent(event)).toThrow(
          'Event detail must contain a non-empty userEmail'
        );
      });
    });
  });
});
