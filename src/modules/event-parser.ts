/**
 * Parsed event detail from ISB LeaseApproved event
 * Note: ISB events only contain leaseId and userEmail - accountId must be looked up
 */
export interface ParsedLeaseEvent {
  /** UUID of the lease */
  leaseId: string;
  /** Email of the user who owns the lease */
  userEmail: string;
  /** Who approved the lease (AUTO_APPROVED or admin email) */
  approvedBy?: string;
}

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
 * Parses and validates a lease approved event from ISB EventBridge
 *
 * ISB LeaseApproved events contain:
 * - leaseId: UUID of the lease
 * - userEmail: Email of the lease owner
 * - approvedBy: Who approved (AUTO_APPROVED or admin email)
 *
 * Note: accountId and templateName are NOT in the event - they must be
 * looked up from the lease table using userEmail + leaseId (uuid).
 *
 * @param event - The raw EventBridge event (unknown type for safety)
 * @returns Validated ParsedLeaseEvent with leaseId and userEmail
 * @throws Error if the event structure is invalid or required fields are missing
 *
 * @example
 * ```typescript
 * const event = {
 *   version: '0',
 *   id: 'event-123',
 *   'detail-type': 'LeaseApproved',
 *   source: 'innovation-sandbox',
 *   account: '568672915267',
 *   time: '2024-01-01T00:00:00Z',
 *   region: 'us-west-2',
 *   detail: {
 *     leaseId: 'f2d3eb78-907a-4c20-8127-7ce45758836d',
 *     userEmail: 'user@example.gov.uk',
 *     approvedBy: 'AUTO_APPROVED'
 *   }
 * };
 *
 * const leaseDetail = parseLeaseEvent(event);
 * // leaseDetail.leaseId === 'f2d3eb78-907a-4c20-8127-7ce45758836d'
 * // leaseDetail.userEmail === 'user@example.gov.uk'
 * ```
 */
export function parseLeaseEvent(event: unknown): ParsedLeaseEvent {
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

  // Validate required field: userEmail
  if (!('userEmail' in detail) || !isNonEmptyString(detail.userEmail)) {
    throw new Error('Event detail must contain a non-empty userEmail');
  }

  // Extract optional field: approvedBy
  const approvedBy =
    'approvedBy' in detail && isNonEmptyString(detail.approvedBy)
      ? detail.approvedBy
      : undefined;

  // Return validated lease event detail
  return {
    leaseId: detail.leaseId,
    userEmail: detail.userEmail,
    approvedBy,
  };
}
