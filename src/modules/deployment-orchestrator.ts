import { mapParameters } from './parameter-mapper.js';
import { deployOrUpdateStack } from './stack-manager.js';
import type { LeaseDetails } from './lease-lookup.js';
import type { AssumedRoleCredentials } from './role-assumer.js';

/**
 * Custom error class for deployment orchestration failures
 */
export class DeploymentOrchestrationError extends Error {
  constructor(
    message: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'DeploymentOrchestrationError';
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DeploymentOrchestrationError);
    }
  }
}

/**
 * Input configuration for deploying a stack with parameter mapping
 */
export interface DeploymentInput {
  /** CloudFormation template as a string (JSON or YAML) */
  templateBody: string;
  /** Parameter names extracted from template validation */
  templateParameters: string[];
  /** Lease details for parameter mapping */
  leaseDetails: LeaseDetails;
  /** Name of the stack to create or update */
  stackName: string;
  /** AWS credentials from assumed role */
  credentials: AssumedRoleCredentials;
  /** Optional custom parameters to merge with mapped parameters */
  customParameters?: Record<string, string>;
}

/**
 * Result of a deployment operation with parameter statistics
 */
export interface DeploymentOutput {
  /** The unique identifier of the stack */
  stackId: string;
  /** Action taken: created (new stack), exists (already complete), skipped (in-progress) */
  action: 'created' | 'exists' | 'skipped';
  /** Number of parameters successfully mapped and used */
  parametersUsed: number;
  /** Number of parameters skipped (no mapping or no value) */
  parametersSkipped: number;
}

/**
 * Logger interface for optional logging
 */
export interface Logger {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
  debug: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Orchestrates CloudFormation stack deployment with parameter mapping
 *
 * This function integrates the parameter mapping and stack deployment flows:
 * 1. Maps template parameters to lease details using the parameter-mapper
 * 2. Merges custom parameters from lease metadata if provided
 * 3. Logs parameter names being used (without exposing sensitive values)
 * 4. Handles templates with no parameters gracefully
 * 5. Deploys or updates the stack using the stack-manager
 * 6. Returns deployment result with parameter statistics
 *
 * The function is designed to be idempotent - it can be called multiple times
 * with the same inputs without causing errors or duplicate stacks.
 *
 * @param input - Deployment configuration including template, parameters, lease details, and credentials
 * @param logger - Optional logger for recording deployment progress
 * @returns Deployment result including stack ID, action taken, and parameter statistics
 * @throws {DeploymentOrchestrationError} If parameter mapping or deployment fails
 *
 * @example
 * ```typescript
 * const credentials = await assumeRole('123456789012');
 * const leaseDetails = await lookupLease('lease-12345');
 * const templateParameters = ['AccountId', 'LeaseId', 'Budget'];
 *
 * const result = await deployWithParameters({
 *   templateBody: JSON.stringify(cfnTemplate),
 *   templateParameters,
 *   leaseDetails,
 *   stackName: 'my-app-stack',
 *   credentials,
 *   customParameters: { Environment: 'production' }
 * });
 *
 * console.log(`Stack ${result.action}: ${result.stackId}`);
 * console.log(`Used ${result.parametersUsed} parameters, skipped ${result.parametersSkipped}`);
 * ```
 */
/* eslint-disable no-console */
export async function deployWithParameters(
  input: DeploymentInput,
  logger?: Logger
): Promise<DeploymentOutput> {
  const {
    templateBody,
    templateParameters,
    leaseDetails,
    stackName,
    credentials,
    customParameters,
  } = input;

  const log = logger || {
    info: (msg: string) => console.log(msg),
    warn: (msg: string) => console.warn(msg),
    error: (msg: string) => console.error(msg),
    debug: (msg: string) => console.debug(msg),
  };

  try {
    // Step 1: Map parameters from lease details
    log.info(`Mapping parameters for stack '${stackName}'`, {
      templateParameterCount: templateParameters.length,
      leaseId: leaseDetails.leaseId,
    });

    const mappedParameters = mapParameters(leaseDetails, templateParameters);

    // Step 2: Merge custom parameters if provided
    const customParameterArray = customParameters
      ? Object.entries(customParameters).map(([key, value]) => ({
          ParameterKey: key,
          ParameterValue: value,
        }))
      : [];

    // Combine mapped and custom parameters (custom parameters override mapped ones)
    const parameterMap = new Map(mappedParameters.map((p) => [p.ParameterKey, p.ParameterValue]));

    // Override with custom parameters
    customParameterArray.forEach((p) => {
      parameterMap.set(p.ParameterKey, p.ParameterValue);
    });

    // Convert back to array
    const finalParameters = Array.from(parameterMap.entries()).map(([key, value]) => ({
      ParameterKey: key,
      ParameterValue: value,
    }));

    // Step 3: Log parameter statistics (without exposing sensitive values)
    const parametersUsed = finalParameters.length;
    const parametersSkipped = templateParameters.length - mappedParameters.length;

    if (parametersUsed === 0) {
      log.info(`Stack '${stackName}' has no parameters to map - deploying without parameters`);
    } else {
      const parameterNames = finalParameters.map((p) => p.ParameterKey).join(', ');
      log.info(
        `Stack '${stackName}' deploying with ${parametersUsed} parameters: ${parameterNames}`,
        {
          parametersUsed,
          parametersSkipped,
          customParametersCount: customParameterArray.length,
        }
      );
    }

    if (parametersSkipped > 0) {
      log.debug(
        `Stack '${stackName}' skipped ${parametersSkipped} parameters (no mapping or no value)`
      );
    }

    // Step 4: Deploy or update the stack
    log.info(`Deploying stack '${stackName}'...`);

    const deployResult = await deployOrUpdateStack({
      stackName,
      templateBody,
      parameters: finalParameters.length > 0 ? finalParameters : undefined,
      credentials,
    });

    log.info(`Stack '${stackName}' deployment completed`, {
      stackId: deployResult.stackId,
      action: deployResult.action,
      status: deployResult.status,
    });

    // Step 5: Return deployment result with parameter statistics
    return {
      stackId: deployResult.stackId,
      action: deployResult.action,
      parametersUsed,
      parametersSkipped,
    };
  } catch (error) {
    // Wrap any errors in DeploymentOrchestrationError
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during deployment';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    log.error(`Failed to deploy stack '${stackName}': ${errorName} - ${errorMessage}`, {
      error: errorMessage,
      stackName,
      leaseId: leaseDetails.leaseId,
    });

    throw new DeploymentOrchestrationError(
      `Failed to deploy stack '${stackName}' for lease ${leaseDetails.leaseId}: ${errorName} - ${errorMessage}`,
      error
    );
  }
}
/* eslint-enable no-console */
