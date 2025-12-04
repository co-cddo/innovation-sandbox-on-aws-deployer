import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { emitEvent, resetEventBridgeClient } from './event-emitter.js';
import { resetConfig } from './config.js';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(),
  PutEventsCommand: vi.fn(),
}));

describe('event-emitter module', () => {
  const originalEnv = process.env;
  let mockSend: ReturnType<typeof vi.fn>;
  let mockEventBridgeClient: any;

  beforeEach(() => {
    vi.resetModules();
    resetConfig();
    resetEventBridgeClient();
    process.env = { ...originalEnv };
    process.env.LEASE_TABLE_NAME = 'test-table';

    // Create a mock send function
    mockSend = vi.fn();

    // Create a mock EventBridge client instance
    mockEventBridgeClient = {
      send: mockSend,
    };

    // Mock the EventBridgeClient constructor
    (EventBridgeClient as any).mockImplementation(() => mockEventBridgeClient);

    // Mock the PutEventsCommand constructor
    (PutEventsCommand as any).mockImplementation((input: any) => ({
      input,
      _isMockCommand: true,
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
    resetEventBridgeClient();
    vi.clearAllMocks();
  });

  describe('emitEvent', () => {
    it('should emit event successfully with correct parameters', async () => {
      // Mock successful response
      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      const detailType = 'Deployment Succeeded';
      const detail = {
        leaseId: 'lease-123',
        accountId: '123456789012',
        templateName: 'example-template',
        stackName: 'example-stack',
        stackId: 'arn:aws:cloudformation:...',
      };

      await emitEvent(detailType, detail);

      // Verify the send method was called once
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Verify the command was created with correct parameters
      const command = mockSend.mock.calls[0][0];
      expect(command.input.Entries).toHaveLength(1);
      expect(command.input.Entries[0]).toEqual({
        Source: 'innovation-sandbox',
        DetailType: detailType,
        Detail: JSON.stringify(detail),
      });
    });

    it('should use event source from config (default: innovation-sandbox)', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      await emitEvent('Test Event', { test: 'data' });

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Entries[0].Source).toBe('innovation-sandbox');
    });

    it('should use custom event source from environment variable', async () => {
      resetConfig();
      resetEventBridgeClient();
      process.env.EVENT_SOURCE = 'custom-source';

      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      await emitEvent('Test Event', { test: 'data' });

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Entries[0].Source).toBe('custom-source');
    });

    it('should pass detail type correctly', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      const detailType = 'Custom Detail Type';
      await emitEvent(detailType, { foo: 'bar' });

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Entries[0].DetailType).toBe(detailType);
    });

    it('should serialize detail payload to JSON string', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      const detail = {
        leaseId: 'lease-456',
        accountId: '987654321098',
        nested: {
          field: 'value',
          array: [1, 2, 3],
        },
      };

      await emitEvent('Test Event', detail);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Entries[0].Detail).toBe(JSON.stringify(detail));
      expect(typeof command.input.Entries[0].Detail).toBe('string');
    });

    it('should throw error when FailedEntryCount is greater than 0', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [
          {
            ErrorCode: 'ValidationError',
            ErrorMessage: 'Invalid event format',
          },
        ],
      });

      await expect(emitEvent('Test Event', { test: 'data' })).rejects.toThrow(
        'Failed to emit event: Invalid event format'
      );
    });

    it('should throw error with generic message when error message is not provided', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [
          {
            ErrorCode: 'UnknownError',
          },
        ],
      });

      await expect(emitEvent('Test Event', { test: 'data' })).rejects.toThrow(
        'Failed to emit event: Unknown error emitting event'
      );
    });

    it('should throw error when Entries array is missing', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 1,
      });

      await expect(emitEvent('Test Event', { test: 'data' })).rejects.toThrow(
        'Failed to emit event: Unknown error emitting event'
      );
    });

    it('should use AWS region from config for EventBridge client', async () => {
      resetConfig();
      resetEventBridgeClient();
      process.env.AWS_REGION = 'us-west-2';

      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      await emitEvent('Test Event', { test: 'data' });

      // Verify EventBridgeClient was created with correct region
      expect(EventBridgeClient).toHaveBeenCalledWith({ region: 'us-west-2' });
    });

    it('should use default AWS region (us-west-2) when not specified', async () => {
      delete process.env.AWS_REGION;
      resetConfig();
      resetEventBridgeClient();

      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      await emitEvent('Test Event', { test: 'data' });

      // Verify EventBridgeClient was created with default region
      expect(EventBridgeClient).toHaveBeenCalledWith({ region: 'us-west-2' });
    });
  });

  describe('EventBridge client singleton', () => {
    it('should create EventBridge client only once for multiple calls', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      await emitEvent('Event 1', { data: 1 });
      await emitEvent('Event 2', { data: 2 });
      await emitEvent('Event 3', { data: 3 });

      // EventBridgeClient constructor should be called only once (singleton pattern)
      expect(EventBridgeClient).toHaveBeenCalledTimes(1);

      // But send should be called three times
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should use the same client instance for multiple emissions', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      await emitEvent('Event 1', { data: 1 });
      await emitEvent('Event 2', { data: 2 });

      // EventBridgeClient should only be instantiated once (singleton)
      expect(EventBridgeClient).toHaveBeenCalledTimes(1);

      // But send should be called twice
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('resetEventBridgeClient', () => {
    it('should reset the EventBridge client singleton', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      // First emission creates the client
      await emitEvent('Event 1', { data: 1 });
      expect(EventBridgeClient).toHaveBeenCalledTimes(1);

      // Reset the client
      resetEventBridgeClient();

      // Second emission should create a new client
      await emitEvent('Event 2', { data: 2 });
      expect(EventBridgeClient).toHaveBeenCalledTimes(2);
    });

    it('should allow client to be recreated with different config after reset', async () => {
      // Set up first region explicitly
      delete process.env.AWS_REGION;
      resetConfig();
      resetEventBridgeClient();

      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      // Create client with default region (us-west-2)
      await emitEvent('Event 1', { data: 1 });
      expect(EventBridgeClient).toHaveBeenCalledTimes(1);
      expect(EventBridgeClient).toHaveBeenLastCalledWith({ region: 'us-west-2' });

      // Reset both config and client
      resetConfig();
      resetEventBridgeClient();
      process.env.AWS_REGION = 'ap-southeast-1';

      // Create new client with different region
      await emitEvent('Event 2', { data: 2 });
      expect(EventBridgeClient).toHaveBeenCalledTimes(2);
      expect(EventBridgeClient).toHaveBeenLastCalledWith({ region: 'ap-southeast-1' });
    });
  });

  describe('error handling', () => {
    it('should propagate AWS SDK errors', async () => {
      const awsError = new Error('AWS service unavailable');
      mockSend.mockRejectedValue(awsError);

      await expect(emitEvent('Test Event', { test: 'data' })).rejects.toThrow(
        'AWS service unavailable'
      );
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      mockSend.mockRejectedValue(networkError);

      await expect(emitEvent('Test Event', { test: 'data' })).rejects.toThrow('Network timeout');
    });

    it('should handle empty detail object', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      await emitEvent('Test Event', {});

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Entries[0].Detail).toBe('{}');
    });

    it('should handle complex nested detail objects', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      const complexDetail = {
        level1: {
          level2: {
            level3: {
              array: [1, 2, 3],
              boolean: true,
              null: null,
            },
          },
        },
      };

      await emitEvent('Test Event', complexDetail);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Entries[0].Detail).toBe(JSON.stringify(complexDetail));
    });
  });
});
