import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getConfig } from './config.js';

/**
 * EventBridge client singleton
 */
let eventBridgeClient: EventBridgeClient | null = null;

/**
 * Gets or creates the EventBridge client instance
 */
function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) {
    const config = getConfig();
    eventBridgeClient = new EventBridgeClient({ region: config.awsRegion });
  }
  return eventBridgeClient;
}

/**
 * Resets the EventBridge client singleton (for testing)
 */
export function resetEventBridgeClient(): void {
  eventBridgeClient = null;
}

/**
 * Emits an event to the default EventBridge bus
 *
 * @param detailType - The event detail type (e.g., 'Deployment Succeeded')
 * @param detail - The event detail payload
 * @throws {Error} If the event emission fails
 *
 * @example
 * ```typescript
 * await emitEvent('Deployment Succeeded', {
 *   leaseId: 'lease-123',
 *   accountId: '123456789012',
 *   templateName: 'example-template',
 *   stackName: 'example-stack',
 *   stackId: 'arn:aws:cloudformation:...'
 * });
 * ```
 */
export async function emitEvent(detailType: string, detail: object): Promise<void> {
  const config = getConfig();
  const client = getEventBridgeClient();

  const command = new PutEventsCommand({
    Entries: [
      {
        Source: config.eventSource,
        DetailType: detailType,
        Detail: JSON.stringify(detail),
      },
    ],
  });

  const response = await client.send(command);

  // Check for failures in the response
  if (response.FailedEntryCount && response.FailedEntryCount > 0) {
    const errorMessage =
      response.Entries?.[0]?.ErrorMessage || 'Unknown error emitting event';
    throw new Error(`Failed to emit event: ${errorMessage}`);
  }
}
