# Innovation Sandbox on AWS Deployer

[![CI](https://github.com/co-cddo/innovation-sandbox-on-aws-deployer/workflows/CI/badge.svg)](https://github.com/co-cddo/innovation-sandbox-on-aws-deployer/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)

AWS Lambda function that automatically deploys CloudFormation templates to Innovation Sandbox sub-accounts when leases are approved. This serverless solution listens for "LeaseApproved" events from EventBridge and orchestrates cross-account CloudFormation stack deployments with parameter enrichment from DynamoDB.

## Overview

The Innovation Sandbox Deployer automates the provisioning of AWS resources in sandbox sub-accounts by:

1. Listening for lease approval events via EventBridge
2. Fetching CloudFormation templates from GitHub
3. Enriching deployment parameters from DynamoDB lease data
4. Assuming cross-account IAM roles via STS
5. Deploying CloudFormation stacks in target accounts
6. Emitting success/failure events back to EventBridge

This enables a fully automated, event-driven infrastructure provisioning workflow for Innovation Sandbox environments.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Source Account                           │
│                                                                 │
│  ┌─────────────────┐         ┌──────────────────────────────┐  │
│  │  EventBridge    │         │    DynamoDB                  │  │
│  │                 │         │    isb-leases                │  │
│  │  "Lease         │         │                              │  │
│  │   Approved"     │         │  - leaseId (PK)              │  │
│  │   Event         │         │  - accountId                 │  │
│  └────────┬────────┘         │  - templateName              │  │
│           │                  │  - budgetAmount              │  │
│           │ triggers         │  - requesterEmail            │  │
│           ▼                  └──────────────────────────────┘  │
│  ┌─────────────────────────┐           ▲                      │
│  │   Lambda Function       │           │                      │
│  │   isb-deployer          │           │ query lease          │
│  │                         ├───────────┘                      │
│  │  1. Parse event         │                                  │
│  │  2. Lookup lease        │           ┌────────────────────┐ │
│  │  3. Fetch template      ├──────────▶│   GitHub           │ │
│  │  4. Assume role         │           │   Raw Content      │ │
│  │  5. Deploy stack        │           │                    │ │
│  │  6. Emit status event   │           │   co-cddo/         │ │
│  └──────────┬──────────────┘           │   ndx_try_aws_     │ │
│             │                          │   scenarios        │ │
│             │ AssumeRole               └────────────────────┘ │
│             │                                                 │
└─────────────┼─────────────────────────────────────────────────┘
              │
              │ sts:AssumeRole
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Target Sub-Account                         │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │   IAM Role: ndx_IsbUsersPS                               │  │
│  │                                                          │  │
│  │   Trust Policy: Allows source account to assume         │  │
│  │   Permissions: CloudFormation full access               │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                         │
│                       │ creates/updates                         │
│                       ▼                                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │   CloudFormation Stack                                   │  │
│  │                                                          │  │
│  │   Stack Name: isb-{leaseId}-{templateName}              │  │
│  │   Template: From GitHub                                 │  │
│  │   Parameters: Enriched from lease data                  │  │
│  │   Resources: As defined in template                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Event Flow:
1. EventBridge receives "LeaseApproved" event
2. Lambda triggered and parses event
3. Lambda queries DynamoDB for lease details
4. Lambda fetches CloudFormation template from GitHub raw URL
5. Lambda assumes cross-account IAM role via STS
6. Lambda creates CloudFormation stack in target account
7. Lambda emits "Deployment Succeeded" or "Deployment Failed" event
```

## Prerequisites

Before deploying this solution, ensure you have:

- **AWS Account**: Source account for Lambda and EventBridge
- **Node.js**: Version 20.0.0 or higher
- **AWS CLI**: Configured with appropriate credentials
- **IAM Permissions**: Ability to create Lambda, IAM roles, and EventBridge rules
- **DynamoDB Table**: Existing table for lease data (e.g., `isb-leases`)
- **Target Accounts**: Sub-accounts with assumable IAM role (e.g., `ndx_IsbUsersPS`)
- **GitHub Repository**: Repository containing CloudFormation templates
- **S3 Bucket**: For storing Lambda deployment artifacts

## Environment Variables

The Lambda function is configured via the following environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LEASE_TABLE_NAME` | **Yes** | - | DynamoDB table name for lease lookups. Must have `leaseId` as partition key. |
| `GITHUB_REPO` | No | `co-cddo/ndx_try_aws_scenarios` | GitHub repository in `owner/name` format containing CloudFormation templates. |
| `GITHUB_BRANCH` | No | `main` | GitHub branch to fetch templates from. |
| `GITHUB_PATH` | No | `cloudformation/scenarios` | Path within repository to scenario templates directory. |
| `TARGET_ROLE_NAME` | No | `ndx_IsbUsersPS` | IAM role name to assume in target sub-accounts for CloudFormation operations. |
| `AWS_REGION` | No | `us-west-2` | AWS region for Lambda execution and DynamoDB access. |
| `EVENT_SOURCE` | No | `isb-deployer` | EventBridge source identifier for emitted deployment status events. |
| `LOG_LEVEL` | No | `INFO` | Logging verbosity level. Options: `DEBUG`, `INFO`, `WARN`, `ERROR`. |

These variables are configured in the CloudFormation template and can be overridden via stack parameters.

## Installation

### Clone the Repository

```bash
git clone https://github.com/co-cddo/innovation-sandbox-on-aws-deployer.git
cd innovation-sandbox-on-aws-deployer
```

### Install Dependencies

```bash
npm install
```

### Build the Lambda Bundle

```bash
npm run build:prod
```

This creates an optimized, minified bundle in the `dist/` directory using esbuild.

## Local Development

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build Lambda bundle for development (with source maps) |
| `npm run build:prod` | Build optimized, minified Lambda bundle for production |
| `npm test` | Run unit tests once with Vitest |
| `npm run test:watch` | Run tests in watch mode for development |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Check code quality with ESLint |
| `npm run lint:fix` | Fix auto-fixable ESLint issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check code formatting without modifying files |
| `npm run typecheck` | Run TypeScript type checking without emitting files |
| `npm run check` | Run all checks: typecheck, lint, and test |

### Testing Locally

#### Unit Tests

```bash
# Run all tests
npm test

# Run tests in watch mode during development
npm run test:watch

# Generate coverage report
npm run test:coverage
```

#### Manual Testing with Sample Events

Create a test event file `test-event.json`:

```json
{
  "version": "0",
  "id": "12345678-1234-1234-1234-123456789012",
  "detail-type": "LeaseApproved",
  "source": "innovation-sandbox",
  "account": "123456789012",
  "time": "2025-12-03T10:00:00Z",
  "region": "us-west-2",
  "detail": {
    "leaseId": "lease-001",
    "accountId": "987654321098",
    "templateName": "ec2-instance",
    "status": "approved"
  }
}
```

Set up environment variables and invoke the handler:

```bash
export LEASE_TABLE_NAME=dev-isb-leases
export GITHUB_REPO=co-cddo/ndx_try_aws_scenarios
export GITHUB_BRANCH=main
export GITHUB_PATH=cloudformation/scenarios
export TARGET_ROLE_NAME=ndx_IsbUsersPS
export AWS_REGION=us-west-2
export LOG_LEVEL=DEBUG

# Test with AWS SAM CLI (if installed)
sam local invoke -e test-event.json

# Or use the AWS Lambda Runtime Interface Emulator
docker run -p 9000:8080 \
  -e LEASE_TABLE_NAME \
  -e GITHUB_REPO \
  -e GITHUB_BRANCH \
  -e GITHUB_PATH \
  -e TARGET_ROLE_NAME \
  -e AWS_REGION \
  -e LOG_LEVEL \
  -v $PWD/dist:/var/task \
  public.ecr.aws/lambda/nodejs:20 \
  handler.handler
```

### Code Quality

Before committing, ensure all checks pass:

```bash
npm run check
```

This runs TypeScript type checking, ESLint, and all tests.

## Deployment

### Package Lambda Function

```bash
npm run build:prod
cd dist
zip -r ../lambda-function.zip .
cd ..
```

### Upload to S3

```bash
aws s3 cp lambda-function.zip s3://your-artifact-bucket/lambda/handler.zip
```

### Deploy CloudFormation Stack

#### Using AWS CLI

```bash
aws cloudformation deploy \
  --template-file infrastructure/template.yaml \
  --stack-name isb-deployer-dev \
  --parameter-overrides \
    Environment=dev \
    LeaseTableName=dev-isb-leases \
    ArtifactBucket=your-artifact-bucket \
    ArtifactKey=lambda/handler.zip \
    GithubRepo=co-cddo/ndx_try_aws_scenarios \
    GithubBranch=main \
    GithubPath=cloudformation/scenarios \
    TargetRoleName=ndx_IsbUsersPS \
    EventSource=innovation-sandbox \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-west-2
```

#### Using Parameter Files

Parameter files are provided for different environments:

- `infrastructure/parameters/dev.json`
- `infrastructure/parameters/staging.json`
- `infrastructure/parameters/prod.json`

Deploy with a parameter file:

```bash
aws cloudformation deploy \
  --template-file infrastructure/template.yaml \
  --stack-name isb-deployer-dev \
  --parameter-overrides file://infrastructure/parameters/dev.json \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-west-2
```

### Automated Deployment via CI/CD

The project includes a GitHub Actions workflow (`.github/workflows/ci.yml`) that automatically:

1. Runs linting, type checking, and tests on pull requests
2. Builds the Lambda bundle
3. Deploys to production on merge to `main` branch

**Required GitHub Secrets:**

- `AWS_DEPLOY_ROLE_ARN`: IAM role ARN for GitHub OIDC authentication

**Required GitHub Variables:**

- `LEASE_TABLE_NAME`: DynamoDB table name
- `AWS_REGION`: AWS region (default: `us-west-2`)
- `TARGET_ROLE_NAME`: IAM role in target accounts (optional)
- `GITHUB_REPO`: Template repository (optional)
- `GITHUB_BRANCH`: Template branch (optional)
- `GITHUB_PATH`: Template path (optional)

## Configuration

### CloudFormation Parameters

The following parameters can be customized during stack deployment:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `Environment` | String | `dev` | Deployment environment (dev/staging/prod). Controls log level and resource naming. |
| `LeaseTableName` | String | `isb-leases` | DynamoDB table name for lease data. |
| `GithubRepo` | String | `co-cddo/ndx_try_aws_scenarios` | GitHub repository for templates. |
| `GithubBranch` | String | `main` | GitHub branch for templates. |
| `GithubPath` | String | `cloudformation/scenarios` | Path to templates in repository. |
| `TargetRoleName` | String | `ndx_IsbUsersPS` | IAM role name in target accounts. |
| `EventSource` | String | `innovation-sandbox` | EventBridge source filter. |
| `ArtifactBucket` | String | - | S3 bucket containing Lambda deployment package. |
| `ArtifactKey` | String | `lambda/handler.zip` | S3 key for Lambda deployment package. |

### DynamoDB Lease Table Schema

The lease table must have the following structure:

**Primary Key:**
- `leaseId` (String) - Partition key

**Attributes:**
- `accountId` (String) - Target AWS account ID
- `templateName` (String) - CloudFormation template filename (without extension)
- `budgetAmount` (Number, optional) - Budget allocated for the lease
- `expirationDate` (String, optional) - ISO 8601 expiration timestamp
- `requesterEmail` (String, optional) - Email of requester

**Example Item:**

```json
{
  "leaseId": "lease-001",
  "accountId": "987654321098",
  "templateName": "ec2-instance",
  "budgetAmount": 100,
  "expirationDate": "2025-12-31T23:59:59Z",
  "requesterEmail": "user@example.gov.uk"
}
```

### Target Account IAM Role

Each target sub-account must have an assumable IAM role with:

**Trust Policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::SOURCE_ACCOUNT_ID:role/isb-deployer-role-ENV"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**Permissions Policy:**

Attach `CloudFormationFullAccess` or a custom policy allowing:
- `cloudformation:CreateStack`
- `cloudformation:UpdateStack`
- `cloudformation:DescribeStacks`
- `cloudformation:GetTemplate`
- Resource-specific permissions (e.g., EC2, S3, IAM) based on templates

## Event Handling

### Input Event Format

The Lambda function expects EventBridge events with the following structure:

```json
{
  "version": "0",
  "id": "unique-event-id",
  "detail-type": "LeaseApproved",
  "source": "innovation-sandbox",
  "account": "123456789012",
  "time": "2025-12-03T10:00:00Z",
  "region": "us-west-2",
  "detail": {
    "leaseId": "lease-001",
    "accountId": "987654321098",
    "templateName": "ec2-instance",
    "status": "approved"
  }
}
```

**Required Fields:**
- `detail.leaseId`: Unique lease identifier (used for DynamoDB lookup)
- `detail.accountId`: Target AWS account ID
- `detail.templateName`: CloudFormation template name (optional in event, required in DynamoDB)

### Output Events

The Lambda function emits deployment status events back to EventBridge:

#### Success Event

```json
{
  "source": "isb-deployer",
  "detail-type": "Deployment Succeeded",
  "detail": {
    "leaseId": "lease-001",
    "accountId": "987654321098",
    "templateName": "ec2-instance",
    "stackName": "isb-lease-001-ec2-instance",
    "stackId": "arn:aws:cloudformation:us-west-2:987654321098:stack/..."
  }
}
```

#### Failure Event

```json
{
  "source": "isb-deployer",
  "detail-type": "Deployment Failed",
  "detail": {
    "leaseId": "lease-001",
    "accountId": "987654321098",
    "templateName": "ec2-instance",
    "error": "Template validation failed: Missing required parameter",
    "errorType": "ValidationError"
  }
}
```

### EventBridge Rule

The CloudFormation template creates an EventBridge rule that filters for:

- **Source**: Value of `EventSource` parameter (default: `innovation-sandbox`)
- **Detail Type**: `LeaseApproved`

To send events from another system:

```bash
aws events put-events \
  --entries '[
    {
      "Source": "innovation-sandbox",
      "DetailType": "LeaseApproved",
      "Detail": "{\"leaseId\":\"lease-001\",\"accountId\":\"987654321098\",\"templateName\":\"ec2-instance\",\"status\":\"approved\"}"
    }
  ]'
```

## Monitoring & Debugging

### CloudWatch Logs

Lambda execution logs are automatically sent to CloudWatch Logs:

**Log Group**: `/aws/lambda/isb-deployer-{environment}`

View logs:

```bash
aws logs tail /aws/lambda/isb-deployer-dev --follow
```

### Log Levels

Set `LOG_LEVEL` environment variable to control verbosity:

- `DEBUG`: Detailed information for diagnosing problems
- `INFO`: Confirmation that things are working as expected (default for prod)
- `WARN`: Warning messages for recoverable issues
- `ERROR`: Error messages for failures

### Common Issues

#### Issue: "Template not found" Error

**Symptom**: Lambda fails with "Template not found" message

**Causes:**
1. Template doesn't exist in GitHub repository
2. Incorrect `GITHUB_REPO`, `GITHUB_BRANCH`, or `GITHUB_PATH` configuration
3. GitHub repository is private (Lambda requires public repositories)

**Solution:**
- Verify template exists at: `https://raw.githubusercontent.com/{GITHUB_REPO}/{GITHUB_BRANCH}/{GITHUB_PATH}/{templateName}.yaml`
- Check environment variables in Lambda console
- Enable DEBUG logging to see constructed URL

#### Issue: "Access Denied" when Assuming Role

**Symptom**: Lambda fails with STS AssumeRole access denied

**Causes:**
1. Target account IAM role doesn't exist
2. Trust policy doesn't allow source account to assume role
3. Role name mismatch (check `TARGET_ROLE_NAME`)

**Solution:**
- Verify IAM role exists in target account: `aws iam get-role --role-name ndx_IsbUsersPS`
- Check trust policy allows source account
- Verify `TARGET_ROLE_NAME` environment variable matches actual role name

#### Issue: "Lease not found in DynamoDB"

**Symptom**: Lambda fails to find lease record

**Causes:**
1. LeaseId in event doesn't match DynamoDB item
2. DynamoDB table name incorrect
3. Insufficient IAM permissions for DynamoDB

**Solution:**
- Query DynamoDB directly: `aws dynamodb get-item --table-name dev-isb-leases --key '{"leaseId":{"S":"lease-001"}}'`
- Verify `LEASE_TABLE_NAME` environment variable
- Check Lambda IAM role has `dynamodb:GetItem` permission

#### Issue: CloudFormation Stack Creation Fails

**Symptom**: Stack creation initiated but fails in CloudFormation

**Causes:**
1. Template syntax errors
2. Missing required parameters
3. Insufficient permissions in target account role
4. Resource limits or quotas exceeded

**Solution:**
- Check CloudFormation console in target account for error details
- Validate template locally: `aws cloudformation validate-template --template-body file://template.yaml`
- Review assumed role permissions
- Check AWS service quotas

### Troubleshooting Commands

```bash
# Check Lambda function configuration
aws lambda get-function-configuration --function-name isb-deployer-dev

# Test Lambda function with sample event
aws lambda invoke \
  --function-name isb-deployer-dev \
  --payload file://test-event.json \
  response.json

# View recent Lambda invocations
aws lambda get-function --function-name isb-deployer-dev \
  --query 'Configuration.LastModified'

# Check EventBridge rule
aws events list-rules --name-prefix isb-deployer

# Describe CloudFormation stack in target account (requires assumed role)
aws cloudformation describe-stacks \
  --stack-name isb-lease-001-ec2-instance \
  --region us-west-2 \
  --profile target-account
```

## Project Structure

```
innovation-sandbox-on-aws-deployer/
├── src/
│   ├── handler.ts              # Lambda entry point
│   ├── modules/
│   │   ├── config.ts           # Configuration management
│   │   ├── logger.ts           # Structured logging
│   │   ├── event-parser.ts    # Event parsing and validation
│   │   ├── event-emitter.ts   # EventBridge event emission
│   │   └── utils.ts            # Utility functions (URL, stack name)
│   └── types/
│       └── index.ts            # TypeScript type definitions
├── tests/
│   ├── unit/
│   │   ├── config.test.ts
│   │   ├── logger.test.ts
│   │   ├── event-parser.test.ts
│   │   ├── event-emitter.test.ts
│   │   └── utils.test.ts
│   └── __fixtures__/           # Test fixtures and mock data
├── infrastructure/
│   ├── template.yaml           # CloudFormation template
│   └── parameters/
│       ├── dev.json            # Development environment parameters
│       ├── staging.json        # Staging environment parameters
│       └── prod.json           # Production environment parameters
├── .github/
│   └── workflows/
│       └── ci.yml              # GitHub Actions CI/CD pipeline
├── dist/                       # Build output (gitignored)
├── coverage/                   # Test coverage reports (gitignored)
├── package.json                # Node.js dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── vitest.config.ts            # Vitest test configuration
├── .eslintrc.cjs               # ESLint configuration
├── .prettierrc                 # Prettier configuration
└── README.md                   # This file
```

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork the repository** and create a feature branch
2. **Follow coding standards**: Run `npm run check` before committing
3. **Write tests**: Maintain or improve code coverage
4. **Update documentation**: Keep README and code comments current
5. **Use conventional commits**: Format commit messages as `type(scope): description`
   - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
   - Example: `feat(deployer): add support for multi-region deployments`
6. **Submit a pull request** with a clear description of changes

### Development Workflow

```bash
# Create feature branch
git checkout -b feature/my-new-feature

# Make changes and test
npm run test:watch

# Run all checks
npm run check

# Commit changes
git commit -m "feat(module): add new feature"

# Push and create PR
git push origin feature/my-new-feature
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Support

For issues, questions, or contributions:

- **GitHub Issues**: [Report a bug or request a feature](https://github.com/co-cddo/innovation-sandbox-on-aws-deployer/issues)
- **Team Contact**: NDX Team (GDS)

## Related Projects

- [co-cddo/ndx_try_aws_scenarios](https://github.com/co-cddo/ndx_try_aws_scenarios) - CloudFormation scenario templates
- [Innovation Sandbox Platform](https://github.com/co-cddo/innovation-sandbox) - Main platform repository

---

**Built with** TypeScript, AWS Lambda, EventBridge, and CloudFormation by the NDX Team at GDS.
