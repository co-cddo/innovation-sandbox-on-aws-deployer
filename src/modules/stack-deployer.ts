import { CloudFormationClient, CreateStackCommand } from '@aws-sdk/client-cloudformation';
import type { AssumedRoleCredentials } from './role-assumer.js';

/**
 * Custom error class for stack deployment failures
 */
export class StackDeploymentError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'StackDeploymentError';
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StackDeploymentError);
    }
  }
}

/**
 * CloudFormation parameter structure
 */
export interface CloudFormationParameter {
  /** Parameter key name */
  ParameterKey: string;
  /** Parameter value */
  ParameterValue: string;
}

/**
 * Input for deploying a CloudFormation stack
 */
export interface DeployStackInput {
  /** Name of the stack to create */
  stackName: string;
  /** CloudFormation template as a string (JSON or YAML) */
  templateBody: string;
  /** Optional array of parameters for the stack */
  parameters?: CloudFormationParameter[];
  /** AWS credentials from assumed role */
  credentials: AssumedRoleCredentials;
}

/**
 * Result of a successful stack deployment
 */
export interface DeployStackResult {
  /** The unique identifier of the created stack */
  stackId: string;
}

/**
 * Deploys a CloudFormation stack to AWS using the CreateStack API
 *
 * This function:
 * - Creates a new CloudFormation client with the provided credentials
 * - Calls CreateStack with the template, stack name, and parameters
 * - Enables CAPABILITY_NAMED_IAM and CAPABILITY_AUTO_EXPAND for IAM and SAM/nested stack support
 * - Returns the stack ID on successful creation
 * - Handles common CloudFormation errors with descriptive messages
 *
 * @param input - Stack deployment configuration including credentials, template, and parameters
 * @returns The stack ID of the created stack
 * @throws {StackDeploymentError} If stack creation fails or returns invalid response
 *
 * @example
 * ```typescript
 * const credentials = await assumeRole('123456789012');
 * const result = await deployStack({
 *   stackName: 'my-app-stack',
 *   templateBody: JSON.stringify(cfnTemplate),
 *   parameters: [
 *     { ParameterKey: 'Environment', ParameterValue: 'production' }
 *   ],
 *   credentials
 * });
 * console.log('Stack created:', result.stackId);
 * ```
 */
export async function deployStack(input: DeployStackInput): Promise<DeployStackResult> {
  const { stackName, templateBody, parameters, credentials } = input;

  // Create CloudFormation client with assumed role credentials
  // Note: Do NOT use singleton pattern here - create fresh client per call with specific credentials
  const client = new CloudFormationClient({
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });

  try {
    const command = new CreateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Parameters: parameters,
      // Enable IAM resource creation and SAM/nested stack expansion
      Capabilities: ['CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
    });

    const response = await client.send(command);

    // Validate that StackId was returned
    if (!response.StackId) {
      throw new StackDeploymentError(
        `CloudFormation CreateStack succeeded but did not return a StackId for stack ${stackName}`
      );
    }

    return {
      stackId: response.StackId,
    };
  } catch (error) {
    // If already a StackDeploymentError, rethrow
    if (error instanceof StackDeploymentError) {
      throw error;
    }

    // Extract error details from AWS SDK error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error deploying stack';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    // Handle specific CloudFormation errors
    if (errorName === 'AlreadyExistsException') {
      throw new StackDeploymentError(
        `Stack '${stackName}' already exists. Use update or idempotent deployment instead.`,
        error
      );
    }

    if (errorName === 'InsufficientCapabilitiesException') {
      throw new StackDeploymentError(
        `Stack '${stackName}' requires additional capabilities beyond CAPABILITY_NAMED_IAM: ${errorMessage}`,
        error
      );
    }

    if (errorName === 'ValidationError') {
      throw new StackDeploymentError(
        `Invalid CloudFormation template or parameters for stack '${stackName}': ${errorMessage}`,
        error
      );
    }

    if (errorName === 'LimitExceededException') {
      throw new StackDeploymentError(
        `CloudFormation limit exceeded for stack '${stackName}': ${errorMessage}`,
        error
      );
    }

    if (errorName === 'TokenAlreadyExistsException') {
      throw new StackDeploymentError(
        `CloudFormation client request token already exists for stack '${stackName}': ${errorMessage}`,
        error
      );
    }

    // Generic error handling for other cases
    throw new StackDeploymentError(
      `Failed to deploy stack '${stackName}': ${errorName} - ${errorMessage}`,
      error
    );
  }
}
