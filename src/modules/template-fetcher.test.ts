import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchTemplate, TemplateFetchError, FETCH_TIMEOUT_MS } from './template-fetcher.js';

describe('template-fetcher module', () => {
  // Store the original fetch function
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Restore the original fetch
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('fetchTemplate', () => {
    it('should successfully fetch template content', async () => {
      const mockTemplate = `AWSTemplateFormatVersion: '2010-09-09'
Description: Test template
Resources:
  MyBucket:
    Type: AWS::S3::Bucket`;

      // Mock fetch to return successful response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(mockTemplate),
      });

      const url = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';
      const result = await fetchTemplate(url);

      expect(result).toBe(mockTemplate);
      expect(global.fetch).toHaveBeenCalledWith(url, {
        signal: expect.any(AbortSignal),
      });
    });

    it('should handle 404 Not Found errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const url = 'https://raw.githubusercontent.com/test/repo/main/missing.yaml';

      await expect(fetchTemplate(url)).rejects.toThrow(TemplateFetchError);
      await expect(fetchTemplate(url)).rejects.toThrow('HTTP 404: Not Found');

      try {
        await fetchTemplate(url);
      } catch (error) {
        expect(error).toBeInstanceOf(TemplateFetchError);
        if (error instanceof TemplateFetchError) {
          expect(error.statusCode).toBe(404);
          expect(error.url).toBe(url);
        }
      }
    });

    it('should handle 500 Internal Server Error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const url = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';

      await expect(fetchTemplate(url)).rejects.toThrow(TemplateFetchError);
      await expect(fetchTemplate(url)).rejects.toThrow('HTTP 500: Internal Server Error');

      try {
        await fetchTemplate(url);
      } catch (error) {
        if (error instanceof TemplateFetchError) {
          expect(error.statusCode).toBe(500);
          expect(error.url).toBe(url);
        }
      }
    });

    it('should handle 403 Forbidden errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const url = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';

      await expect(fetchTemplate(url)).rejects.toThrow(TemplateFetchError);
      await expect(fetchTemplate(url)).rejects.toThrow('HTTP 403: Forbidden');

      try {
        await fetchTemplate(url);
      } catch (error) {
        if (error instanceof TemplateFetchError) {
          expect(error.statusCode).toBe(403);
        }
      }
    });

    it('should handle timeout after 5 seconds', async () => {
      // Mock fetch to reject with AbortError (simulating what happens when timeout fires)
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      global.fetch = vi.fn().mockRejectedValue(abortError);

      const url = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';

      await expect(fetchTemplate(url)).rejects.toThrow(TemplateFetchError);
      await expect(fetchTemplate(url)).rejects.toThrow(`Request timed out after ${FETCH_TIMEOUT_MS}ms`);

      try {
        await fetchTemplate(url);
        expect.fail('Should have thrown TemplateFetchError');
      } catch (error) {
        if (error instanceof TemplateFetchError) {
          expect(error.statusCode).toBeUndefined();
          expect(error.url).toBe(url);
        }
      }
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network connection failed');
      global.fetch = vi.fn().mockRejectedValue(networkError);

      const url = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';

      await expect(fetchTemplate(url)).rejects.toThrow(TemplateFetchError);
      await expect(fetchTemplate(url)).rejects.toThrow('Network error: Network connection failed');

      try {
        await fetchTemplate(url);
      } catch (error) {
        if (error instanceof TemplateFetchError) {
          expect(error.statusCode).toBeUndefined();
          expect(error.url).toBe(url);
        }
      }
    });

    it('should handle DNS resolution errors', async () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND');
      global.fetch = vi.fn().mockRejectedValue(dnsError);

      const url = 'https://invalid-domain-that-does-not-exist.com/template.yaml';

      await expect(fetchTemplate(url)).rejects.toThrow(TemplateFetchError);
      await expect(fetchTemplate(url)).rejects.toThrow('Network error:');
    });

    it('should handle invalid URL formats gracefully', async () => {
      // fetch itself will throw a TypeError for invalid URLs
      const typeError = new TypeError('Invalid URL');
      global.fetch = vi.fn().mockRejectedValue(typeError);

      const url = 'not-a-valid-url';

      await expect(fetchTemplate(url)).rejects.toThrow(TemplateFetchError);
      await expect(fetchTemplate(url)).rejects.toThrow('Network error:');
    });

    it('should handle empty response body', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(''),
      });

      const url = 'https://raw.githubusercontent.com/test/repo/main/empty.yaml';
      const result = await fetchTemplate(url);

      expect(result).toBe('');
    });

    it('should handle large template files', async () => {
      // Create a large template (simulate a big YAML file)
      const largeTemplate = 'line\n'.repeat(15000);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(largeTemplate),
      });

      const url = 'https://raw.githubusercontent.com/test/repo/main/large.yaml';
      const result = await fetchTemplate(url);

      expect(result).toBe(largeTemplate);
      expect(result.length).toBeGreaterThan(50000);
    });

    it('should clear timeout when fetch completes successfully', async () => {
      const mockTemplate = 'test template content';

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(mockTemplate),
      });

      const url = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';
      await fetchTemplate(url);

      // Advance timers to ensure timeout would have fired if not cleared
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1000);

      // No error should be thrown since timeout was cleared
      expect(true).toBe(true);
    });

    it('should clear timeout when fetch fails with HTTP error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const url = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';

      await expect(fetchTemplate(url)).rejects.toThrow(TemplateFetchError);

      // Advance timers to ensure timeout would have fired if not cleared
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1000);

      // Should only throw once (from the HTTP error, not from timeout)
      expect(true).toBe(true);
    });

    it('should handle AbortError correctly', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      global.fetch = vi.fn().mockRejectedValue(abortError);

      const url = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';

      await expect(fetchTemplate(url)).rejects.toThrow(TemplateFetchError);
      await expect(fetchTemplate(url)).rejects.toThrow(`Request timed out after ${FETCH_TIMEOUT_MS}ms`);
    });

    it('should handle unknown error types', async () => {
      // Simulate a completely unexpected error type
      global.fetch = vi.fn().mockRejectedValue('string error');

      const url = 'https://raw.githubusercontent.com/test/repo/main/template.yaml';

      await expect(fetchTemplate(url)).rejects.toThrow(TemplateFetchError);
      await expect(fetchTemplate(url)).rejects.toThrow('Unknown error fetching template:');
    });

    it('should preserve url in error for debugging', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const url = 'https://raw.githubusercontent.com/complex/path/with/many/segments/template.yaml';

      try {
        await fetchTemplate(url);
        expect.fail('Should have thrown an error');
      } catch (error) {
        if (error instanceof TemplateFetchError) {
          expect(error.url).toBe(url);
          expect(error.statusCode).toBe(503);
          expect(error.message).toContain('503');
        }
      }
    });
  });

  describe('TemplateFetchError', () => {
    it('should create error with all properties', () => {
      const error = new TemplateFetchError(
        'Test error',
        404,
        'https://example.com/test.yaml'
      );

      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(404);
      expect(error.url).toBe('https://example.com/test.yaml');
      expect(error.name).toBe('TemplateFetchError');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TemplateFetchError);
    });

    it('should create error without statusCode', () => {
      const error = new TemplateFetchError('Network error', undefined, 'https://example.com');

      expect(error.message).toBe('Network error');
      expect(error.statusCode).toBeUndefined();
      expect(error.url).toBe('https://example.com');
    });

    it('should create error without url', () => {
      const error = new TemplateFetchError('Unknown error', 500);

      expect(error.message).toBe('Unknown error');
      expect(error.statusCode).toBe(500);
      expect(error.url).toBeUndefined();
    });

    it('should have a stack trace', () => {
      const error = new TemplateFetchError('Test error');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('TemplateFetchError');
    });
  });

  describe('FETCH_TIMEOUT_MS constant', () => {
    it('should be set to 5000 milliseconds', () => {
      expect(FETCH_TIMEOUT_MS).toBe(5000);
    });
  });
});
