/**
 * CDK Bootstrapper Module
 *
 * Ensures target accounts are CDK bootstrapped before deploying CDK stacks.
 * Uses the CDK Bootstrap CloudFormation template to set up required resources.
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
  CreateStackCommand,
  UpdateStackCommand,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import { SSMClient, GetParameterCommand, ParameterNotFound } from '@aws-sdk/client-ssm';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import type { Logger } from './logger.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CDK Bootstrap stack name (standard CDK convention)
 */
const BOOTSTRAP_STACK_NAME = 'CDKToolkit';

/**
 * SSM parameter that CDK uses to verify bootstrap version
 */
const BOOTSTRAP_VERSION_PARAMETER = '/cdk-bootstrap/hnb659fds/version';

/**
 * Minimum bootstrap version required
 */
const MIN_BOOTSTRAP_VERSION = 6;

/**
 * Current bootstrap version we deploy
 * Note: This constant is kept for documentation; the actual version is in the template file
 */
const _CURRENT_BOOTSTRAP_VERSION = 21;
void _CURRENT_BOOTSTRAP_VERSION; // Suppress unused variable warning

/**
 * Find the CDK bootstrap template file
 *
 * Searches multiple possible locations to support:
 * - Lambda runtime (/var/task)
 * - Local development (src/templates)
 * - Built output (dist/templates)
 */
function findBootstrapTemplatePath(): string {
  // In Lambda, the code runs from /var/task
  // During build, templates are copied to dist/templates
  const possiblePaths = [
    // Lambda: in /var/task/templates
    path.join('/var/task/templates', 'cdk-bootstrap.yaml'),
    // Development: relative to src
    path.join(process.cwd(), 'src/templates/cdk-bootstrap.yaml'),
    // Production build: in dist/templates
    path.join(process.cwd(), 'dist/templates/cdk-bootstrap.yaml'),
    // Relative to __dirname (for CJS bundled output)
    path.join(__dirname, '../templates/cdk-bootstrap.yaml'),
    path.join(__dirname, 'templates/cdk-bootstrap.yaml'),
  ];

  for (const templatePath of possiblePaths) {
    if (fs.existsSync(templatePath)) {
      return templatePath;
    }
  }

  throw new Error('CDK bootstrap template not found. Searched: ' + possiblePaths.join(', '));
}

/**
 * Loads the CDK bootstrap template from the templates directory
 *
 * The template is loaded from a separate YAML file for:
 * - Better maintainability (can be edited with YAML tools)
 * - Easier updates (just update the file, no code changes)
 * - Code review clarity (template changes are visible in diffs)
 */
function loadBootstrapTemplate(): string {
  const templatePath = findBootstrapTemplatePath();
  return fs.readFileSync(templatePath, 'utf-8');
}

// Lazy-loaded template (cached after first load)
let cachedBootstrapTemplate: string | null = null;

/**
 * Gets the CDK Bootstrap CloudFormation template
 */
function getBootstrapTemplate(): string {
  if (!cachedBootstrapTemplate) {
    cachedBootstrapTemplate = loadBootstrapTemplate();
  }
  return cachedBootstrapTemplate;
}

/**
 * Check if a target account/region is CDK bootstrapped
 *
 * @param credentials - AWS credentials for the target account
 * @param region - Target AWS region
 * @param logger - Logger instance
 * @returns Bootstrap version if bootstrapped, null if not
 */
export async function checkBootstrapStatus(
  credentials: AwsCredentialIdentity,
  region: string,
  logger: Logger
): Promise<number | null> {
  const ssmClient = new SSMClient({
    region,
    credentials,
  });

  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: BOOTSTRAP_VERSION_PARAMETER,
      })
    );

    const version = parseInt(response.Parameter?.Value || '0', 10);
    logger.info('CDK bootstrap detected', { region, version });
    return version;
  } catch (error) {
    if (error instanceof ParameterNotFound || (error as Error).name === 'ParameterNotFound') {
      logger.info('CDK bootstrap not found', { region });
      return null;
    }
    throw error;
  }
}

/**
 * Bootstrap a target account/region for CDK deployments
 *
 * @param credentials - AWS credentials for the target account
 * @param accountId - Target AWS account ID
 * @param region - Target AWS region
 * @param logger - Logger instance
 */
export async function bootstrapAccount(
  credentials: AwsCredentialIdentity,
  accountId: string,
  region: string,
  logger: Logger
): Promise<void> {
  const cfnClient = new CloudFormationClient({
    region,
    credentials,
  });

  logger.info('Starting CDK bootstrap', { accountId, region });

  // Check if CDKToolkit stack exists
  let stackExists = false;
  try {
    const describeResponse = await cfnClient.send(
      new DescribeStacksCommand({
        StackName: BOOTSTRAP_STACK_NAME,
      })
    );

    const stack = describeResponse.Stacks?.[0];
    if (stack) {
      stackExists = true;
      const status = stack.StackStatus;

      // Check if stack is in a good state
      if (
        status === StackStatus.CREATE_COMPLETE ||
        status === StackStatus.UPDATE_COMPLETE ||
        status === StackStatus.UPDATE_ROLLBACK_COMPLETE
      ) {
        logger.info('CDKToolkit stack exists, checking version', {
          stackStatus: status,
        });
      } else if (
        status === StackStatus.CREATE_IN_PROGRESS ||
        status === StackStatus.UPDATE_IN_PROGRESS
      ) {
        logger.info('CDKToolkit stack is being updated, waiting', {
          stackStatus: status,
        });
        // Wait for the stack to stabilize
        await waitForStackStable(cfnClient, BOOTSTRAP_STACK_NAME, logger);
        return;
      } else {
        logger.warn('CDKToolkit stack is in unexpected state', {
          stackStatus: status,
        });
      }
    }
  } catch (error) {
    if ((error as Error).message?.includes('does not exist')) {
      stackExists = false;
      logger.info('CDKToolkit stack does not exist, will create');
    } else {
      throw error;
    }
  }

  // Create or update the bootstrap stack
  try {
    if (stackExists) {
      logger.info('Updating CDKToolkit stack');
      await cfnClient.send(
        new UpdateStackCommand({
          StackName: BOOTSTRAP_STACK_NAME,
          TemplateBody: getBootstrapTemplate(),
          Capabilities: ['CAPABILITY_NAMED_IAM'],
          Parameters: [
            {
              ParameterKey: 'Qualifier',
              ParameterValue: 'hnb659fds',
            },
          ],
        })
      );
    } else {
      logger.info('Creating CDKToolkit stack');
      await cfnClient.send(
        new CreateStackCommand({
          StackName: BOOTSTRAP_STACK_NAME,
          TemplateBody: getBootstrapTemplate(),
          Capabilities: ['CAPABILITY_NAMED_IAM'],
          Parameters: [
            {
              ParameterKey: 'Qualifier',
              ParameterValue: 'hnb659fds',
            },
          ],
        })
      );
    }

    // Wait for stack operation to complete
    await waitForStackStable(cfnClient, BOOTSTRAP_STACK_NAME, logger);

    logger.info('CDK bootstrap complete', { accountId, region });
  } catch (error) {
    // Handle "No updates are to be performed" error
    if ((error as Error).message?.includes('No updates are to be performed')) {
      logger.info('CDKToolkit stack is already up to date');
      return;
    }
    throw error;
  }
}

/**
 * Wait for a CloudFormation stack to reach a stable state
 */
async function waitForStackStable(
  cfnClient: CloudFormationClient,
  stackName: string,
  logger: Logger,
  maxWaitMs = 300000, // 5 minutes
  pollIntervalMs = 5000 // 5 seconds
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const response = await cfnClient.send(
      new DescribeStacksCommand({
        StackName: stackName,
      })
    );

    const stack = response.Stacks?.[0];
    if (!stack) {
      throw new Error(`Stack ${stackName} not found`);
    }

    const status = stack.StackStatus;
    logger.debug('Stack status check', { stackName, status });

    // Check for terminal states
    if (status === StackStatus.CREATE_COMPLETE || status === StackStatus.UPDATE_COMPLETE) {
      logger.info('Stack operation completed', { stackName, status });
      return;
    }

    if (
      status === StackStatus.CREATE_FAILED ||
      status === StackStatus.ROLLBACK_COMPLETE ||
      status === StackStatus.ROLLBACK_FAILED ||
      status === StackStatus.UPDATE_ROLLBACK_COMPLETE ||
      status === StackStatus.UPDATE_ROLLBACK_FAILED ||
      status === StackStatus.DELETE_COMPLETE ||
      status === StackStatus.DELETE_FAILED
    ) {
      throw new Error(`Stack ${stackName} ended in state: ${status}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timeout waiting for stack ${stackName} to stabilize`);
}

/**
 * Ensure an account is CDK bootstrapped, bootstrapping if necessary
 *
 * @param credentials - AWS credentials for the target account
 * @param accountId - Target AWS account ID
 * @param region - Target AWS region
 * @param logger - Logger instance
 */
export async function ensureBootstrapped(
  credentials: AwsCredentialIdentity,
  accountId: string,
  region: string,
  logger: Logger
): Promise<void> {
  logger.info('Ensuring CDK bootstrap', { accountId, region });

  const currentVersion = await checkBootstrapStatus(credentials, region, logger);

  if (currentVersion === null) {
    // Not bootstrapped, need to bootstrap
    logger.info('Account not bootstrapped, bootstrapping now', {
      accountId,
      region,
    });
    await bootstrapAccount(credentials, accountId, region, logger);
  } else if (currentVersion < MIN_BOOTSTRAP_VERSION) {
    // Bootstrap version too old, need to upgrade
    logger.info('Bootstrap version too old, upgrading', {
      currentVersion,
      requiredVersion: MIN_BOOTSTRAP_VERSION,
      accountId,
      region,
    });
    await bootstrapAccount(credentials, accountId, region, logger);
  } else {
    logger.info('Account already bootstrapped', {
      version: currentVersion,
      accountId,
      region,
    });
  }
}
