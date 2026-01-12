#!/bin/bash
# ISB Deployer Container Image Build Script
#
# Builds and pushes the ISB Deployer Lambda container image to ECR.
# Run from the repository root directory.
#
# Prerequisites:
# - AWS CLI configured with credentials
# - Docker installed and running
# - ECR repository created (done by infrastructure/template.yaml)
#
# Usage:
#   ./infrastructure/docker/build.sh [--push]
#   ./infrastructure/docker/build.sh --push --region us-west-2

set -e

# Default values
REGION="${AWS_REGION:-us-east-1}"
REPO_NAME="isb-deployer"
PUSH=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --push)
            PUSH=true
            shift
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--push] [--region REGION]"
            exit 1
            ;;
    esac
done

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

if [ -z "$ACCOUNT_ID" ]; then
    echo "Error: Could not get AWS account ID. Check your AWS credentials."
    exit 1
fi

echo "Building ISB Deployer container image..."
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $REGION"
echo "  Repo:    $REPO_NAME"

# Step 1: Build the Lambda code
echo ""
echo "Step 1: Building Lambda handler..."
npm run build:prod

# Step 2: Build Docker image
echo ""
echo "Step 2: Building Docker image..."
docker build \
    -t "${REPO_NAME}:latest" \
    -f infrastructure/docker/Dockerfile \
    .

# Step 3: Tag and push if requested
if [ "$PUSH" = true ]; then
    ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"

    echo ""
    echo "Step 3: Tagging image for ECR..."
    docker tag "${REPO_NAME}:latest" "${ECR_URI}:latest"
    docker tag "${REPO_NAME}:latest" "${ECR_URI}:$(git rev-parse --short HEAD)"

    echo ""
    echo "Step 4: Logging into ECR..."
    aws ecr get-login-password --region "${REGION}" | \
        docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

    echo ""
    echo "Step 5: Pushing to ECR..."
    docker push "${ECR_URI}:latest"
    docker push "${ECR_URI}:$(git rev-parse --short HEAD)"

    echo ""
    echo "Image pushed successfully!"
    echo "  URI: ${ECR_URI}:latest"
else
    echo ""
    echo "Image built successfully (local only)."
    echo "Run with --push to push to ECR."
fi

echo ""
echo "Done!"
