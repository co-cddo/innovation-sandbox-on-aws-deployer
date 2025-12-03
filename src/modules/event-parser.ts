import type { LeaseEventDetail } from '../types/index.js';

/**
 * Validates that a value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates that a value is an object (not null or array)
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses and validates a lease approved event from EventBridge
 *
 * This function extracts the lease metadata from an EventBridge event,
 * validates that all required fields are present, and returns a structured
 * LeaseEventDetail object ready for processing.
 *
 * @param event - The raw EventBridge event (unknown type for safety)
 * @returns Validated LeaseEventDetail with leaseId, accountId, and optional templateName
 * @throws Error if the event structure is invalid or required fields are missing
 *
 * @example
 * ```typescript
 * const event = {
 *   version: '0',
 *   id: 'event-123',
 *   'detail-type': 'Lease Approved',
 *   source: 'innovation-sandbox',
 *   account: '123456789012',
 *   time: '2024-01-01T00:00:00Z',
 *   region: 'eu-west-2',
 *   detail: {
 *     leaseId: 'lease-abc-123',
 *     accountId: '987654321098',
 *     templateName: 'ec2-instance',
 *     status: 'Approved'
 *   }
 * };
 *
 * const leaseDetail = parseLeaseEvent(event);
 * // leaseDetail.leaseId === 'lease-abc-123'
 * // leaseDetail.accountId === '987654321098'
 * // leaseDetail.templateName === 'ec2-instance'
 * ```
 */
export function parseLeaseEvent(event: unknown): LeaseEventDetail {
  // Validate event is an object
  if (!isObject(event)) {
    throw new Error('Event must be an object');
  }

  // Validate detail property exists and is an object
  if (!('detail' in event) || !isObject(event.detail)) {
    throw new Error('Event must contain a detail object');
  }

  const detail = event.detail;

  // Validate required field: leaseId
  if (!('leaseId' in detail) || !isNonEmptyString(detail.leaseId)) {
    throw new Error('Event detail must contain a non-empty leaseId');
  }

  // Validate required field: accountId
  if (!('accountId' in detail) || !isNonEmptyString(detail.accountId)) {
    throw new Error('Event detail must contain a non-empty accountId');
  }

  // Validate required field: status
  if (!('status' in detail) || !isNonEmptyString(detail.status)) {
    throw new Error('Event detail must contain a non-empty status');
  }

  // Extract and validate optional field: templateName
  const templateName =
    'templateName' in detail && isNonEmptyString(detail.templateName)
      ? detail.templateName
      : undefined;

  // Return validated lease event detail
  return {
    leaseId: detail.leaseId,
    accountId: detail.accountId,
    templateName,
    status: detail.status,
  };
}
