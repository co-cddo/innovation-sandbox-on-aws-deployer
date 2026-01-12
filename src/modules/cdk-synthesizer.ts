/**
 * CDK Synthesizer Module
 *
 * Synthesizes CDK projects to CloudFormation templates.
 * Installs the correct CDK version at runtime based on the project's package.json.
 */

import { spawnSync, type SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { SynthesisResult } from '../types/index.js';
import type { Logger } from './logger.js';

/**
 * Error thrown when CDK synthesis fails.
 *
 * This error indicates that the `cdk synth` command failed to produce
 * a CloudFormation template. Common causes include:
 * - Invalid CDK code or constructs
 * - Missing context values (e.g., availability zones)
 * - Incompatible CDK version
 * - Multiple stacks in a single app (not supported)
 *
 * @example
 * ```typescript
 * try {
 *   await synthesizeCdk(cdkPath, logger);
 * } catch (error) {
 *   if (error instanceof CdkSynthesisError) {
 *     console.error('Synthesis failed:', error.message);
 *     if (error.stderr) {
 *       console.error('CDK output:', error.stderr);
 *     }
 *   }
 * }
 * ```
 */
export class CdkSynthesisError extends Error {
  /**
   * Creates a new CdkSynthesisError.
   *
   * @param message - Human-readable description of the synthesis failure
   * @param cause - Optional underlying error that caused the failure
   * @param stderr - Optional stderr output from the CDK CLI
   */
  constructor(
    message: string,
    public readonly cause?: Error,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'CdkSynthesisError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CdkSynthesisError);
    }
  }
}

/**
 * Error thrown when npm dependency installation fails.
 *
 * This error indicates that `npm ci` failed to install project dependencies.
 * Common causes include:
 * - Invalid package.json or package-lock.json
 * - Network issues reaching npm registry
 * - Disk space exhaustion in /tmp
 * - Permission issues in Lambda environment
 *
 * @example
 * ```typescript
 * try {
 *   await synthesizeCdk(cdkPath, logger);
 * } catch (error) {
 *   if (error instanceof DependencyInstallError) {
 *     console.error('npm install failed:', error.message);
 *   }
 * }
 * ```
 */
export class DependencyInstallError extends Error {
  /**
   * Creates a new DependencyInstallError.
   *
   * @param message - Human-readable description of the installation failure
   * @param cause - Optional underlying error that caused the failure
   */
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DependencyInstallError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DependencyInstallError);
    }
  }
}

/**
 * Error thrown when CDK version cannot be detected.
 *
 * This error indicates that the CDK version could not be determined from
 * the project's package.json or installed node_modules. Common causes include:
 * - Missing package.json file
 * - aws-cdk-lib not listed as a dependency
 * - node_modules not installed (npm ci not run)
 * - Corrupted package.json format
 *
 * @example
 * ```typescript
 * try {
 *   const version = detectCDKVersion(cdkPath);
 * } catch (error) {
 *   if (error instanceof VersionDetectionError) {
 *     console.error('Cannot detect CDK version:', error.message);
 *   }
 * }
 * ```
 */
export class VersionDetectionError extends Error {
  /**
   * Creates a new VersionDetectionError.
   *
   * @param message - Human-readable description of why version detection failed
   */
  constructor(message: string) {
    super(message);
    this.name = 'VersionDetectionError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VersionDetectionError);
    }
  }
}

// Paths for caching CDK installation between Lambda invocations
const CDK_INSTALL_DIR = '/tmp/cdk-runtime';
const CDK_VERSION_MARKER = '/tmp/cdk-installed-version.txt';
const NPM_CACHE_DIR = '/tmp/.npm';

// Timeouts for various operations
const CDK_INSTALL_TIMEOUT_MS = 120_000; // 2 minutes
const NPM_CI_TIMEOUT_MS = 180_000; // 3 minutes
const CDK_SYNTH_TIMEOUT_MS = 180_000; // 3 minutes

/**
 * Executes a command safely using spawnSync with argument array
 *
 * This prevents command injection by avoiding shell interpretation.
 * Arguments are passed directly to the process, not through a shell.
 *
 * @param command - The command to execute (e.g., 'npm', 'npx')
 * @param args - Array of command arguments
 * @param options - Options for spawnSync (cwd, env, timeout)
 * @returns SpawnSyncReturns object with result
 * @throws Error if the command fails
 */
function execCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
  }
): SpawnSyncReturns<Buffer> {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    env: options.env,
    stdio: 'pipe',
    // No shell: true - this prevents command injection
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || '';
    const stdout = result.stdout?.toString() || '';
    throw new Error(`Command failed (exit ${result.status}): ${stderr || stdout}`);
  }

  return result;
}

/**
 * Package.json structure (partial)
 */
interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Detects the CDK version from the project's package.json (pre-install)
 *
 * This is used to verify CDK is a dependency before npm ci.
 * For the actual CLI version to install, use detectInstalledCDKVersion after npm ci.
 *
 * @param cdkPath - Path to the CDK project folder
 * @returns CDK version string from package.json (may include range specifiers)
 * @throws {VersionDetectionError} If CDK version cannot be detected
 */
export function detectCDKVersion(cdkPath: string): string {
  const packageJsonPath = path.join(cdkPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    throw new VersionDetectionError(`No package.json found at ${packageJsonPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJson;

  // Check multiple possible locations for CDK version
  const version =
    pkg.dependencies?.['aws-cdk-lib'] ||
    pkg.devDependencies?.['aws-cdk'] ||
    pkg.devDependencies?.['aws-cdk-lib'] ||
    pkg.peerDependencies?.['aws-cdk-lib'];

  if (!version) {
    throw new VersionDetectionError(
      'Could not find CDK version (aws-cdk-lib or aws-cdk) in package.json'
    );
  }

  // Strip version range operators (^, ~, >=, <, etc.)
  return version.replace(/^[\^~>=<]+/, '');
}

/**
 * Detects the INSTALLED CDK version from node_modules after npm ci
 *
 * This reads the actual installed version of aws-cdk-lib from node_modules,
 * which is the version we need to match the CLI to. This is critical because
 * package.json may specify a range (e.g., ^2.173.1) which npm resolves to
 * a newer version that uses a different cloud assembly schema.
 *
 * @param cdkPath - Path to the CDK project folder (must have node_modules)
 * @returns Exact installed CDK version string (e.g., '2.185.0')
 * @throws {VersionDetectionError} If version cannot be detected
 */
export function detectInstalledCDKVersion(cdkPath: string): string {
  const installedPackageJson = path.join(cdkPath, 'node_modules', 'aws-cdk-lib', 'package.json');

  if (!fs.existsSync(installedPackageJson)) {
    throw new VersionDetectionError(`aws-cdk-lib not found in node_modules. Run npm ci first.`);
  }

  const pkg = JSON.parse(fs.readFileSync(installedPackageJson, 'utf-8')) as PackageJson & {
    version?: string;
  };

  if (!pkg.version) {
    throw new VersionDetectionError('Could not read version from aws-cdk-lib package.json');
  }

  return pkg.version;
}

/**
 * Known-stable CDK CLI version for post-divergence library versions
 *
 * After CDK 2.179.0, CLI versions diverged to 2.1xxx.x series. This is a pinned
 * CLI version that has been tested and verified to work with library versions 2.179.0+.
 *
 * Security: Pinning versions instead of using 'latest' protects against supply chain attacks
 * where a compromised 'latest' package could inject malicious code.
 *
 * Update this version periodically after verifying compatibility.
 * Last updated: 2026-01 (bump to support cloud assembly schema 48.x.x)
 */
const PINNED_CDK_CLI_VERSION = '2.1033.0';

/**
 * Maps aws-cdk-lib version to compatible aws-cdk CLI version
 *
 * Starting from CDK 2.179.0, CLI versions diverged from library versions.
 * CLI versions are now 2.1000.0+ while library versions continue at 2.xxx.x.
 *
 * The CLI supports a range of library versions through cloud assembly schema compatibility.
 * This function returns the appropriate CLI version for a given library version.
 *
 * @param libVersion - The installed aws-cdk-lib version (e.g., '2.233.0')
 * @returns Compatible aws-cdk CLI version to install
 */
export function mapLibVersionToCliVersion(libVersion: string): string {
  // Parse version numbers
  const parts = libVersion.split('.');
  const major = parseInt(parts[0] ?? '0', 10);
  const minor = parseInt(parts[1] ?? '0', 10);

  // Before 2.179.0, CLI and library versions were in lockstep
  if (major < 2 || (major === 2 && minor < 179)) {
    return libVersion;
  }

  // For 2.179.0+, use a pinned stable CLI version (2.1xxx.x series)
  // The new CLI versions are backwards compatible with newer lib versions
  // We use a pinned version rather than 'latest' for supply chain security
  return PINNED_CDK_CLI_VERSION;
}

/**
 * Checks if the CDK is already cached with the correct version
 *
 * @param targetVersion - The version we need
 * @returns true if cached version matches
 */
function isCDKCached(targetVersion: string): boolean {
  if (!fs.existsSync(CDK_VERSION_MARKER)) {
    return false;
  }

  const cachedVersion = fs.readFileSync(CDK_VERSION_MARKER, 'utf-8').trim();
  return cachedVersion === targetVersion;
}

/**
 * Installs CDK CLI to /tmp with optimization flags
 *
 * Uses npm optimization flags for faster installation:
 * - --no-audit: Skip security audit (16% faster)
 * - --prefer-offline: Use npm cache when available (30%+ faster when cached)
 * - --no-save: Don't modify package.json
 * - --no-fund: Suppress funding messages
 *
 * @param version - CDK version to install
 * @param logger - Logger instance
 * @throws {DependencyInstallError} If installation fails
 */
function installCDK(version: string, logger: Logger): void {
  logger.info('Installing CDK CLI', { version });

  // Ensure npm cache directory exists and is writable (critical for Lambda)
  fs.mkdirSync(NPM_CACHE_DIR, { recursive: true });
  fs.mkdirSync(CDK_INSTALL_DIR, { recursive: true });

  // Use spawnSync with argument array to prevent command injection
  // The version string is passed as a single argument, not interpolated into a shell command
  const npmArgs = [
    'install',
    `--prefix=${CDK_INSTALL_DIR}`,
    `aws-cdk@${version}`,
    '--no-save',
    '--no-audit',
    '--no-fund',
    '--prefer-offline',
    '--loglevel=error',
  ];

  try {
    execCommand('npm', npmArgs, {
      timeout: CDK_INSTALL_TIMEOUT_MS,
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: NPM_CACHE_DIR,
        HOME: '/tmp',
      },
    });

    // Mark the installed version for cache validation
    fs.writeFileSync(CDK_VERSION_MARKER, version);

    logger.info('CDK CLI installed successfully', { version });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DependencyInstallError(
      `Failed to install aws-cdk@${version}: ${message}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Installs project dependencies using npm ci
 *
 * @param cdkPath - Path to the CDK project
 * @param logger - Logger instance
 * @throws {DependencyInstallError} If installation fails
 */
function installProjectDependencies(cdkPath: string, logger: Logger): void {
  logger.info('Installing project dependencies', { cdkPath });

  try {
    // Use spawnSync with argument array to prevent command injection
    // SECURITY: --ignore-scripts prevents npm lifecycle scripts (preinstall, postinstall, etc.)
    // from executing. This mitigates supply chain attacks where malicious packages
    // could run arbitrary code during installation. CDK projects don't typically
    // need postinstall scripts, and any that do should be audited.
    execCommand('npm', ['ci', '--prefer-offline', '--ignore-scripts'], {
      cwd: cdkPath,
      timeout: NPM_CI_TIMEOUT_MS,
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: NPM_CACHE_DIR,
        HOME: '/tmp',
      },
    });

    logger.info('Project dependencies installed successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DependencyInstallError(
      `Failed to install project dependencies: ${message}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Synthesizes a CDK project to CloudFormation template
 *
 * This function:
 * 1. Detects the CDK version from the project's package.json
 * 2. Installs the matching CDK CLI (with caching for warm starts)
 * 3. Installs project dependencies
 * 4. Runs cdk synth to generate CloudFormation template
 * 5. Reads and returns the generated template
 *
 * @param cdkPath - Path to the CDK project folder
 * @param logger - Logger instance for structured logging
 * @param targetAccountId - Optional AWS account ID for synthesis context
 * @param targetRegion - Optional AWS region for synthesis context
 * @returns Synthesis result with CloudFormation template
 * @throws {CdkSynthesisError} If synthesis fails
 * @throws {DependencyInstallError} If dependency installation fails
 * @throws {VersionDetectionError} If CDK version cannot be detected
 */
export async function synthesizeCdk(
  cdkPath: string,
  logger: Logger,
  targetAccountId?: string,
  targetRegion?: string
): Promise<SynthesisResult> {
  // Step 1: Verify CDK is in package.json (pre-flight check)
  const packageJsonVersion = detectCDKVersion(cdkPath);
  logger.info('CDK dependency found in package.json', { packageJsonVersion });

  // Step 2: Install project dependencies FIRST
  // This is critical because npm ci resolves version ranges (^2.173.1 -> 2.185.0)
  installProjectDependencies(cdkPath, logger);

  // Step 3: Detect the ACTUALLY INSTALLED version from node_modules
  // This ensures we install a CLI version compatible with the library's schema
  const installedLibVersion = detectInstalledCDKVersion(cdkPath);

  // Step 4: Map library version to compatible CLI version
  // From CDK 2.179.0+, CLI versions diverged (CLI is 2.1000.0+ while lib is 2.xxx.x)
  const cliVersion = mapLibVersionToCliVersion(installedLibVersion);
  logger.info('Detected installed CDK version', {
    packageJsonVersion,
    installedLibVersion,
    cliVersion,
  });

  // Step 5: Install matching CDK CLI if not cached or version mismatch
  if (!isCDKCached(cliVersion)) {
    installCDK(cliVersion, logger);
  } else {
    logger.info('Using cached CDK CLI', { cdkVersion: cliVersion });
  }

  // Step 6: Run CDK synth
  const cdkBin = path.join(CDK_INSTALL_DIR, 'node_modules', '.bin', 'cdk');
  const cdkOutDir = `/tmp/cdk.out-${Date.now()}`;

  logger.info('Running CDK synthesis', { cdkPath, cdkOutDir });

  try {
    // Build environment for synthesis - start with base values, NOT process.env
    // SECURITY: This prevents Lambda's AWS credentials from leaking into CDK synthesis.
    // Malicious CDK constructs or npm packages could capture credentials from process.env.
    // By explicitly listing only needed env vars, we ensure AWS_ACCESS_KEY_ID,
    // AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN are never passed to synthesis.
    const synthEnv: Record<string, string | undefined> = {
      // Essential paths and config from Lambda environment
      PATH: process.env.PATH,
      NODE_PATH: process.env.NODE_PATH,
      LAMBDA_TASK_ROOT: process.env.LAMBDA_TASK_ROOT,
      // NPM configuration
      NPM_CONFIG_CACHE: NPM_CACHE_DIR,
      HOME: '/tmp',
      // SECURITY: Explicitly NOT including:
      // - AWS_ACCESS_KEY_ID
      // - AWS_SECRET_ACCESS_KEY
      // - AWS_SESSION_TOKEN
      // - Any other sensitive environment variables
    };

    // Set account and region for CDK context
    // CDK checks multiple environment variables for account/region
    if (targetAccountId) {
      synthEnv.CDK_DEFAULT_ACCOUNT = targetAccountId;
    }
    if (targetRegion) {
      synthEnv.CDK_DEFAULT_REGION = targetRegion;
      synthEnv.AWS_DEFAULT_REGION = targetRegion;
      synthEnv.AWS_REGION = targetRegion;
    }

    // Log synthesis environment for debugging
    logger.debug('CDK synthesis environment', {
      hasAwsCredentials: !!process.env.AWS_ACCESS_KEY_ID,
      synthEnvHasCredentials: !!synthEnv.AWS_ACCESS_KEY_ID,
      targetAccountId,
      targetRegion,
      cdkDefaultAccount: synthEnv.CDK_DEFAULT_ACCOUNT,
      cdkDefaultRegion: synthEnv.CDK_DEFAULT_REGION,
    });

    // Build common context values to inject
    // This avoids the need for CDK to make API calls during synthesis
    // We write to cdk.context.json for reliable context passing
    const contextValues: Record<string, unknown> = {};

    // Standard AWS availability zones for common regions
    const azMap: Record<string, string[]> = {
      'us-east-1': [
        'us-east-1a',
        'us-east-1b',
        'us-east-1c',
        'us-east-1d',
        'us-east-1e',
        'us-east-1f',
      ],
      'us-east-2': ['us-east-2a', 'us-east-2b', 'us-east-2c'],
      'us-west-1': ['us-west-1a', 'us-west-1b'],
      'us-west-2': ['us-west-2a', 'us-west-2b', 'us-west-2c', 'us-west-2d'],
      'eu-west-1': ['eu-west-1a', 'eu-west-1b', 'eu-west-1c'],
      'eu-west-2': ['eu-west-2a', 'eu-west-2b', 'eu-west-2c'],
      'eu-west-3': ['eu-west-3a', 'eu-west-3b', 'eu-west-3c'],
      'eu-central-1': ['eu-central-1a', 'eu-central-1b', 'eu-central-1c'],
      'ap-northeast-1': ['ap-northeast-1a', 'ap-northeast-1c', 'ap-northeast-1d'],
      'ap-southeast-1': ['ap-southeast-1a', 'ap-southeast-1b', 'ap-southeast-1c'],
      'ap-southeast-2': ['ap-southeast-2a', 'ap-southeast-2b', 'ap-southeast-2c'],
    };

    // Helper to add AZ context for an account/region pair
    const addAzContext = (accountId: string, region: string): void => {
      const azs = azMap[region];
      if (azs) {
        const azKey = `availability-zones:account=${accountId}:region=${region}`;
        contextValues[azKey] = azs;
      }
    };

    // Provide AZ context for target account/region
    if (targetAccountId && targetRegion) {
      addAzContext(targetAccountId, targetRegion);
    }

    // Also provide AZ context for all regions in target account
    // (CDK apps might synthesize for multiple regions)
    if (targetAccountId) {
      for (const region of Object.keys(azMap)) {
        if (region !== targetRegion) {
          addAzContext(targetAccountId, region);
        }
      }
    }

    // Provide AZ context for the Lambda execution environment (deployer account)
    // Some CDK apps query their current execution environment during synthesis
    const deployerAccountId = process.env.AWS_ACCOUNT_ID || synthEnv.CDK_DEFAULT_ACCOUNT;
    const deployerRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
    if (deployerAccountId && deployerRegion && deployerAccountId !== targetAccountId) {
      addAzContext(deployerAccountId, deployerRegion);
      // Also provide for all regions
      for (const region of Object.keys(azMap)) {
        if (region !== deployerRegion) {
          addAzContext(deployerAccountId, region);
        }
      }
    }

    // Write context to cdk.context.json file for reliable context passing
    // CDK reads this file automatically during synthesis
    const cdkContextPath = path.join(cdkPath, 'cdk.context.json');
    let existingContext: Record<string, unknown> = {};

    // Preserve any existing context from the project
    if (fs.existsSync(cdkContextPath)) {
      try {
        existingContext = JSON.parse(fs.readFileSync(cdkContextPath, 'utf-8')) as Record<
          string,
          unknown
        >;
      } catch {
        // Ignore parse errors, start fresh
      }
    }

    // Merge our context with existing (our values take precedence)
    const mergedContext = { ...existingContext, ...contextValues };
    fs.writeFileSync(cdkContextPath, JSON.stringify(mergedContext, null, 2));

    // Log context for debugging AZ issues
    logger.info('CDK synthesis context written', {
      contextPath: cdkContextPath,
      contextKeyCount: Object.keys(contextValues).length,
      targetAccountId,
      targetRegion,
      contextKeys: Object.keys(contextValues),
    });

    // Build the synth command args:
    // synth: CDK synthesis command
    // --output: Output directory for cloud assembly
    // --quiet: Suppress non-essential output
    // Note: Context is provided via cdk.context.json file for reliability
    const synthArgs = ['synth', '--output', cdkOutDir, '--quiet'];

    // Use spawnSync with argument array to prevent command injection
    execCommand(cdkBin, synthArgs, {
      cwd: cdkPath,
      timeout: CDK_SYNTH_TIMEOUT_MS,
      env: synthEnv,
    });

    logger.info('CDK synthesis completed');

    // Step 6: Find and read the generated template
    const files = fs.readdirSync(cdkOutDir);
    const templateFile = files.find((f) => f.endsWith('.template.json'));

    if (!templateFile) {
      throw new CdkSynthesisError(
        'No template.json found in cdk.out. Ensure the CDK app produces a single stack.'
      );
    }

    // Check if multiple stacks were generated (not supported)
    const templateFiles = files.filter((f) => f.endsWith('.template.json'));
    if (templateFiles.length > 1) {
      throw new CdkSynthesisError(
        `Multiple stacks detected (${templateFiles.length}). Only single-stack CDK apps are supported. ` +
          `Found: ${templateFiles.join(', ')}`
      );
    }

    const templateBody = fs.readFileSync(path.join(cdkOutDir, templateFile), 'utf-8');

    // Extract stack name from template filename
    const stackName = templateFile.replace('.template.json', '');

    // Cleanup cdk.out
    fs.rmSync(cdkOutDir, { recursive: true, force: true });

    logger.info('Template read successfully', {
      stackName,
      templateSize: templateBody.length,
    });

    return {
      templateBody,
      stackName,
    };
  } catch (error) {
    // Cleanup cdk.out on error
    try {
      if (fs.existsSync(cdkOutDir)) {
        fs.rmSync(cdkOutDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    // Re-throw known errors
    if (error instanceof CdkSynthesisError || error instanceof DependencyInstallError) {
      throw error;
    }

    // Extract stderr if available
    let stderr: string | undefined;
    if (error && typeof error === 'object' && 'stderr' in error) {
      stderr = String((error as { stderr: unknown }).stderr);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new CdkSynthesisError(
      `CDK synthesis failed: ${message}`,
      error instanceof Error ? error : undefined,
      stderr
    );
  }
}
