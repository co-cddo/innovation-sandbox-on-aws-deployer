/**
 * Template Handler Module
 *
 * Handles template availability checking and graceful handling of missing templates.
 * Supports both CloudFormation templates and CDK scenarios.
 * Missing templates are expected behavior (users without scenarios get empty accounts)
 * and are NOT treated as errors.
 */

import {
  resolveTemplate,
  TemplateResolutionError,
  GitHubApiError,
  CdkSynthesisError,
} from './template-resolver.js';
import { getConfigAsync } from './config.js';
import type { Logger } from './logger.js';

/**
 * Result of template handling operation
 */
export interface TemplateHandleResult {
  /** Whether to skip deployment (true if no template available) */
  skip: boolean;
  /** Template content if available */
  template?: string;
  /** Reason for skipping (for logging/observability) */
  reason?: string;
  /** Source of the template: 'cdk' or 'cloudformation' */
  source?: 'cdk' | 'cloudformation';
  /** Whether the template was synthesized (CDK only) */
  synthesized?: boolean;
}

/**
 * Handles template retrieval with graceful handling for missing templates
 *
 * This function checks if a template name is provided and attempts to resolve it.
 * It automatically detects whether the scenario is CDK or CloudFormation and handles
 * each appropriately:
 * - CloudFormation: Fetches the template.yaml directly
 * - CDK: Fetches the scenario folder, runs synthesis, and returns the generated template
 *
 * Missing templates (undefined templateName or 404 from GitHub) are treated as
 * expected behavior, not errors. This allows users without scenarios to get
 * empty accounts (existing ISB behavior).
 *
 * @param templateName - Optional template name from the lease event
 * @param leaseId - Lease ID for logging correlation
 * @param logger - Logger instance for structured logging
 * @param targetAccountId - Optional target AWS account for CDK synthesis context
 * @param targetRegion - Optional target AWS region for CDK synthesis context
 * @returns Promise resolving to a result indicating whether to skip deployment
 *
 * @example
 * ```typescript
 * const result = await handleTemplate(templateName, leaseId, logger, accountId);
 * if (result.skip) {
 *   logger.info('Skipping deployment', { reason: result.reason });
 *   return;
 * }
 * // Proceed with deployment using result.template
 * console.log(`Template from: ${result.source}, synthesized: ${result.synthesized}`);
 * ```
 */
export async function handleTemplate(
  templateName: string | undefined,
  leaseId: string,
  logger: Logger,
  targetAccountId?: string,
  targetRegion?: string
): Promise<TemplateHandleResult> {
  // Set logging context
  logger.setContext({ correlationId: leaseId });

  // Check if templateName is provided
  if (!templateName || templateName.trim() === '') {
    logger.info('No template configured for lease, skipping deployment', {
      event: 'FETCH',
      leaseId,
      templateName: templateName === undefined ? 'undefined' : templateName,
    });

    return {
      skip: true,
      reason: 'No template configured',
    };
  }

  // Template name is provided, attempt to resolve it
  try {
    logger.debug('Resolving template', {
      event: 'FETCH',
      leaseId,
      templateName,
    });

    // Get config with GitHub token
    const config = await getConfigAsync();

    // Resolve the template (handles both CDK and CloudFormation)
    const resolved = await resolveTemplate(
      templateName,
      logger,
      targetAccountId,
      targetRegion,
      config
    );

    // Handle not found
    if (!resolved) {
      logger.info('Template not found in repository, skipping deployment', {
        event: 'FETCH',
        leaseId,
        templateName,
        reason: 'Template does not exist',
      });

      return {
        skip: true,
        reason: 'Template not found (404)',
      };
    }

    logger.info('Template resolved successfully', {
      event: 'FETCH',
      leaseId,
      templateName,
      templateSize: resolved.templateBody.length,
      source: resolved.source,
      synthesized: resolved.synthesized,
    });

    return {
      skip: false,
      template: resolved.templateBody,
      source: resolved.source,
      synthesized: resolved.synthesized,
    };
  } catch (error) {
    // Handle GitHub rate limiting specially
    if (error instanceof GitHubApiError && error.message.includes('rate limit')) {
      logger.error('GitHub rate limit exceeded', {
        event: 'FETCH',
        leaseId,
        templateName,
        error: error.message,
      });
      throw error;
    }

    // Handle CDK synthesis errors
    if (error instanceof CdkSynthesisError) {
      logger.error('CDK synthesis failed', {
        event: 'FETCH',
        leaseId,
        templateName,
        error: error.message,
        stderr: error.stderr,
      });
      throw error;
    }

    // Handle other resolution errors - preserve full error chain
    if (error instanceof TemplateResolutionError) {
      logger.error('Template resolution failed', {
        event: 'FETCH',
        leaseId,
        templateName,
        error: error.message,
        // Preserve cause chain for debugging
        cause: error.cause?.message,
        causeType: error.cause?.name,
      });
      throw error;
    }

    // Log and re-throw unexpected errors with full context
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error('Unexpected error resolving template', {
      event: 'FETCH',
      leaseId,
      templateName,
      error: errorObj.message,
      errorType: errorObj.name,
      // Include stack trace for debugging
      stack: errorObj.stack?.split('\n').slice(0, 5).join('\n'),
    });

    throw error;
  }
}
