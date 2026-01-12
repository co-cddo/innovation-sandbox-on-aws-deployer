/**
 * GitHub OIDC Stack - GitHub Actions OIDC Provider and Deploy Role
 *
 * This stack sets up GitHub Actions OIDC authentication:
 * - GitHub OIDC Identity Provider
 * - IAM Role for GitHub Actions with CDK deploy permissions
 *
 * Ported from infrastructure/github-oidc.yaml
 */

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

/**
 * Props for the GitHubOidcStack
 */
export interface GitHubOidcStackProps extends cdk.StackProps {
  /** GitHub organization or username */
  githubOrg: string;
  /** GitHub repository name (without org prefix) */
  githubRepo: string;
  /** Branch allowed to assume this role */
  githubBranch: string;
  /** Deployment environment */
  environment: string;
}

/**
 * Stack containing GitHub OIDC provider and Actions deploy role
 */
export class GitHubOidcStack extends cdk.Stack {
  /** The GitHub OIDC provider */
  public readonly oidcProvider: iam.OpenIdConnectProvider;
  /** The GitHub Actions deploy role */
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);

    const { githubOrg, githubRepo, githubBranch, environment } = props;

    // GitHub OIDC Identity Provider
    // Note: Only ONE GitHub OIDC provider can exist per AWS account
    // Import existing provider if it exists, otherwise create new one
    const existingProviderArn = `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com`;

    // Try to import existing provider - this is a lookup that won't fail if it doesn't exist
    // We use fromOpenIdConnectProviderArn to reference an existing provider
    this.oidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOIDCProvider',
      existingProviderArn
    ) as iam.OpenIdConnectProvider;

    // IAM Role for GitHub Actions to assume
    this.deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      roleName: `github-actions-${githubRepo}-deploy`,
      description: `Role for GitHub Actions to deploy ${githubOrg}/${githubRepo}`,
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.FederatedPrincipal(
        this.oidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': [
              `repo:${githubOrg}/${githubRepo}:ref:refs/heads/${githubBranch}`,
              `repo:${githubOrg}/${githubRepo}:environment:*`,
            ],
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Override logical ID to match existing CloudFormation resource from SAM migration
    (this.deployRole.node.defaultChild as cdk.CfnResource).overrideLogicalId(
      'GitHubActionsDeployRole'
    );

    // CloudFormation permissions for CDK deployment
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFormationStackOperations',
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:DescribeStackResources',
          'cloudformation:GetTemplate',
          'cloudformation:GetTemplateSummary',
          'cloudformation:ValidateTemplate',
          'cloudformation:CreateChangeSet',
          'cloudformation:DescribeChangeSet',
          'cloudformation:ExecuteChangeSet',
          'cloudformation:DeleteChangeSet',
          'cloudformation:ListStackResources',
        ],
        resources: [
          `arn:aws:cloudformation:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:stack/isb-deployer*/*`,
          `arn:aws:cloudformation:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:stack/CDKToolkit/*`,
        ],
      })
    );

    // SSM Parameter Store permissions for CDK bootstrap version
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SSMParameterAccess',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/cdk-bootstrap/*`,
        ],
      })
    );

    // S3 permissions for CDK bootstrap assets bucket
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3CDKAssetsBucket',
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
          's3:GetBucketLocation',
        ],
        resources: [
          `arn:aws:s3:::cdk-hnb659fds-assets-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
          `arn:aws:s3:::cdk-hnb659fds-assets-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}/*`,
        ],
      })
    );

    // ECR permissions for pushing container images
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRRepositoryAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:BatchCheckLayerAvailability',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:DescribeRepositories',
          'ecr:CreateRepository',
          'ecr:DeleteRepository',
          'ecr:SetRepositoryPolicy',
          'ecr:GetRepositoryPolicy',
          'ecr:ListImages',
          'ecr:DescribeImages',
          'ecr:TagResource',
          'ecr:UntagResource',
          'ecr:PutLifecyclePolicy',
          'ecr:GetLifecyclePolicy',
          'ecr:PutImageScanningConfiguration',
        ],
        resources: [
          `arn:aws:ecr:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:repository/isb-deployer*`,
        ],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRAuthToken',
        effect: iam.Effect.ALLOW,
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      })
    );

    // Lambda permissions for function deployment
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'LambdaFunctionOperations',
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:CreateFunction',
          'lambda:UpdateFunctionCode',
          'lambda:UpdateFunctionConfiguration',
          'lambda:DeleteFunction',
          'lambda:GetFunction',
          'lambda:GetFunctionConfiguration',
          'lambda:ListVersionsByFunction',
          'lambda:PublishVersion',
          'lambda:AddPermission',
          'lambda:RemovePermission',
          'lambda:TagResource',
          'lambda:UntagResource',
          'lambda:GetFunctionCodeSigningConfig',
        ],
        resources: [
          `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:isb-deployer*`,
        ],
      })
    );

    // IAM permissions for Lambda execution role management
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'IAMRoleOperations',
        effect: iam.Effect.ALLOW,
        actions: [
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:GetRole',
          'iam:UpdateRole',
          'iam:PassRole',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:GetRolePolicy',
          'iam:TagRole',
          'iam:UntagRole',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
        ],
        resources: [`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/isb-deployer*`],
      })
    );

    // PassRole permission for CDK bootstrap execution role
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CDKPassRole',
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [
          `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-hnb659fds-cfn-exec-role-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
        ],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'IAMPolicyRead',
        effect: iam.Effect.ALLOW,
        actions: ['iam:GetPolicy', 'iam:GetPolicyVersion'],
        resources: ['*'],
      })
    );

    // EventBridge permissions for rule management
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EventBridgeRuleOperations',
        effect: iam.Effect.ALLOW,
        actions: [
          'events:PutRule',
          'events:DeleteRule',
          'events:DescribeRule',
          'events:EnableRule',
          'events:DisableRule',
          'events:PutTargets',
          'events:RemoveTargets',
          'events:ListTargetsByRule',
          'events:TagResource',
          'events:UntagResource',
        ],
        resources: [
          `arn:aws:events:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:rule/isb-deployer*`,
          `arn:aws:events:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:event-bus/default`,
        ],
      })
    );

    // CloudWatch Logs permissions for Lambda log group
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogsManagement',
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:DeleteLogGroup',
          'logs:PutRetentionPolicy',
          'logs:TagResource',
          'logs:DescribeLogGroups',
        ],
        resources: [
          `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/isb-deployer*`,
        ],
      })
    );

    // STS GetCallerIdentity for CDK deploy
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'STSGetCallerIdentity',
        effect: iam.Effect.ALLOW,
        actions: ['sts:GetCallerIdentity'],
        resources: ['*'],
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'OIDCProviderArn', {
      description: 'ARN of the GitHub OIDC provider',
      value: existingProviderArn,
      exportName: `${this.stackName}-OIDCProviderArn`,
    });

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      description: 'ARN of the GitHub Actions deploy role (use this in GitHub secrets as AWS_DEPLOY_ROLE_ARN)',
      value: this.deployRole.roleArn,
      exportName: `${this.stackName}-DeployRoleArn`,
    });

    new cdk.CfnOutput(this, 'DeployRoleName', {
      description: 'Name of the GitHub Actions deploy role',
      value: this.deployRole.roleName!,
      exportName: `${this.stackName}-DeployRoleName`,
    });

    new cdk.CfnOutput(this, 'GitHubRepoConfig', {
      description: 'GitHub repository this role is configured for',
      value: `${githubOrg}/${githubRepo}:${githubBranch}`,
    });

    new cdk.CfnOutput(this, 'SetupInstructions', {
      description: 'Next steps to complete GitHub Actions OIDC setup',
      value: `1. Copy DeployRoleArn value. 2. In GitHub repo settings > Secrets > Actions, add AWS_DEPLOY_ROLE_ARN secret. 3. Push to main to trigger deployment.`,
    });
  }
}
