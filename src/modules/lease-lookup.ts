import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { getConfig } from './config.js';

/**
 * Custom error class for lease lookup failures
 */
export class LeaseLookupError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'LeaseLookupError';
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LeaseLookupError);
    }
  }
}

/**
 * Lease details returned from DynamoDB lookup
 */
export interface LeaseDetails {
  /** Unique identifier for the lease */
  leaseId: string;
  /** AWS account ID where the lease is deployed */
  accountId: string;
  /** CloudFormation template name to deploy */
  templateName?: string;
  /** Budget amount in GBP for the lease */
  budgetAmount?: number;
  /** Status of the lease (e.g., 'active', 'expired', 'pending') */
  status?: string;
  /** Expiration date of the lease in ISO 8601 format */
  expirationDate?: string;
  /** Email address of the requester */
  requesterEmail?: string;
  /** Any additional attributes from DynamoDB */
  [key: string]: unknown;
}

/**
 * DynamoDB client singleton
 */
let dynamoDBClient: DynamoDBClient | null = null;

/**
 * Gets or creates the DynamoDB client instance
 */
function getDynamoDBClient(): DynamoDBClient {
  if (!dynamoDBClient) {
    const config = getConfig();
    dynamoDBClient = new DynamoDBClient({ region: config.awsRegion });
  }
  return dynamoDBClient;
}

/**
 * Resets the DynamoDB client singleton (for testing)
 */
export function resetDynamoDBClient(): void {
  dynamoDBClient = null;
}

/**
 * Looks up a lease in the DynamoDB table using the lease ID
 *
 * This function:
 * - Queries the DynamoDB leases table using the leaseId as the partition key
 * - Returns all lease attributes including accountId, templateName, budget, etc.
 * - Handles item not found scenarios with descriptive errors
 * - Handles DynamoDB service errors with appropriate error wrapping
 * - Uses configurable table name from environment (LEASE_TABLE_NAME)
 *
 * @param leaseId - The unique identifier for the lease to look up
 * @returns Lease details including accountId, templateName, and other attributes
 * @throws {LeaseLookupError} If the lease is not found or DynamoDB query fails
 *
 * @example
 * ```typescript
 * const lease = await lookupLease('lease-12345');
 * console.log(`Account: ${lease.accountId}, Template: ${lease.templateName}`);
 * ```
 */
export async function lookupLease(leaseId: string): Promise<LeaseDetails> {
  const config = getConfig();
  const client = getDynamoDBClient();

  try {
    const command = new GetItemCommand({
      TableName: config.leaseTableName,
      Key: {
        leaseId: { S: leaseId },
      },
    });

    const response = await client.send(command);

    // Check if item was found
    if (!response.Item) {
      throw new LeaseLookupError(`Lease not found: ${leaseId}`);
    }

    // Unmarshall the DynamoDB item to a plain JavaScript object
    const item = unmarshall(response.Item);

    // Validate that required fields are present
    if (!item.leaseId || !item.accountId) {
      throw new LeaseLookupError(
        `Lease ${leaseId} is missing required fields (leaseId or accountId)`
      );
    }

    // Return the lease details with proper typing
    return {
      leaseId: item.leaseId as string,
      accountId: item.accountId as string,
      templateName: item.templateName as string | undefined,
      budgetAmount: item.budgetAmount as number | undefined,
      status: item.status as string | undefined,
      expirationDate: item.expirationDate as string | undefined,
      requesterEmail: item.requesterEmail as string | undefined,
      // Include any additional attributes
      ...item,
    };
  } catch (error) {
    // If already a LeaseLookupError, rethrow
    if (error instanceof LeaseLookupError) {
      throw error;
    }

    // Extract error message from AWS SDK error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error looking up lease';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    // Provide descriptive error message
    throw new LeaseLookupError(
      `Failed to lookup lease ${leaseId} in table ${config.leaseTableName}: ${errorName} - ${errorMessage}`,
      error
    );
  }
}
