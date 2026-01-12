import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  Config,
  ScenarioDetectionResult,
  FetchedScenario,
  SynthesisResult,
} from '../types/index.js';

// Mock dependencies
vi.mock('./scenario-detector.js', () => ({
  detectScenarioType: vi.fn(),
  GitHubApiError: class GitHubApiError extends Error {
    constructor(
      message: string,
      public statusCode?: number
    ) {
      super(message);
      this.name = 'GitHubApiError';
    }
  },
}));

vi.mock('./scenario-fetcher.js', () => ({
  fetchScenarioFolder: vi.fn(),
  ScenarioFetchError: class ScenarioFetchError extends Error {
    constructor(
      message: string,
      public cause?: Error
    ) {
      super(message);
      this.name = 'ScenarioFetchError';
    }
  },
}));

vi.mock('./cdk-synthesizer.js', () => ({
  synthesizeCdk: vi.fn(),
  CdkSynthesisError: class CdkSynthesisError extends Error {
    constructor(
      message: string,
      public cause?: Error,
      public stderr?: string
    ) {
      super(message);
      this.name = 'CdkSynthesisError';
    }
  },
}));

vi.mock('./template-fetcher.js', () => ({
  fetchTemplate: vi.fn(),
  TemplateFetchError: class TemplateFetchError extends Error {
    constructor(
      message: string,
      public statusCode?: number
    ) {
      super(message);
      this.name = 'TemplateFetchError';
    }
  },
}));

vi.mock('./github-url.js', () => ({
  buildTemplateUrl: vi.fn(),
}));

vi.mock('./config.js', () => ({
  getConfig: vi.fn(),
}));

describe('template-resolver module', () => {
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

  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setContext: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveTemplate', () => {
    it('should resolve CloudFormation template directly', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { fetchTemplate } = await import('./template-fetcher.js');
      const { buildTemplateUrl } = await import('./github-url.js');
      const { resolveTemplate } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockResolvedValue({
        type: 'cloudformation',
      } as ScenarioDetectionResult);

      vi.mocked(buildTemplateUrl).mockReturnValue(
        'https://raw.githubusercontent.com/test-org/test-repo/main/scenarios/my-app/template.yaml'
      );

      vi.mocked(fetchTemplate).mockResolvedValue('AWSTemplateFormatVersion: "2010-09-09"');

      const result = await resolveTemplate(
        'my-app',
        mockLogger as any,
        undefined,
        undefined,
        mockConfig
      );

      expect(result).toEqual({
        templateBody: 'AWSTemplateFormatVersion: "2010-09-09"',
        source: 'cloudformation',
        synthesized: false,
      });
    });

    it('should resolve CDK template by fetching and synthesizing', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { fetchScenarioFolder } = await import('./scenario-fetcher.js');
      const { synthesizeCdk } = await import('./cdk-synthesizer.js');
      const { resolveTemplate } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockResolvedValue({
        type: 'cdk',
        cdkPath: '',
      } as ScenarioDetectionResult);

      const mockCleanup = vi.fn();
      vi.mocked(fetchScenarioFolder).mockResolvedValue({
        localPath: '/tmp/my-app-abc123',
        cdkPath: '/tmp/my-app-abc123/scenarios/my-app',
        cleanup: mockCleanup,
      } as FetchedScenario);

      vi.mocked(synthesizeCdk).mockResolvedValue({
        templateBody: '{"AWSTemplateFormatVersion": "2010-09-09"}',
        stackName: 'MyAppStack',
      } as SynthesisResult);

      const result = await resolveTemplate(
        'my-app',
        mockLogger as any,
        '123456789012',
        'us-east-1',
        mockConfig
      );

      expect(result).toEqual({
        templateBody: '{"AWSTemplateFormatVersion": "2010-09-09"}',
        source: 'cdk',
        synthesized: true,
      });
      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should resolve CDK in subfolder', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { fetchScenarioFolder } = await import('./scenario-fetcher.js');
      const { synthesizeCdk } = await import('./cdk-synthesizer.js');
      const { resolveTemplate } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockResolvedValue({
        type: 'cdk-subfolder',
        cdkPath: 'cdk',
      } as ScenarioDetectionResult);

      const mockCleanup = vi.fn();
      vi.mocked(fetchScenarioFolder).mockResolvedValue({
        localPath: '/tmp/my-app-abc123',
        cdkPath: '/tmp/my-app-abc123/scenarios/my-app/cdk',
        cleanup: mockCleanup,
      } as FetchedScenario);

      vi.mocked(synthesizeCdk).mockResolvedValue({
        templateBody: '{"AWSTemplateFormatVersion": "2010-09-09"}',
        stackName: 'MyAppStack',
      } as SynthesisResult);

      const result = await resolveTemplate(
        'my-app',
        mockLogger as any,
        undefined,
        undefined,
        mockConfig
      );

      expect(result).toEqual({
        templateBody: '{"AWSTemplateFormatVersion": "2010-09-09"}',
        source: 'cdk',
        synthesized: true,
      });
      expect(fetchScenarioFolder).toHaveBeenCalledWith('my-app', 'cdk', mockLogger, mockConfig);
    });

    it('should return null when scenario not found (404)', async () => {
      const { detectScenarioType, GitHubApiError } = await import('./scenario-detector.js');
      const { resolveTemplate } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockRejectedValue(new GitHubApiError('Not found', 404));

      const result = await resolveTemplate(
        'non-existent',
        mockLogger as any,
        undefined,
        undefined,
        mockConfig
      );

      expect(result).toBeNull();
    });

    it('should return null when CloudFormation template not found', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { fetchTemplate, TemplateFetchError } = await import('./template-fetcher.js');
      const { buildTemplateUrl } = await import('./github-url.js');
      const { resolveTemplate } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockResolvedValue({
        type: 'cloudformation',
      } as ScenarioDetectionResult);

      vi.mocked(buildTemplateUrl).mockReturnValue('https://...');
      vi.mocked(fetchTemplate).mockRejectedValue(new TemplateFetchError('Not found', 404));

      const result = await resolveTemplate(
        'my-app',
        mockLogger as any,
        undefined,
        undefined,
        mockConfig
      );

      expect(result).toBeNull();
    });

    it('should cleanup on CDK synthesis error', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { fetchScenarioFolder } = await import('./scenario-fetcher.js');
      const { synthesizeCdk, CdkSynthesisError } = await import('./cdk-synthesizer.js');
      const { resolveTemplate, TemplateResolutionError } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockResolvedValue({
        type: 'cdk',
        cdkPath: '',
      } as ScenarioDetectionResult);

      const mockCleanup = vi.fn();
      vi.mocked(fetchScenarioFolder).mockResolvedValue({
        localPath: '/tmp/my-app-abc123',
        cdkPath: '/tmp/my-app-abc123/scenarios/my-app',
        cleanup: mockCleanup,
      } as FetchedScenario);

      vi.mocked(synthesizeCdk).mockRejectedValue(
        new CdkSynthesisError('Synthesis failed', undefined, 'npm error')
      );

      await expect(
        resolveTemplate('my-app', mockLogger as any, undefined, undefined, mockConfig)
      ).rejects.toThrow(TemplateResolutionError);

      // Cleanup should still be called
      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should wrap unknown errors in TemplateResolutionError', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { resolveTemplate, TemplateResolutionError } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockRejectedValue(new Error('Unknown error'));

      await expect(
        resolveTemplate('my-app', mockLogger as any, undefined, undefined, mockConfig)
      ).rejects.toThrow(TemplateResolutionError);

      // Error message now includes branch (uses default 'main' from mockConfig)
      await expect(
        resolveTemplate('my-app', mockLogger as any, undefined, undefined, mockConfig)
      ).rejects.toThrow("Failed to resolve template 'my-app@main'");
    });
  });

  describe('TemplateResolutionError', () => {
    it('should include message and cause', async () => {
      const { TemplateResolutionError } = await import('./template-resolver.js');

      const cause = new Error('Original error');
      const error = new TemplateResolutionError('Resolution failed', cause);

      expect(error.name).toBe('TemplateResolutionError');
      expect(error.message).toBe('Resolution failed');
      expect(error.cause).toBe(cause);
    });

    it('should work without cause', async () => {
      const { TemplateResolutionError } = await import('./template-resolver.js');

      const error = new TemplateResolutionError('Resolution failed');

      expect(error.name).toBe('TemplateResolutionError');
      expect(error.message).toBe('Resolution failed');
      expect(error.cause).toBeUndefined();
    });
  });

  describe('branch override support', () => {
    it('should pass branch override to detectScenarioType', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { fetchTemplate } = await import('./template-fetcher.js');
      const { buildTemplateUrl } = await import('./github-url.js');
      const { resolveTemplate } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockResolvedValue({
        type: 'cloudformation',
      } as ScenarioDetectionResult);

      vi.mocked(buildTemplateUrl).mockReturnValue('https://example.com/template.yaml');
      vi.mocked(fetchTemplate).mockResolvedValue('AWSTemplateFormatVersion: "2010-09-09"');

      await resolveTemplate(
        'my-app@feature-branch', // Template ref with branch override
        mockLogger as any,
        undefined,
        undefined,
        mockConfig
      );

      // Verify detectScenarioType was called with modified config
      expect(detectScenarioType).toHaveBeenCalledWith(
        'my-app', // Pure template name (no @branch)
        expect.objectContaining({
          githubBranch: 'feature-branch', // Branch from template ref
        })
      );
    });

    it('should use default branch when no override specified', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { fetchTemplate } = await import('./template-fetcher.js');
      const { buildTemplateUrl } = await import('./github-url.js');
      const { resolveTemplate } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockResolvedValue({
        type: 'cloudformation',
      } as ScenarioDetectionResult);

      vi.mocked(buildTemplateUrl).mockReturnValue('https://example.com/template.yaml');
      vi.mocked(fetchTemplate).mockResolvedValue('AWSTemplateFormatVersion: "2010-09-09"');

      await resolveTemplate(
        'my-app', // No branch specifier
        mockLogger as any,
        undefined,
        undefined,
        mockConfig
      );

      expect(detectScenarioType).toHaveBeenCalledWith(
        'my-app',
        expect.objectContaining({
          githubBranch: 'main', // Default from mockConfig
        })
      );
    });

    it('should throw TemplateResolutionError for invalid template ref starting with @', async () => {
      const { resolveTemplate, TemplateResolutionError } = await import('./template-resolver.js');

      await expect(
        resolveTemplate('@invalid', mockLogger as any, undefined, undefined, mockConfig)
      ).rejects.toThrow(TemplateResolutionError);

      await expect(
        resolveTemplate('@invalid', mockLogger as any, undefined, undefined, mockConfig)
      ).rejects.toThrow('cannot start with @');
    });

    it('should throw TemplateResolutionError for template ref ending with @', async () => {
      const { resolveTemplate, TemplateResolutionError } = await import('./template-resolver.js');

      await expect(
        resolveTemplate('app@', mockLogger as any, undefined, undefined, mockConfig)
      ).rejects.toThrow(TemplateResolutionError);

      await expect(
        resolveTemplate('app@', mockLogger as any, undefined, undefined, mockConfig)
      ).rejects.toThrow('cannot be empty after @');
    });

    it('should throw TemplateResolutionError for invalid branch name', async () => {
      const { resolveTemplate, TemplateResolutionError } = await import('./template-resolver.js');

      await expect(
        resolveTemplate('app@branch..invalid', mockLogger as any, undefined, undefined, mockConfig)
      ).rejects.toThrow(TemplateResolutionError);

      await expect(
        resolveTemplate('app@branch..invalid', mockLogger as any, undefined, undefined, mockConfig)
      ).rejects.toThrow('consecutive dots');
    });

    it('should handle feature branch with slashes', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { fetchTemplate } = await import('./template-fetcher.js');
      const { buildTemplateUrl } = await import('./github-url.js');
      const { resolveTemplate } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockResolvedValue({
        type: 'cloudformation',
      } as ScenarioDetectionResult);

      vi.mocked(buildTemplateUrl).mockReturnValue('https://example.com/template.yaml');
      vi.mocked(fetchTemplate).mockResolvedValue('AWSTemplateFormatVersion: "2010-09-09"');

      await resolveTemplate(
        'my-app@feature/new-feature', // Branch with slashes
        mockLogger as any,
        undefined,
        undefined,
        mockConfig
      );

      expect(detectScenarioType).toHaveBeenCalledWith(
        'my-app',
        expect.objectContaining({
          githubBranch: 'feature/new-feature',
        })
      );
    });

    it('should log branch information', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { fetchTemplate } = await import('./template-fetcher.js');
      const { buildTemplateUrl } = await import('./github-url.js');
      const { resolveTemplate } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockResolvedValue({
        type: 'cloudformation',
      } as ScenarioDetectionResult);

      vi.mocked(buildTemplateUrl).mockReturnValue('https://example.com/template.yaml');
      vi.mocked(fetchTemplate).mockResolvedValue('AWSTemplateFormatVersion: "2010-09-09"');

      await resolveTemplate('my-app@develop', mockLogger as any, undefined, undefined, mockConfig);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Resolving template',
        expect.objectContaining({
          templateName: 'my-app',
          branch: 'develop',
          branchOverride: true,
        })
      );
    });

    it('should log branchOverride as false when using default branch', async () => {
      const { detectScenarioType } = await import('./scenario-detector.js');
      const { fetchTemplate } = await import('./template-fetcher.js');
      const { buildTemplateUrl } = await import('./github-url.js');
      const { resolveTemplate } = await import('./template-resolver.js');

      vi.mocked(detectScenarioType).mockResolvedValue({
        type: 'cloudformation',
      } as ScenarioDetectionResult);

      vi.mocked(buildTemplateUrl).mockReturnValue('https://example.com/template.yaml');
      vi.mocked(fetchTemplate).mockResolvedValue('AWSTemplateFormatVersion: "2010-09-09"');

      await resolveTemplate('my-app', mockLogger as any, undefined, undefined, mockConfig);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Resolving template',
        expect.objectContaining({
          templateName: 'my-app',
          branch: 'main',
          branchOverride: false,
        })
      );
    });
  });

  describe('re-exports', () => {
    it('should re-export error classes from other modules', async () => {
      const {
        GitHubApiError,
        ScenarioFetchError,
        CdkSynthesisError,
        TemplateFetchError,
        TemplateRefParseError,
      } = await import('./template-resolver.js');

      expect(GitHubApiError).toBeDefined();
      expect(ScenarioFetchError).toBeDefined();
      expect(CdkSynthesisError).toBeDefined();
      expect(TemplateFetchError).toBeDefined();
      expect(TemplateRefParseError).toBeDefined();
    });
  });
});
