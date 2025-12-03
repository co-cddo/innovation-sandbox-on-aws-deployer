import { emitEvent } from './event-emitter.js';
import type { Logger } from './logger.js';

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
 * Emits a deployment success event to EventBridge
 *
 * This function emits a 'Deployment Succeeded' event with comprehensive
 * deployment details. It includes error handling to ensure that event
 * emission failures don't block the deployment workflow.
 *
 * Event structure:
 * - Source: Configured via EVENT_SOURCE env var (default: 'isb-deployer')
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
 *   stackId: 'arn:aws:cloudformation:eu-west-2:123456789012:stack/basic-vpc-lease-12345/guid',
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
      // eslint-disable-next-line no-console
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
