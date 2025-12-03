# Product Requirements Document: Innovation Sandbox on AWS Deployer

**Project:** innovation-sandbox-on-aws-deployer
**Type:** Infrastructure
**Level:** 3 (Complex - 12-40 stories)
**Date:** 2025-12-03
**Status:** Approved
**Product Brief:** [docs/product-brief-innovation-sandbox-on-aws-deployer-2025-12-03.md](./product-brief-innovation-sandbox-on-aws-deployer-2025-12-03.md)

---

## Executive Summary

An AWS CloudFormation deployer that integrates with innovation-sandbox-on-aws, automatically deploying templates from a configurable GitHub repository when lease template names match directory names. It runs as a background service triggered by EventBridge events, giving Innovation Sandbox users meaningful starting environments instead of empty AWS consoles.

---

## Business Objectives

1. **Improve user engagement** with Innovation Sandbox
2. **Reduce time-to-value** for lease holders
3. **Support the UK Government rollout** of Innovation Sandbox

---

## Success Metrics

| Metric | Description |
|--------|-------------|
| CloudTrail engagement | Monitor user interaction with deployed resources |
| Scenario usage rates | Track which scenarios are deployed and used |
| Repeat usage rates | Measure returning users |
| Qualitative feedback | User satisfaction surveys and feedback |

---

## User Personas

### Primary: Innovation Sandbox Lease Holders

A mix of developers, architects, policy people, and others exploring AWS. Profile varies by scenario they deploy. They receive pre-configured environments matching their lease template.

### Secondary: NDX Team (GDS)

Operators who:
- Manage scenario templates in the GitHub repository
- Deploy and maintain this stack in the hub account
- Monitor deployment success rates

### Adopters: ISB Team

The Innovation Sandbox team who may adopt this project for long-term maintenance. They need clean, well-documented code that meets ISB coding standards.

---

## Key User Flows

### Flow 1: Automatic Scenario Deployment

```
1. User's lease is approved (manual or auto)
2. EventBridge triggers deployer Lambda
3. Lambda fetches matching template from GitHub
4. Lambda deploys CloudFormation stack to user's sub-account
5. User receives pre-configured environment
6. Success event emitted for observability
```

### Flow 2: Graceful No-Op (No Template)

```
1. User's lease is approved for generic template
2. EventBridge triggers deployer Lambda
3. Lambda finds no matching template in GitHub
4. Lambda exits quietly (no error)
5. User gets empty account (existing behavior)
```

---

## Functional Requirements

### Summary

| Priority | Count |
|----------|-------|
| Must Have | 17 |
| Should Have | 0 |
| Could Have | 0 |
| **Total** | **17** |

---

### FR-001: Receive Lease Approved Events

**Priority:** Must Have

**Description:**
Lambda receives EventBridge events when leases are approved (including auto-approved)

**Acceptance Criteria:**
- [ ] Lambda is triggered by ISB lease approval EventBridge events
- [ ] Both manual and auto-approved leases trigger the function
- [ ] Event payload is correctly parsed

**Dependencies:** FR-016

---

### FR-002: Extract Lease Metadata

**Priority:** Must Have

**Description:**
Extract lease template name and account ID from event payload

**Acceptance Criteria:**
- [ ] Template name extracted from event or DynamoDB lookup
- [ ] Target AWS account ID extracted
- [ ] Lease ID extracted for correlation

**Dependencies:** FR-001

---

### FR-003: Fetch Template from GitHub

**Priority:** Must Have

**Description:**
Retrieve CloudFormation template from `{repo}/{branch}/{directory}/{template-name}/template.yaml`

**Acceptance Criteria:**
- [ ] Template fetched using GitHub API or raw URL
- [ ] Path constructed correctly from configuration + template name
- [ ] YAML content retrieved successfully

**Dependencies:** FR-002, FR-012

---

### FR-004: Handle Missing Templates

**Priority:** Must Have

**Description:**
Exit gracefully when no matching template exists (empty account is valid)

**Acceptance Criteria:**
- [ ] 404 from GitHub results in graceful exit (no error)
- [ ] No EventBridge failure event emitted for missing templates
- [ ] Execution logged for observability

**Dependencies:** FR-003

---

### FR-005: Assume Cross-Account Role

**Priority:** Must Have

**Description:**
Assume configurable IAM role in target sub-account

**Acceptance Criteria:**
- [ ] Successfully assume role in target account
- [ ] Temporary credentials obtained for CloudFormation operations
- [ ] Role assumption failure results in error event

**Dependencies:** FR-002, FR-013

---

### FR-006: Deploy CloudFormation Stack

**Priority:** Must Have

**Description:**
Create CloudFormation stack in sub-account from fetched template

**Acceptance Criteria:**
- [ ] Stack created using assumed role credentials
- [ ] Template body passed to CloudFormation
- [ ] Stack creation initiated successfully

**Dependencies:** FR-003, FR-005, FR-007

---

### FR-007: Unique Stack Naming

**Priority:** Must Have

**Description:**
Generate unique stack name to avoid conflicts

**Acceptance Criteria:**
- [ ] Stack name includes template/scenario identifier
- [ ] Stack name includes lease identifier or timestamp
- [ ] Stack name complies with CloudFormation naming rules

**Dependencies:** None

---

### FR-008: Lookup Lease from DynamoDB

**Priority:** Must Have

**Description:**
Retrieve lease details from DynamoDB lease table for parameter enrichment

**Acceptance Criteria:**
- [ ] Query lease table using lease ID from event
- [ ] Retrieve all relevant lease attributes
- [ ] Handle missing lease records gracefully

**Dependencies:** FR-002, FR-014

---

### FR-009: Inject Lease Parameters

**Priority:** Must Have

**Description:**
Pass lease metadata as CloudFormation parameters

**Acceptance Criteria:**
- [ ] Lease attributes mapped to CloudFormation parameters
- [ ] Only parameters defined in template are passed
- [ ] Parameter values correctly formatted

**Dependencies:** FR-003, FR-008

---

### FR-010: Emit Success Event

**Priority:** Must Have

**Description:**
Publish EventBridge event on successful deployment

**Acceptance Criteria:**
- [ ] Event published to default event bus
- [ ] Event includes lease ID, account ID, stack name
- [ ] Event source clearly identifies deployer

**Dependencies:** FR-006

---

### FR-011: Emit Failure Event

**Priority:** Must Have

**Description:**
Publish EventBridge event on deployment failure with error details

**Acceptance Criteria:**
- [ ] Event published on any deployment failure
- [ ] Error message and type included
- [ ] Does not break ISB functionality

**Dependencies:** None

---

### FR-012: Configurable GitHub Source

**Priority:** Must Have

**Description:**
Allow configuration of repository, branch, and directory path

**Acceptance Criteria:**
- [ ] Repository configurable (default: co-cddo/ndx_try_aws_scenarios)
- [ ] Branch configurable (default: main)
- [ ] Directory path configurable (default: cloudformation/scenarios)

**Dependencies:** None

---

### FR-013: Configurable Target Role

**Priority:** Must Have

**Description:**
Allow configuration of IAM role name for cross-account access

**Acceptance Criteria:**
- [ ] Role name configurable via CloudFormation parameter
- [ ] Default: ndx_IsbUsersPS
- [ ] Role ARN constructed correctly for target account

**Dependencies:** None

---

### FR-014: Configurable Lease Table

**Priority:** Must Have

**Description:**
Allow configuration of DynamoDB table name

**Acceptance Criteria:**
- [ ] Table name configurable via CloudFormation parameter
- [ ] Lambda has read permissions on configured table

**Dependencies:** None

---

### FR-015: CloudFormation Deployment Stack

**Priority:** Must Have

**Description:**
Provide CloudFormation template to deploy the Lambda and supporting resources

**Acceptance Criteria:**
- [ ] Single CloudFormation template deploys all resources
- [ ] Template validates successfully
- [ ] Deployable to any AWS account

**Dependencies:** FR-016, FR-017

---

### FR-016: EventBridge Rule

**Priority:** Must Have

**Description:**
Create EventBridge rule to trigger Lambda on lease approved events

**Acceptance Criteria:**
- [ ] Rule filters for correct ISB event pattern
- [ ] Rule targets Lambda function
- [ ] Rule enabled by default

**Dependencies:** None

---

### FR-017: IAM Permissions

**Priority:** Must Have

**Description:**
Define minimal IAM permissions for Lambda execution

**Acceptance Criteria:**
- [ ] Least privilege permissions
- [ ] No wildcard (*) actions on sensitive resources
- [ ] Cross-account STS assume role allowed
- [ ] DynamoDB read access scoped to lease table
- [ ] EventBridge put events allowed

**Dependencies:** None

---

## Non-Functional Requirements

### Summary

| Priority | Count |
|----------|-------|
| Must Have | 8 |
| Should Have | 2 |
| **Total** | **10** |

---

### NFR-001: Performance - Execution Time

**Priority:** Must Have

**Description:**
Lambda executes within reasonable time limits

**Acceptance Criteria:**
- [ ] Total execution time < 30 seconds for typical deployment
- [ ] GitHub fetch completes within 5 seconds

**Rationale:** Async processing; user doesn't wait, but we shouldn't hog resources

---

### NFR-002: Security - Least Privilege

**Priority:** Must Have

**Description:**
All IAM permissions follow least privilege principle

**Acceptance Criteria:**
- [ ] Lambda role has minimal required permissions
- [ ] No wildcard (*) actions on sensitive resources
- [ ] Cross-account role assumption scoped appropriately

**Rationale:** ISB handles sensitive AWS accounts; security is paramount

---

### NFR-003: Security - Secrets Management

**Priority:** Must Have

**Description:**
GitHub access tokens (if needed) stored securely

**Acceptance Criteria:**
- [ ] No hardcoded secrets in code or CloudFormation
- [ ] Secrets stored in Parameter Store or Secrets Manager if required
- [ ] Public repos work without authentication

**Rationale:** Open source ready means no embedded secrets

---

### NFR-004: Reliability - Error Handling

**Priority:** Must Have

**Description:**
Errors handled gracefully without breaking ISB

**Acceptance Criteria:**
- [ ] Uncaught exceptions don't propagate to EventBridge source
- [ ] All error paths emit appropriate events
- [ ] Lambda exits cleanly in all scenarios

**Rationale:** Design principle: "Fail gracefully"

---

### NFR-005: Reliability - Idempotency

**Priority:** Should Have

**Description:**
Multiple invocations for same lease don't cause issues

**Acceptance Criteria:**
- [ ] Re-triggering for same lease doesn't create duplicate stacks
- [ ] Existing stack detected and handled appropriately

**Rationale:** Events could be replayed; system should be resilient

---

### NFR-006: Maintainability - Code Simplicity

**Priority:** Must Have

**Description:**
Codebase is minimal and easy to understand

**Acceptance Criteria:**
- [ ] Single Lambda function, minimal dependencies
- [ ] Clear separation of concerns
- [ ] Follows standard Node.js conventions

**Rationale:** Design principle: "Minimal and simple"

---

### NFR-007: Maintainability - Test Coverage

**Priority:** Must Have

**Description:**
Comprehensive test coverage for reliability

**Acceptance Criteria:**
- [ ] Unit tests for all business logic
- [ ] Integration tests for AWS interactions (mocked)
- [ ] Test coverage > 80%

**Rationale:** Design principle: "Comprehensive testing"

---

### NFR-008: Maintainability - Documentation

**Priority:** Must Have

**Description:**
README enables others to use and contribute

**Acceptance Criteria:**
- [ ] README covers installation, configuration, and usage
- [ ] Architecture overview documented
- [ ] Contributing guidelines included

**Rationale:** Design principle: "Great documentation", "Open source ready"

---

### NFR-009: Observability - Logging

**Priority:** Must Have

**Description:**
Sufficient logging for troubleshooting

**Acceptance Criteria:**
- [ ] Structured JSON logging to CloudWatch
- [ ] Key events logged (trigger, lookup, deploy, complete)
- [ ] Error details logged with context

**Rationale:** Operators need visibility into deployments

---

### NFR-010: Cost - Operational Efficiency

**Priority:** Should Have

**Description:**
Low operational cost as expected

**Acceptance Criteria:**
- [ ] Lambda sized appropriately (not over-provisioned)
- [ ] No unnecessary AWS API calls
- [ ] CloudWatch log retention configured appropriately

**Rationale:** Constraint from product brief: "Low operational cost expected"

---

## Epics

### Traceability Matrix

| Epic ID | Epic Name | FRs | Story Estimate |
|---------|-----------|-----|----------------|
| EPIC-001 | Event Processing | FR-001, FR-002 | 3-4 |
| EPIC-002 | Template Management | FR-003, FR-004, FR-012 | 4-5 |
| EPIC-003 | Cross-Account Deployment | FR-005, FR-006, FR-007, FR-013 | 5-6 |
| EPIC-004 | Parameter Enrichment | FR-008, FR-009, FR-014 | 3-4 |
| EPIC-005 | Status Notifications | FR-010, FR-011 | 2-3 |
| EPIC-006 | Infrastructure & Deployment | FR-015, FR-016, FR-017 | 4-5 |
| | **Total** | | **21-27** |

---

### EPIC-001: Event Processing

**Description:**
Handle incoming lease approval events and extract required metadata

**Functional Requirements:**
- FR-001: Receive lease approved events
- FR-002: Extract lease metadata

**Story Count Estimate:** 3-4 stories

**Priority:** Must Have

**Business Value:** Foundation for the entire system - without event processing, nothing else works

---

### EPIC-002: Template Management

**Description:**
Fetch and validate CloudFormation templates from GitHub

**Functional Requirements:**
- FR-003: Fetch template from GitHub
- FR-004: Handle missing templates
- FR-012: Configurable GitHub source

**Story Count Estimate:** 4-5 stories

**Priority:** Must Have

**Business Value:** Core capability to retrieve scenario templates and handle edge cases

---

### EPIC-003: Cross-Account Deployment

**Description:**
Deploy CloudFormation stacks to lease holder sub-accounts

**Functional Requirements:**
- FR-005: Assume cross-account role
- FR-006: Deploy CloudFormation stack
- FR-007: Unique stack naming
- FR-013: Configurable target role

**Story Count Estimate:** 5-6 stories

**Priority:** Must Have

**Business Value:** The core value proposition - deploying infrastructure to user accounts

---

### EPIC-004: Parameter Enrichment

**Description:**
Enhance deployments with lease metadata from DynamoDB

**Functional Requirements:**
- FR-008: Lookup lease from DynamoDB
- FR-009: Inject lease parameters
- FR-014: Configurable lease table

**Story Count Estimate:** 3-4 stories

**Priority:** Must Have

**Business Value:** Enables personalized deployments using lease context

---

### EPIC-005: Status Notifications

**Description:**
Emit events for deployment outcomes

**Functional Requirements:**
- FR-010: Emit success event
- FR-011: Emit failure event

**Story Count Estimate:** 2-3 stories

**Priority:** Must Have

**Business Value:** Observability and potential integrations with ISB

---

### EPIC-006: Infrastructure & Deployment

**Description:**
CloudFormation stack and supporting resources for the deployer

**Functional Requirements:**
- FR-015: CloudFormation deployment stack
- FR-016: EventBridge rule
- FR-017: IAM permissions

**Story Count Estimate:** 4-5 stories

**Priority:** Must Have

**Business Value:** Enables deployment and operation of the system

---

## User Stories

Detailed user stories will be created during sprint planning (Phase 4).

---

## Dependencies

### Internal Dependencies

| Dependency | Description | Risk |
|------------|-------------|------|
| ISB EventBridge Events | Lease approval events trigger this system | Medium - event structure may change |
| ISB DynamoDB Lease Table | Source of lease metadata for parameter enrichment | Low - stable table structure |
| ISB Cross-Account Role | `ndx_IsbUsersPS` role for deployment to sub-accounts | Medium - permissions may be insufficient |

### External Dependencies

| Dependency | Description | Risk |
|------------|-------------|------|
| GitHub Repository | Source of CloudFormation scenario templates | Low - public repo, controlled by NDX |
| GitHub API | Used to fetch templates | Low - rate limiting mitigated with tokens |

---

## Assumptions

1. Lease template name is available via EventBridge event or DynamoDB lookup
2. GitHub repository is accessible (public or with access tokens)
3. `ndx_IsbUsersPS` role has sufficient permissions for CloudFormation deployment in sub-accounts
4. Scenario templates are valid CloudFormation YAML

---

## Constraints

1. Must integrate with existing ISB EventBridge and DynamoDB (no modifications to ISB core)
2. Must use existing `ndx_IsbUsersPS` role for cross-account deployment
3. Node.js runtime for Lambda function
4. Follow good security best practices
5. Low operational cost expected

---

## Out of Scope

- Creating or managing the scenario templates themselves
- Cleanup of deployed resources when lease expires
- UI or dashboard for monitoring deployments
- Support for non-CloudFormation deployments (Terraform, CDK)
- Retry logic for failed deployments

---

## Future Considerations

- CDK support for scenario templates

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ISB event structure changes | Medium | High | Decouple with DynamoDB lookup; monitor ISB releases |
| Cross-account permissions insufficient | Medium | High | Test early with real sub-accounts; document required permissions |
| Malformed scenario templates | Medium | Medium | Validate templates before deployment; emit clear error events |
| GitHub rate limiting | Low | Low | Cache templates where possible; use GitHub API tokens |
| ISB team doesn't adopt it | Medium | Medium | Build to ISB coding standards; engage early with ISB team |

---

## Stakeholders

| Stakeholder | Interest | Influence |
|-------------|----------|-----------|
| NDX team (GDS) | Building, deploying, rolling out to UK Gov | High |
| ISB team | Potential adopters for long-term maintenance | Medium |
| Innovation Sandbox users | Beneficiaries - better starting experience | Low (indirect) |

---

## Prioritization Summary

### Functional Requirements
- **Must Have:** 17
- **Should Have:** 0
- **Could Have:** 0

### Non-Functional Requirements
- **Must Have:** 8
- **Should Have:** 2

### Epics
- **Must Have:** 6
- **Total Estimated Stories:** 21-27

---

## Approval

- [ ] Product Owner approval
- [ ] Technical Lead review
- [ ] Stakeholder sign-off

---

*Document generated as part of BMAD Method v6 - Phase 2: Requirements & Planning*
