/**
 * Configuration for the ISB Deployer Lambda
 */
export interface Config {
  /** GitHub repository owner/name (e.g., 'co-cddo/ndx_try_aws_scenarios') */
  githubRepo: string;
  /** GitHub branch to fetch templates from */
  githubBranch: string;
  /** Path within the repository to scenario templates */
  githubPath: string;
  /** DynamoDB table name for lease lookups */
  leaseTableName: string;
  /** IAM role name to assume in target sub-accounts */
  targetRoleName: string;
  /** AWS region for Lambda operations (e.g., us-west-2) */
  awsRegion: string;
  /** AWS region where CloudFormation stacks are deployed (e.g., us-east-1) */
  deployRegion: string;
  /** EventBridge source name for emitted events */
  eventSource: string;
  /** Log level for structured logging */
  logLevel: LogLevel;
  /** GitHub personal access token for API authentication (required for CDK scenarios) */
  githubToken?: string;
}

/**
 * Supported log levels
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Incoming EventBridge event from ISB
 */
export interface LeaseApprovedEvent {
  version: string;
  id: string;
  'detail-type': string;
  source: string;
  account: string;
  time: string;
  region: string;
  detail: LeaseEventDetail;
}

/**
 * Detail section of the lease approved event
 */
export interface LeaseEventDetail {
  leaseId: string;
  accountId: string;
  templateName?: string;
  status: string;
}

/**
 * Lease record from DynamoDB
 */
export interface Lease {
  leaseId: string;
  accountId: string;
  templateName: string;
  budgetAmount?: number;
  expirationDate?: string;
  requesterEmail?: string;
}

/**
 * Parsed lease context for deployment
 */
export interface DeploymentContext {
  leaseId: string;
  accountId: string;
  templateName: string;
  lease?: Lease;
  template?: string;
  stackName?: string;
  parameters?: CloudFormationParameter[];
}

/**
 * CloudFormation parameter structure
 */
export interface CloudFormationParameter {
  ParameterKey: string;
  ParameterValue: string;
}

/**
 * Result of a deployment operation
 */
export interface DeploymentResult {
  success: boolean;
  stackName?: string;
  stackId?: string;
  error?: string;
  errorType?: string;
}

/**
 * Output event for deployment status
 */
export interface DeploymentEvent {
  source: string;
  detailType: 'Deployment Succeeded' | 'Deployment Failed';
  detail: {
    leaseId: string;
    accountId: string;
    templateName: string;
    stackName?: string;
    stackId?: string;
    error?: string;
    errorType?: string;
  };
}

/**
 * Types for CDK support
 */

/**
 * Type of scenario detected in the repository
 */
export type ScenarioType = 'cdk' | 'cdk-subfolder' | 'cloudformation';

/**
 * Result of scenario type detection
 */
export interface ScenarioDetectionResult {
  /** Type of scenario: cdk, cdk-subfolder, or cloudformation */
  type: ScenarioType;
  /** Relative path to cdk.json (empty string if at root, 'cdk/' if in subfolder) */
  cdkPath?: string;
}

/**
 * Result of fetching a scenario folder to local filesystem
 */
export interface FetchedScenario {
  /** Base path where scenario was downloaded (e.g., '/tmp/localgov-drupal-abc123') */
  localPath: string;
  /** Full path to the CDK project (e.g., '/tmp/localgov-drupal-abc123/cloudformation/scenarios/localgov-drupal/cdk') */
  cdkPath: string;
  /** Cleanup function to remove temp files */
  cleanup: () => void;
}

/**
 * Result of CDK synthesis
 */
export interface SynthesisResult {
  /** Synthesized CloudFormation template as JSON string */
  templateBody: string;
  /** Stack name detected from cdk.out */
  stackName?: string;
}

/**
 * Result of template resolution (unified CDK + CloudFormation)
 */
export interface ResolvedTemplate {
  /** CloudFormation template body (YAML or JSON) */
  templateBody: string;
  /** Source type: 'cdk' for synthesized, 'cloudformation' for direct */
  source: 'cdk' | 'cloudformation';
  /** Whether the template was synthesized (true for CDK) */
  synthesized: boolean;
}

/**
 * Parsed template reference containing template name and optional branch override
 *
 * When a templateName contains '@', it is split into name and branch components.
 * This allows per-template branch overrides without changing the global GITHUB_BRANCH.
 *
 * @example
 * // Without branch override (uses default GITHUB_BRANCH)
 * { name: "localgov-drupal" }
 *
 * // With branch override
 * { name: "localgov-drupal", branch: "feature-branch" }
 * { name: "localgov-drupal", branch: "v2.0" }
 */
export interface TemplateRef {
  /** Template/scenario name (without branch suffix) */
  name: string;
  /** Branch override (undefined means use default from config.githubBranch) */
  branch?: string;
}
