import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MetricsCollector,
  MetricName,
  recordInvocationStart,
  createMetricsCollector,
} from './metrics.js';
import type { Logger } from './logger.js';

describe('metrics module', () => {
  let mockLogger: Logger;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setContext: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as Logger;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('MetricsCollector', () => {
    describe('constructor', () => {
      it('should create collector with environment', () => {
        const collector = new MetricsCollector(mockLogger, 'prod');
        expect(collector).toBeInstanceOf(MetricsCollector);
      });

      it('should use unknown as default environment', () => {
        const collector = new MetricsCollector(mockLogger);
        collector.recordCount(MetricName.COLD_START);
        collector.flush();

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(emfPayload.environment).toBe('unknown');
      });
    });

    describe('setDimensions', () => {
      it('should set dimensions for subsequent metrics', () => {
        const collector = new MetricsCollector(mockLogger, 'dev');
        collector.setDimensions({ templateSource: 'cdk', templateName: 'my-template' });
        collector.recordCount(MetricName.CDK_SYNTHESIS_SUCCESS);
        collector.flush();

        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(emfPayload.templateSource).toBe('cdk');
        expect(emfPayload.templateName).toBe('my-template');
      });

      it('should merge dimensions with existing ones', () => {
        const collector = new MetricsCollector(mockLogger, 'staging');
        collector.setDimensions({ templateSource: 'cloudformation' });
        collector.setDimensions({ region: 'us-east-1' });
        collector.recordCount(MetricName.DEPLOYMENT_SUCCESS);
        collector.flush();

        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(emfPayload.environment).toBe('staging');
        expect(emfPayload.templateSource).toBe('cloudformation');
        expect(emfPayload.region).toBe('us-east-1');
      });
    });

    describe('startTimer', () => {
      it('should return current timestamp', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

        const collector = new MetricsCollector(mockLogger);
        const startTime = collector.startTimer();

        expect(startTime).toBe(new Date('2024-01-15T12:00:00Z').getTime());

        vi.useRealTimers();
      });
    });

    describe('recordDuration', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should record duration from start time', () => {
        vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));
        const collector = new MetricsCollector(mockLogger, 'prod');
        const startTime = collector.startTimer();

        vi.setSystemTime(new Date('2024-01-15T12:00:01.500Z'));
        collector.recordDuration(MetricName.CDK_SYNTHESIS_DURATION, startTime);
        collector.flush();

        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(emfPayload[MetricName.CDK_SYNTHESIS_DURATION]).toBe(1500);
      });

      it('should include additional dimensions', () => {
        const collector = new MetricsCollector(mockLogger, 'prod');
        const startTime = collector.startTimer();
        collector.recordDuration(MetricName.DEPLOYMENT_DURATION, startTime, {
          templateName: 'test-template',
        });

        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Metric recorded',
          expect.objectContaining({
            metric: MetricName.DEPLOYMENT_DURATION,
            templateName: 'test-template',
          })
        );
      });
    });

    describe('recordCount', () => {
      it('should record count with default value of 1', () => {
        const collector = new MetricsCollector(mockLogger, 'prod');
        collector.recordCount(MetricName.COLD_START);
        collector.flush();

        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(emfPayload[MetricName.COLD_START]).toBe(1);
      });

      it('should record count with custom value', () => {
        const collector = new MetricsCollector(mockLogger, 'prod');
        collector.recordCount(MetricName.STACK_CREATE, 5);
        collector.flush();

        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(emfPayload[MetricName.STACK_CREATE]).toBe(5);
      });

      it('should include dimensions', () => {
        const collector = new MetricsCollector(mockLogger, 'prod');
        collector.recordCount(MetricName.DEPLOYMENT_FAILURE, 1, { errorType: 'TimeoutError' });

        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Metric recorded',
          expect.objectContaining({
            metric: MetricName.DEPLOYMENT_FAILURE,
            errorType: 'TimeoutError',
          })
        );
      });
    });

    describe('flush', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should output EMF formatted JSON', () => {
        const collector = new MetricsCollector(mockLogger, 'prod');
        collector.recordCount(MetricName.WARM_START);
        collector.flush();

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

        expect(emfPayload._aws).toBeDefined();
        expect(emfPayload._aws.Timestamp).toBe(new Date('2024-01-15T12:00:00Z').getTime());
        expect(emfPayload._aws.CloudWatchMetrics).toHaveLength(1);
        expect(emfPayload._aws.CloudWatchMetrics[0].Namespace).toBe('ISBDeployer');
        expect(emfPayload._aws.CloudWatchMetrics[0].Metrics).toContainEqual({
          Name: MetricName.WARM_START,
          Unit: 'Count',
        });
      });

      it('should not output if no metrics recorded', () => {
        const collector = new MetricsCollector(mockLogger, 'prod');
        collector.flush();

        expect(consoleLogSpy).not.toHaveBeenCalled();
      });

      it('should clear metrics after flush', () => {
        const collector = new MetricsCollector(mockLogger, 'prod');
        collector.recordCount(MetricName.COLD_START);
        collector.flush();
        collector.flush();

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      });

      it('should include multiple metrics in single payload', () => {
        const collector = new MetricsCollector(mockLogger, 'prod');
        collector.recordCount(MetricName.COLD_START);
        collector.recordCount(MetricName.DEPLOYMENT_SUCCESS);
        collector.flush();

        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(emfPayload[MetricName.COLD_START]).toBe(1);
        expect(emfPayload[MetricName.DEPLOYMENT_SUCCESS]).toBe(1);
        expect(emfPayload._aws.CloudWatchMetrics[0].Metrics).toHaveLength(2);
      });

      it('should include dimension keys in EMF structure', () => {
        const collector = new MetricsCollector(mockLogger, 'prod');
        collector.setDimensions({ templateSource: 'cdk' });
        collector.recordCount(MetricName.CDK_SYNTHESIS_SUCCESS);
        collector.flush();

        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(emfPayload._aws.CloudWatchMetrics[0].Dimensions[0]).toContain('environment');
        expect(emfPayload._aws.CloudWatchMetrics[0].Dimensions[0]).toContain('templateSource');
      });
    });

    describe('withTiming', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should record duration and success metric on success', async () => {
        vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));
        const collector = new MetricsCollector(mockLogger, 'prod');

        const fn = vi.fn().mockImplementation(async () => {
          vi.setSystemTime(new Date('2024-01-15T12:00:00.500Z'));
          return 'result';
        });

        const result = await collector.withTiming(
          MetricName.CDK_SYNTHESIS_DURATION,
          fn,
          MetricName.CDK_SYNTHESIS_SUCCESS,
          MetricName.CDK_SYNTHESIS_FAILURE
        );

        expect(result).toBe('result');
        expect(fn).toHaveBeenCalledTimes(1);

        collector.flush();
        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

        expect(emfPayload[MetricName.CDK_SYNTHESIS_DURATION]).toBe(500);
        expect(emfPayload[MetricName.CDK_SYNTHESIS_SUCCESS]).toBe(1);
        expect(emfPayload[MetricName.CDK_SYNTHESIS_FAILURE]).toBeUndefined();
      });

      it('should record duration and failure metric on error', async () => {
        vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));
        const collector = new MetricsCollector(mockLogger, 'prod');

        const fn = vi.fn().mockImplementation(async () => {
          vi.setSystemTime(new Date('2024-01-15T12:00:00.200Z'));
          throw new Error('Synthesis failed');
        });

        await expect(
          collector.withTiming(
            MetricName.CDK_SYNTHESIS_DURATION,
            fn,
            MetricName.CDK_SYNTHESIS_SUCCESS,
            MetricName.CDK_SYNTHESIS_FAILURE
          )
        ).rejects.toThrow('Synthesis failed');

        collector.flush();
        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

        expect(emfPayload[MetricName.CDK_SYNTHESIS_DURATION]).toBe(200);
        expect(emfPayload[MetricName.CDK_SYNTHESIS_SUCCESS]).toBeUndefined();
      });

      it('should handle non-Error thrown values', async () => {
        const collector = new MetricsCollector(mockLogger, 'prod');

        const fn = vi.fn().mockRejectedValue('string error');

        await expect(
          collector.withTiming(
            MetricName.DEPLOYMENT_DURATION,
            fn,
            MetricName.DEPLOYMENT_SUCCESS,
            MetricName.DEPLOYMENT_FAILURE
          )
        ).rejects.toBe('string error');

        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Metric recorded',
          expect.objectContaining({
            metric: MetricName.DEPLOYMENT_FAILURE,
            errorType: 'UnknownError',
          })
        );
      });

      it('should work without success/failure metrics', async () => {
        const collector = new MetricsCollector(mockLogger, 'prod');

        const fn = vi.fn().mockResolvedValue('result');
        const result = await collector.withTiming(MetricName.GIT_CLONE_DURATION, fn);

        expect(result).toBe('result');

        collector.flush();
        const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
        expect(emfPayload._aws.CloudWatchMetrics[0].Metrics).toHaveLength(1);
      });
    });
  });

  describe('recordInvocationStart', () => {
    it('should record cold start on first invocation and warm start on subsequent', async () => {
      // Reset module to get fresh cold start state
      vi.resetModules();
      const {
        recordInvocationStart: freshRecordInvocation,
        MetricsCollector: FreshCollector,
        MetricName: FreshMetricName,
      } = await import('./metrics.js');

      // Create fresh mock logger for this test
      const freshMockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        setContext: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as unknown as Logger;

      // First invocation - should be cold start
      const collector1 = new FreshCollector(freshMockLogger, 'prod');
      freshRecordInvocation(collector1);

      expect(freshMockLogger.debug).toHaveBeenCalledWith(
        'Metric recorded',
        expect.objectContaining({
          metric: FreshMetricName.COLD_START,
        })
      );

      // Clear mock calls
      vi.mocked(freshMockLogger.debug).mockClear();

      // Second invocation - should be warm start
      const collector2 = new FreshCollector(freshMockLogger, 'prod');
      freshRecordInvocation(collector2);

      expect(freshMockLogger.debug).toHaveBeenCalledWith(
        'Metric recorded',
        expect.objectContaining({
          metric: FreshMetricName.WARM_START,
        })
      );
    });
  });

  describe('createMetricsCollector', () => {
    it('should create MetricsCollector instance', () => {
      const collector = createMetricsCollector(mockLogger, 'test');
      expect(collector).toBeInstanceOf(MetricsCollector);
    });

    it('should pass environment to collector', () => {
      const collector = createMetricsCollector(mockLogger, 'production');
      collector.recordCount(MetricName.COLD_START);
      collector.flush();

      const emfPayload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(emfPayload.environment).toBe('production');
    });
  });

  describe('MetricName enum', () => {
    it('should have all expected metric names', () => {
      expect(MetricName.TEMPLATE_RESOLUTION_DURATION).toBe('TemplateResolutionDuration');
      expect(MetricName.TEMPLATE_RESOLUTION_SUCCESS).toBe('TemplateResolutionSuccess');
      expect(MetricName.TEMPLATE_RESOLUTION_FAILURE).toBe('TemplateResolutionFailure');
      expect(MetricName.TEMPLATE_NOT_FOUND).toBe('TemplateNotFound');
      expect(MetricName.CDK_SYNTHESIS_DURATION).toBe('CdkSynthesisDuration');
      expect(MetricName.CDK_SYNTHESIS_SUCCESS).toBe('CdkSynthesisSuccess');
      expect(MetricName.CDK_SYNTHESIS_FAILURE).toBe('CdkSynthesisFailure');
      expect(MetricName.CDK_DEPENDENCIES_INSTALL_DURATION).toBe('CdkDependenciesInstallDuration');
      expect(MetricName.CDK_BOOTSTRAP_DURATION).toBe('CdkBootstrapDuration');
      expect(MetricName.GIT_CLONE_DURATION).toBe('GitCloneDuration');
      expect(MetricName.GITHUB_API_DURATION).toBe('GitHubApiDuration');
      expect(MetricName.GITHUB_RATE_LIMITED).toBe('GitHubRateLimited');
      expect(MetricName.DEPLOYMENT_DURATION).toBe('DeploymentDuration');
      expect(MetricName.DEPLOYMENT_SUCCESS).toBe('DeploymentSuccess');
      expect(MetricName.DEPLOYMENT_FAILURE).toBe('DeploymentFailure');
      expect(MetricName.STACK_CREATE).toBe('StackCreate');
      expect(MetricName.STACK_UPDATE).toBe('StackUpdate');
      expect(MetricName.STACK_EXISTS).toBe('StackExists');
      expect(MetricName.COLD_START).toBe('ColdStart');
      expect(MetricName.WARM_START).toBe('WarmStart');
      expect(MetricName.INVOCATION_DURATION).toBe('InvocationDuration');
    });
  });
});
