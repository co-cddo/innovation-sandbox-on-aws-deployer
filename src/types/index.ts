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
  /** AWS region for operations */
  awsRegion: string;
  /** EventBridge source name for emitted events */
  eventSource: string;
  /** Log level for structured logging */
  logLevel: LogLevel;
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
