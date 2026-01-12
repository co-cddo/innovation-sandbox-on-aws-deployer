/**
 * Metrics Module
 *
 * Provides CloudWatch metrics for observability of the ISB Deployer.
 * Uses EMF (Embedded Metric Format) for structured metrics that work
 * seamlessly with Lambda and CloudWatch Logs.
 */

import type { Logger } from './logger.js';

/**
 * Metric names used by the ISB Deployer
 */
export enum MetricName {
  // Template resolution metrics
  TEMPLATE_RESOLUTION_DURATION = 'TemplateResolutionDuration',
  TEMPLATE_RESOLUTION_SUCCESS = 'TemplateResolutionSuccess',
  TEMPLATE_RESOLUTION_FAILURE = 'TemplateResolutionFailure',
  TEMPLATE_NOT_FOUND = 'TemplateNotFound',

  // CDK metrics
  CDK_SYNTHESIS_DURATION = 'CdkSynthesisDuration',
  CDK_SYNTHESIS_SUCCESS = 'CdkSynthesisSuccess',
  CDK_SYNTHESIS_FAILURE = 'CdkSynthesisFailure',
  CDK_DEPENDENCIES_INSTALL_DURATION = 'CdkDependenciesInstallDuration',
  CDK_BOOTSTRAP_DURATION = 'CdkBootstrapDuration',

  // Git/GitHub metrics
  GIT_CLONE_DURATION = 'GitCloneDuration',
  GITHUB_API_DURATION = 'GitHubApiDuration',
  GITHUB_RATE_LIMITED = 'GitHubRateLimited',

  // Deployment metrics
  DEPLOYMENT_DURATION = 'DeploymentDuration',
  DEPLOYMENT_SUCCESS = 'DeploymentSuccess',
  DEPLOYMENT_FAILURE = 'DeploymentFailure',
  STACK_CREATE = 'StackCreate',
  STACK_UPDATE = 'StackUpdate',
  STACK_EXISTS = 'StackExists',

  // Lambda metrics
  COLD_START = 'ColdStart',
  WARM_START = 'WarmStart',
  INVOCATION_DURATION = 'InvocationDuration',
}

/**
 * Metric dimensions for categorizing metrics
 */
export interface MetricDimensions {
  /** Environment (dev, staging, prod) */
  environment?: string;
  /** Template source (cdk, cloudformation) */
  templateSource?: 'cdk' | 'cloudformation';
  /** Scenario/template name */
  templateName?: string;
  /** Error type if applicable */
  errorType?: string;
  /** AWS region */
  region?: string;
}

/**
 * EMF metric entry for CloudWatch embedded metric format
 */
interface EMFMetric {
  Name: string;
  Unit: 'Milliseconds' | 'Count' | 'None';
}

/**
 * Metrics collector for the ISB Deployer
 *
 * Uses CloudWatch Embedded Metric Format (EMF) to emit structured metrics
 * that are automatically extracted by CloudWatch Logs Insights.
 *
 * @example
 * ```typescript
 * const metrics = new MetricsCollector(logger, 'prod');
 *
 * // Record a duration metric
 * const timer = metrics.startTimer();
 * await someOperation();
 * metrics.recordDuration(MetricName.CDK_SYNTHESIS_DURATION, timer);
 *
 * // Record a count metric
 * metrics.recordCount(MetricName.DEPLOYMENT_SUCCESS, 1);
 *
 * // Emit all collected metrics
 * metrics.flush();
 * ```
 */
export class MetricsCollector {
  private readonly namespace = 'ISBDeployer';
  private readonly metrics: Map<string, { value: number; unit: EMFMetric['Unit'] }> = new Map();
  private readonly dimensions: MetricDimensions;

  constructor(
    private readonly logger: Logger,
    environment?: string
  ) {
    this.dimensions = { environment: environment ?? 'unknown' };
  }

  /**
   * Sets dimensions for all subsequent metrics
   */
  setDimensions(dimensions: Partial<MetricDimensions>): void {
    Object.assign(this.dimensions, dimensions);
  }

  /**
   * Starts a timer for duration measurements
   * @returns Start time in milliseconds
   */
  startTimer(): number {
    return Date.now();
  }

  /**
   * Records a duration metric
   *
   * @param name - Metric name
   * @param startTime - Start time from startTimer()
   * @param dimensions - Optional additional dimensions
   */
  recordDuration(name: MetricName, startTime: number, dimensions?: Partial<MetricDimensions>): void {
    const duration = Date.now() - startTime;
    this.record(name, duration, 'Milliseconds', dimensions);
  }

  /**
   * Records a count metric
   *
   * @param name - Metric name
   * @param count - Count value (default: 1)
   * @param dimensions - Optional additional dimensions
   */
  recordCount(name: MetricName, count: number = 1, dimensions?: Partial<MetricDimensions>): void {
    this.record(name, count, 'Count', dimensions);
  }

  /**
   * Records a generic metric value
   */
  private record(
    name: MetricName,
    value: number,
    unit: EMFMetric['Unit'],
    dimensions?: Partial<MetricDimensions>
  ): void {
    // Create a unique key including dimensions
    const dimKey = dimensions ? JSON.stringify(dimensions) : '';
    const key = `${name}:${dimKey}`;

    this.metrics.set(key, { value, unit });

    // Also log the metric for immediate visibility
    this.logger.debug('Metric recorded', {
      metric: name,
      value,
      unit,
      ...this.dimensions,
      ...dimensions,
    });
  }

  /**
   * Flushes all collected metrics using EMF format
   *
   * This outputs metrics in CloudWatch Embedded Metric Format,
   * which is automatically parsed by CloudWatch Logs.
   */
  flush(): void {
    if (this.metrics.size === 0) {
      return;
    }

    // Build EMF payload
    const dimensionKeys = Object.keys(this.dimensions).filter(
      (k) => this.dimensions[k as keyof MetricDimensions] !== undefined
    );

    const emfPayload: Record<string, unknown> = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: this.namespace,
            Dimensions: [dimensionKeys],
            Metrics: [] as EMFMetric[],
          },
        ],
      },
    };

    // Add dimensions to payload
    for (const key of dimensionKeys) {
      const value = this.dimensions[key as keyof MetricDimensions];
      if (value !== undefined) {
        emfPayload[key] = value;
      }
    }

    // Add each metric
    for (const [key, { value, unit }] of this.metrics) {
      const parts = key.split(':');
      const name = parts[0] ?? key;
      emfPayload[name] = value;
      (emfPayload._aws as { CloudWatchMetrics: [{ Metrics: EMFMetric[] }] }).CloudWatchMetrics[0].Metrics.push({
        Name: name,
        Unit: unit,
      });
    }

    // Output EMF to stdout (CloudWatch Logs will parse it)
    console.log(JSON.stringify(emfPayload));

    // Clear metrics after flush
    this.metrics.clear();
  }

  /**
   * Wraps an async function with timing metrics
   *
   * @param name - Metric name for duration
   * @param fn - Async function to wrap
   * @param successMetric - Optional metric to record on success
   * @param failureMetric - Optional metric to record on failure
   * @returns Result of the function
   */
  async withTiming<T>(
    name: MetricName,
    fn: () => Promise<T>,
    successMetric?: MetricName,
    failureMetric?: MetricName
  ): Promise<T> {
    const startTime = this.startTimer();
    try {
      const result = await fn();
      this.recordDuration(name, startTime);
      if (successMetric) {
        this.recordCount(successMetric);
      }
      return result;
    } catch (error) {
      this.recordDuration(name, startTime);
      if (failureMetric) {
        this.recordCount(failureMetric, 1, {
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
      }
      throw error;
    }
  }
}

/**
 * Global cold start tracking
 */
let isFirstInvocation = true;

/**
 * Records Lambda invocation metrics (cold/warm start)
 */
export function recordInvocationStart(metrics: MetricsCollector): void {
  if (isFirstInvocation) {
    metrics.recordCount(MetricName.COLD_START);
    isFirstInvocation = false;
  } else {
    metrics.recordCount(MetricName.WARM_START);
  }
}

/**
 * Creates a metrics collector for the current invocation
 */
export function createMetricsCollector(logger: Logger, environment?: string): MetricsCollector {
  return new MetricsCollector(logger, environment);
}
