import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { getConfig } from './config.js';

/**
 * Custom error class for role assumption failures
 */
export class RoleAssumptionError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'RoleAssumptionError';
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RoleAssumptionError);
    }
  }
}

/**
 * Temporary credentials returned from role assumption
 */
export interface AssumedRoleCredentials {
  /** AWS access key ID */
  accessKeyId: string;
  /** AWS secret access key */
  secretAccessKey: string;
  /** Session token */
  sessionToken: string;
  /** Expiration timestamp of credentials */
  expiration?: Date;
}

/**
 * STS client singleton
 */
let stsClient: STSClient | null = null;

/**
 * Gets or creates the STS client instance
 */
function getSTSClient(): STSClient {
  if (!stsClient) {
    const config = getConfig();
    stsClient = new STSClient({ region: config.awsRegion });
  }
  return stsClient;
}

/**
 * Resets the STS client singleton (for testing)
 */
export function resetSTSClient(): void {
  stsClient = null;
}

/**
 * Assumes an IAM role in the target AWS account using STS AssumeRole
 *
 * This function:
 * - Constructs the role ARN from the account ID and configured role name
 * - Calls AWS STS AssumeRole with appropriate session parameters
 * - Returns temporary credentials for cross-account access
 * - Sets a session name for CloudTrail audit trail
 *
 * @param accountId - The AWS account ID where the role exists
 * @returns Temporary credentials for the assumed role
 * @throws {RoleAssumptionError} If role assumption fails or credentials are missing
 *
 * @example
 * ```typescript
 * const credentials = await assumeRole('123456789012');
 * // Use credentials with other AWS SDK clients
 * const cfClient = new CloudFormationClient({
 *   region: 'eu-west-2',
 *   credentials: {
 *     accessKeyId: credentials.accessKeyId,
 *     secretAccessKey: credentials.secretAccessKey,
 *     sessionToken: credentials.sessionToken,
 *   }
 * });
 * ```
 */
export async function assumeRole(accountId: string): Promise<AssumedRoleCredentials> {
  const config = getConfig();
  const client = getSTSClient();

  // Construct the role ARN: arn:aws:iam::{accountId}:role/{roleName}
  const roleArn = `arn:aws:iam::${accountId}:role/${config.targetRoleName}`;

  // Session name for audit trail in CloudTrail
  const roleSessionName = 'innovation-sandbox-deployer';

  // Session duration: 1 hour (3600 seconds)
  const durationSeconds = 3600;

  try {
    const command = new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: roleSessionName,
      DurationSeconds: durationSeconds,
    });

    const response = await client.send(command);

    // Validate that credentials were returned
    if (!response.Credentials) {
      throw new RoleAssumptionError(
        `STS AssumeRole succeeded but did not return credentials for role ${roleArn}`
      );
    }

    const { AccessKeyId, SecretAccessKey, SessionToken, Expiration } = response.Credentials;

    // Validate required credential fields are present
    if (!AccessKeyId || !SecretAccessKey || !SessionToken) {
      throw new RoleAssumptionError(
        `STS AssumeRole returned incomplete credentials for role ${roleArn}`
      );
    }

    return {
      accessKeyId: AccessKeyId,
      secretAccessKey: SecretAccessKey,
      sessionToken: SessionToken,
      expiration: Expiration,
    };
  } catch (error) {
    // If already a RoleAssumptionError, rethrow
    if (error instanceof RoleAssumptionError) {
      throw error;
    }

    // Extract error message from AWS SDK error
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error assuming role';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    // Provide descriptive error message
    throw new RoleAssumptionError(
      `Failed to assume role ${roleArn}: ${errorName} - ${errorMessage}`,
      error
    );
  }
}
