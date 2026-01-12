import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { handleTemplate } from './template-handler.js';
import { Logger } from './logger.js';
import * as templateResolver from './template-resolver.js';
import * as configModule from './config.js';

// Mock the modules
vi.mock('./template-resolver.js', () => ({
  resolveTemplate: vi.fn(),
  TemplateResolutionError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TemplateResolutionError';
    }
  },
  GitHubApiError: class extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.name = 'GitHubApiError';
      this.statusCode = statusCode;
    }
  },
  CdkSynthesisError: class extends Error {
    stderr?: string;
    constructor(message: string, cause?: Error, stderr?: string) {
      super(message);
      this.name = 'CdkSynthesisError';
      this.stderr = stderr;
    }
  },
}));

vi.mock('./config.js', () => ({
  getConfigAsync: vi.fn(),
  getConfig: vi.fn(),
  resetConfig: vi.fn(),
}));

describe('template-handler module', () => {
  let logger: Logger;
  let loggerInfoSpy: ReturnType<typeof vi.spyOn>;
  let loggerDebugSpy: ReturnType<typeof vi.spyOn>;
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>;
  let loggerSetContextSpy: ReturnType<typeof vi.spyOn>;

  const mockConfig = {
    githubRepo: 'test/repo',
    githubBranch: 'main',
    githubPath: 'scenarios',
    leaseTableName: 'test-table',
    targetRoleName: 'TestRole',
    awsRegion: 'us-east-1',
    eventSource: 'test-source',
    logLevel: 'DEBUG' as const,
    githubToken: 'test-token',
  };

  beforeEach(() => {
    logger = new Logger('DEBUG');
    loggerInfoSpy = vi.spyOn(logger, 'info');
    loggerDebugSpy = vi.spyOn(logger, 'debug');
    loggerErrorSpy = vi.spyOn(logger, 'error');
    loggerSetContextSpy = vi.spyOn(logger, 'setContext');

    // Setup default mock
    vi.mocked(configModule.getConfigAsync).mockResolvedValue(mockConfig);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('handleTemplate', () => {
    describe('when templateName is undefined', () => {
      it('should skip deployment and log appropriately', async () => {
        const result = await handleTemplate(undefined, 'lease-123', logger);

        expect(result.skip).toBe(true);
        expect(result.template).toBeUndefined();
        expect(result.reason).toBe('No template configured');

        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-123' });
        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'No template configured for lease, skipping deployment',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-123',
            templateName: 'undefined',
          })
        );
      });
    });

    describe('when templateName is empty string', () => {
      it('should skip deployment and log appropriately', async () => {
        const result = await handleTemplate('', 'lease-456', logger);

        expect(result.skip).toBe(true);
        expect(result.template).toBeUndefined();
        expect(result.reason).toBe('No template configured');

        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'No template configured for lease, skipping deployment',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-456',
            templateName: '',
          })
        );
      });
    });

    describe('when templateName is whitespace only', () => {
      it('should skip deployment and log appropriately', async () => {
        const result = await handleTemplate('   ', 'lease-789', logger);

        expect(result.skip).toBe(true);
        expect(result.template).toBeUndefined();
        expect(result.reason).toBe('No template configured');

        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'No template configured for lease, skipping deployment',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-789',
          })
        );
      });
    });

    describe('when CloudFormation template exists and is fetched successfully', () => {
      it('should return template content and not skip deployment', async () => {
        const mockTemplate = `AWSTemplateFormatVersion: '2010-09-09'
Description: Test template
Resources:
  MyBucket:
    Type: AWS::S3::Bucket`;

        vi.mocked(templateResolver.resolveTemplate).mockResolvedValue({
          templateBody: mockTemplate,
          source: 'cloudformation',
          synthesized: false,
        });

        const result = await handleTemplate('test-template', 'lease-abc', logger);

        expect(result.skip).toBe(false);
        expect(result.template).toBe(mockTemplate);
        expect(result.source).toBe('cloudformation');
        expect(result.synthesized).toBe(false);
        expect(result.reason).toBeUndefined();

        expect(loggerDebugSpy).toHaveBeenCalledWith(
          'Resolving template',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-abc',
            templateName: 'test-template',
          })
        );

        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'Template resolved successfully',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-abc',
            templateName: 'test-template',
            templateSize: mockTemplate.length,
            source: 'cloudformation',
            synthesized: false,
          })
        );
      });
    });

    describe('when CDK template is synthesized successfully', () => {
      it('should return synthesized template and indicate CDK source', async () => {
        const mockTemplate = '{"AWSTemplateFormatVersion":"2010-09-09","Resources":{}}';

        vi.mocked(templateResolver.resolveTemplate).mockResolvedValue({
          templateBody: mockTemplate,
          source: 'cdk',
          synthesized: true,
        });

        const result = await handleTemplate(
          'cdk-scenario',
          'lease-cdk',
          logger,
          '123456789012',
          'us-east-1'
        );

        expect(result.skip).toBe(false);
        expect(result.template).toBe(mockTemplate);
        expect(result.source).toBe('cdk');
        expect(result.synthesized).toBe(true);

        // Verify resolveTemplate was called with correct params
        expect(templateResolver.resolveTemplate).toHaveBeenCalledWith(
          'cdk-scenario',
          logger,
          '123456789012',
          'us-east-1',
          mockConfig
        );
      });
    });

    describe('when template is not found (returns null)', () => {
      it('should skip deployment gracefully and log as info', async () => {
        vi.mocked(templateResolver.resolveTemplate).mockResolvedValue(null);

        const result = await handleTemplate('missing-template', 'lease-def', logger);

        expect(result.skip).toBe(true);
        expect(result.template).toBeUndefined();
        expect(result.reason).toBe('Template not found (404)');

        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'Template not found in repository, skipping deployment',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-def',
            templateName: 'missing-template',
            reason: 'Template does not exist',
          })
        );

        // Should NOT log an error for not found
        expect(loggerErrorSpy).not.toHaveBeenCalled();
      });
    });

    describe('when GitHub rate limit is exceeded', () => {
      it('should throw error and log appropriately', async () => {
        const rateLimitError = new templateResolver.GitHubApiError(
          'GitHub API rate limit exceeded',
          403
        );

        vi.mocked(templateResolver.resolveTemplate).mockRejectedValue(rateLimitError);

        await expect(handleTemplate('rate-limited', 'lease-rate', logger)).rejects.toThrow(
          templateResolver.GitHubApiError
        );

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'GitHub rate limit exceeded',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-rate',
            templateName: 'rate-limited',
          })
        );
      });
    });

    describe('when CDK synthesis fails', () => {
      it('should throw error and log with stderr', async () => {
        const synthesisError = new templateResolver.CdkSynthesisError(
          'CDK synthesis failed',
          undefined,
          'npm ERR! missing dependencies'
        );

        vi.mocked(templateResolver.resolveTemplate).mockRejectedValue(synthesisError);

        await expect(handleTemplate('cdk-error', 'lease-synth', logger)).rejects.toThrow(
          templateResolver.CdkSynthesisError
        );

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'CDK synthesis failed',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-synth',
            templateName: 'cdk-error',
            stderr: 'npm ERR! missing dependencies',
          })
        );
      });
    });

    describe('when template resolution fails with generic error', () => {
      it('should throw and log as resolution error', async () => {
        const resolutionError = new templateResolver.TemplateResolutionError(
          'Failed to resolve template'
        );

        vi.mocked(templateResolver.resolveTemplate).mockRejectedValue(resolutionError);

        await expect(handleTemplate('error-template', 'lease-res', logger)).rejects.toThrow(
          templateResolver.TemplateResolutionError
        );

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Template resolution failed',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-res',
            templateName: 'error-template',
          })
        );
      });
    });

    describe('when unexpected error occurs', () => {
      it('should log and rethrow', async () => {
        const unexpectedError = new Error('Something unexpected');

        vi.mocked(templateResolver.resolveTemplate).mockRejectedValue(unexpectedError);

        await expect(handleTemplate('unexpected', 'lease-unexpected', logger)).rejects.toThrow(
          'Something unexpected'
        );

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Unexpected error resolving template',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-unexpected',
            templateName: 'unexpected',
            error: 'Something unexpected',
            errorType: 'Error',
          })
        );
      });
    });

    describe('logger context', () => {
      it('should set correlation ID context for all scenarios', async () => {
        await handleTemplate(undefined, 'lease-context-1', logger);
        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-context-1' });

        loggerSetContextSpy.mockClear();

        vi.mocked(templateResolver.resolveTemplate).mockResolvedValue({
          templateBody: 'template',
          source: 'cloudformation',
          synthesized: false,
        });

        await handleTemplate('valid-template', 'lease-context-2', logger);
        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-context-2' });
      });
    });

    describe('edge cases', () => {
      it('should handle empty template content', async () => {
        vi.mocked(templateResolver.resolveTemplate).mockResolvedValue({
          templateBody: '',
          source: 'cloudformation',
          synthesized: false,
        });

        const result = await handleTemplate('empty-template', 'lease-empty', logger);

        expect(result.skip).toBe(false);
        expect(result.template).toBe('');
        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'Template resolved successfully',
          expect.objectContaining({
            templateSize: 0,
          })
        );
      });

      it('should handle very large templates', async () => {
        const largeTemplate = 'x'.repeat(100000);

        vi.mocked(templateResolver.resolveTemplate).mockResolvedValue({
          templateBody: largeTemplate,
          source: 'cloudformation',
          synthesized: false,
        });

        const result = await handleTemplate('large-template', 'lease-large', logger);

        expect(result.skip).toBe(false);
        expect(result.template).toBe(largeTemplate);
        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'Template resolved successfully',
          expect.objectContaining({
            templateSize: 100000,
          })
        );
      });
    });

    describe('integration scenarios', () => {
      it('should handle complete CloudFormation success workflow', async () => {
        const mockTemplate = 'AWSTemplateFormatVersion: "2010-09-09"\nResources: {}';

        vi.mocked(templateResolver.resolveTemplate).mockResolvedValue({
          templateBody: mockTemplate,
          source: 'cloudformation',
          synthesized: false,
        });

        const result = await handleTemplate('scenario', 'lease-workflow', logger);

        expect(result).toEqual({
          skip: false,
          template: mockTemplate,
          source: 'cloudformation',
          synthesized: false,
        });

        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-workflow' });
        expect(loggerDebugSpy).toHaveBeenCalledTimes(1);
        expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
        expect(loggerErrorSpy).not.toHaveBeenCalled();
      });

      it('should handle complete CDK success workflow', async () => {
        const mockTemplate = '{"Resources":{}}';

        vi.mocked(templateResolver.resolveTemplate).mockResolvedValue({
          templateBody: mockTemplate,
          source: 'cdk',
          synthesized: true,
        });

        const result = await handleTemplate(
          'cdk-scenario',
          'lease-cdk-workflow',
          logger,
          '123456789012'
        );

        expect(result).toEqual({
          skip: false,
          template: mockTemplate,
          source: 'cdk',
          synthesized: true,
        });

        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-cdk-workflow' });
        expect(loggerErrorSpy).not.toHaveBeenCalled();
      });

      it('should handle complete no-op workflow for undefined template', async () => {
        const result = await handleTemplate(undefined, 'lease-no-op', logger);

        expect(result).toEqual({
          skip: true,
          reason: 'No template configured',
        });

        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-no-op' });
        expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
        expect(loggerDebugSpy).not.toHaveBeenCalled();
        expect(loggerErrorSpy).not.toHaveBeenCalled();
      });

      it('should handle complete no-op workflow for missing template', async () => {
        vi.mocked(templateResolver.resolveTemplate).mockResolvedValue(null);

        const result = await handleTemplate('missing', 'lease-404-workflow', logger);

        expect(result).toEqual({
          skip: true,
          reason: 'Template not found (404)',
        });

        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-404-workflow' });
        expect(loggerDebugSpy).toHaveBeenCalledTimes(1);
        expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
        expect(loggerErrorSpy).not.toHaveBeenCalled();
      });
    });
  });
});
