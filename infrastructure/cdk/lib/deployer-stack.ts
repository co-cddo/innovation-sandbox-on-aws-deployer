/**
 * Deployer Stack - Lambda, ECR, EventBridge, IAM
 *
 * This stack contains all the infrastructure for the ISB Deployer Lambda:
 * - ECR Repository for container images
 * - Lambda Function (container-based, arm64)
 * - IAM Role with least-privilege permissions
 * - EventBridge Rule for LeaseApproved events
 *
 * Ported from infrastructure/template-container.yaml
 */

import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import type { Construct } from 'constructs';

/**
 * Props for the DeployerStack
 */
export interface DeployerStackProps extends cdk.StackProps {
  /** Deployment environment (dev, staging, prod) */
  environment: string;
  /** Container image tag to deploy */
  imageTag: string;
  /** DynamoDB table name for lease lookups */
  leaseTableName: string;
  /** AWS region where lease table is located */
  leaseTableRegion?: string;
  /** GitHub repository for scenario templates (owner/repo format) */
  githubRepo: string;
  /** GitHub branch to fetch templates from */
  githubBranch: string;
  /** Path within repository to scenario templates */
  githubPath: string;
  /** ARN of Secrets Manager secret containing GitHub token */
  githubTokenSecretArn?: string;
  /** IAM role name to assume in target sandbox accounts */
  targetRoleName: string;
  /** EventBridge event source for filtering events */
  eventSource: string;
}

/**
 * Stack containing the ISB Deployer Lambda and supporting infrastructure
 */
export class DeployerStack extends cdk.Stack {
  /** The ECR repository for container images */
  public readonly repository: ecr.IRepository;
  /** The Lambda function */
  public readonly lambdaFunction: lambda.DockerImageFunction;
  /** The Lambda execution role */
  public readonly lambdaRole: iam.Role;
  /** The EventBridge rule */
  public readonly eventRule: events.Rule;

  constructor(scope: Construct, id: string, props: DeployerStackProps) {
    super(scope, id, props);

    const {
      environment,
      imageTag,
      leaseTableName,
      leaseTableRegion,
      githubRepo,
      githubBranch,
      githubPath,
      githubTokenSecretArn,
      targetRoleName,
      eventSource,
    } = props;

    const isProd = environment === 'prod';
    const tableRegion = leaseTableRegion || cdk.Aws.REGION;

    // ECR Repository for Lambda container images
    // Try to import existing repo first, create if doesn't exist
    const repoName = `isb-deployer-${environment}`;
    this.repository = ecr.Repository.fromRepositoryName(this, 'Repository', repoName);

    // Note: When deploying fresh, use this instead:
    // this.repository = new ecr.Repository(this, 'Repository', {
    //   repositoryName: repoName,
    //   removalPolicy: cdk.RemovalPolicy.RETAIN,
    //   imageScanOnPush: true,
    //   encryption: ecr.RepositoryEncryption.AES_256,
    //   lifecycleRules: [{ rulePriority: 1, description: 'Keep last 10 images', maxImageCount: 10 }],
    // });

    // IAM Role for Lambda execution
    this.lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: `isb-deployer-role-${environment}`,
      description: 'IAM role for Innovation Sandbox Deployer Lambda (CDK-enabled)',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // DynamoDB read-only access for lease table lookups
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DynamoDBReadAccess',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [`arn:aws:dynamodb:${tableRegion}:${cdk.Aws.ACCOUNT_ID}:table/${leaseTableName}`],
      })
    );

    // KMS decrypt permission for encrypted DynamoDB table
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'KMSDecryptAccess',
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt'],
        resources: [`arn:aws:kms:${tableRegion}:${cdk.Aws.ACCOUNT_ID}:key/*`],
        conditions: {
          StringEquals: {
            'kms:ViaService': `dynamodb.${tableRegion}.amazonaws.com`,
          },
        },
      })
    );

    // STS permissions for ISB double role chain
    // ISB requires: Lambda -> IntermediateRole (hub) -> SandboxAccountRole (target)
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'STSAssumeRoleAccess',
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/InnovationSandbox-ndx-IntermediateRole`],
      })
    );

    // EventBridge permissions for deployment status events
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EventBridgePutEvents',
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:event-bus/default`],
      })
    );

    // Secrets Manager access for GitHub token (if provided)
    // Note: The secret may be in a different account (e.g., shared secrets account)
    // Cross-account access requires both IAM policy here AND resource policy on the secret
    if (githubTokenSecretArn) {
      // Extract account from ARN to detect cross-account access
      const arnParts = githubTokenSecretArn.split(':');
      const secretAccountId = arnParts.length >= 5 ? arnParts[4] : undefined;
      const isCrossAccount = secretAccountId && secretAccountId !== cdk.Aws.ACCOUNT_ID;

      this.lambdaRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'SecretsManagerAccess',
          effect: iam.Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [githubTokenSecretArn],
        })
      );

      // Warn if cross-account secret access is detected
      if (isCrossAccount) {
        cdk.Annotations.of(this).addWarning(
          `Cross-account Secrets Manager access detected (account: ${secretAccountId}). ` +
            `Ensure the secret has a resource policy allowing this Lambda role: ${this.lambdaRole.roleArn}`
        );
      }
    }

    // ECR permissions for Lambda to pull container image
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRPullAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:BatchCheckLayerAvailability',
        ],
        resources: [this.repository.repositoryArn],
      })
    );

    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRAuthToken',
        effect: iam.Effect.ALLOW,
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      })
    );

    // Lambda Function using container image
    this.lambdaFunction = new lambda.DockerImageFunction(this, 'DeployerFunction', {
      functionName: `isb-deployer-${environment}`,
      description: 'Deploys CloudFormation and CDK scenarios to Innovation Sandbox sub-accounts on lease approval',
      code: lambda.DockerImageCode.fromEcr(this.repository, {
        tagOrDigest: imageTag,
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 2048,
      timeout: cdk.Duration.minutes(10),
      ephemeralStorageSize: cdk.Size.gibibytes(5),
      role: this.lambdaRole,
      environment: {
        LEASE_TABLE_NAME: leaseTableName,
        LEASE_TABLE_REGION: tableRegion,
        DEPLOY_REGION: 'us-east-1', // CloudFormation stacks deploy to us-east-1
        GITHUB_REPO: githubRepo,
        GITHUB_BRANCH: githubBranch,
        GITHUB_PATH: githubPath,
        TARGET_ROLE_NAME: targetRoleName,
        EVENT_SOURCE: eventSource,
        LOG_LEVEL: isProd ? 'INFO' : 'DEBUG',
        ...(githubTokenSecretArn && { GITHUB_TOKEN_SECRET_ARN: githubTokenSecretArn }),
      },
    });

    // EventBridge Rule for LeaseApproved events
    // Filter by both source and detail-type to only process events from ISB
    this.eventRule = new events.Rule(this, 'LeaseApprovedRule', {
      ruleName: `isb-deployer-lease-approved-${environment}`,
      description: `Triggers deployment when a lease is approved from ${eventSource}`,
      eventPattern: {
        source: [eventSource],
        detailType: ['LeaseApproved'],
      },
    });

    // Add Lambda as target
    this.eventRule.addTarget(new targets.LambdaFunction(this.lambdaFunction));

    // Outputs
    new cdk.CfnOutput(this, 'FunctionArn', {
      description: 'ARN of the deployer Lambda function',
      value: this.lambdaFunction.functionArn,
      exportName: `${this.stackName}-FunctionArn`,
    });

    new cdk.CfnOutput(this, 'FunctionName', {
      description: 'Name of the deployer Lambda function',
      value: this.lambdaFunction.functionName,
      exportName: `${this.stackName}-FunctionName`,
    });

    new cdk.CfnOutput(this, 'RoleArn', {
      description: 'ARN of the Lambda execution role',
      value: this.lambdaRole.roleArn,
      exportName: `${this.stackName}-RoleArn`,
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      description: 'URI of the ECR repository for container images',
      value: this.repository.repositoryUri,
      exportName: `${this.stackName}-EcrRepositoryUri`,
    });

    new cdk.CfnOutput(this, 'EcrRepositoryArn', {
      description: 'ARN of the ECR repository',
      value: this.repository.repositoryArn,
      exportName: `${this.stackName}-EcrRepositoryArn`,
    });

    new cdk.CfnOutput(this, 'LeaseApprovedRuleArn', {
      description: 'ARN of the EventBridge rule for lease approved events',
      value: this.eventRule.ruleArn,
      exportName: `${this.stackName}-LeaseApprovedRuleArn`,
    });
  }
}
