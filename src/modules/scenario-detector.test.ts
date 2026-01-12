import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectScenarioType, GitHubRateLimitError, GitHubApiError } from './scenario-detector.js';
import type { Config } from '../types/index.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('scenario-detector module', () => {
  const mockConfig: Config = {
    githubRepo: 'test-org/test-repo',
    githubBranch: 'main',
    githubPath: 'scenarios',
    leaseTableName: 'test-table',
    targetRoleName: 'TestRole',
    awsRegion: 'us-west-2',
    deployRegion: 'us-east-1',
    eventSource: 'test-source',
    logLevel: 'INFO',
    githubToken: 'test-token',
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('detectScenarioType', () => {
    describe('CDK detection at root', () => {
      it('should detect CDK scenario when cdk.json exists at root', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            { name: 'cdk.json', path: 'scenarios/my-app/cdk.json', type: 'file' },
            { name: 'lib', path: 'scenarios/my-app/lib', type: 'dir' },
            { name: 'bin', path: 'scenarios/my-app/bin', type: 'dir' },
          ],
        });

        const result = await detectScenarioType('my-app', mockConfig);

        expect(result).toEqual({
          type: 'cdk',
          cdkPath: '',
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.github.com/repos/test-org/test-repo/contents/scenarios/my-app?ref=main',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'token test-token',
            }),
          })
        );
      });
    });

    describe('CDK detection in subfolder', () => {
      it('should detect CDK in subfolder when cdk/cdk.json exists', async () => {
        // First call returns directory contents without cdk.json at root
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            { name: 'cdk', path: 'scenarios/my-app/cdk', type: 'dir' },
            { name: 'README.md', path: 'scenarios/my-app/README.md', type: 'file' },
          ],
        });

        // Second call checks cdk subdirectory
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            { name: 'cdk.json', path: 'scenarios/my-app/cdk/cdk.json', type: 'file' },
            { name: 'lib', path: 'scenarios/my-app/cdk/lib', type: 'dir' },
          ],
        });

        const result = await detectScenarioType('my-app', mockConfig);

        expect(result).toEqual({
          type: 'cdk-subfolder',
          cdkPath: 'cdk',
        });
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('should fall back to cloudformation if cdk dir exists but no cdk.json inside', async () => {
        // First call returns directory with cdk folder
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            { name: 'cdk', path: 'scenarios/my-app/cdk', type: 'dir' },
            { name: 'template.yaml', path: 'scenarios/my-app/template.yaml', type: 'file' },
          ],
        });

        // Second call returns cdk dir contents without cdk.json
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            { name: 'some-file.txt', path: 'scenarios/my-app/cdk/some-file.txt', type: 'file' },
          ],
        });

        const result = await detectScenarioType('my-app', mockConfig);

        expect(result).toEqual({
          type: 'cloudformation',
        });
      });
    });

    describe('CloudFormation detection', () => {
      it('should detect CloudFormation when no cdk.json exists', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            { name: 'template.yaml', path: 'scenarios/my-app/template.yaml', type: 'file' },
            { name: 'README.md', path: 'scenarios/my-app/README.md', type: 'file' },
          ],
        });

        const result = await detectScenarioType('my-app', mockConfig);

        expect(result).toEqual({
          type: 'cloudformation',
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    describe('error handling', () => {
      it('should throw GitHubApiError on 404', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        });

        await expect(detectScenarioType('non-existent', mockConfig)).rejects.toThrow(
          GitHubApiError
        );

        mockFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        });

        await expect(detectScenarioType('non-existent', mockConfig)).rejects.toThrow(
          "Scenario 'non-existent' not found in repository"
        );
      });

      it('should throw GitHubRateLimitError when rate limited', async () => {
        const resetTime = Math.floor(Date.now() / 1000) + 3600;
        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: {
            get: (name: string) => {
              if (name === 'x-ratelimit-remaining') return '0';
              if (name === 'x-ratelimit-reset') return String(resetTime);
              return null;
            },
          },
        });

        await expect(detectScenarioType('my-app', mockConfig)).rejects.toThrow(
          GitHubRateLimitError
        );
      });

      it('should throw GitHubApiError on 403 without rate limit', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: {
            get: (name: string) => {
              if (name === 'x-ratelimit-remaining') return '100';
              return null;
            },
          },
        });

        await expect(detectScenarioType('my-app', mockConfig)).rejects.toThrow(GitHubApiError);

        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: {
            get: (name: string) => {
              if (name === 'x-ratelimit-remaining') return '100';
              return null;
            },
          },
        });

        await expect(detectScenarioType('my-app', mockConfig)).rejects.toThrow(
          'GitHub API forbidden'
        );
      });

      it('should throw GitHubApiError on other HTTP errors', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        await expect(detectScenarioType('my-app', mockConfig)).rejects.toThrow(GitHubApiError);

        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        await expect(detectScenarioType('my-app', mockConfig)).rejects.toThrow(
          'GitHub API error: 500'
        );
      });
    });

    describe('authentication', () => {
      it('should include auth token in headers when provided', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        });

        await detectScenarioType('my-app', mockConfig);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'token test-token',
            }),
          })
        );
      });

      it('should not include auth token when not provided', async () => {
        const configWithoutToken = { ...mockConfig, githubToken: undefined };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        });

        await detectScenarioType('my-app', configWithoutToken);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: expect.not.objectContaining({
              Authorization: expect.any(String),
            }),
          })
        );
      });
    });

    describe('URL encoding', () => {
      it('should properly encode template names with special characters', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        });

        await detectScenarioType('my app/with spaces', mockConfig);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('my%20app%2Fwith%20spaces'),
          expect.any(Object)
        );
      });
    });
  });

  describe('error classes', () => {
    it('GitHubRateLimitError should include reset time', () => {
      const resetTime = new Date();
      const error = new GitHubRateLimitError('Rate limited', resetTime);

      expect(error.name).toBe('GitHubRateLimitError');
      expect(error.message).toBe('Rate limited');
      expect(error.resetTime).toBe(resetTime);
    });

    it('GitHubApiError should include status code', () => {
      const error = new GitHubApiError('Not found', 404);

      expect(error.name).toBe('GitHubApiError');
      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
    });
  });
});
