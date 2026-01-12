#!/usr/bin/env node
/**
 * CDK App Entry Point for Innovation Sandbox Deployer Infrastructure
 *
 * This app defines two stacks:
 * 1. GitHubOidcStack - GitHub OIDC provider and Actions role (deploy once)
 * 2. DeployerStack - Lambda function, ECR, EventBridge rule (deploy on each push)
 *
 * Usage:
 *   cdk deploy GitHubOidcStack  # One-time deployment
 *   cdk deploy DeployerStack -c imageTag=abc123 -c environment=dev
 */

import * as cdk from 'aws-cdk-lib';
import { DeployerStack } from '../lib/deployer-stack.js';
import { GitHubOidcStack } from '../lib/github-oidc-stack.js';

const app = new cdk.App();

// Get context values with defaults
const imageTag = app.node.tryGetContext('imageTag') || 'latest';

// Production configuration - deployer runs in us-west-2, deploys to us-east-1
const config = {
  leaseTableName: 'ndx-try-isb-data-LeaseTable473C6DF2-1RC3238PVASE1',
  leaseTableRegion: 'us-west-2',
  githubRepo: 'co-cddo/ndx_try_aws_scenarios',
  githubBranch: 'main',
  githubPath: 'cloudformation/scenarios',
  githubTokenSecretArn: 'arn:aws:secretsmanager:us-west-2:568672915267:secret:isb-deployer/github-token-NZqylu',
  targetRoleName: 'InnovationSandbox-ndx-DeployerRole',
};

// Common stack props - Lambda runs in us-west-2 where ISB is deployed
// The Lambda itself deploys CloudFormation stacks to us-east-1 (via config.deployRegion)
const stackProps: cdk.StackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-west-2', // Lambda runs in ISB's region
  },
  tags: {
    Application: 'innovation-sandbox-deployer',
    ManagedBy: 'CDK',
  },
};

// GitHub OIDC Stack (deploy once, rarely changes)
new GitHubOidcStack(app, 'GitHubOidcStack', {
  ...stackProps,
  stackName: 'isb-deployer-github-oidc',
  description: 'GitHub OIDC provider and Actions role for ISB Deployer CI/CD',
  githubOrg: 'co-cddo',
  githubRepo: 'innovation-sandbox-on-aws-deployer',
  githubBranch: 'main',
  environment: 'prod',
});

// Deployer Stack (deploy on each push to main)
new DeployerStack(app, 'DeployerStack', {
  ...stackProps,
  stackName: 'isb-deployer-prod',
  description: 'Innovation Sandbox Deployer Lambda and EventBridge infrastructure',
  environment: 'prod',
  imageTag,
  leaseTableName: config.leaseTableName,
  leaseTableRegion: config.leaseTableRegion,
  githubRepo: config.githubRepo,
  githubBranch: config.githubBranch,
  githubPath: config.githubPath,
  githubTokenSecretArn: config.githubTokenSecretArn,
  targetRoleName: config.targetRoleName,
});

app.synth();
