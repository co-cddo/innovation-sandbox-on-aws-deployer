import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleTemplate } from './template-handler.js';
import { Logger } from './logger.js';
import { TemplateFetchError } from './template-fetcher.js';
import * as templateFetcher from './template-fetcher.js';
import * as githubUrl from './github-url.js';

describe('template-handler module', () => {
  let logger: Logger;
  let loggerInfoSpy: ReturnType<typeof vi.spyOn>;
  let loggerDebugSpy: ReturnType<typeof vi.spyOn>;
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>;
  let loggerSetContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new Logger('DEBUG');
    loggerInfoSpy = vi.spyOn(logger, 'info');
    loggerDebugSpy = vi.spyOn(logger, 'debug');
    loggerErrorSpy = vi.spyOn(logger, 'error');
    loggerSetContextSpy = vi.spyOn(logger, 'setContext');
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

    describe('when template exists and is fetched successfully', () => {
      it('should return template content and not skip deployment', async () => {
        const mockTemplate = `AWSTemplateFormatVersion: '2010-09-09'
Description: Test template
Resources:
  MyBucket:
    Type: AWS::S3::Bucket`;

        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockResolvedValue(mockTemplate);

        const result = await handleTemplate('test-template', 'lease-abc', logger);

        expect(result.skip).toBe(false);
        expect(result.template).toBe(mockTemplate);
        expect(result.reason).toBeUndefined();

        expect(loggerDebugSpy).toHaveBeenCalledWith(
          'Fetching template from GitHub',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-abc',
            templateName: 'test-template',
            url: mockUrl,
          })
        );

        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'Template fetched successfully',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-abc',
            templateName: 'test-template',
            templateSize: mockTemplate.length,
          })
        );
      });
    });

    describe('when template fetch returns 404', () => {
      it('should skip deployment gracefully and log as info (not error)', async () => {
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/missing.yaml';
        const notFoundError = new TemplateFetchError('HTTP 404: Not Found', 404, mockUrl);

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockRejectedValue(notFoundError);

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

        // Should NOT log an error for 404
        expect(loggerErrorSpy).not.toHaveBeenCalled();
      });
    });

    describe('when template fetch fails with 500 error', () => {
      it('should throw error and log as error', async () => {
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';
        const serverError = new TemplateFetchError('HTTP 500: Internal Server Error', 500, mockUrl);

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockRejectedValue(serverError);

        await expect(handleTemplate('error-template', 'lease-ghi', logger)).rejects.toThrow(
          TemplateFetchError
        );

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Error fetching template',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-ghi',
            templateName: 'error-template',
            error: 'HTTP 500: Internal Server Error',
            errorType: 'TemplateFetchError',
            statusCode: 500,
          })
        );
      });
    });

    describe('when template fetch fails with 403 error', () => {
      it('should throw error and log as error', async () => {
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';
        const forbiddenError = new TemplateFetchError('HTTP 403: Forbidden', 403, mockUrl);

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockRejectedValue(forbiddenError);

        await expect(handleTemplate('forbidden-template', 'lease-jkl', logger)).rejects.toThrow(
          TemplateFetchError
        );

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Error fetching template',
          expect.objectContaining({
            event: 'FETCH',
            errorType: 'TemplateFetchError',
            statusCode: 403,
          })
        );
      });
    });

    describe('when template fetch times out', () => {
      it('should throw error and log as error', async () => {
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';
        const timeoutError = new TemplateFetchError(
          'Request timed out after 5000ms',
          undefined,
          mockUrl
        );

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockRejectedValue(timeoutError);

        await expect(handleTemplate('timeout-template', 'lease-mno', logger)).rejects.toThrow(
          TemplateFetchError
        );

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Error fetching template',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-mno',
            templateName: 'timeout-template',
            error: 'Request timed out after 5000ms',
            errorType: 'TemplateFetchError',
            statusCode: undefined,
          })
        );
      });
    });

    describe('when template fetch fails with network error', () => {
      it('should throw error and log as error', async () => {
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';
        const networkError = new TemplateFetchError(
          'Network error: Connection refused',
          undefined,
          mockUrl
        );

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockRejectedValue(networkError);

        await expect(handleTemplate('network-error-template', 'lease-pqr', logger)).rejects.toThrow(
          TemplateFetchError
        );

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Error fetching template',
          expect.objectContaining({
            event: 'FETCH',
            error: 'Network error: Connection refused',
            errorType: 'TemplateFetchError',
          })
        );
      });
    });

    describe('when template fetch fails with unknown error', () => {
      it('should throw error and log as error with UnknownError type', async () => {
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';
        const unknownError = new Error('Something unexpected happened');

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockRejectedValue(unknownError);

        await expect(handleTemplate('unknown-error-template', 'lease-stu', logger)).rejects.toThrow(
          Error
        );

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Error fetching template',
          expect.objectContaining({
            event: 'FETCH',
            leaseId: 'lease-stu',
            templateName: 'unknown-error-template',
            error: 'Something unexpected happened',
            errorType: 'UnknownError',
            statusCode: undefined,
          })
        );
      });
    });

    describe('when template fetch fails with non-Error object', () => {
      it('should handle string errors gracefully', async () => {
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockRejectedValue('string error');

        await expect(handleTemplate('string-error-template', 'lease-vwx', logger)).rejects.toBe(
          'string error'
        );

        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Error fetching template',
          expect.objectContaining({
            event: 'FETCH',
            error: 'string error',
            errorType: 'UnknownError',
          })
        );
      });
    });

    describe('when template name has special characters', () => {
      it('should handle template names with hyphens and underscores', async () => {
        const mockTemplate = 'AWSTemplateFormatVersion: "2010-09-09"';
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/my-special_template.yaml';

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockResolvedValue(mockTemplate);

        const result = await handleTemplate('my-special_template', 'lease-yz1', logger);

        expect(result.skip).toBe(false);
        expect(result.template).toBe(mockTemplate);
      });
    });

    describe('logger context', () => {
      it('should set correlation ID context for all scenarios', async () => {
        await handleTemplate(undefined, 'lease-context-1', logger);
        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-context-1' });

        loggerSetContextSpy.mockClear();

        const mockTemplate = 'template content';
        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue('http://example.com');
        vi.spyOn(templateFetcher, 'fetchTemplate').mockResolvedValue(mockTemplate);

        await handleTemplate('valid-template', 'lease-context-2', logger);
        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-context-2' });
      });
    });

    describe('edge cases', () => {
      it('should handle empty template content', async () => {
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/empty.yaml';

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockResolvedValue('');

        const result = await handleTemplate('empty-template', 'lease-empty', logger);

        expect(result.skip).toBe(false);
        expect(result.template).toBe('');
        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'Template fetched successfully',
          expect.objectContaining({
            templateSize: 0,
          })
        );
      });

      it('should handle very large templates', async () => {
        const largeTemplate = 'x'.repeat(100000);
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/large.yaml';

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockResolvedValue(largeTemplate);

        const result = await handleTemplate('large-template', 'lease-large', logger);

        expect(result.skip).toBe(false);
        expect(result.template).toBe(largeTemplate);
        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'Template fetched successfully',
          expect.objectContaining({
            templateSize: 100000,
          })
        );
      });
    });

    describe('integration scenarios', () => {
      it('should handle complete success workflow', async () => {
        const mockTemplate = 'AWSTemplateFormatVersion: "2010-09-09"\nResources: {}';
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/scenario.yaml';

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockResolvedValue(mockTemplate);

        const result = await handleTemplate('scenario', 'lease-workflow', logger);

        expect(result).toEqual({
          skip: false,
          template: mockTemplate,
        });

        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-workflow' });
        expect(loggerDebugSpy).toHaveBeenCalledTimes(1);
        expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
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

      it('should handle complete no-op workflow for 404 template', async () => {
        const mockUrl = 'https://raw.githubusercontent.com/test/repo/main/missing.yaml';
        const notFoundError = new TemplateFetchError('HTTP 404: Not Found', 404, mockUrl);

        vi.spyOn(githubUrl, 'buildTemplateUrl').mockReturnValue(mockUrl);
        vi.spyOn(templateFetcher, 'fetchTemplate').mockRejectedValue(notFoundError);

        const result = await handleTemplate('missing', 'lease-404-workflow', logger);

        expect(result).toEqual({
          skip: true,
          reason: 'Template not found (404)',
        });

        expect(loggerSetContextSpy).toHaveBeenCalledWith({ correlationId: 'lease-404-workflow' });
        expect(loggerDebugSpy).toHaveBeenCalledTimes(1);
        expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
        expect(loggerErrorSpy).not.toHaveBeenCalled(); // Critical: 404 is NOT an error
      });
    });
  });
});
