import {
  CloudFormationClient,
  DescribeStacksCommand,
  DeleteStackCommand,
} from '@aws-sdk/client-cloudformation';
import { deployStack, type DeployStackInput } from './stack-deployer.js';
import type { AssumedRoleCredentials } from './role-assumer.js';
import { DEFAULTS } from './config.js';

/**
 * Custom error class for stack management failures
 */
export class StackManagementError extends Error {
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
  // Note: Do NOT use singleton pattern here - create fresh client per call with specific credentials
  // Query stacks in us-east-1 where they are deployed
  const client = new CloudFormationClient({
    region: DEFAULTS.DEPLOY_REGION,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });

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

    // Delete the stack (in us-east-1 where stacks are deployed)
    const client = new CloudFormationClient({
      region: DEFAULTS.DEPLOY_REGION,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    try {
      const deleteCommand = new DeleteStackCommand({
        StackName: stackName,
      });
      await client.send(deleteCommand);
      console.log(`Stack '${stackName}' deletion initiated. Creating new stack...`);
    } catch (error) {
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
