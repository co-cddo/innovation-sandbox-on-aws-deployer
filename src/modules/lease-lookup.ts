import { createISBClient, type ISBClient } from '@co-cddo/isb-client';

/**
 * Custom error class for lease lookup failures
 */
export class LeaseLookupError extends Error {
  constructor(
    message: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'LeaseLookupError';
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LeaseLookupError);
    }
  }
}

/**
 * Lease details returned from ISB API
 * Field names are normalized from ISB's API schema to our internal format
 */
export interface LeaseDetails {
  /** Unique identifier for the lease (uuid in ISB) */
  leaseId: string;
  /** AWS account ID where the lease is deployed (awsAccountId in ISB) */
  accountId: string;
  /** CloudFormation template name to deploy (originalLeaseTemplateName in ISB) */
  templateName?: string;
  /** Maximum spend budget in GBP (maxSpend in ISB) */
  budgetAmount?: number;
  /** Status of the lease (e.g., 'Active', 'Expired', 'Frozen') */
  status?: string;
  /** Expiration date of the lease in ISO 8601 format */
  expirationDate?: string;
  /** Email address of the user who owns the lease */
  userEmail: string;
  /** Any additional attributes from ISB API */
  [key: string]: unknown;
}

/**
 * ISB client singleton
 */
let isbClient: ISBClient | null = null;

/**
 * Gets or creates the ISB client instance
 */
function getISBClient(): ISBClient {
  if (!isbClient) {
    isbClient = createISBClient({
      serviceIdentity: {
        email: 'deployer@innovation-sandbox.local',
        roles: ['Admin'],
      },
    });
  }
  return isbClient;
}

/**
 * Resets the ISB client singleton (for testing)
 */
export function resetISBClient(): void {
  isbClient = null;
}

/**
 * Looks up a lease via the ISB API using userEmail and leaseId
 *
 * ISB API key lookup uses:
 * - userEmail (partition key)
 * - uuid (sort key / leaseId)
 *
 * ISB field names are mapped to our internal format:
 * - awsAccountId → accountId
 * - originalLeaseTemplateName → templateName
 * - maxSpend → budgetAmount
 *
 * @param userEmail - The email of the user who owns the lease
 * @param leaseId - The unique identifier (uuid) for the lease
 * @returns Lease details including accountId, templateName, and other attributes
 * @throws {LeaseLookupError} If the lease is not found or API request fails
 *
 * @example
 * ```typescript
 * const lease = await lookupLease('user@example.gov.uk', 'f2d3eb78-907a-4c20-8127-7ce45758836d');
 * console.log(`Account: ${lease.accountId}, Template: ${lease.templateName}`);
 * ```
 */
export async function lookupLease(userEmail: string, leaseId: string): Promise<LeaseDetails> {
  const client = getISBClient();

  try {
    const result = await client.fetchLeaseByKey(userEmail, leaseId, leaseId);

    if (!result) {
      throw new LeaseLookupError(`Lease not found: ${leaseId} for user ${userEmail}`);
    }

    // Validate that required fields are present
    if (!result.uuid || !result.awsAccountId) {
      throw new LeaseLookupError(
        `Lease ${leaseId} is missing required fields (uuid or awsAccountId)`
      );
    }

    // Return the lease details, mapping ISB field names to our internal format
    // Spread first, then override with mapped fields
    return {
      ...result,
      leaseId: result.uuid,
      accountId: result.awsAccountId,
      templateName: result.originalLeaseTemplateName,
      budgetAmount: result.maxSpend,
      status: result.status,
      expirationDate: result.expirationDate,
      userEmail: result.userEmail,
    };
  } catch (error) {
    // If already a LeaseLookupError, rethrow
    if (error instanceof LeaseLookupError) {
      throw error;
    }

    // Extract error message
    const errorMessage = error instanceof Error ? error.message : 'Unknown error looking up lease';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    // Provide descriptive error message
    throw new LeaseLookupError(
      `Failed to lookup lease ${leaseId} for user ${userEmail}: ${errorName} - ${errorMessage}`,
      error
    );
  }
}
