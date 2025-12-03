/**
 * ISB Deployer Lambda Handler
 *
 * This Lambda function is triggered by EventBridge when leases are approved
 * in Innovation Sandbox. It fetches CloudFormation templates from GitHub
 * and deploys them to the user's sub-account.
 */

import type { LeaseApprovedEvent } from './types/index.js';

/**
 * Lambda handler entry point
 *
 * @param event - EventBridge event for lease approval
 * @returns Handler response
 */
export async function handler(event: LeaseApprovedEvent): Promise<{ statusCode: number }> {
  // Placeholder - will be implemented in STORY-003
  const leaseId = event.detail?.leaseId ?? 'unknown';

  // Log the event for now
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event: 'TRIGGER', leaseId }));

  return { statusCode: 200 };
}
