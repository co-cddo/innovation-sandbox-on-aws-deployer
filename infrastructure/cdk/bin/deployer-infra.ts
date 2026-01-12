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
const environment = app.node.tryGetContext('environment') || 'dev';
const imageTag = app.node.tryGetContext('imageTag') || 'latest';

// Configuration based on environment
const config = {
  dev: {
    leaseTableName: 'ndx-try-isb-data-LeaseTable473C6DF2-1RC3238PVASE1',
    leaseTableRegion: 'us-west-2',
    githubRepo: 'co-cddo/ndx_try_aws_scenarios',
    githubBranch: 'main',
    githubPath: 'cloudformation/scenarios',
    githubTokenSecretArn: 'arn:aws:secretsmanager:us-east-1:568672915267:secret:isb-deployer/github-token-pAKbvA',
    targetRoleName: 'InnovationSandbox-ndx-DeployerRole',
    eventSource: 'sandbox.leasing',
  },
  prod: {
    leaseTableName: 'ndx-try-isb-data-LeaseTable473C6DF2-1RC3238PVASE1',
    leaseTableRegion: 'us-west-2',
    githubRepo: 'co-cddo/ndx_try_aws_scenarios',
    githubBranch: 'main',
    githubPath: 'cloudformation/scenarios',
    githubTokenSecretArn: 'arn:aws:secretsmanager:us-east-1:568672915267:secret:isb-deployer/github-token-pAKbvA',
    targetRoleName: 'InnovationSandbox-ndx-DeployerRole',
    eventSource: 'sandbox.leasing',
  },
}[environment as 'dev' | 'prod'] || {
  leaseTableName: 'ndx-try-isb-data-LeaseTable473C6DF2-1RC3238PVASE1',
  leaseTableRegion: 'us-west-2',
  githubRepo: 'co-cddo/ndx_try_aws_scenarios',
  githubBranch: 'main',
  githubPath: 'cloudformation/scenarios',
  targetRoleName: 'InnovationSandbox-ndx-DeployerRole',
  eventSource: 'sandbox.leasing',
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
    Environment: environment,
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
  environment,
});

// Deployer Stack (deploy on each push to main)
new DeployerStack(app, 'DeployerStack', {
  ...stackProps,
  stackName: `isb-deployer-${environment}`,
  description: 'Innovation Sandbox Deployer Lambda and EventBridge infrastructure',
  environment,
  imageTag,
  leaseTableName: config.leaseTableName,
  leaseTableRegion: config.leaseTableRegion,
  githubRepo: config.githubRepo,
  githubBranch: config.githubBranch,
  githubPath: config.githubPath,
  githubTokenSecretArn: config.githubTokenSecretArn,
  targetRoleName: config.targetRoleName,
  eventSource: config.eventSource,
});

app.synth();
