# CloudFormation Parameters

This directory contains environment-specific parameter files for deploying the Innovation Sandbox Deployer CloudFormation stack.

## Parameter Files

- `dev.json` - Development environment parameters
- `staging.json` - Staging environment parameters
- `prod.json` - Production environment parameters

## Usage

When deploying the CloudFormation stack, reference the appropriate parameter file:

```bash
# Deploy to development
aws cloudformation deploy \
  --template-file ../template.yaml \
  --stack-name isb-deployer-dev \
  --parameter-overrides file://./parameters/dev.json \
  --capabilities CAPABILITY_NAMED_IAM

# Deploy to staging
aws cloudformation deploy \
  --template-file ../template.yaml \
  --stack-name isb-deployer-staging \
  --parameter-overrides file://./parameters/staging.json \
  --capabilities CAPABILITY_NAMED_IAM

# Deploy to production
aws cloudformation deploy \
  --template-file ../template.yaml \
  --stack-name isb-deployer-prod \
  --parameter-overrides file://./parameters/prod.json \
  --capabilities CAPABILITY_NAMED_IAM
```

## Parameter Descriptions

### Environment Configuration
- **Environment**: Deployment environment (dev/staging/prod). Controls log level and resource naming.

### Data Storage
- **LeaseTableName**: DynamoDB table name for lease data lookups. Must be an existing table accessible by the Lambda function.

### GitHub Repository Configuration
- **GithubRepo**: GitHub repository in owner/name format where CloudFormation scenario templates are stored
- **GithubBranch**: GitHub branch to fetch templates from. Defaults to main branch.
- **GithubPath**: Path within the repository to scenario templates directory (without leading/trailing slashes)

### Cross-Account Access
- **TargetRoleName**: IAM role name to assume in target sub-accounts for CloudFormation deployment operations

### Event Configuration
- **EventSource**: EventBridge event source to filter for lease approved events. Must match the source field in incoming events.

### Deployment Artifacts
- **ArtifactBucket**: S3 bucket name containing the Lambda deployment package (.zip file). Must be in the same region as the stack.
- **ArtifactKey**: S3 object key for the Lambda deployment package (.zip file)

## Customization

Before deploying to a specific environment:

1. Review the parameter values in the corresponding JSON file
2. Update the `ArtifactBucket` to match your actual S3 bucket name
3. Ensure the `LeaseTableName` matches the actual DynamoDB table in that environment
4. Verify the `GithubRepo`, `GithubBranch`, and `GithubPath` point to the correct template repository

## Validation

All parameters include validation constraints in the CloudFormation template:
- Pattern matching for correct format (e.g., GitHub repo must be owner/name)
- Length constraints (min/max)
- Allowed values for enums (e.g., Environment must be dev/staging/prod)

If you provide invalid parameter values, CloudFormation will reject the stack creation/update with a descriptive error message.
