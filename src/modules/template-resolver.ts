/**
 * Template Resolver Module
 *
 * Orchestrates the detection, fetching, and synthesis/fetching flow for templates.
 * Provides a unified interface for both CDK and CloudFormation scenarios.
 */

import type { ResolvedTemplate, Config, TemplateRef } from '../types/index.js';
import type { Logger } from './logger.js';
import { detectScenarioType, GitHubApiError } from './scenario-detector.js';
import { fetchScenarioFolder, ScenarioFetchError } from './scenario-fetcher.js';
import { synthesizeCdk, CdkSynthesisError } from './cdk-synthesizer.js';
import { fetchTemplate, TemplateFetchError } from './template-fetcher.js';
import { buildTemplateUrl } from './github-url.js';
import { getConfig } from './config.js';
import {
  parseTemplateRef,
  resolveEffectiveBranch,
  TemplateRefParseError,
} from './template-ref-parser.js';

/**
 * Error thrown when template resolution fails.
 *
 * This error wraps failures during the template detection, fetch, or synthesis
 * pipeline. It preserves the underlying error (GitHubApiError, ScenarioFetchError,
 * CdkSynthesisError, or TemplateFetchError) in the cause property.
 *
 * @example
 * ```typescript
 * try {
 *   const template = await resolveTemplate(templateName, logger);
 * } catch (error) {
 *   if (error instanceof TemplateResolutionError) {
 *     console.error('Resolution failed:', error.message);
 *     if (error.cause instanceof CdkSynthesisError) {
 *       console.error('CDK synthesis stderr:', error.cause.stderr);
 *     }
 *   }
 * }
 * ```
 */
export class TemplateResolutionError extends Error {
  /**
   * Creates a new TemplateResolutionError.
   *
   * @param message - Human-readable description of the resolution failure
   * @param cause - Underlying error that caused the failure
   */
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'TemplateResolutionError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TemplateResolutionError);
    }
  }
}

/**
 * Resolves a template by detecting the scenario type and fetching/synthesizing as needed
 *
 * Supports template references with optional branch override using @ syntax:
 * - "template-name" - Uses default branch from config.githubBranch
 * - "template-name@branch" - Uses specified branch override
 *
 * Flow:
 * 1. Parse template reference (extract name and optional branch)
 * 2. Detect scenario type (cdk, cdk-subfolder, or cloudformation)
 * 3. For CloudFormation: fetch the template.yaml directly
 * 4. For CDK: fetch the scenario folder, synthesize, and return the generated template
 *
 * @param templateName - Name of the template/scenario, optionally with @branch suffix
 * @param logger - Logger instance for structured logging
 * @param targetAccountId - Optional target AWS account for CDK synthesis
 * @param targetRegion - Optional target AWS region for CDK synthesis
 * @param config - Optional configuration override
 * @returns Resolved template with source information, or null if not found
 * @throws {TemplateResolutionError} For fatal errors during resolution
 *
 * @example
 * // Without branch override (uses default GITHUB_BRANCH)
 * await resolveTemplate('localgov-drupal', logger);
 *
 * // With branch override
 * await resolveTemplate('localgov-drupal@feature-branch', logger);
 * await resolveTemplate('localgov-drupal@v2.0', logger);
 */
export async function resolveTemplate(
  templateName: string,
  logger: Logger,
  targetAccountId?: string,
  targetRegion?: string,
  config?: Config
): Promise<ResolvedTemplate | null> {
  const cfg = config ?? getConfig();

  // Parse template reference (may include @branch suffix)
  let templateRef: TemplateRef;
  try {
    templateRef = parseTemplateRef(templateName);
  } catch (error) {
    if (error instanceof TemplateRefParseError) {
      throw new TemplateResolutionError(error.message);
    }
    throw error;
  }

  // Resolve the effective branch (use override or default from config)
  const effectiveBranch = resolveEffectiveBranch(templateRef, cfg.githubBranch);

  // Create a config override with the effective branch
  const configWithBranch: Config = {
    ...cfg,
    githubBranch: effectiveBranch,
  };

  logger.info('Resolving template', {
    templateName: templateRef.name,
    branch: effectiveBranch,
    branchOverride: templateRef.branch !== undefined,
  });

  try {
    // Step 1: Detect scenario type (using pure template name, not full ref)
    const detection = await detectScenarioType(templateRef.name, configWithBranch);

    logger.info('Scenario type detected', {
      templateName: templateRef.name,
      branch: effectiveBranch,
      type: detection.type,
      cdkPath: detection.cdkPath,
    });

    // Step 2: Handle based on type
    if (detection.type === 'cloudformation') {
      return await resolveCloudFormationTemplate(templateRef.name, logger, configWithBranch);
    }

    // CDK path (either 'cdk' or 'cdk-subfolder')
    return await resolveCdkTemplate(
      templateRef.name,
      detection.cdkPath ?? '',
      logger,
      targetAccountId,
      targetRegion,
      configWithBranch
    );
  } catch (error) {
    // Handle 404 as not found (graceful handling)
    if (error instanceof GitHubApiError && error.statusCode === 404) {
      logger.info('Template not found in repository', {
        templateName: templateRef.name,
        branch: effectiveBranch,
      });
      return null;
    }

    // Handle template fetch 404 as not found
    if (error instanceof TemplateFetchError && error.statusCode === 404) {
      logger.info('CloudFormation template file not found', {
        templateName: templateRef.name,
        branch: effectiveBranch,
      });
      return null;
    }

    // Wrap and rethrow other errors
    if (error instanceof TemplateResolutionError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new TemplateResolutionError(
      `Failed to resolve template '${templateRef.name}@${effectiveBranch}': ${message}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Resolves a CloudFormation template by fetching it directly
 */
async function resolveCloudFormationTemplate(
  templateName: string,
  logger: Logger,
  config: Config
): Promise<ResolvedTemplate> {
  const url = buildTemplateUrl(templateName, config);

  logger.debug('Fetching CloudFormation template', { templateName, url });

  const templateBody = await fetchTemplate(url);

  logger.info('CloudFormation template fetched', {
    templateName,
    templateSize: templateBody.length,
  });

  return {
    templateBody,
    source: 'cloudformation',
    synthesized: false,
  };
}

/**
 * Resolves a CDK template by fetching the scenario and synthesizing it
 */
async function resolveCdkTemplate(
  templateName: string,
  cdkSubpath: string,
  logger: Logger,
  targetAccountId?: string,
  targetRegion?: string,
  config?: Config
): Promise<ResolvedTemplate> {
  const cfg = config ?? getConfig();

  logger.info('Fetching CDK scenario', { templateName, cdkSubpath });

  // Fetch the scenario folder
  const scenario = await fetchScenarioFolder(templateName, cdkSubpath, logger, cfg);

  try {
    // Synthesize the CDK project
    logger.info('Synthesizing CDK project', { cdkPath: scenario.cdkPath });

    const result = await synthesizeCdk(scenario.cdkPath, logger, targetAccountId, targetRegion);

    logger.info('CDK synthesis complete', {
      templateName,
      stackName: result.stackName,
      templateSize: result.templateBody.length,
    });

    return {
      templateBody: result.templateBody,
      source: 'cdk',
      synthesized: true,
    };
  } finally {
    // Always cleanup the temp directory
    scenario.cleanup();
  }
}

// Re-export errors for convenience
export {
  GitHubApiError,
  ScenarioFetchError,
  CdkSynthesisError,
  TemplateFetchError,
  TemplateRefParseError,
};
