# Product Brief: Innovation Sandbox on AWS Deployer

**Project:** innovation-sandbox-on-aws-deployer
**Type:** Infrastructure
**Level:** 3 (Complex - 12-40 stories)
**Date:** 2025-12-03
**Status:** Draft

---

## Executive Summary

An AWS CloudFormation deployer that integrates with innovation-sandbox-on-aws, automatically deploying templates from a configurable GitHub repository when lease template names match directory names. It runs as a background service triggered by EventBridge events, giving Innovation Sandbox users meaningful starting environments instead of empty AWS consoles.

---

## Problem Statement

### The Problem

Users of Innovation Sandbox receive empty AWS accounts when their lease is approved. They must deploy infrastructure themselves, which creates friction and confusion.

### Current Behavior

Users mostly give up, get lost, or get distracted when faced with an empty AWS console. This leads to poor engagement and wasted sandbox leases.

### Why Now

The NDX team is rolling out Innovation Sandbox to a large cohort of UK Government organizations. Without pre-configured environments, the rollout risks poor adoption and frustrated users.

### Impact if Unsolved

- Poor adoption rates across UK Gov organizations
- Wasted sandbox leases
- Frustrated users who abandon before experiencing value
- Failed rollout objectives

---

## Target Audience

### Primary Users (Beneficiaries)

Innovation Sandbox lease holders - a mix of developers, architects, policy people, and others exploring AWS. Profile varies by scenario they deploy.

### Secondary Users (Operators)

NDX team in GDS:
- Manages scenario templates in the GitHub repository
- Deploys and maintains this stack in the hub account

### Open Source Adopters

ISB team - goal is for them to adopt this project so NDX team can hand off maintenance.

---

## Solution Overview

### Proposed Solution

A CloudFormation-deployed Lambda function in the Innovation Sandbox hub account that automatically deploys scenario templates when leases are approved.

### Core Flow

1. **Trigger:** EventBridge event when lease is approved (including auto-approved)
2. **Lookup:** Lambda extracts lease template name (from event or DynamoDB)
3. **Match:** Check if `{repo}/{branch}/{directory}/{template-name}/template.yaml` exists in GitHub
4. **Deploy:** If match found → Assume `ndx_IsbUsersPS` role in sub-account → Deploy CloudFormation with enriched parameters
5. **Notify:** Emit EventBridge event on success/failure
6. **Graceful exit:** If no template exists, exit quietly (empty account is valid)

### Key Features

- Configurable GitHub repository, branch, and directory path
- Configurable IAM role for cross-account deployment
- Parameter enrichment from DynamoDB lease table
- EventBridge events for deployment status (without breaking ISB functionality)
- Graceful handling of missing templates
- Minimal, simple codebase
- Comprehensive test coverage
- Great README documentation
- Open source ready

### Configuration

Default deployment configuration:
- **Repository:** `co-cddo/ndx_try_aws_scenarios`
- **Branch:** `main`
- **Directory:** `cloudformation/scenarios`
- **Lease Table:** `ndx-try-isb-data-LeaseTable473C6DF2-1RC3238PVASE1`
- **Target Role:** `ndx_IsbUsersPS`

### Example Scenarios

| Lease Template | Action |
|----------------|--------|
| `council-chatbot` | Deploy `cloudformation/scenarios/council-chatbot/template.yaml` |
| `user research 0.0.1` | No matching directory → exit quietly |

---

## Business Objectives

### Goals

- Improve user engagement with Innovation Sandbox
- Reduce time-to-value for lease holders
- Support the UK Government rollout of Innovation Sandbox

### Success Metrics

- CloudTrail monitoring for engagement with deployed resources
- Usage rates of deployed scenarios
- Repeat usage rates
- Qualitative feedback from users

### Business Value

- Better adoption rates across UK Gov organizations
- Demonstrable value for the rollout
- Reduced friction for new users
- Improved user experience leading to higher satisfaction

---

## Scope

### In Scope

- CloudFormation stack for deployment to hub account
- Lambda function triggered by EventBridge (lease approved events)
- GitHub repository integration (configurable repo/branch/directory)
- Cross-account CloudFormation deployment via role assumption
- DynamoDB enrichment of CloudFormation parameters
- EventBridge events for deployment status
- Comprehensive test coverage
- Great README documentation
- Open source ready codebase

### Out of Scope

- Creating or managing the scenario templates themselves
- Cleanup of deployed resources when lease expires
- UI or dashboard for monitoring deployments
- Support for non-CloudFormation deployments (Terraform, CDK)
- Retry logic for failed deployments

### Future Considerations

- CDK support for scenario templates

---

## Stakeholders

| Stakeholder | Interest | Influence |
|-------------|----------|-----------|
| **NDX team (GDS)** | Building, deploying, and rolling out Innovation Sandbox to UK Gov | High |
| **ISB team** | Potential adopters to maintain long-term | Medium |
| **Innovation Sandbox users** | Beneficiaries - better starting experience | Low (indirect) |

---

## Constraints and Assumptions

### Constraints

- Must integrate with existing ISB EventBridge and DynamoDB (no modifications to ISB core)
- Must use existing `ndx_IsbUsersPS` role for cross-account deployment
- Node.js runtime for Lambda function
- Follow good security best practices
- Low operational cost expected

### Assumptions

- Lease template name is available via EventBridge event or DynamoDB lookup
- GitHub repository is accessible (public or with access tokens)
- `ndx_IsbUsersPS` role has sufficient permissions for CloudFormation deployment in sub-accounts
- Scenario templates are valid CloudFormation YAML

---

## Success Criteria

- Users can start experimenting within minutes of lease approval
- ISB team accepts the contribution and maintains it going forward
- Zero manual intervention required for deployments
- Ready for UK Gov rollout

---

## Timeline

- **Target:** ASAP
- **Environment:** Single working environment (ISB not in production yet)
- **Approach:** Build → Test → Deploy to working environment

---

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **ISB event structure changes** - integration breaks | Medium | Decouple with DynamoDB lookup; monitor ISB releases |
| **Cross-account permissions insufficient** - deployments fail | Medium | Test early with real sub-accounts; document required permissions |
| **Malformed scenario templates** - deployment errors | Medium | Validate templates before deployment; emit clear error events |
| **GitHub rate limiting** - can't fetch templates | Low | Cache templates where possible; use GitHub API tokens |
| **ISB team doesn't adopt it** - NDX maintains indefinitely | Medium | Build to ISB coding standards; engage early with ISB team |

---

## Technical References

- **ISB Source Code:** `../innovation-sandbox-on-aws`
- **Scenario Templates:** `https://github.com/co-cddo/ndx_try_aws_scenarios`
- **AWS Profile for Inspection:** `NDX/InnovationSandboxHub`
- **DynamoDB Lease Table:** `ndx-try-isb-data-LeaseTable473C6DF2-1RC3238PVASE1`
- **Target Role:** `ndx_IsbUsersPS`

---

## Appendix: Design Principles

1. **Minimal and simple** - Code should be straightforward and easy to understand
2. **Comprehensive testing** - High test coverage for reliability
3. **Great documentation** - README should enable others to use and contribute
4. **Open source ready** - Build with community adoption in mind
5. **Non-invasive** - Don't modify ISB core; integrate via events
6. **Fail gracefully** - Missing templates are OK; errors should not break ISB

---

*Document generated as part of BMAD Method v6 - Phase 1: Discovery & Vision*
