# ISB Deployer Lambda Container Image
#
# This Dockerfile creates a container image for the ISB Deployer Lambda function
# that supports both CloudFormation templates and CDK scenario synthesis.
#
# Base: AWS Lambda Node.js 22 (Amazon Linux 2023)
# Additional: Git (for sparse clone), TypeScript tooling
# Note: CDK CLI is installed at runtime based on each scenario's package.json version

FROM public.ecr.aws/lambda/nodejs:22

# Install system dependencies:
# - git: Required for sparse-checkout of CDK scenarios from GitHub
# - tar, gzip: For extracting npm packages
RUN microdnf install -y \
    git \
    tar \
    gzip \
    && microdnf clean all \
    && rm -rf /var/cache/yum

# Verify git version (need 2.25+ for sparse-checkout)
RUN git --version

# Install TypeScript tooling globally
# Note: CDK CLI is NOT installed here - it's installed at runtime
# based on each scenario's package.json version for compatibility
RUN npm install -g \
    typescript \
    ts-node \
    --loglevel=error

# Create directories that will be used at runtime
RUN mkdir -p /tmp/.npm /tmp/cdk-runtime

# Set npm cache location (Lambda /tmp is writable)
ENV NPM_CONFIG_CACHE=/tmp/.npm
ENV HOME=/tmp

# Copy the bundled Lambda handler
# This is the esbuild output from npm run build:prod
COPY dist/handler.js ${LAMBDA_TASK_ROOT}/

# Copy template files (e.g., CDK bootstrap template)
COPY dist/templates/ ${LAMBDA_TASK_ROOT}/templates/

# Set the Lambda handler
CMD ["handler.handler"]
