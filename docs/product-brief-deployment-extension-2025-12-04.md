# Product Brief: Innovation Sandbox Deployer - Deployment Extension

**Project:** innovation-sandbox-on-aws-deployer
**Version:** 2.0 (Sprint 2 Extension)
**Date:** 2025-12-04
**Author:** Business Analyst
**Project Level:** 3 (Complex)

---

## Executive Summary

This product brief extends the Innovation Sandbox Deployer project to include **real-world deployment and end-to-end testing** in the existing Innovation Sandbox hub account. Sprint 1 successfully delivered all 24 stories (93 story points) of application code, CloudFormation infrastructure templates, and CI/CD pipelines. This extension covers merging all feature branches, deploying the application to AWS via CloudFormation, and validating the complete workflow works in a production-like environment.

---

## Problem Statement

### The Current Gap

The Innovation Sandbox Deployer code is **complete but not deployed**. All modules have been implemented and tested in isolation, but:

1. **24 feature branches** need to be merged into main
2. **CloudFormation stack** hasn't been deployed to AWS
3. **End-to-end workflow** hasn't been validated with real AWS services
4. **DynamoDB lease table** integration is untested in production
5. **Cross-account deployment** to target accounts is unverified

### Why Now

- Sprint 1 code is complete and tested locally
- The Innovation Sandbox hub account exists and is ready
- Remaining sprint capacity (83 points) can be utilized
- Deployment is the final step before the system can provide value

### Impact if Unsolved

Without deployment and real-world testing:
- Code remains theoretical, unable to automate lease provisioning
- Integration bugs may exist that unit tests don't catch
- No confidence in production readiness
- Manual provisioning continues, wasting operator time

---

## Target Audience

### Primary Users
- **Innovation Sandbox Operators**: GDS/NDX team members who manage sandbox sub-accounts
- **Platform Engineers**: Team members responsible for deploying and maintaining the solution

### Secondary Users
- **Sandbox Users**: Government developers who request leases (indirect beneficiaries)
- **Security Team**: Stakeholders who need to validate IAM policies and cross-account access

### Key User Needs
1. Automated deployment of CF templates when leases are approved
2. Visibility into deployment status (success/failure events)
3. Easy troubleshooting via CloudWatch logs
4. Confidence the system works before going to production

---

## Solution Overview

### Proposed Solution

A structured deployment and testing phase consisting of:

1. **Branch Consolidation**: Merge all 24 feature branches into main
2. **Infrastructure Deployment**: Deploy CloudFormation stack to Innovation Sandbox hub
3. **Integration Testing**: Validate end-to-end workflow with real AWS services
4. **Non-Destructive Testing**: Test using same-account deployment (no external sub-accounts needed initially)

### Key Activities

- **Merge Strategy**: Sequential merge of feature branches with conflict resolution
- **Parameter Discovery**: Use AWS CLI to identify correct DynamoDB table, S3 bucket locations
- **CloudFormation Deployment**: Deploy `infrastructure/template.yaml` with correct parameters
- **Test Data Setup**: Create test lease record in DynamoDB
- **Manual Trigger Test**: Send test EventBridge event to trigger Lambda
- **Validation**: Verify CloudFormation stack created in target (same account for testing)
- **Event Verification**: Confirm success/failure events emitted to EventBridge

### Value Proposition

Transform the Innovation Sandbox Deployer from tested code into a **working, deployed solution** that provides immediate value by automating lease provisioning.

---

## Business Objectives

### Goals (SMART Framework)

1. **Specific**: Merge all feature branches and deploy to Innovation Sandbox hub account
2. **Measurable**: Successfully create a CF stack via EventBridge event trigger
3. **Achievable**: All code is complete; deployment is a configuration exercise
4. **Relevant**: Enables automated provisioning, the core project goal
5. **Time-bound**: Complete within 1 week (by Dec 11, 2025)

### Success Metrics

- [ ] All 24 feature branches merged to main without breaking tests
- [ ] CloudFormation stack deployed successfully (CREATE_COMPLETE)
- [ ] Lambda function responds to EventBridge events
- [ ] Test CF stack created in target account from event trigger
- [ ] Success event emitted to EventBridge after deployment
- [ ] CloudWatch logs show complete workflow execution

### Business Value

- **Operational Efficiency**: Eliminate manual CF stack deployment for each lease
- **Time Savings**: Reduce provisioning time from hours to minutes
- **Consistency**: Ensure standardized deployments across all leases
- **Auditability**: Event-driven architecture provides complete audit trail

---

## Scope

### In Scope (Sprint 2)

**Phase 1: Branch Consolidation**
- [ ] Merge STORY-001 through STORY-024 branches to main
- [ ] Resolve any merge conflicts
- [ ] Run full test suite on consolidated code
- [ ] Verify build succeeds

**Phase 2: Infrastructure Deployment**
- [ ] Discover existing DynamoDB table name via AWS CLI
- [ ] Identify or create S3 bucket for Lambda artifacts
- [ ] Upload Lambda bundle to S3
- [ ] Deploy CloudFormation stack with correct parameters
- [ ] Verify all resources created (Lambda, IAM Role, EventBridge Rule)

**Phase 3: Integration Testing**
- [ ] Create test lease record in DynamoDB
- [ ] Create simple test CF template in GitHub repo (or use existing)
- [ ] Send test EventBridge event manually
- [ ] Verify Lambda execution in CloudWatch Logs
- [ ] Verify CF stack created in target account
- [ ] Verify success event emitted to EventBridge

**Phase 4: Error Scenario Testing**
- [ ] Test with missing template (graceful no-op)
- [ ] Test with invalid template (validation error)
- [ ] Test with missing lease in DynamoDB (error event)
- [ ] Verify failure events emitted correctly

### Out of Scope

- Production deployment to external sub-accounts (deferred to later sprint)
- Multi-region deployment
- Custom alerting/monitoring dashboards
- Performance/load testing
- Blue/green deployment strategy
- Automated rollback mechanisms

### Future Considerations

- Deploy to real Innovation Sandbox sub-accounts
- Set up CloudWatch alarms for failures
- Create operational runbook
- Implement deployment notifications (Slack, email)

---

## Stakeholders

| Stakeholder | Role | Influence | Interest |
|-------------|------|-----------|----------|
| **NDX Team Lead** | Project Sponsor | High | Successful deployment, operational system |
| **Platform Engineers** | Implementers | High | Clean deployment process, good documentation |
| **Security Team** | Reviewer | Medium | IAM policies, cross-account access security |
| **Sandbox Users** | End Users | Low | Faster provisioning (indirect benefit) |

---

## Constraints and Assumptions

### Constraints

1. **CloudFormation Only**: All infrastructure must be defined in CloudFormation - no manual AWS Console changes
2. **Existing Hub Account**: Must deploy to the existing Innovation Sandbox hub account
3. **Non-Destructive Testing**: Tests must not impact existing production workloads
4. **Same-Account Testing**: Initial testing will deploy CF stacks in the same account (no cross-account needed for validation)
5. **AWS CLI Access**: Deployment will use AWS CLI with appropriate credentials
6. **Timeline**: Complete within 1 week

### Assumptions

1. AWS CLI is configured with appropriate credentials for the hub account
2. The Innovation Sandbox hub account has necessary service quotas
3. A DynamoDB table for leases exists (or we can identify the correct one)
4. An S3 bucket is available for Lambda artifact storage
5. The account has IAM permissions to create Lambda, EventBridge rules, and IAM roles
6. A simple CF template exists in the GitHub repo for testing
7. Feature branches are mergeable without significant conflicts

---

## Success Criteria

1. **Deployment Success**
   - CloudFormation stack reaches CREATE_COMPLETE status
   - All resources (Lambda, IAM Role, EventBridge Rule) are functional
   - Lambda can be invoked manually without errors

2. **Integration Success**
   - EventBridge event triggers Lambda function
   - Lambda reads from DynamoDB successfully
   - Lambda fetches template from GitHub
   - Lambda creates CF stack in target account
   - Success event appears in EventBridge

3. **Error Handling Verification**
   - Missing template results in graceful skip (no error)
   - Invalid template results in failure event
   - Missing lease results in appropriate error event
   - All errors are logged to CloudWatch

4. **Code Quality**
   - All tests pass after merge
   - No regressions in functionality
   - Build and deployment artifacts are valid

---

## Timeline

**Target Completion**: December 11, 2025 (1 week)

### Key Milestones

| Milestone | Target Date | Description |
|-----------|-------------|-------------|
| Branch Consolidation | Dec 5 | All feature branches merged to main |
| Test Suite Validation | Dec 5 | All tests pass on consolidated code |
| Infrastructure Deployed | Dec 7 | CF stack deployed to hub account |
| Integration Tests Pass | Dec 9 | End-to-end workflow validated |
| Error Scenarios Tested | Dec 10 | All error paths verified |
| Documentation Updated | Dec 11 | README reflects deployment |

---

## Risks

### Risk 1: Merge Conflicts

**Risk**: Feature branches may have conflicts when merging
**Likelihood**: Medium
**Impact**: Medium
**Mitigation**:
- Merge branches in dependency order
- Resolve conflicts incrementally
- Run tests after each merge

### Risk 2: Missing AWS Resources

**Risk**: Required AWS resources (DynamoDB table, S3 bucket) may not exist or have different names
**Likelihood**: Medium
**Impact**: High
**Mitigation**:
- Use AWS CLI to discover existing resources
- Document resource requirements
- Create missing resources via CloudFormation

### Risk 3: IAM Permission Issues

**Risk**: Lambda role may lack permissions for cross-account actions or DynamoDB
**Likelihood**: Medium
**Impact**: High
**Mitigation**:
- Review IAM policies before deployment
- Test with same-account first (no STS AssumeRole needed)
- Iteratively add permissions as needed

### Risk 4: Template Validation Failures

**Risk**: Test CloudFormation templates may have syntax/validation errors
**Likelihood**: Low
**Impact**: Medium
**Mitigation**:
- Validate templates before deployment
- Use simple, known-working templates for testing
- Check CloudFormation events for detailed errors

### Risk 5: EventBridge Event Format Mismatch

**Risk**: Real events from Innovation Sandbox may differ from expected format
**Likelihood**: Low
**Impact**: High
**Mitigation**:
- Send manually crafted events first
- Capture real event format from existing system
- Add robust event validation

---

## Recommended Stories for Sprint 2

Based on this brief, the following stories should be added to Sprint 2:

| Story ID | Title | Points | Epic |
|----------|-------|--------|------|
| STORY-025 | Merge all feature branches to main | 3 | EPIC-007 |
| STORY-026 | Discover and document AWS resource names | 2 | EPIC-007 |
| STORY-027 | Upload Lambda artifact to S3 | 1 | EPIC-007 |
| STORY-028 | Deploy CloudFormation stack to hub account | 3 | EPIC-007 |
| STORY-029 | Create test lease record in DynamoDB | 1 | EPIC-007 |
| STORY-030 | Create simple test CloudFormation template | 2 | EPIC-007 |
| STORY-031 | Manual end-to-end integration test | 5 | EPIC-007 |
| STORY-032 | Test missing template scenario | 2 | EPIC-007 |
| STORY-033 | Test invalid template scenario | 2 | EPIC-007 |
| STORY-034 | Test missing lease scenario | 2 | EPIC-007 |
| STORY-035 | Verify CloudWatch logging | 2 | EPIC-007 |
| STORY-036 | Update documentation with deployment | 3 | EPIC-007 |

**Total: 28 story points** (New Epic: EPIC-007 - Deployment & Validation)

---

## Next Steps

1. **Create Sprint 2 Plan**: Run `/bmad:sprint-planning` to create detailed stories
2. **Begin Branch Consolidation**: Start merging feature branches
3. **AWS Resource Discovery**: Use AWS CLI to identify existing infrastructure
4. **Deploy and Test**: Execute deployment and validation workflow

---

## Appendix: AWS CLI Discovery Commands

```bash
# Discover DynamoDB tables
aws dynamodb list-tables --region us-west-2

# Describe specific table
aws dynamodb describe-table --table-name <table-name>

# List S3 buckets
aws s3 ls

# List EventBridge rules
aws events list-rules --region us-west-2

# Check existing Lambda functions
aws lambda list-functions --region us-west-2 --query 'Functions[*].FunctionName'
```

---

*Generated by Business Analyst Workflow - BMAD Method v6*
