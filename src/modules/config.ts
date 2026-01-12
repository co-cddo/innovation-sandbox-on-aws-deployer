import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { Config, LogLevel } from '../types/index.js';

/**
 * Default configuration values
 */
const DEFAULTS = {
  GITHUB_REPO: 'co-cddo/ndx_try_aws_scenarios',
  GITHUB_BRANCH: 'main',
  GITHUB_PATH: 'cloudformation/scenarios',
  TARGET_ROLE_NAME: 'InnovationSandbox-ndx-DeployerRole',
  AWS_REGION: 'us-west-2',
  DEPLOY_REGION: 'us-east-1', // Region where CloudFormation stacks are deployed (some features only available in us-east-1)
  EVENT_SOURCE: 'innovation-sandbox',
  LOG_LEVEL: 'INFO' as LogLevel,
} as const;

/**
 * Cached GitHub token (fetched from Secrets Manager once)
 */
let cachedGithubToken: string | null = null;

/**
 * Validates that a log level is valid
 */
function isValidLogLevel(level: string): level is LogLevel {
  return ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(level);
}

/**
 * Validates GitHub token format
 *
 * GitHub tokens use these formats:
 * - Classic PAT: ghp_XXXXXXXXXXXX (40+ chars)
 * - Fine-grained PAT: github_pat_XXXXXXXXXXXX
 * - OAuth tokens: gho_XXXXXXXXXXXX
 * - GitHub App: ghs_XXXXXXXXXXXX
 *
 * @param token - Token to validate
 * @returns Validated and trimmed token
 * @throws Error if token format is invalid
 */
function validateGithubToken(token: string): string {
  const trimmed = token.trim();

  // Check for known GitHub token prefixes
  const validPrefixes = ['ghp_', 'github_pat_', 'gho_', 'ghs_'];
  const hasValidPrefix = validPrefixes.some((prefix) => trimmed.startsWith(prefix));

  if (!hasValidPrefix) {
    throw new Error(
      'Invalid GitHub token format. Expected token starting with ghp_, github_pat_, gho_, or ghs_'
    );
  }

  // Check for reasonable length (GitHub tokens are typically 40+ chars)
  if (trimmed.length < 20) {
    throw new Error('GitHub token too short, may be invalid');
  }

  return trimmed;
}

/**
 * Validates AWS account ID format
 *
 * @param accountId - Account ID to validate
 * @throws Error if format is invalid
 */
export function validateAccountId(accountId: string): void {
  if (!/^\d{12}$/.test(accountId)) {
    throw new Error(`Invalid AWS account ID: ${accountId}. Must be exactly 12 digits.`);
  }
}

/**
 * Validates AWS region format
 *
 * @param region - Region to validate
 * @throws Error if format is invalid
 */
export function validateRegion(region: string): void {
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) {
    throw new Error(`Invalid AWS region: ${region}. Expected format like us-east-1.`);
  }
}

/**
 * Gets a required environment variable, throwing if not set
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Gets an optional environment variable with a default value
 */
function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

/**
 * Fetches the GitHub token from AWS Secrets Manager
 *
 * The token is cached for subsequent calls to avoid repeated API calls.
 * Falls back to GITHUB_TOKEN environment variable if no secret ARN is configured.
 *
 * @returns GitHub token string, or undefined if not configured
 */
async function fetchGithubToken(): Promise<string | undefined> {
  // Return cached token if available
  if (cachedGithubToken) {
    return cachedGithubToken;
  }

  // Check for direct environment variable first (for local development)
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    cachedGithubToken = validateGithubToken(envToken);
    return cachedGithubToken;
  }

  // Check for Secrets Manager ARN
  const secretArn = process.env.GITHUB_TOKEN_SECRET_ARN;
  if (!secretArn) {
    // No GitHub token configured - this is OK for CloudFormation-only deployments
    return undefined;
  }

  // Validate and extract region from ARN
  // Format: arn:aws:secretsmanager:REGION:ACCOUNT:secret:NAME-RANDOM
  // Strict regex to prevent malformed ARNs from bypassing validation
  // Valid AWS regions follow patterns like: us-east-1, eu-west-2, ap-northeast-1
  const arnPattern =
    /^arn:aws:secretsmanager:((?:us|eu|ap|sa|ca|me|af|il)-(?:north|south|east|west|central|northeast|southeast|northwest|southwest)-\d+):(\d{12}):secret:[a-zA-Z0-9/_+=.@-]+$/;
  const match = secretArn.match(arnPattern);

  if (!match) {
    throw new Error(
      `Invalid Secrets Manager ARN format: ${secretArn}. ` +
        `Expected format: arn:aws:secretsmanager:REGION:ACCOUNT:secret:NAME ` +
        `where REGION is a valid AWS region (e.g., us-east-1, eu-west-2)`
    );
  }

  const secretRegion = match[1];

  // Additional validation: verify region is not empty
  if (!secretRegion || secretRegion.length < 9) {
    throw new Error(`Invalid region extracted from ARN: ${secretArn}`);
  }

  // Fetch from Secrets Manager in the correct region
  // The SDK does NOT automatically route to the region in the ARN
  const client = new SecretsManagerClient({ region: secretRegion });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));

  if (!response.SecretString) {
    throw new Error('GitHub token secret exists but has no value');
  }

  // Validate token format before caching
  cachedGithubToken = validateGithubToken(response.SecretString);
  return cachedGithubToken;
}

/**
 * Loads and validates configuration from environment variables (synchronous)
 *
 * NOTE: This does not include githubToken. Use loadConfigAsync() for full config.
 *
 * Required environment variables:
 * - LEASE_TABLE_NAME: DynamoDB table name for lease lookups
 *
 * Optional environment variables (with defaults):
 * - GITHUB_REPO: Repository for templates (default: co-cddo/ndx_try_aws_scenarios)
 * - GITHUB_BRANCH: Branch to fetch from (default: main)
 * - GITHUB_PATH: Path to templates (default: cloudformation/scenarios)
 * - TARGET_ROLE_NAME: IAM role for cross-account (default: InnovationSandbox-ndx-DeployerRole)
 * - AWS_REGION: AWS region (default: us-west-2)
 * - EVENT_SOURCE: EventBridge source (default: innovation-sandbox)
 * - LOG_LEVEL: Logging level (default: INFO)
 */
export function loadConfig(): Config {
  const logLevelEnv = getOptionalEnv('LOG_LEVEL', DEFAULTS.LOG_LEVEL);
  const logLevel = isValidLogLevel(logLevelEnv) ? logLevelEnv : DEFAULTS.LOG_LEVEL;

  return {
    githubRepo: getOptionalEnv('GITHUB_REPO', DEFAULTS.GITHUB_REPO),
    githubBranch: getOptionalEnv('GITHUB_BRANCH', DEFAULTS.GITHUB_BRANCH),
    githubPath: getOptionalEnv('GITHUB_PATH', DEFAULTS.GITHUB_PATH),
    leaseTableName: getRequiredEnv('LEASE_TABLE_NAME'),
    targetRoleName: getOptionalEnv('TARGET_ROLE_NAME', DEFAULTS.TARGET_ROLE_NAME),
    awsRegion: getOptionalEnv('AWS_REGION', DEFAULTS.AWS_REGION),
    deployRegion: getOptionalEnv('DEPLOY_REGION', DEFAULTS.DEPLOY_REGION),
    eventSource: getOptionalEnv('EVENT_SOURCE', DEFAULTS.EVENT_SOURCE),
    logLevel,
  };
}

/**
 * Loads configuration including GitHub token from Secrets Manager (async)
 *
 * This is the preferred method when CDK support is needed.
 */
export async function loadConfigAsync(): Promise<Config> {
  const baseConfig = loadConfig();
  const githubToken = await fetchGithubToken();

  return {
    ...baseConfig,
    githubToken,
  };
}

/**
 * Singleton config instance (lazy loaded)
 */
let configInstance: Config | null = null;

/**
 * Flag indicating whether async config (with GitHub token) has been loaded
 */
let asyncConfigLoaded = false;

/**
 * Gets the configuration singleton, loading it on first access (synchronous)
 *
 * Use this function when:
 * - You need config for modules that don't interact with GitHub (role-assumer, event-emitter)
 * - The GitHub token is not required for the operation
 *
 * NOTE: This does NOT include githubToken. For CDK/GitHub operations, use getConfigAsync().
 *
 * @returns Config object without GitHub token
 *
 * @example
 * ```typescript
 * // In modules like role-assumer.ts that don't need GitHub token
 * const config = getConfig();
 * const roleArn = `arn:aws:iam::${accountId}:role/${config.targetRoleName}`;
 * ```
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Gets the configuration singleton including GitHub token (async)
 *
 * Use this function when:
 * - You need to interact with GitHub API (template resolution, scenario detection)
 * - You need to fetch CDK scenarios from private repositories
 * - The GitHub token is required for authentication
 *
 * The token is fetched from AWS Secrets Manager on first call and cached.
 *
 * @returns Config object with GitHub token (if configured)
 *
 * @example
 * ```typescript
 * // In template-handler.ts that needs GitHub access
 * const config = await getConfigAsync();
 * // config.githubToken is available for authenticated requests
 * ```
 */
export async function getConfigAsync(): Promise<Config> {
  if (!configInstance) {
    configInstance = await loadConfigAsync();
    asyncConfigLoaded = true;
  } else if (!asyncConfigLoaded) {
    // Config was loaded sync, now fetch the token
    const githubToken = await fetchGithubToken();
    configInstance = { ...configInstance, githubToken };
    asyncConfigLoaded = true;
  }
  return configInstance;
}

/**
 * Checks if the async config (with GitHub token) has been loaded
 *
 * Use this to verify config initialization before operations that require the GitHub token.
 *
 * @returns true if getConfigAsync() has been called successfully
 */
export function isAsyncConfigLoaded(): boolean {
  return asyncConfigLoaded;
}

/**
 * Resets the configuration singleton (for testing)
 */
export function resetConfig(): void {
  configInstance = null;
  cachedGithubToken = null;
  asyncConfigLoaded = false;
}

/**
 * Default values exported for reference
 */
export { DEFAULTS };
