import { emitEvent } from './event-emitter.js';
import type { Logger } from './logger.js';

/**
 * Categories for deployment failures
 */
export type FailureCategory = 'validation' | 'permission' | 'resource' | 'network' | 'unknown';

/**
 * Detail payload for deployment success events
 */
export interface DeploymentSuccessDetail {
  /** Unique identifier for the lease */
  leaseId: string;
  /** AWS account ID where the deployment occurred */
  accountId: string;
  /** Name of the CloudFormation stack */
  stackName: string;
  /** ARN/ID of the CloudFormation stack */
  stackId: string;
  /** Name of the template that was deployed (optional) */
  templateName?: string;
  /** Action taken: created (new stack), exists (already complete), skipped (in-progress) */
  action: 'created' | 'exists' | 'skipped';
  /** ISO 8601 timestamp of when the event was emitted */
  timestamp: string;
}

/**
 * Detail payload for deployment failure events
 */
export interface DeploymentFailureDetail {
  /** Unique identifier for the lease */
  leaseId: string;
  /** AWS account ID where the deployment failed */
  accountId: string;
  /** Error message describing the failure */
  errorMessage: string;
  /** Error type/class if available */
  errorType?: string;
  /** Error code if available */
  errorCode?: string;
  /** Category of the failure for routing/handling */
  failureCategory: FailureCategory;
  /** Name of the CloudFormation stack (if known) */
  stackName?: string;
  /** Name of the template that failed to deploy (if known) */
  templateName?: string;
  /** ISO 8601 timestamp of when the event was emitted */
  timestamp: string;
}

/**
 * Emits a deployment success event to EventBridge
 *
 * This function emits a 'Deployment Succeeded' event with comprehensive
 * deployment details. It includes error handling to ensure that event
 * emission failures don't block the deployment workflow.
 *
 * Event structure:
 * - Source: Configured via EVENT_SOURCE env var (default: 'innovation-sandbox')
 * - DetailType: 'Deployment Succeeded'
 * - Detail: JSON payload with deployment information
 *
 * @param detail - Deployment success information
 * @param logger - Optional logger for observability
 * @returns Promise that resolves when event is emitted successfully
 *
 * @example
 * ```typescript
 * await emitDeploymentSuccess({
 *   leaseId: 'lease-12345',
 *   accountId: '123456789012',
 *   stackName: 'basic-vpc-lease-12345',
 *   stackId: 'arn:aws:cloudformation:us-west-2:123456789012:stack/basic-vpc-lease-12345/guid',
 *   templateName: 'basic-vpc',
 *   action: 'created',
 *   timestamp: new Date().toISOString()
 * }, logger);
 * ```
 */
export async function emitDeploymentSuccess(
  detail: DeploymentSuccessDetail,
  logger?: Logger
): Promise<void> {
  try {
    // Log the event emission attempt
    if (logger) {
      logger.info('Emitting deployment success event', {
        leaseId: detail.leaseId,
        accountId: detail.accountId,
        stackName: detail.stackName,
        action: detail.action,
        hasTemplateName: !!detail.templateName,
      });
    }

    // Emit the event to EventBridge
    await emitEvent('Deployment Succeeded', detail);

    // Log successful emission
    if (logger) {
      logger.info('Deployment success event emitted successfully', {
        leaseId: detail.leaseId,
        stackName: detail.stackName,
      });
    }
  } catch (error) {
    // Log error but don't fail the deployment
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (logger) {
      logger.error('Failed to emit deployment success event - continuing anyway', {
        error: errorMessage,
        leaseId: detail.leaseId,
        stackName: detail.stackName,
      });
    } else {
      // Fallback to console.error if no logger provided
       
      console.error(
        JSON.stringify({
          level: 'ERROR',
          message: 'Failed to emit deployment success event',
          error: errorMessage,
          leaseId: detail.leaseId,
          timestamp: new Date().toISOString(),
        })
      );
    }
    // Don't throw - event emission failures should not block the deployment workflow
  }
}

/**
 * Categorizes an error based on its type, code, and message
 *
 * This function maps AWS SDK errors and other common error patterns
 * to deployment failure categories for better event routing and handling.
 *
 * Categories:
 * - validation: Invalid template, parameter validation errors
 * - permission: AccessDenied, IAM-related errors
 * - resource: ResourceNotFound, limit exceeded, quota errors
 * - network: Timeout, connection errors
 * - unknown: Everything else
 *
 * @param error - The error object or error details
 * @returns The failure category
 *
 * @example
 * ```typescript
 * const category = categorizeError({
 *   errorType: 'ValidationError',
 *   errorCode: 'InvalidParameterValue',
 *   errorMessage: 'Template format error'
 * });
 * // Returns: 'validation'
 * ```
 */
export function categorizeError(error: {
  errorType?: string;
  errorCode?: string;
  errorMessage: string;
}): FailureCategory {
  const { errorType = '', errorCode = '', errorMessage = '' } = error;

  // Combine all error info for pattern matching (case-insensitive)
  const errorInfo = `${errorType} ${errorCode} ${errorMessage}`.toLowerCase();

  // Validation errors
  if (
    errorInfo.includes('validation') ||
    errorInfo.includes('invalid') ||
    errorInfo.includes('malformed') ||
    errorInfo.includes('template') ||
    errorCode === 'InvalidParameterValue' ||
    errorCode === 'ValidationError'
  ) {
    return 'validation';
  }

  // Permission errors
  if (
    errorInfo.includes('access') ||
    errorInfo.includes('denied') ||
    errorInfo.includes('unauthorized') ||
    errorInfo.includes('forbidden') ||
    errorInfo.includes('permission') ||
    errorCode === 'AccessDenied' ||
    errorCode === 'UnauthorizedOperation' ||
    errorCode === 'Forbidden'
  ) {
    return 'permission';
  }

  // Resource errors
  if (
    errorInfo.includes('notfound') ||
    errorInfo.includes('not found') ||
    errorInfo.includes('limit') ||
    errorInfo.includes('quota') ||
    errorInfo.includes('exceeded') ||
    errorInfo.includes('insufficient') ||
    errorCode === 'ResourceNotFoundException' ||
    errorCode === 'LimitExceeded' ||
    errorCode === 'QuotaExceeded'
  ) {
    return 'resource';
  }

  // Network errors
  if (
    errorInfo.includes('timeout') ||
    errorInfo.includes('timed out') ||
    errorInfo.includes('connection') ||
    errorInfo.includes('network') ||
    errorInfo.includes('unreachable') ||
    errorCode === 'RequestTimeout' ||
    errorCode === 'NetworkError'
  ) {
    return 'network';
  }

  // Default to unknown
  return 'unknown';
}

/**
 * Emits a deployment failure event to EventBridge
 *
 * This function emits a 'Deployment Failed' event with comprehensive
 * error and deployment details. It includes error handling to ensure that
 * event emission failures don't block error reporting in the deployment workflow.
 *
 * The function automatically adds a timestamp and categorizes the failure
 * for better event routing and handling downstream.
 *
 * Event structure:
 * - Source: Configured via EVENT_SOURCE env var (default: 'innovation-sandbox')
 * - DetailType: 'Deployment Failed'
 * - Detail: JSON payload with error and deployment information
 *
 * @param detail - Deployment failure information (timestamp will be added automatically)
 * @param logger - Optional logger for observability
 * @returns Promise that resolves when event is emitted successfully
 *
 * @example
 * ```typescript
 * await emitDeploymentFailure({
 *   leaseId: 'lease-12345',
 *   accountId: '123456789012',
 *   errorMessage: 'Template validation failed: Invalid resource type',
 *   errorType: 'ValidationError',
 *   errorCode: 'InvalidTemplate',
 *   failureCategory: 'validation',
 *   stackName: 'basic-vpc-lease-12345',
 *   templateName: 'basic-vpc'
 * }, logger);
 * ```
 */
export async function emitDeploymentFailure(
  detail: Omit<DeploymentFailureDetail, 'timestamp'>,
  logger?: Logger
): Promise<void> {
  try {
    // Add timestamp to the detail
    const completeDetail: DeploymentFailureDetail = {
      ...detail,
      timestamp: new Date().toISOString(),
    };

    // Log the event emission attempt
    if (logger) {
      logger.error('Emitting deployment failure event', {
        leaseId: detail.leaseId,
        accountId: detail.accountId,
        errorMessage: detail.errorMessage,
        errorType: detail.errorType,
        errorCode: detail.errorCode,
        failureCategory: detail.failureCategory,
        hasStackName: !!detail.stackName,
        hasTemplateName: !!detail.templateName,
      });
    }

    // Emit the event to EventBridge
    await emitEvent('Deployment Failed', completeDetail);

    // Log successful emission
    if (logger) {
      logger.info('Deployment failure event emitted successfully', {
        leaseId: detail.leaseId,
        failureCategory: detail.failureCategory,
      });
    }
  } catch (error) {
    // Log error but don't fail the deployment
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (logger) {
      logger.error('Failed to emit deployment failure event - continuing anyway', {
        error: errorMessage,
        leaseId: detail.leaseId,
        originalError: detail.errorMessage,
      });
    } else {
      // Fallback to console.error if no logger provided
       
      console.error(
        JSON.stringify({
          level: 'ERROR',
          message: 'Failed to emit deployment failure event',
          error: errorMessage,
          leaseId: detail.leaseId,
          timestamp: new Date().toISOString(),
        })
      );
    }
    // Don't throw - event emission failures should not block error reporting
  }
}
