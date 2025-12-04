/**
 * ISB Deployer Lambda Handler
 *
 * This Lambda function is triggered by EventBridge when leases are approved
 * in Innovation Sandbox. It fetches CloudFormation templates from GitHub
 * and deploys them to the user's sub-account.
 *
 * Deployment Flow:
 * 1. Parse and validate the incoming lease event (get leaseId + userEmail)
 * 2. Lookup lease details from DynamoDB (get accountId + templateName)
 * 3. Check for template (graceful no-op if missing)
 * 4. Validate CloudFormation template structure
 * 5. Assume role in target sub-account
 * 6. Generate unique stack name
 * 7. Deploy stack with parameters mapped from lease
 * 8. Emit success or failure event to EventBridge
 */

import { parseLeaseEvent } from './modules/event-parser.js';
import { getConfig } from './modules/config.js';
import { Logger } from './modules/logger.js';
import { handleTemplate } from './modules/template-handler.js';
import { validateTemplate } from './modules/template-validator.js';
import { lookupLease } from './modules/lease-lookup.js';
import { assumeRole } from './modules/role-assumer.js';
import { generateStackName } from './modules/stack-name.js';
import { deployWithParameters } from './modules/deployment-orchestrator.js';
import {
  emitDeploymentSuccess,
  emitDeploymentFailure,
  categorizeError,
} from './modules/deployment-events.js';

/**
 * Lambda handler response type
 */
interface HandlerResponse {
  statusCode: number;
  body?: string;
}

/**
 * Lambda handler entry point
 *
 * @param event - EventBridge event for lease approval (ISB LeaseApproved event)
 * @returns Handler response with status code
 */
export async function handler(event: unknown): Promise<HandlerResponse> {
  // Initialize config and logger
  const config = getConfig();
  const logger = new Logger(config.logLevel);

  // Placeholder for parsed event details (needed for error handling)
  let leaseId = 'unknown';
  let userEmail = 'unknown';
  let accountId = 'unknown';
  let templateName: string | undefined;

  try {
    // Step 1: Parse and validate the incoming event
    // ISB LeaseApproved events contain: leaseId, userEmail, approvedBy
    logger.info('Lambda triggered by EventBridge event', { event: 'TRIGGER' });

    const leaseEvent = parseLeaseEvent(event);
    leaseId = leaseEvent.leaseId;
    userEmail = leaseEvent.userEmail;

    // Set correlation ID for all subsequent logs
    logger.setContext({ correlationId: leaseId });

    logger.info('Lease event parsed successfully', {
      event: 'TRIGGER',
      leaseId,
      userEmail,
      approvedBy: leaseEvent.approvedBy,
    });

    // Step 2: Lookup lease details from DynamoDB
    // This gets accountId and templateName which are NOT in the event
    logger.info('Looking up lease details', { event: 'LOOKUP', leaseId, userEmail });
    const leaseDetails = await lookupLease(userEmail, leaseId);

    // Now we have accountId and templateName from the lookup
    accountId = leaseDetails.accountId;
    templateName = leaseDetails.templateName;

    logger.info('Lease details retrieved', {
      event: 'LOOKUP',
      leaseId,
      accountId,
      templateName: templateName || 'none',
      budgetAmount: leaseDetails.budgetAmount,
      status: leaseDetails.status,
    });

    // Step 3: Handle template (check if exists, fetch if specified)
    const templateResult = await handleTemplate(templateName, leaseId, logger);

    if (templateResult.skip) {
      // No template to deploy - graceful no-op
      logger.info('Deployment skipped - no template configured', {
        event: 'COMPLETE',
        leaseId,
        reason: templateResult.reason,
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Deployment skipped',
          reason: templateResult.reason,
          leaseId,
        }),
      };
    }

    // Step 4: Validate the template
    logger.debug('Validating CloudFormation template', { event: 'FETCH', leaseId });
    const validatedTemplate = validateTemplate(templateResult.template!);

    logger.info('Template validated successfully', {
      event: 'FETCH',
      leaseId,
      hasParameters: validatedTemplate.hasParameters,
      parameterCount: validatedTemplate.parameters.length,
    });

    // Step 5: Assume role in target account
    logger.info('Assuming role in target account', {
      event: 'DEPLOY',
      leaseId,
      targetAccountId: leaseDetails.accountId,
    });

    const credentials = await assumeRole(leaseDetails.accountId);

    logger.info('Role assumed successfully', {
      event: 'DEPLOY',
      leaseId,
      targetAccountId: leaseDetails.accountId,
      credentialExpiration: credentials.expiration?.toISOString(),
    });

    // Step 6: Generate stack name
    const stackName = generateStackName(templateName!, leaseId);
    logger.info('Stack name generated', {
      event: 'DEPLOY',
      leaseId,
      stackName,
    });

    // Step 7: Deploy the stack with parameters
    logger.info('Deploying CloudFormation stack', {
      event: 'DEPLOY',
      leaseId,
      stackName,
      targetAccountId: leaseDetails.accountId,
    });

    const deploymentResult = await deployWithParameters(
      {
        templateBody: templateResult.template!,
        templateParameters: validatedTemplate.parameters,
        leaseDetails,
        stackName,
        credentials,
      },
      logger
    );

    // Step 8: Emit success event
    logger.info('Deployment completed successfully', {
      event: 'COMPLETE',
      leaseId,
      stackId: deploymentResult.stackId,
      action: deploymentResult.action,
      parametersUsed: deploymentResult.parametersUsed,
    });

    await emitDeploymentSuccess(
      {
        leaseId,
        accountId: leaseDetails.accountId,
        stackName,
        stackId: deploymentResult.stackId,
        templateName,
        action: deploymentResult.action,
        timestamp: new Date().toISOString(),
      },
      logger
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Deployment successful',
        leaseId,
        stackId: deploymentResult.stackId,
        action: deploymentResult.action,
      }),
    };
  } catch (error) {
    // Handle deployment failure
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorType = error instanceof Error ? error.name : 'UnknownError';

    logger.error('Deployment failed', {
      event: 'COMPLETE',
      leaseId,
      error: errorMessage,
      errorType,
    });

    // Emit failure event
    await emitDeploymentFailure(
      {
        leaseId,
        accountId,
        errorMessage,
        errorType,
        failureCategory: categorizeError({
          errorType,
          errorMessage,
        }),
        templateName,
      },
      logger
    );

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Deployment failed',
        leaseId,
        error: errorMessage,
        errorType,
      }),
    };
  }
}
