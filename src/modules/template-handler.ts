/**
 * Template Handler Module
 *
 * Handles template availability checking and graceful handling of missing templates.
 * Missing templates are expected behavior (users without scenarios get empty accounts)
 * and are NOT treated as errors.
 */

import { fetchTemplate, TemplateFetchError } from './template-fetcher.js';
import { buildTemplateUrl } from './github-url.js';
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
}

/**
 * Handles template retrieval with graceful handling for missing templates
 *
 * This function checks if a template name is provided and attempts to fetch it.
 * Missing templates (undefined templateName or 404 from GitHub) are treated as
 * expected behavior, not errors. This allows users without scenarios to get
 * empty accounts (existing ISB behavior).
 *
 * @param templateName - Optional template name from the lease event
 * @param leaseId - Lease ID for logging correlation
 * @param logger - Logger instance for structured logging
 * @returns Promise resolving to a result indicating whether to skip deployment
 *
 * @example
 * ```typescript
 * const result = await handleTemplate(templateName, leaseId, logger);
 * if (result.skip) {
 *   logger.info('Skipping deployment', { reason: result.reason });
 *   return;
 * }
 * // Proceed with deployment using result.template
 * ```
 */
export async function handleTemplate(
  templateName: string | undefined,
  leaseId: string,
  logger: Logger
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

  // Template name is provided, attempt to fetch it
  try {
    const url = buildTemplateUrl(templateName);
    logger.debug('Fetching template from GitHub', {
      event: 'FETCH',
      leaseId,
      templateName,
      url,
    });

    const template = await fetchTemplate(url);

    logger.info('Template fetched successfully', {
      event: 'FETCH',
      leaseId,
      templateName,
      templateSize: template.length,
    });

    return {
      skip: false,
      template,
    };
  } catch (error) {
    // Handle 404 as graceful no-op (expected behavior)
    if (error instanceof TemplateFetchError && error.statusCode === 404) {
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

    // Other errors (network issues, timeouts, 500s, etc.) should be re-thrown
    // These are actual errors that should be handled by the caller
    logger.error('Error fetching template', {
      event: 'FETCH',
      leaseId,
      templateName,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof TemplateFetchError ? 'TemplateFetchError' : 'UnknownError',
      statusCode: error instanceof TemplateFetchError ? error.statusCode : undefined,
    });

    throw error;
  }
}
