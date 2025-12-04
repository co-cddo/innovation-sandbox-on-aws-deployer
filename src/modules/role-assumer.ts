import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
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
 * ISB role names for the double role assumption chain
 * The deployer must:
 * 1. Assume IntermediateRole in the hub account
 * 2. Use those creds to assume SandboxAccountRole in the target account
 */
const ISB_INTERMEDIATE_ROLE = 'InnovationSandbox-ndx-IntermediateRole';
const ISB_SANDBOX_ROLE = 'InnovationSandbox-ndx-SandboxAccountRole';
const HUB_ACCOUNT_ID = '568672915267';

/**
 * Performs STS AssumeRole with given credentials
 */
async function doAssumeRole(
  roleArn: string,
  sessionName: string,
  credentials?: AssumedRoleCredentials
): Promise<AssumedRoleCredentials> {
  const config = getConfig();

  // Create STS client with optional credentials for role chaining
  const clientConfig: { region: string; credentials?: object } = { region: config.awsRegion };
  if (credentials) {
    clientConfig.credentials = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    };
  }
  const client = new STSClient(clientConfig);

  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: sessionName,
    DurationSeconds: 3600,
  });

  const response = await client.send(command);

  if (!response.Credentials) {
    throw new RoleAssumptionError(
      `STS AssumeRole succeeded but did not return credentials for role ${roleArn}`
    );
  }

  const { AccessKeyId, SecretAccessKey, SessionToken, Expiration } = response.Credentials;

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
}

/**
 * Assumes an IAM role in the target sandbox account using ISB's role chain
 *
 * ISB uses a double role assumption pattern:
 * 1. First assume IntermediateRole in the hub account (568672915267)
 * 2. Then use those creds to assume SandboxAccountRole in the target account
 *
 * This works with ISB's SCP configuration which only allows InnovationSandbox-*
 * roles to operate in sandbox accounts.
 *
 * @param accountId - The AWS account ID where the sandbox role exists
 * @returns Temporary credentials for the sandbox account role
 * @throws {RoleAssumptionError} If role assumption fails
 *
 * @example
 * ```typescript
 * const credentials = await assumeRole('831494785845');
 * // Use credentials with other AWS SDK clients
 * ```
 */
export async function assumeRole(accountId: string): Promise<AssumedRoleCredentials> {
  try {
    // Step 1: Assume IntermediateRole in hub account
    const intermediateRoleArn = `arn:aws:iam::${HUB_ACCOUNT_ID}:role/${ISB_INTERMEDIATE_ROLE}`;
    const intermediateCreds = await doAssumeRole(
      intermediateRoleArn,
      'isb-deployer-intermediate'
    );

    // Step 2: Use intermediate creds to assume SandboxAccountRole in target account
    const sandboxRoleArn = `arn:aws:iam::${accountId}:role/${ISB_SANDBOX_ROLE}`;
    const sandboxCreds = await doAssumeRole(
      sandboxRoleArn,
      'isb-deployer-sandbox',
      intermediateCreds
    );

    return sandboxCreds;
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
      `Failed to assume role chain for account ${accountId}: ${errorName} - ${errorMessage}`,
      error
    );
  }
}
