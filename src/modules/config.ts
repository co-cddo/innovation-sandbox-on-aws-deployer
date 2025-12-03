import type { Config, LogLevel } from '../types/index.js';

/**
 * Default configuration values
 */
const DEFAULTS = {
  GITHUB_REPO: 'co-cddo/ndx_try_aws_scenarios',
  GITHUB_BRANCH: 'main',
  GITHUB_PATH: 'cloudformation/scenarios',
  TARGET_ROLE_NAME: 'ndx_IsbUsersPS',
  AWS_REGION: 'eu-west-2',
  EVENT_SOURCE: 'isb-deployer',
  LOG_LEVEL: 'INFO' as LogLevel,
} as const;

/**
 * Validates that a log level is valid
 */
function isValidLogLevel(level: string): level is LogLevel {
  return ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(level);
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
 * Loads and validates configuration from environment variables
 *
 * Required environment variables:
 * - LEASE_TABLE_NAME: DynamoDB table name for lease lookups
 *
 * Optional environment variables (with defaults):
 * - GITHUB_REPO: Repository for templates (default: co-cddo/ndx_try_aws_scenarios)
 * - GITHUB_BRANCH: Branch to fetch from (default: main)
 * - GITHUB_PATH: Path to templates (default: cloudformation/scenarios)
 * - TARGET_ROLE_NAME: IAM role for cross-account (default: ndx_IsbUsersPS)
 * - AWS_REGION: AWS region (default: eu-west-2)
 * - EVENT_SOURCE: EventBridge source (default: isb-deployer)
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
    eventSource: getOptionalEnv('EVENT_SOURCE', DEFAULTS.EVENT_SOURCE),
    logLevel,
  };
}

/**
 * Singleton config instance (lazy loaded)
 */
let configInstance: Config | null = null;

/**
 * Gets the configuration singleton, loading it on first access
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Resets the configuration singleton (for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}

/**
 * Default values exported for reference
 */
export { DEFAULTS };
