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
 * Field names are normalized from ISB's DynamoDB schema to our internal format
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
 * Looks up a lease in the ISB DynamoDB table using userEmail and leaseId
 *
 * ISB DynamoDB schema uses a composite key:
 * - Partition key: userEmail
 * - Sort key: uuid (the leaseId)
 *
 * ISB field names are mapped to our internal format:
 * - awsAccountId → accountId
 * - originalLeaseTemplateName → templateName
 * - maxSpend → budgetAmount
 *
 * @param userEmail - The email of the user who owns the lease
 * @param leaseId - The unique identifier (uuid) for the lease
 * @returns Lease details including accountId, templateName, and other attributes
 * @throws {LeaseLookupError} If the lease is not found or DynamoDB query fails
 *
 * @example
 * ```typescript
 * const lease = await lookupLease('user@example.gov.uk', 'f2d3eb78-907a-4c20-8127-7ce45758836d');
 * console.log(`Account: ${lease.accountId}, Template: ${lease.templateName}`);
 * ```
 */
export async function lookupLease(userEmail: string, leaseId: string): Promise<LeaseDetails> {
  const config = getConfig();
  const client = getDynamoDBClient();

  try {
    // ISB table uses composite key: userEmail (HASH) + uuid (RANGE)
    const command = new GetItemCommand({
      TableName: config.leaseTableName,
      Key: {
        userEmail: { S: userEmail },
        uuid: { S: leaseId },
      },
    });

    const response = await client.send(command);

    // Check if item was found
    if (!response.Item) {
      throw new LeaseLookupError(`Lease not found: ${leaseId} for user ${userEmail}`);
    }

    // Unmarshall the DynamoDB item to a plain JavaScript object
    const item = unmarshall(response.Item);

    // Validate that required fields are present (using ISB field names)
    if (!item.uuid || !item.awsAccountId) {
      throw new LeaseLookupError(
        `Lease ${leaseId} is missing required fields (uuid or awsAccountId)`
      );
    }

    // Return the lease details, mapping ISB field names to our internal format
    return {
      // Map ISB fields to our normalized format
      leaseId: item.uuid as string,
      accountId: item.awsAccountId as string,
      templateName: item.originalLeaseTemplateName as string | undefined,
      budgetAmount: item.maxSpend as number | undefined,
      status: item.status as string | undefined,
      expirationDate: item.expirationDate as string | undefined,
      userEmail: item.userEmail as string,
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
      `Failed to lookup lease ${leaseId} for user ${userEmail} in table ${config.leaseTableName}: ${errorName} - ${errorMessage}`,
      error
    );
  }
}
