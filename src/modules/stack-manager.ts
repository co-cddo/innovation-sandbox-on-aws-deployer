import {
  CloudFormationClient,
  DescribeStacksCommand,
  DeleteStackCommand,
} from '@aws-sdk/client-cloudformation';
import { deployStack, type DeployStackInput } from './stack-deployer.js';
import type { AssumedRoleCredentials } from './role-assumer.js';
import { DEFAULTS } from './config.js';

/** Maximum time to wait for stack deletion before timeout (2 minutes) */
const DELETE_WAIT_TIMEOUT_MS = 120_000;

/** Interval between stack deletion status checks (3 seconds) */
const DELETE_POLL_INTERVAL_MS = 3_000;

/**
 * Creates a CloudFormation client configured for the deploy region with assumed role credentials.
 *
 * This factory ensures consistent client configuration across all stack operations.
 * Each call creates a fresh client instance - do NOT cache or reuse as credentials may differ.
 *
 * @param credentials - Assumed role credentials for the target AWS account
 * @returns Configured CloudFormation client
 */
function createCloudFormationClient(credentials: AssumedRoleCredentials): CloudFormationClient {
  return new CloudFormationClient({
    region: DEFAULTS.DEPLOY_REGION,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });
}

/**
 * Error thrown when CloudFormation stack management operations fail.
 *
 * This error wraps failures from stack status checks, deployments, updates,
 * and deletions. It preserves the original AWS SDK error for debugging.
 *
 * Common causes include:
 * - Stack does not exist when expected
 * - Insufficient IAM permissions in target account
 * - Stack is in an unrecoverable state (DELETE_FAILED)
 * - Timeout waiting for stack operations to complete
 * - Invalid CloudFormation template
 *
 * @example
 * ```typescript
 * try {
 *   const result = await deployOrUpdateStack(input);
 * } catch (error) {
 *   if (error instanceof StackManagementError) {
 *     console.error('Stack operation failed:', error.message);
 *     if (error.originalError) {
 *       console.error('Original error:', error.originalError);
 *     }
 *   }
 * }
 * ```
 */
export class StackManagementError extends Error {
  /**
   * Creates a new StackManagementError.
   *
   * @param message - Human-readable description of the stack operation failure
   * @param originalError - Optional underlying error from AWS SDK or other source
   */
  constructor(
    message: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'StackManagementError';
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StackManagementError);
    }
  }
}

/**
 * CloudFormation stack status values
 * Reference: https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_Stack.html
 */
export enum StackStatus {
  // CREATE statuses
  CREATE_IN_PROGRESS = 'CREATE_IN_PROGRESS',
  CREATE_COMPLETE = 'CREATE_COMPLETE',
  CREATE_FAILED = 'CREATE_FAILED',
  ROLLBACK_IN_PROGRESS = 'ROLLBACK_IN_PROGRESS',
  ROLLBACK_COMPLETE = 'ROLLBACK_COMPLETE',
  ROLLBACK_FAILED = 'ROLLBACK_FAILED',

  // UPDATE statuses
  UPDATE_IN_PROGRESS = 'UPDATE_IN_PROGRESS',
  UPDATE_COMPLETE = 'UPDATE_COMPLETE',
  UPDATE_COMPLETE_CLEANUP_IN_PROGRESS = 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
  UPDATE_FAILED = 'UPDATE_FAILED',
  UPDATE_ROLLBACK_IN_PROGRESS = 'UPDATE_ROLLBACK_IN_PROGRESS',
  UPDATE_ROLLBACK_COMPLETE = 'UPDATE_ROLLBACK_COMPLETE',
  UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS = 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS',
  UPDATE_ROLLBACK_FAILED = 'UPDATE_ROLLBACK_FAILED',

  // DELETE statuses
  DELETE_IN_PROGRESS = 'DELETE_IN_PROGRESS',
  DELETE_COMPLETE = 'DELETE_COMPLETE',
  DELETE_FAILED = 'DELETE_FAILED',

  // REVIEW statuses
  REVIEW_IN_PROGRESS = 'REVIEW_IN_PROGRESS',

  // IMPORT statuses
  IMPORT_IN_PROGRESS = 'IMPORT_IN_PROGRESS',
  IMPORT_COMPLETE = 'IMPORT_COMPLETE',
  IMPORT_ROLLBACK_IN_PROGRESS = 'IMPORT_ROLLBACK_IN_PROGRESS',
  IMPORT_ROLLBACK_COMPLETE = 'IMPORT_ROLLBACK_COMPLETE',
  IMPORT_ROLLBACK_FAILED = 'IMPORT_ROLLBACK_FAILED',
}

/**
 * Result of stack status check
 */
export interface StackStatusResult {
  /** Whether the stack exists */
  exists: boolean;
  /** Stack ID if exists */
  stackId?: string;
  /** Current stack status if exists */
  status?: StackStatus;
}

/**
 * Action taken during stack operation
 */
export type StackAction = 'created' | 'exists' | 'skipped';

/**
 * Result of a stack operation
 */
export interface StackOperationResult {
  /** The unique identifier of the stack */
  stackId: string;
  /** Action taken: created (new stack), exists (already complete), skipped (in-progress) */
  action: StackAction;
  /** Current stack status */
  status?: StackStatus;
}

/**
 * Gets the current status of a CloudFormation stack
 *
 * This function:
 * - Creates a CloudFormation client with the provided credentials
 * - Calls DescribeStacks to check if the stack exists
 * - Returns stack status information
 * - Handles stack not found gracefully (returns exists: false)
 *
 * @param stackName - Name of the stack to check
 * @param credentials - AWS credentials from assumed role
 * @returns Stack status information
 * @throws {StackManagementError} If the API call fails (except for stack not found)
 *
 * @example
 * ```typescript
 * const credentials = await assumeRole('123456789012');
 * const status = await getStackStatus('my-stack', credentials);
 * if (status.exists) {
 *   console.log('Stack exists with status:', status.status);
 * }
 * ```
 */
export async function getStackStatus(
  stackName: string,
  credentials: AssumedRoleCredentials
): Promise<StackStatusResult> {
  // Create CloudFormation client with assumed role credentials
  const client = createCloudFormationClient(credentials);

  try {
    const command = new DescribeStacksCommand({
      StackName: stackName,
    });

    const response = await client.send(command);

    // If we get here, the stack exists
    if (!response.Stacks || response.Stacks.length === 0) {
      return { exists: false };
    }

    const stack = response.Stacks[0];

    if (!stack || !stack.StackId || !stack.StackStatus) {
      throw new StackManagementError(
        `DescribeStacks returned incomplete data for stack ${stackName}`
      );
    }

    return {
      exists: true,
      stackId: stack.StackId,
      status: stack.StackStatus as StackStatus,
    };
  } catch (error) {
    // Stack doesn't exist - this is not an error
    if (error instanceof Error && error.name === 'ValidationError') {
      if (error.message.includes('does not exist')) {
        return { exists: false };
      }
    }

    // Any other error is a real problem
    const errorMessage = error instanceof Error ? error.message : 'Unknown error checking stack';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    throw new StackManagementError(
      `Failed to get stack status for '${stackName}': ${errorName} - ${errorMessage}`,
      error
    );
  }
}

/**
 * Deploys or updates a CloudFormation stack with idempotent handling
 *
 * This function implements intelligent stack state management:
 * - If stack doesn't exist: creates new stack
 * - If stack is CREATE_COMPLETE or UPDATE_COMPLETE: returns existing stack ID
 * - If stack is in progress (CREATE_IN_PROGRESS, UPDATE_IN_PROGRESS): skips deployment
 * - If stack is ROLLBACK_COMPLETE: deletes and recreates (can't update rollback complete stacks)
 * - If stack is UPDATE_ROLLBACK_COMPLETE: can be updated, creates new stack
 * - If stack is DELETE_COMPLETE: creates new stack (treated as non-existent)
 * - Logs appropriate messages for each scenario
 *
 * @param input - Stack deployment configuration including credentials, template, and parameters
 * @returns Stack operation result with stack ID and action taken
 * @throws {StackManagementError} If stack status check fails
 * @throws {StackDeploymentError} If stack creation fails
 *
 * @example
 * ```typescript
 * const credentials = await assumeRole('123456789012');
 * const result = await deployOrUpdateStack({
 *   stackName: 'my-app-stack',
 *   templateBody: JSON.stringify(cfnTemplate),
 *   parameters: [
 *     { ParameterKey: 'Environment', ParameterValue: 'production' }
 *   ],
 *   credentials
 * });
 * console.log(`Stack ${result.action}:`, result.stackId);
 * ```
 */
/* eslint-disable no-console */
export async function deployOrUpdateStack(input: DeployStackInput): Promise<StackOperationResult> {
  const { stackName, credentials } = input;

  // Check current stack status
  const statusResult = await getStackStatus(stackName, credentials);

  // Stack doesn't exist - create it
  if (!statusResult.exists) {
    console.log(`Stack '${stackName}' does not exist. Creating new stack...`);
    const deployResult = await deployStack(input);
    return {
      stackId: deployResult.stackId,
      action: 'created',
      status: StackStatus.CREATE_IN_PROGRESS,
    };
  }

  // Stack exists - handle based on status
  const { stackId, status } = statusResult;

  if (!stackId || !status) {
    throw new StackManagementError(
      `Stack '${stackName}' exists but status information is incomplete`
    );
  }

  // Handle complete states - return existing stack
  if (status === StackStatus.CREATE_COMPLETE || status === StackStatus.UPDATE_COMPLETE) {
    console.log(
      `Stack '${stackName}' already exists with status ${status}. Returning existing stack ID.`
    );
    return {
      stackId,
      action: 'exists',
      status,
    };
  }

  // Handle in-progress states - skip deployment
  if (
    status === StackStatus.CREATE_IN_PROGRESS ||
    status === StackStatus.UPDATE_IN_PROGRESS ||
    status === StackStatus.UPDATE_COMPLETE_CLEANUP_IN_PROGRESS ||
    status === StackStatus.UPDATE_ROLLBACK_IN_PROGRESS ||
    status === StackStatus.UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS ||
    status === StackStatus.DELETE_IN_PROGRESS ||
    status === StackStatus.ROLLBACK_IN_PROGRESS ||
    status === StackStatus.REVIEW_IN_PROGRESS ||
    status === StackStatus.IMPORT_IN_PROGRESS ||
    status === StackStatus.IMPORT_ROLLBACK_IN_PROGRESS
  ) {
    console.log(
      `Stack '${stackName}' is currently in ${status} state. Skipping deployment to avoid conflicts.`
    );
    return {
      stackId,
      action: 'skipped',
      status,
    };
  }

  // Handle ROLLBACK_COMPLETE - must delete and recreate
  if (status === StackStatus.ROLLBACK_COMPLETE) {
    console.log(`Stack '${stackName}' is in ${status} state. Deleting stack before recreating...`);

    // Delete the stack using shared client factory
    const client = createCloudFormationClient(credentials);

    try {
      const deleteCommand = new DeleteStackCommand({
        StackName: stackName,
      });
      await client.send(deleteCommand);
      console.log(`Stack '${stackName}' deletion initiated. Waiting for deletion to complete...`);

      // Wait for stack deletion to complete before creating new stack
      // CloudFormation won't allow creating a stack with the same name while delete is in progress
      const startTime = Date.now();

      while (Date.now() - startTime < DELETE_WAIT_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, DELETE_POLL_INTERVAL_MS));

        const currentStatus = await getStackStatus(stackName, credentials);

        // Stack is fully deleted (doesn't exist anymore)
        if (!currentStatus.exists) {
          console.log(`Stack '${stackName}' deletion complete. Creating new stack...`);
          break;
        }

        // Stack deletion failed
        if (currentStatus.status === StackStatus.DELETE_FAILED) {
          throw new StackManagementError(
            `Stack '${stackName}' deletion failed. Cannot recreate stack.`
          );
        }

        // Still deleting, continue waiting
        console.log(`Stack '${stackName}' still deleting (${currentStatus.status})...`);
      }

      // Check if we timed out
      const finalStatus = await getStackStatus(stackName, credentials);
      if (finalStatus.exists && finalStatus.status !== StackStatus.DELETE_COMPLETE) {
        throw new StackManagementError(
          `Timeout waiting for stack '${stackName}' deletion. Current status: ${finalStatus.status}`
        );
      }
    } catch (error) {
      if (error instanceof StackManagementError) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new StackManagementError(
        `Failed to delete stack '${stackName}' in ROLLBACK_COMPLETE state: ${errorMessage}`,
        error
      );
    }

    // Create new stack
    const deployResult = await deployStack(input);
    return {
      stackId: deployResult.stackId,
      action: 'created',
      status: StackStatus.CREATE_IN_PROGRESS,
    };
  }

  // Handle UPDATE_ROLLBACK_COMPLETE - can be updated, treat as updatable
  if (status === StackStatus.UPDATE_ROLLBACK_COMPLETE) {
    console.log(
      `Stack '${stackName}' is in ${status} state. Stack is updatable, returning existing stack ID.`
    );
    return {
      stackId,
      action: 'exists',
      status,
    };
  }

  // Handle DELETE_COMPLETE - treat as non-existent
  if (status === StackStatus.DELETE_COMPLETE) {
    console.log(
      `Stack '${stackName}' is in ${status} state. Treating as non-existent and creating new stack...`
    );
    const deployResult = await deployStack(input);
    return {
      stackId: deployResult.stackId,
      action: 'created',
      status: StackStatus.CREATE_IN_PROGRESS,
    };
  }

  // Handle other failed states - log warning and return existing
  console.warn(
    `Stack '${stackName}' is in unexpected state: ${status}. Returning existing stack ID.`
  );
  return {
    stackId,
    action: 'exists',
    status,
  };
}
/* eslint-enable no-console */
