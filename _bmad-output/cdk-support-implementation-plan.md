# CDK Support Implementation Plan

**Date:** 2026-01-09
**Status:** Approved
**Authors:** Party Mode Session (Winston, Amelia, Barry, Murat, John, Mary)
**Approved by:** Cns (2026-01-09)

---

## Executive Summary

Add support for AWS CDK scenarios alongside existing CloudFormation templates. The Lambda deployer will automatically detect scenario type and synthesize CDK projects before deployment.

**Key Decision:** Lambda Container Image with CDK CLI (revised from original Lambda Layer approach after research).

---

## Research Findings (2026-01-09)

### Critical Discovery: Lambda Layer Approach is HIGH RISK

Research revealed significant concerns with the original Lambda Layer approach:

| Factor | Finding | Impact |
|--------|---------|--------|
| **CDK CLI + deps size** | ~234MB (aws-cdk-lib alone is ~101MB) | Approaches/exceeds 250MB layer limit |
| **Cold start penalty** | ~1 minute for first CDK operation | Unacceptable for production |
| **Research consensus** | "Not recommended" for Lambda layers | HIGH RISK |

### Recommended Alternative: Lambda Container Image

| Factor | Container Image | Lambda Layer |
|--------|-----------------|--------------|
| Size limit | **10GB** | 250MB |
| Cold start | Competitive with zip (AWS optimized 2025) | ~1 minute with CDK |
| Complexity | Dockerfile required | Simpler |
| Reliability | **High** | Medium-Low |

### GitHub API Updates (2025)

**IMPORTANT:** `raw.githubusercontent.com` is **NOW RATE-LIMITED** as of 2025.

| Method | Rate Limit |
|--------|------------|
| Unauthenticated | 60 requests/hour |
| With token | 5,000 requests/hour |
| raw.githubusercontent.com | **No longer unlimited** |

**Recommended approach:** Use GitHub **Tarball API** for efficient folder downloads:
```
GET /repos/{owner}/{repo}/tarball/{ref}
```
Single API call downloads entire repo as compressed archive.

### localgov-drupal Analysis

**Project Structure:**
```
cdk/
├── bin/app.ts          # Entry point
├── lib/
│   ├── localgov-drupal-stack.ts  # Main stack (5KB)
│   └── constructs/               # Custom constructs
├── cdk.json            # CDK config with context flags
├── package.json        # CDK 2.173.1
└── tsconfig.json
```

**Stack Complexity:** HIGH
- Aurora Serverless v2 (MySQL)
- EFS for persistent storage
- Fargate containers with ALB
- CloudFront distribution
- AI services (Bedrock, Polly, Translate, Rekognition, Textract)

**CDK Version:** 2.173.1 (must ensure compatibility)

**Critical cdk.json Context Flags:**
- `@aws-cdk/aws-lambda:recognizeLayerVersion`
- `@aws-cdk/core:target-partitions: ["aws"]`
- Multiple ECS, RDS, and core feature flags

These context flags **MUST be preserved** during synthesis.

### Programmatic Synthesis Option

Research found CDK can be synthesized **without the CLI**:

```typescript
// Minimum deps: aws-cdk-lib + constructs (~101MB)
const app = new cdk.App({ outdir: '/tmp/cdk.out' });
new MyStack(app, 'MyStack');
const cloudAssembly = app.synth();
const template = cloudAssembly.getStackByName('MyStack').template;
```

**Caveat:** `app.synth()` doesn't read `cdk.json` by default - context must be passed manually.

---

## Current Architecture

```
EventBridge (LeaseApproved)
    ↓
Lambda handler.ts
    ↓
template-handler.ts → github-url.ts → template-fetcher.ts
    ↓                      ↓                   ↓
    │              Build raw.githubusercontent URL
    │                                          ↓
    │                              HTTP GET template.yaml
    ↓
template-validator.ts → stack-deployer.ts
```

**Limitation:** Only fetches single `template.yaml` file. Cannot handle CDK projects.

---

## Target Architecture

```
EventBridge (LeaseApproved)
    ↓
Lambda handler.ts
    ↓
template-handler.ts → template-resolver.ts (NEW)
                           ↓
                    scenario-detector.ts (NEW)
                           ↓
              ┌────────────┴────────────┐
              ↓                         ↓
         CDK Scenario              CF Scenario
              ↓                         ↓
    scenario-fetcher.ts (NEW)    github-url.ts (existing)
              ↓                         ↓
    cdk-synthesizer.ts (NEW)     template-fetcher.ts (existing)
              ↓                         ↓
         Read cdk.out              Return YAML
              ↓                         ↓
              └────────────┬────────────┘
                           ↓
                  template-validator.ts
                           ↓
                    stack-deployer.ts
```

---

## Implementation Phases

### Phase 1: New Modules

#### 1.1 `src/modules/scenario-detector.ts`

**Purpose:** Determine if a scenario is CDK or CloudFormation by querying GitHub API.

**Interface:**
```typescript
export type ScenarioType = 'cdk' | 'cdk-subfolder' | 'cloudformation';

export interface ScenarioDetectionResult {
  type: ScenarioType;
  cdkPath?: string;  // Relative path to cdk.json (e.g., '' or 'cdk/')
}

export async function detectScenarioType(
  templateName: string,
  config?: Config
): Promise<ScenarioDetectionResult>;
```

**Logic:**
1. Query `GET /repos/{owner}/{repo}/contents/{path}/{templateName}`
2. Parse response for file/directory listing
3. Check for `cdk.json` file → return `{ type: 'cdk', cdkPath: '' }`
4. Check for `cdk` directory → return `{ type: 'cdk-subfolder', cdkPath: 'cdk/' }`
5. Otherwise → return `{ type: 'cloudformation' }`

**Dependencies:**
- Native `fetch` for GitHub API
- `config.ts` for repo/branch/path settings
- New env var: `GITHUB_TOKEN` (optional, for rate limits)

**Error Handling:**
- 404 → Scenario not found (let template-handler handle gracefully)
- 403 → Rate limited (throw specific error)
- Network errors → Propagate with context

---

#### 1.2 `src/modules/scenario-fetcher.ts`

**Purpose:** Download entire scenario folder to Lambda's `/tmp` filesystem.

**Interface:**
```typescript
export interface FetchedScenario {
  localPath: string;     // e.g., '/tmp/localgov-drupal-abc123'
  cdkPath: string;       // e.g., '/tmp/localgov-drupal-abc123/cdk'
  cleanup: () => void;   // Remove temp files
}

export async function fetchScenarioFolder(
  templateName: string,
  cdkSubpath: string,
  config?: Config
): Promise<FetchedScenario>;
```

**Logic:**
1. Create unique temp directory: `/tmp/{templateName}-{uuid}`
2. Use GitHub API to recursively fetch folder contents
3. For each file: download raw content and write to temp path
4. For each directory: recurse
5. Return paths and cleanup function

**GitHub API Strategy: Sparse Git Clone (User Decision)**

Based on user decision, using sparse git clone for optimal precision and minimal downloads.

**Implementation Details:**

```typescript
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export async function fetchScenarioFolder(
  templateName: string,
  cdkSubpath: string,
  config: Config
): Promise<FetchedScenario> {
  const uuid = crypto.randomUUID().slice(0, 8);
  const localPath = `/tmp/${templateName}-${uuid}`;
  const scenarioPath = `${config.githubPath}/${templateName}`;

  // Build authenticated URL
  const authUrl = `https://${config.githubToken}@github.com/${config.githubRepo}.git`;

  // Step 1: Clone with partial clone + no checkout (fast, minimal download)
  execSync(
    `git clone --filter=blob:none --no-checkout --depth 1 "${authUrl}" "${localPath}"`,
    { timeout: 60_000, stdio: 'pipe' }
  );

  // Step 2: Initialize sparse-checkout in cone mode
  execSync('git sparse-checkout init --cone', { cwd: localPath, stdio: 'pipe' });

  // Step 3: Set specific folder to checkout
  execSync(`git sparse-checkout set "${scenarioPath}"`, { cwd: localPath, stdio: 'pipe' });

  // Step 4: Checkout the branch
  execSync(`git checkout ${config.githubBranch}`, { cwd: localPath, stdio: 'pipe' });

  // Step 5: Remove .git to free space
  fs.rmSync(path.join(localPath, '.git'), { recursive: true, force: true });

  const cdkPath = path.join(localPath, scenarioPath, cdkSubpath);

  return {
    localPath,
    cdkPath,
    cleanup: () => fs.rmSync(localPath, { recursive: true, force: true })
  };
}
```

**Performance (from research):**
- Sparse clone + partial clone: **93-98% faster** than full clone
- Downloads only commits/trees initially, blobs fetched on-demand
- Typical time: 5-15 seconds vs 5-15 minutes for full clone

**Git Version Requirements:**
- Minimum: Git 2.25.0 (sparse-checkout command)
- Recommended: Git 2.27.0+ (cone mode default)
- Container includes Git 2.39+ (Amazon Linux 2023)

**Rate Limits:**
- Uses git protocol (not GitHub API) - different rate limiting
- GITHUB_TOKEN required for authentication
- Token embedded in clone URL: `https://{token}@github.com/...`

---

#### 1.3 `src/modules/cdk-synthesizer.ts`

**Purpose:** Run `npm ci` and `cdk synth` in the fetched scenario folder.

**Interface:**
```typescript
export interface SynthesisResult {
  templateBody: string;   // Synthesized CloudFormation template
  stackName?: string;     // Detected stack name from cdk.out
}

export async function synthesizeCdk(
  cdkPath: string,
  logger: Logger
): Promise<SynthesisResult>;
```

**Logic (REVISED for Runtime CDK Installation):**

Based on user decision to install CDK version at runtime from project's package.json:

1. Read `package.json` from CDK project folder
2. Extract CDK version from `dependencies["aws-cdk-lib"]` or `devDependencies["aws-cdk"]`
3. Check if correct CDK version is cached in `/tmp`
4. Install CDK if needed (with optimization flags)
5. Run `npm ci` in project folder (install project dependencies)
6. Run `cdk synth` to generate CloudFormation template
7. Find and return generated template

**Implementation Details:**

```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const CDK_INSTALL_DIR = '/tmp/cdk-runtime';
const CDK_VERSION_MARKER = '/tmp/cdk-installed-version.txt';
const NPM_CACHE_DIR = '/tmp/.npm';

/**
 * Detect CDK version from project's package.json
 */
function detectCDKVersion(cdkPath: string): string {
  const packageJsonPath = path.join(cdkPath, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  // Check multiple possible locations
  const version =
    pkg.dependencies?.['aws-cdk-lib'] ||
    pkg.devDependencies?.['aws-cdk'] ||
    pkg.devDependencies?.['aws-cdk-lib'] ||
    pkg.peerDependencies?.['aws-cdk-lib'];

  if (!version) {
    throw new Error('Could not find CDK version in package.json');
  }

  // Strip version range operators (^, ~, >=)
  return version.replace(/^[\^~>=<]+/, '');
}

/**
 * Check if CDK is cached with correct version
 */
function isCDKCached(targetVersion: string): boolean {
  if (!fs.existsSync(CDK_VERSION_MARKER)) return false;
  const cached = fs.readFileSync(CDK_VERSION_MARKER, 'utf-8').trim();
  return cached === targetVersion;
}

/**
 * Install CDK to /tmp with optimization flags
 */
function installCDK(version: string, logger: Logger): void {
  logger.info(`Installing aws-cdk@${version}...`);

  // Set npm cache to writable location (CRITICAL for Lambda)
  process.env.NPM_CONFIG_CACHE = NPM_CACHE_DIR;

  fs.mkdirSync(CDK_INSTALL_DIR, { recursive: true });

  // Optimized installation (16-30% faster with these flags)
  execSync(
    `npm install --prefix ${CDK_INSTALL_DIR} aws-cdk@${version} ` +
    `--no-save --no-audit --no-fund --prefer-offline --loglevel error`,
    {
      timeout: 120_000, // 2 minutes
      env: { ...process.env, NPM_CONFIG_CACHE, HOME: '/tmp' }
    }
  );

  // Mark version for cache validation
  fs.writeFileSync(CDK_VERSION_MARKER, version);
  logger.info(`CDK ${version} installed successfully`);
}

/**
 * Main synthesis function
 */
export async function synthesizeCdk(
  cdkPath: string,
  logger: Logger
): Promise<SynthesisResult> {
  // Step 1: Detect and install correct CDK version
  const cdkVersion = detectCDKVersion(cdkPath);
  logger.info(`Detected CDK version: ${cdkVersion}`);

  if (!isCDKCached(cdkVersion)) {
    installCDK(cdkVersion, logger);
  } else {
    logger.info(`Using cached CDK ${cdkVersion}`);
  }

  // Step 2: Install project dependencies
  logger.info('Installing project dependencies...');
  execSync('npm ci --prefer-offline', {
    cwd: cdkPath,
    timeout: 180_000, // 3 minutes
    env: { ...process.env, NPM_CONFIG_CACHE }
  });

  // Step 3: Run CDK synth
  const cdkBin = path.join(CDK_INSTALL_DIR, 'node_modules', '.bin', 'cdk');
  const cdkOutDir = `/tmp/cdk.out-${Date.now()}`;

  logger.info('Running CDK synthesis...');
  execSync(
    `${cdkBin} synth --output ${cdkOutDir} --quiet`,
    {
      cwd: cdkPath,
      timeout: 180_000, // 3 minutes
      env: {
        ...process.env,
        CDK_DEFAULT_ACCOUNT: process.env.AWS_ACCOUNT_ID,
        CDK_DEFAULT_REGION: 'us-east-1'
      }
    }
  );

  // Step 4: Find and read template
  const files = fs.readdirSync(cdkOutDir);
  const templateFile = files.find(f => f.endsWith('.template.json'));

  if (!templateFile) {
    throw new Error('No template.json found in cdk.out');
  }

  const templateBody = fs.readFileSync(
    path.join(cdkOutDir, templateFile),
    'utf-8'
  );

  // Cleanup cdk.out
  fs.rmSync(cdkOutDir, { recursive: true, force: true });

  return {
    templateBody,
    stackName: templateFile.replace('.template.json', '')
  };
}
```

**Performance Expectations (from research):**

| Phase | Cold Start | Warm Start (cached) |
|-------|------------|---------------------|
| CDK version detection | <0.1s | <0.1s |
| CDK installation | 10-20s | **0s (cached)** |
| npm ci (project deps) | 10-30s | 5-15s (npm cache) |
| CDK synthesis | 10-60s | 10-60s |
| **Total** | **30-110s** | **15-75s** |

**Optimization Flags Used:**
- `--no-audit`: 16% faster (skips security audit)
- `--prefer-offline`: 30%+ faster when cached
- `--no-save`: Avoids package.json writes
- `--no-fund`: Suppresses funding messages

**Timeout Strategy:**
```typescript
const CDK_INSTALL_TIMEOUT = 120_000;  // 2 minutes
const NPM_CI_TIMEOUT = 180_000;       // 3 minutes
const CDK_SYNTH_TIMEOUT = 180_000;    // 3 minutes
```

**Error Handling:**
- npm ci failure → `DependencyInstallError`
- cdk synth failure → `SynthesisError` (include stderr)
- Timeout → `SynthesisTimeoutError`
- No template found → `TemplateNotFoundError`
- Version detection failure → `VersionDetectionError`

---

#### 1.4 `src/modules/template-resolver.ts`

**Purpose:** Orchestrate the detection → fetch → synthesize/fetch flow.

**Interface:**
```typescript
export interface ResolvedTemplate {
  templateBody: string;
  source: 'cdk' | 'cloudformation';
  synthesized: boolean;
}

export async function resolveTemplate(
  templateName: string,
  logger: Logger
): Promise<ResolvedTemplate | null>;
```

**Logic:**
```typescript
async function resolveTemplate(templateName, logger) {
  // 1. Detect scenario type
  const detection = await detectScenarioType(templateName);

  if (detection.type === 'cloudformation') {
    // 2a. Existing flow - fetch single YAML
    const url = buildTemplateUrl(templateName);
    const template = await fetchTemplate(url);
    return { templateBody: template, source: 'cloudformation', synthesized: false };
  }

  // 2b. CDK flow
  const scenario = await fetchScenarioFolder(templateName, detection.cdkPath);
  try {
    const result = await synthesizeCdk(scenario.cdkPath, logger);
    return { templateBody: result.templateBody, source: 'cdk', synthesized: true };
  } finally {
    scenario.cleanup();
  }
}
```

---

### Phase 2: Modify Existing Modules

#### 2.1 `src/modules/template-handler.ts`

**Changes:**
- Replace direct `fetchTemplate()` call with `resolveTemplate()`
- Update logging to indicate source type
- Handle new error types

**Before (lines 71-92):**
```typescript
const url = buildTemplateUrl(templateName);
const template = await fetchTemplate(url);
return { skip: false, template };
```

**After:**
```typescript
const resolved = await resolveTemplate(templateName, logger);
if (!resolved) {
  return { skip: true, reason: 'Template not found' };
}
logger.info('Template resolved', {
  source: resolved.source,
  synthesized: resolved.synthesized,
});
return { skip: false, template: resolved.templateBody };
```

---

#### 2.2 `src/modules/config.ts`

**Add:**
```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface Config {
  // ... existing fields ...
  githubToken: string;  // Required: for GitHub API authentication
}

// Cache for GitHub token (fetched from Secrets Manager)
let cachedGithubToken: string | null = null;

/**
 * Fetch GitHub token from Secrets Manager (cached)
 */
async function getGithubToken(): Promise<string> {
  if (cachedGithubToken) return cachedGithubToken;

  const secretArn = process.env.GITHUB_TOKEN_SECRET_ARN;
  if (!secretArn) {
    throw new Error('GITHUB_TOKEN_SECRET_ARN environment variable is required');
  }

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error('GitHub token secret is empty');
  }

  cachedGithubToken = response.SecretString;
  return cachedGithubToken;
}

// In getConfig() - now async:
export async function getConfig(): Promise<Config> {
  return {
    // ... existing fields ...
    githubToken: await getGithubToken(),
  };
}
```

**New Dependency:** Add `@aws-sdk/client-secrets-manager` to package.json

---

### Phase 3: Infrastructure Changes (REVISED for Container Image)

#### 3.1 Lambda Container Image Approach

**Why Container Image over Lambda Layer:**
- 10GB size limit vs 250MB (40x more headroom)
- Cold starts now competitive with zip deployments (AWS 2025 optimizations)
- Can include CDK CLI, git, ts-node, and all dependencies reliably
- Production-grade reliability

#### 3.2 Dockerfile

**New File:** `infrastructure/docker/Dockerfile`

```dockerfile
# Use AWS Lambda Node.js 20 base image (AL2023)
FROM public.ecr.aws/lambda/nodejs:20

# Install system dependencies (git for sparse clone, tar/gzip for extraction)
RUN microdnf install -y git tar gzip && \
    microdnf clean all

# Install TypeScript tools (CDK is installed per-scenario at runtime)
RUN npm install -g typescript ts-node

# Copy Lambda handler
COPY dist/handler.js ${LAMBDA_TASK_ROOT}/

# Set handler
CMD ["handler.handler"]
```

**Note:** CDK CLI is installed at runtime based on each scenario's package.json version (per Q2 decision).

#### 3.3 `infrastructure/template.yaml` Updates

**Lambda Function Changes:**

```yaml
DeployerFunction:
  Type: AWS::Lambda::Function
  Properties:
    FunctionName: !Sub 'isb-deployer-${Environment}'
    PackageType: Image                    # Changed from Zip
    Code:
      ImageUri: !Sub '${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/isb-deployer:latest'
    Role: !GetAtt DeployerRole.Arn
    MemorySize: 2048                      # Was: 256
    Timeout: 600                          # Was: 60 (10 minutes for complex CDK)
    EphemeralStorageSize:
      Size: 5120                          # 5GB for node_modules + cdk.out
    Architectures:
      - arm64
    Environment:
      Variables:
        LEASE_TABLE_NAME: !Ref LeaseTableName
        GITHUB_REPO: !Ref GithubRepo
        GITHUB_BRANCH: !Ref GithubBranch
        GITHUB_PATH: !Ref GithubPath
        GITHUB_TOKEN_SECRET_ARN: !Ref GithubTokenSecretArn  # Secrets Manager ARN
        LOG_LEVEL: !Ref LogLevel
```

**New Parameter for Secrets Manager:**

```yaml
GithubTokenSecretArn:
  Type: String
  Description: 'ARN of Secrets Manager secret containing GitHub token'
  Default: ''
  AllowedPattern: '^(arn:aws:secretsmanager:[a-z0-9-]+:[0-9]+:secret:.+)?$'
```

**IAM Policy Addition (add to DeployerRole):**

```yaml
# Add to DeployerRole's Policies
- PolicyName: SecretsManagerAccess
  PolicyDocument:
    Version: '2012-10-17'
    Statement:
      - Effect: Allow
        Action:
          - secretsmanager:GetSecretValue
        Resource: !Ref GithubTokenSecretArn
        Condition:
          StringEquals:
            aws:ResourceAccount: !Ref AWS::AccountId
```

**New ECR Repository Resource:**

```yaml
DeployerEcrRepository:
  Type: AWS::ECR::Repository
  Properties:
    RepositoryName: !Sub 'isb-deployer-${Environment}'
    ImageScanningConfiguration:
      ScanOnPush: true
    EncryptionConfiguration:
      EncryptionType: AES256
    LifecyclePolicy:
      LifecyclePolicyText: |
        {
          "rules": [
            {
              "rulePriority": 1,
              "description": "Keep last 5 images",
              "selection": {
                "tagStatus": "any",
                "countType": "imageCountMoreThan",
                "countNumber": 5
              },
              "action": { "type": "expire" }
            }
          ]
        }
```

**Parameters Note:**

The `GithubTokenSecretArn` parameter replaces any direct token parameter. The token is now stored securely in AWS Secrets Manager and retrieved at runtime.

#### 3.4 Build & Deploy Scripts

**New File:** `infrastructure/docker/build.sh`

```bash
#!/bin/bash
set -e

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-east-1}
REPO_NAME="isb-deployer"

# Build the Lambda code
npm run build:prod

# Build Docker image
docker build -t ${REPO_NAME}:latest -f infrastructure/docker/Dockerfile .

# Tag for ECR
docker tag ${REPO_NAME}:latest ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:latest

# Login to ECR
aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

# Push to ECR
docker push ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:latest

echo "Image pushed: ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:latest"
```

#### 3.5 GitHub Actions Workflow (Q4 Decision)

**New File:** `.github/workflows/build-deployer.yml`

```yaml
name: Build and Deploy ISB Deployer

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'infrastructure/docker/**'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/build-deployer.yml'
  pull_request:
    branches: [main]
    paths:
      - 'src/**'
      - 'infrastructure/docker/**'
  workflow_dispatch:  # Manual trigger

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: isb-deployer

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run type check
        run: npm run typecheck

      - name: Run linter
        run: npm run lint

      - name: Run tests
        run: npm run test

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions:
      id-token: write   # For OIDC
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build Lambda
        run: npm run build:prod

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push image to Amazon ECR
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
                       -t $ECR_REGISTRY/$ECR_REPOSITORY:latest \
                       -f infrastructure/docker/Dockerfile .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

      - name: Update Lambda function
        run: |
          aws lambda update-function-code \
            --function-name isb-deployer \
            --image-uri ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ github.sha }}
```

**Required GitHub Secrets:**

| Secret | Description |
|--------|-------------|
| `AWS_DEPLOY_ROLE_ARN` | ARN of IAM role for GitHub Actions OIDC |

**GitHub OIDC Setup (one-time):**

```bash
# Create OIDC provider for GitHub Actions (if not exists)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Create trust policy for the deploy role
cat > trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:co-cddo/innovation-sandbox-on-aws-deployer:*"
        }
      }
    }
  ]
}
EOF
```

---

### Phase 4: Testing Strategy

#### 4.1 Unit Tests

| Module | Test File | Key Test Cases |
|--------|-----------|----------------|
| `scenario-detector.ts` | `scenario-detector.test.ts` | CF detection, CDK root detection, CDK subfolder detection, 404 handling, rate limit handling |
| `scenario-fetcher.ts` | `scenario-fetcher.test.ts` | Folder download, nested directories, cleanup, large file handling |
| `cdk-synthesizer.ts` | `cdk-synthesizer.test.ts` | Successful synth, npm ci failure, synth timeout, missing cdk.json |
| `template-resolver.ts` | `template-resolver.test.ts` | CF path, CDK path, error propagation |

**Mocking Strategy:**
- Mock `fetch` for GitHub API
- Mock `execSync` for npm/cdk commands
- Mock filesystem for temp directory operations

#### 4.2 Integration Tests

**Docker-based Lambda simulation:**
```dockerfile
FROM public.ecr.aws/lambda/nodejs:20
COPY layer/nodejs/node_modules /opt/nodejs/node_modules
COPY dist/handler.js ${LAMBDA_TASK_ROOT}
CMD ["handler.handler"]
```

**Test scenarios:**
1. Deploy a minimal CDK project (single S3 bucket)
2. Deploy localgov-drupal scenario
3. Deploy existing CloudFormation scenario (regression)

#### 4.3 E2E Tests

- Deploy to real Lambda
- Trigger with test EventBridge event
- Verify stack created in sandbox account

---

## File Change Summary

### New Files (REVISED for Container Image)

| Path | Lines (est.) | Description |
|------|--------------|-------------|
| `src/modules/scenario-detector.ts` | ~80 | GitHub API detection |
| `src/modules/scenario-detector.test.ts` | ~150 | Unit tests |
| `src/modules/scenario-fetcher.ts` | ~150 | Tarball download + extraction |
| `src/modules/scenario-fetcher.test.ts` | ~200 | Unit tests |
| `src/modules/cdk-synthesizer.ts` | ~120 | npm ci + cdk synth + context handling |
| `src/modules/cdk-synthesizer.test.ts` | ~200 | Unit tests |
| `src/modules/template-resolver.ts` | ~80 | Orchestration |
| `src/modules/template-resolver.test.ts` | ~120 | Unit tests |
| `infrastructure/docker/Dockerfile` | ~15 | Lambda container image |
| `infrastructure/docker/build.sh` | ~25 | Build and push script |
| `.github/workflows/build-deployer.yml` | ~95 | CI/CD pipeline for container builds |

### Modified Files

| Path | Changes |
|------|---------|
| `src/modules/template-handler.ts` | Replace fetch with resolver call |
| `src/modules/config.ts` | Add `githubToken`, Secrets Manager retrieval, make `getConfig()` async |
| `src/types/index.ts` | Add new interfaces |
| `infrastructure/template.yaml` | PackageType: Image, ECR repo, Secrets Manager param, IAM policy, memory, timeout, ephemeral storage |
| `package.json` | Add `@aws-sdk/client-secrets-manager` dependency |

---

## Risk Assessment (REVISED)

| Risk | Likelihood | Impact | Mitigation | Status |
|------|------------|--------|------------|--------|
| ~~Layer size exceeds 250MB~~ | ~~High~~ | ~~High~~ | **MITIGATED:** Using container image (10GB limit) | **Resolved** |
| CDK synth timeout | Medium | High | 600s timeout, monitor P95, consider async | Active |
| npm ci fails for complex projects | Low | High | Pin Node.js 20, match CDK versions | Active |
| GitHub rate limiting | High | High | **GITHUB_TOKEN required**, implement backoff | Active |
| Lambda /tmp space exhaustion | Low | Medium | 5GB ephemeral storage, cleanup after synth | Active |
| CDK version mismatch | Medium | High | Pin container CDK to 2.173.1, document requirements | Active |
| cdk.json context not preserved | Medium | High | Parse and pass context programmatically | Active |
| Container image cold start | Low | Low | AWS 2025 optimizations, ~10-15s expected | Monitoring |

### New Risks Identified

| Risk | Details | Mitigation |
|------|---------|------------|
| **ECR dependency** | Container images require ECR repository | Create ECR in CloudFormation, lifecycle policies |
| **Build pipeline complexity** | Docker build + ECR push required for updates | Build script, CI/CD integration |
| **Multi-stack CDK apps** | localgov-drupal is single stack, but others may have multiple | Error on multiple stacks (per scope decision) |

---

## Implementation Order

```
Week 1:
  ├── Day 1-2: scenario-detector.ts + tests
  ├── Day 3-4: scenario-fetcher.ts + tests
  └── Day 5: cdk-synthesizer.ts + tests (mock execSync)

Week 2:
  ├── Day 1: template-resolver.ts + tests
  ├── Day 2: Modify template-handler.ts
  ├── Day 3: Lambda layer build scripts
  ├── Day 4: Infrastructure template updates
  └── Day 5: Integration testing

Week 3:
  ├── Day 1-2: E2E testing with localgov-drupal
  ├── Day 3: Documentation
  └── Day 4-5: Buffer / fixes
```

---

## Scope Decisions (Resolved)

| Question | Decision | Rationale |
|----------|----------|-----------|
| CDK Context | **Skip** | Curated scenarios shouldn't need runtime context lookups |
| Multi-stack apps | **Single stack only** | Deploy first/only stack; error if multiple detected |
| CDK version pinning | **Layer pins version** | Scenarios must be compatible with layer CDK version |
| Docker assets | **Out of scope** | Scenarios requiring `cdk bootstrap` should pre-synthesize |

**Confirmed:** localgov-drupal does NOT require `cdk bootstrap`.

---

## Outstanding Questions (RESOLVED)

All questions have been answered by user (2026-01-09):

### Q1: GitHub Token Provisioning
**Question:** How should the GITHUB_TOKEN be provisioned and managed?

**Options:**
- A) AWS Secrets Manager secret (recommended for security)
- B) SSM Parameter Store SecureString
- C) Direct CloudFormation parameter (current approach, less secure)

**Impact:** Affects infrastructure template and deployment process.

**Status:** ✅ Resolved

**Answer:** A - AWS Secrets Manager

**Command to create secret:**
```bash
# Create the secret (replace YOUR_GITHUB_TOKEN with your actual token)
aws secretsmanager create-secret \
  --name "isb-deployer/github-token" \
  --description "GitHub personal access token for ISB Deployer CDK synthesis" \
  --secret-string "YOUR_GITHUB_TOKEN" \
  --region us-east-1

# Verify it was created
aws secretsmanager describe-secret --secret-id "isb-deployer/github-token" --region us-east-1
```

**Note:** The GitHub token needs `repo` scope (for private repos) or just `public_repo` scope (for public repos only).

**UPDATE FROM USER:** have done and tested


---

### Q2: CDK Version Strategy
**Question:** The container pins CDK 2.173.1 (matching localgov-drupal). What happens when new scenarios use different CDK versions?

**Options:**
- A) All scenarios MUST use container's CDK version (document requirement)
- B) Multiple container images with different CDK versions
- C) Install scenario's CDK version at runtime (adds time, complexity)

**Impact:** Affects scenario compatibility and maintenance burden.

**Status:** ✅ Resolved

**Answer:** C - Install scenario's CDK version at runtime

**Implementation:** Read `package.json` from scenario, extract CDK version, run `npm install aws-cdk@{version}` before synthesis.

---

### Q3: Tarball vs Trees API
**Question:** Which GitHub API approach should we use for fetching scenario folders?

**Options:**
- A) **Tarball API** - Single call, downloads entire repo, filter locally (recommended)
- B) **Trees API** - Multiple calls, can filter before download
- C) **Sparse git clone** - Most precise, requires git in container

**Trade-offs:**
| Approach | API Calls | Download Size | Complexity |
|----------|-----------|---------------|------------|
| Tarball | 1 | Larger (full repo) | Low |
| Trees API | 10-50+ | Smaller (filtered) | Medium |
| Sparse clone | 1 | Smallest | High |

**Impact:** Affects performance, rate limit usage, and implementation complexity.

**Status:** ✅ Resolved

**Answer:** C - Sparse git clone

**Implementation:** Use `git clone --depth 1 --sparse` with sparse-checkout to fetch only the scenario folder. Requires git in container (already included).

---

### Q4: CI/CD Integration
**Question:** How should container image builds be integrated into the deployment pipeline?

**Options:**
- A) Manual build script (current plan)
- B) GitHub Actions workflow
- C) AWS CodePipeline/CodeBuild
- D) Defer to later phase

**Impact:** Affects deployment process and automation.

**Status:** ✅ Resolved

**Answer:** B - GitHub Actions workflow

**Implementation:** Create `.github/workflows/build-deployer.yml` to build and push container image on changes to `src/` or `infrastructure/docker/`.

---

### Q5: Existing CloudFormation Deployment - Backward Compatibility
**Question:** Should the container image also support existing CloudFormation-only scenarios, or should we maintain two deployment paths?

**Options:**
- A) **Single container** - Handles both CDK and CF scenarios (recommended)
- B) **Dual deployment** - Original zip Lambda for CF, container for CDK
- C) **Migrate all to container** - Even CF-only scenarios use container

**Impact:** Affects deployment complexity and maintenance.

**Status:** ✅ Resolved

**Answer:** A - Single container handles both CDK and CF scenarios

**Implementation:** Container includes both CDK synthesis capability and existing CloudFormation fetch logic. Detection layer determines which path to use.

---

## Approval

- [x] Scope decisions confirmed by: Cns (2026-01-09)
- [x] Architecture reviewed by: Cns (2026-01-09)
- [x] Implementation plan approved by: Cns (2026-01-09)

---

*Generated by BMAD Party Mode - 2026-01-09*
