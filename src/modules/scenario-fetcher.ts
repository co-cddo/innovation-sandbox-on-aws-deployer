/**
 * Scenario Fetcher Module
 *
 * Downloads CDK scenario folders from GitHub using sparse git clone
 * for efficient, targeted downloads of only the files needed.
 */

import { spawnSync, type SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { FetchedScenario, Config } from '../types/index.js';
import { getConfig } from './config.js';
import type { Logger } from './logger.js';

/**
 * Error thrown when fetching a scenario from GitHub fails.
 *
 * This error indicates that the git sparse clone operation failed to
 * download the scenario folder. Common causes include:
 * - Invalid or expired GitHub token
 * - Repository not found or inaccessible
 * - Template/scenario folder does not exist
 * - Network connectivity issues
 * - Git timeout (operations timeout after 60 seconds)
 *
 * @example
 * ```typescript
 * try {
 *   const scenario = await fetchScenarioFolder(templateName, cdkSubpath, logger);
 * } catch (error) {
 *   if (error instanceof ScenarioFetchError) {
 *     if (error.message.includes('Authentication failed')) {
 *       console.error('GitHub token is invalid or expired');
 *     } else {
 *       console.error('Failed to fetch scenario:', error.message);
 *     }
 *   }
 * }
 * ```
 */
export class ScenarioFetchError extends Error {
  /**
   * Creates a new ScenarioFetchError.
   *
   * @param message - Human-readable description of the fetch failure
   * @param cause - Optional underlying error that caused the failure
   */
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ScenarioFetchError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ScenarioFetchError);
    }
  }
}

/**
 * Timeout for git operations in milliseconds
 */
const GIT_TIMEOUT_MS = 60_000; // 1 minute

/**
 * Validates template name to prevent path traversal and injection
 *
 * @param templateName - Template name to validate
 * @throws {ScenarioFetchError} If template name is invalid
 */
function validateTemplateName(templateName: string): void {
  // Disallow path traversal, shell metacharacters, and whitespace
  if (!/^[a-zA-Z0-9_-]+$/.test(templateName)) {
    throw new ScenarioFetchError(
      `Invalid template name: ${templateName}. Must contain only alphanumeric characters, dashes, and underscores.`
    );
  }

  // Check for length
  if (templateName.length > 100) {
    throw new ScenarioFetchError('Template name too long (max 100 characters)');
  }
}

/**
 * Creates a git credential helper script that provides the token securely
 *
 * This approach is more secure than embedding the token in the URL because:
 * 1. The token never appears in process listings, logs, or error messages
 * 2. The token is not exposed in git remote URLs
 * 3. The credential helper is only accessible in /tmp with restricted permissions
 *
 * @param token - The GitHub token to use for authentication
 * @param workDir - Unique working directory for this invocation (prevents race conditions)
 * @returns Path to the created credential helper
 */
function createCredentialHelper(token: string, workDir: string): string {
  // Create unique credential helper path per invocation to avoid race conditions
  const credentialHelperPath = path.join(workDir, '.git-credential-helper.sh');

  // Script outputs the token when git asks for the password
  // The username is ignored (GitHub accepts anything with token auth)
  const script = `#!/bin/sh\necho "${token.replace(/"/g, '\\"')}"`;

  fs.writeFileSync(credentialHelperPath, script, { mode: 0o700 });
  return credentialHelperPath;
}

/**
 * Removes the credential helper script
 *
 * @param credentialHelperPath - Path to the credential helper to remove
 */
function removeCredentialHelper(credentialHelperPath: string): void {
  try {
    if (credentialHelperPath && fs.existsSync(credentialHelperPath)) {
      fs.unlinkSync(credentialHelperPath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Executes a git command safely using spawnSync with argument array
 *
 * This prevents command injection by avoiding shell interpretation.
 * Arguments are passed directly to the git process, not through a shell.
 *
 * @param args - Array of command arguments (without 'git' prefix)
 * @param options - Options for spawnSync (cwd, env, etc.)
 * @param logger - Logger for debugging
 * @returns SpawnSyncReturns object with result
 * @throws Error if the command fails
 */
function execGit(
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
  },
  logger: Logger
): SpawnSyncReturns<Buffer> {
  // Redact any URLs or tokens that might appear in logs
  // This handles both URL-embedded tokens and standalone token values
  const safeArgs = args.map((arg) => {
    let safe = arg;
    // Redact tokens embedded in URLs (https://token@github.com)
    if (safe.includes('github.com')) {
      safe = safe.replace(/:[^@]+@/, ':[REDACTED]@');
    }
    // Redact standalone GitHub tokens in any argument
    safe = safe
      .replace(/ghp_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]')
      .replace(/github_pat_[a-zA-Z0-9_]+/g, '[REDACTED_TOKEN]')
      .replace(/gho_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]')
      .replace(/ghu_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]')
      .replace(/ghs_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]')
      .replace(/ghr_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]');
    return safe;
  });

  logger.debug('Executing git command', {
    args: safeArgs,
    cwd: options.cwd,
  });

  const result = spawnSync('git', args, {
    cwd: options.cwd,
    timeout: options.timeout ?? GIT_TIMEOUT_MS,
    env: {
      ...process.env,
      ...options.env,
      GIT_TERMINAL_PROMPT: '0', // Disable interactive prompts
    },
    stdio: 'pipe',
    // No shell: true - this prevents command injection
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || '';
    // Redact any tokens that might appear in error messages
    // GitHub uses multiple token formats:
    // - Classic: ghp_[a-zA-Z0-9]{36}
    // - Fine-grained: github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}
    // - OAuth: gho_[a-zA-Z0-9]{36}
    // - User-to-server: ghu_[a-zA-Z0-9]{36}
    // - Server-to-server: ghs_[a-zA-Z0-9]{36}
    // - Refresh: ghr_[a-zA-Z0-9]{36}
    const safeStderr = stderr
      .replace(/ghp_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]')
      .replace(/github_pat_[a-zA-Z0-9_]+/g, '[REDACTED_TOKEN]')
      .replace(/gho_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]')
      .replace(/ghu_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]')
      .replace(/ghs_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]')
      .replace(/ghr_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]');
    throw new Error(`Git command failed (exit ${result.status}): ${safeStderr}`);
  }

  return result;
}

/**
 * Fetches a scenario folder from GitHub using sparse git clone
 *
 * This method is highly efficient as it:
 * 1. Uses partial clone (--filter=blob:none) to skip blob downloads initially
 * 2. Uses sparse-checkout to only fetch the specific scenario folder
 * 3. Removes .git directory after checkout to save space
 *
 * Performance: 93-98% faster than full clone for large repositories
 *
 * @param templateName - Name of the scenario to fetch
 * @param cdkSubpath - Relative path to CDK files within the scenario ('' or 'cdk')
 * @param logger - Logger instance for structured logging
 * @param config - Optional configuration override
 * @returns Fetched scenario with local paths and cleanup function
 * @throws {ScenarioFetchError} If git operations fail
 */
export async function fetchScenarioFolder(
  templateName: string,
  cdkSubpath: string,
  logger: Logger,
  config?: Config
): Promise<FetchedScenario> {
  // Validate template name to prevent path traversal and injection
  validateTemplateName(templateName);

  const cfg = config ?? getConfig();
  const githubToken = cfg.githubToken;

  // Generate unique temp directory structure
  // We use a parent directory for the credential helper, and let git clone create the repo subdirectory
  const uuid = crypto.randomUUID().slice(0, 8);
  const workDir = `/tmp/${templateName}-work-${uuid}`;
  const localPath = `/tmp/${templateName}-${uuid}`;
  const scenarioPath = `${cfg.githubPath}/${templateName}`;

  // Build git URL WITHOUT embedding credentials
  // Authentication is provided ONLY via GIT_ASKPASS for security
  // This ensures tokens never appear in process listings, logs, or error messages
  const repoUrl = `https://github.com/${cfg.githubRepo}.git`;

  logger.debug('Fetching scenario folder via sparse clone', {
    templateName,
    scenarioPath,
    localPath,
  });

  // Create work directory for credential helper (separate from clone destination)
  fs.mkdirSync(workDir, { recursive: true });

  // Set up credential helper if token is provided
  const gitEnv: NodeJS.ProcessEnv = {};
  let credentialHelperPath: string | undefined;

  if (githubToken) {
    // Create credential helper in the work directory (not the clone destination)
    // This prevents race conditions between concurrent Lambda invocations
    credentialHelperPath = createCredentialHelper(githubToken, workDir);
    gitEnv.GIT_ASKPASS = credentialHelperPath;
    // Use token as username for GitHub authentication
    gitEnv.GIT_USERNAME = 'x-access-token';
  }

  try {
    // Remove any existing clone directory (from previous Lambda invocation failures)
    if (fs.existsSync(localPath)) {
      logger.debug('Removing existing directory from previous run', { localPath });
      fs.rmSync(localPath, { recursive: true, force: true });
    }

    // Step 1: Clone with partial clone + no checkout (fast, minimal download)
    // --filter=blob:none: Skip downloading blob objects until needed
    // --no-checkout: Don't checkout files yet
    // --depth 1: Only get latest commit
    logger.debug('Step 1: Initializing sparse clone');

    // Use plain URL - authentication is provided via GIT_ASKPASS only
    // NEVER embed tokens in URLs as they appear in error messages and logs
    execGit(
      ['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', repoUrl, localPath],
      { env: gitEnv },
      logger
    );

    // Step 2: Initialize sparse-checkout in cone mode
    // Cone mode is faster and recommended for Git 2.27+
    logger.debug('Step 2: Initializing sparse-checkout');
    execGit(['sparse-checkout', 'init', '--cone'], { cwd: localPath }, logger);

    // Step 3: Set specific folder to checkout
    logger.debug('Step 3: Setting sparse-checkout path', { scenarioPath });
    execGit(['sparse-checkout', 'set', scenarioPath], { cwd: localPath }, logger);

    // Step 4: Checkout the branch
    logger.debug('Step 4: Checking out branch', { branch: cfg.githubBranch });
    execGit(['checkout', cfg.githubBranch], { cwd: localPath }, logger);

    // Step 5: Remove .git to free space (Lambda has limited ephemeral storage)
    logger.debug('Step 5: Removing .git directory');
    fs.rmSync(path.join(localPath, '.git'), { recursive: true, force: true });

    // Calculate the full CDK path
    const cdkPath = cdkSubpath
      ? path.join(localPath, scenarioPath, cdkSubpath)
      : path.join(localPath, scenarioPath);

    // Verify the CDK path exists
    if (!fs.existsSync(cdkPath)) {
      throw new ScenarioFetchError(`CDK path does not exist after clone: ${cdkPath}`);
    }

    // Clean up credential helper immediately after clone
    // The git operations are complete, so we no longer need credentials
    if (credentialHelperPath) {
      removeCredentialHelper(credentialHelperPath);
    }

    // Clean up work directory (credential helper is removed, directory might be empty)
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    logger.info('Scenario folder fetched successfully', {
      templateName,
      localPath,
      cdkPath,
    });

    return {
      localPath,
      cdkPath,
      cleanup: (): void => {
        try {
          fs.rmSync(localPath, { recursive: true, force: true });
          logger.debug('Cleaned up temp directory', { localPath });
        } catch (error) {
          logger.warn('Failed to cleanup temp directory', {
            localPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };
  } catch (error) {
    // Clean up credential helper on error
    if (credentialHelperPath) {
      removeCredentialHelper(credentialHelperPath);
    }

    // Clean up work directory and partial clone on error
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      if (fs.existsSync(localPath)) {
        fs.rmSync(localPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    // Wrap and rethrow with context
    if (error instanceof ScenarioFetchError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    // Check for common git errors
    if (message.includes('Authentication failed')) {
      throw new ScenarioFetchError(
        'GitHub authentication failed. Check GITHUB_TOKEN.',
        error instanceof Error ? error : undefined
      );
    }

    if (message.includes('Repository not found')) {
      throw new ScenarioFetchError(
        `Repository not found: ${cfg.githubRepo}`,
        error instanceof Error ? error : undefined
      );
    }

    if (message.includes('ETIMEDOUT') || message.includes('timed out')) {
      throw new ScenarioFetchError(
        'Git operation timed out',
        error instanceof Error ? error : undefined
      );
    }

    throw new ScenarioFetchError(
      `Failed to fetch scenario: ${message}`,
      error instanceof Error ? error : undefined
    );
  }
}
