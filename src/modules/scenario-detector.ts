/**
 * Scenario Detector Module
 *
 * Determines if a scenario is CDK or CloudFormation by querying the GitHub API
 * to check for the presence of cdk.json files.
 */

import type { ScenarioDetectionResult, Config } from '../types/index.js';
import { getConfig } from './config.js';

/**
 * Error thrown when GitHub API rate limits are exceeded.
 *
 * GitHub API has rate limits (60 requests/hour unauthenticated, 5000/hour authenticated).
 * When exceeded, this error is thrown with the reset time indicating when requests
 * can resume.
 *
 * @example
 * ```typescript
 * try {
 *   const result = await detectScenarioType(templateName);
 * } catch (error) {
 *   if (error instanceof GitHubRateLimitError && error.resetTime) {
 *     const waitTime = error.resetTime.getTime() - Date.now();
 *     console.error(`Rate limited. Retry after ${waitTime}ms`);
 *   }
 * }
 * ```
 */
export class GitHubRateLimitError extends Error {
  /**
   * Creates a new GitHubRateLimitError.
   *
   * @param message - Human-readable rate limit message
   * @param resetTime - When the rate limit resets (from X-RateLimit-Reset header)
   */
  constructor(
    message: string,
    public readonly resetTime?: Date
  ) {
    super(message);
    this.name = 'GitHubRateLimitError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GitHubRateLimitError);
    }
  }
}

/**
 * Error thrown when GitHub API requests fail.
 *
 * This error wraps non-rate-limit GitHub API failures including:
 * - 404: Repository or path not found
 * - 401/403: Authentication failures
 * - 500+: GitHub server errors
 *
 * @example
 * ```typescript
 * try {
 *   const result = await detectScenarioType(templateName);
 * } catch (error) {
 *   if (error instanceof GitHubApiError) {
 *     if (error.statusCode === 404) {
 *       console.error('Template not found in repository');
 *     } else {
 *       console.error('GitHub API error:', error.message);
 *     }
 *   }
 * }
 * ```
 */
export class GitHubApiError extends Error {
  /**
   * Creates a new GitHubApiError.
   *
   * @param message - Human-readable error description
   * @param statusCode - HTTP status code from GitHub API response
   */
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'GitHubApiError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GitHubApiError);
    }
  }
}

/**
 * GitHub Contents API response item
 */
interface GitHubContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

/**
 * Validates a git branch name to prevent injection attacks
 *
 * Git branch names have specific allowed characters. This validation prevents
 * injection of shell metacharacters, path traversal, and other malicious input.
 *
 * @param branch - Branch name to validate
 * @throws {GitHubApiError} If branch name is invalid
 */
function validateBranchName(branch: string): void {
  // Git branch naming rules:
  // - Cannot start with dot, slash, or dash
  // - Cannot contain: space, ~, ^, :, ?, *, [, \, control chars
  // - Cannot end with .lock
  // - Cannot contain consecutive dots (..)
  const SAFE_BRANCH_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

  if (!branch || branch.length === 0) {
    throw new GitHubApiError('Branch name cannot be empty', 400);
  }

  if (branch.length > 256) {
    throw new GitHubApiError('Branch name too long (max 256 characters)', 400);
  }

  if (!SAFE_BRANCH_REGEX.test(branch)) {
    throw new GitHubApiError(
      `Invalid branch name: ${branch}. Must contain only alphanumeric characters, dots, dashes, underscores, and slashes.`,
      400
    );
  }

  // Additional checks for dangerous patterns
  if (branch.includes('..') || branch.includes('//')) {
    throw new GitHubApiError(
      `Invalid branch name: ${branch}. Cannot contain consecutive dots or slashes.`,
      400
    );
  }

  if (branch.endsWith('.lock')) {
    throw new GitHubApiError(`Invalid branch name: ${branch}. Cannot end with .lock.`, 400);
  }
}

/**
 * Detects the scenario type by checking for cdk.json presence in the repository
 *
 * Detection logic:
 * 1. Query GitHub Contents API for the scenario folder
 * 2. Check for cdk.json file at root → 'cdk' type
 * 3. Check for cdk directory → 'cdk-subfolder' type (check cdk/cdk.json exists)
 * 4. Otherwise → 'cloudformation' type
 *
 * @param templateName - Name of the template/scenario to detect
 * @param config - Optional configuration override
 * @returns Detection result with scenario type and CDK path if applicable
 * @throws {GitHubRateLimitError} If rate limited by GitHub API
 * @throws {GitHubApiError} For other GitHub API failures
 */
export async function detectScenarioType(
  templateName: string,
  config?: Config
): Promise<ScenarioDetectionResult> {
  const cfg = config ?? getConfig();
  const githubToken = cfg.githubToken;

  // Validate branch name to prevent injection attacks
  validateBranchName(cfg.githubBranch);

  // Build the API URL for the scenario folder
  const apiUrl = `https://api.github.com/repos/${cfg.githubRepo}/contents/${cfg.githubPath}/${encodeURIComponent(templateName)}?ref=${cfg.githubBranch}`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'isb-deployer',
  };

  // Add auth token if available (required for rate limits and private repos)
  if (githubToken) {
    headers.Authorization = `token ${githubToken}`;
  }

  const response = await fetch(apiUrl, { headers });

  // Handle rate limiting
  if (response.status === 403) {
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    const rateLimitReset = response.headers.get('x-ratelimit-reset');

    if (rateLimitRemaining === '0') {
      const resetDate = rateLimitReset ? new Date(parseInt(rateLimitReset, 10) * 1000) : undefined;
      throw new GitHubRateLimitError(
        `GitHub API rate limit exceeded. Resets at ${resetDate?.toISOString() ?? 'unknown'}`,
        resetDate
      );
    }
    throw new GitHubApiError(`GitHub API forbidden: ${response.statusText}`, 403);
  }

  // Handle not found - scenario doesn't exist
  if (response.status === 404) {
    throw new GitHubApiError(`Scenario '${templateName}' not found in repository`, 404);
  }

  // Handle other errors
  if (!response.ok) {
    throw new GitHubApiError(
      `GitHub API error: ${response.status} ${response.statusText}`,
      response.status
    );
  }

  // Parse response
  const contents = (await response.json()) as GitHubContentItem[];

  // Check for cdk.json at root level (direct CDK project)
  const hasCdkJsonAtRoot = contents.some(
    (item) => item.type === 'file' && item.name === 'cdk.json'
  );

  if (hasCdkJsonAtRoot) {
    return {
      type: 'cdk',
      cdkPath: '',
    };
  }

  // Check for cdk subdirectory
  const hasCdkDir = contents.some((item) => item.type === 'dir' && item.name === 'cdk');

  if (hasCdkDir) {
    // Verify cdk.json exists in the subdirectory
    const cdkDirUrl = `https://api.github.com/repos/${cfg.githubRepo}/contents/${cfg.githubPath}/${encodeURIComponent(templateName)}/cdk?ref=${cfg.githubBranch}`;

    const cdkDirResponse = await fetch(cdkDirUrl, { headers });

    if (cdkDirResponse.ok) {
      const cdkContents = (await cdkDirResponse.json()) as GitHubContentItem[];
      const hasCdkJsonInSubdir = cdkContents.some(
        (item) => item.type === 'file' && item.name === 'cdk.json'
      );

      if (hasCdkJsonInSubdir) {
        return {
          type: 'cdk-subfolder',
          cdkPath: 'cdk',
        };
      }
    }
  }

  // Default to CloudFormation
  return {
    type: 'cloudformation',
  };
}
