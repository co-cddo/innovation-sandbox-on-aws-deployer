import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, getConfig, resetConfig, DEFAULTS } from './config.js';

describe('config module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    resetConfig();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  describe('loadConfig', () => {
    it('should load config with defaults', () => {
      // Clear all optional env vars to ensure defaults are used
      delete process.env.GITHUB_REPO;
      delete process.env.GITHUB_BRANCH;
      delete process.env.GITHUB_PATH;
      delete process.env.TARGET_ROLE_NAME;
      delete process.env.AWS_REGION;
      delete process.env.EVENT_SOURCE;
      delete process.env.LOG_LEVEL;

      const config = loadConfig();

      expect(config).toEqual({
        githubRepo: DEFAULTS.GITHUB_REPO,
        githubBranch: DEFAULTS.GITHUB_BRANCH,
        githubPath: DEFAULTS.GITHUB_PATH,
        targetRoleName: DEFAULTS.TARGET_ROLE_NAME,
        awsRegion: DEFAULTS.AWS_REGION,
        deployRegion: DEFAULTS.DEPLOY_REGION,
        eventSource: DEFAULTS.EVENT_SOURCE,
        logLevel: DEFAULTS.LOG_LEVEL,
      });
    });

    it('should load config with all custom values', () => {
      process.env.GITHUB_REPO = 'custom-org/custom-repo';
      process.env.GITHUB_BRANCH = 'develop';
      process.env.GITHUB_PATH = 'templates';
      process.env.TARGET_ROLE_NAME = 'CustomRole';
      process.env.AWS_REGION = 'us-west-2';
      process.env.DEPLOY_REGION = 'eu-west-1';
      process.env.EVENT_SOURCE = 'custom-source';
      process.env.LOG_LEVEL = 'DEBUG';

      const config = loadConfig();

      expect(config).toEqual({
        githubRepo: 'custom-org/custom-repo',
        githubBranch: 'develop',
        githubPath: 'templates',
        targetRoleName: 'CustomRole',
        awsRegion: 'us-west-2',
        deployRegion: 'eu-west-1',
        eventSource: 'custom-source',
        logLevel: 'DEBUG',
      });
    });

    it('should use default log level for invalid LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'INVALID';

      const config = loadConfig();

      expect(config.logLevel).toBe('INFO');
    });

    it('should accept all valid log levels', () => {
      const validLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

      for (const level of validLevels) {
        resetConfig();
        process.env.LOG_LEVEL = level;

        const config = loadConfig();
        expect(config.logLevel).toBe(level);
      }
    });
  });

  describe('getConfig', () => {
    it('should return singleton instance', () => {
      const config1 = getConfig();
      const config2 = getConfig();

      expect(config1).toBe(config2);
    });
  });

  describe('resetConfig', () => {
    it('should reset singleton allowing new config load', () => {
      process.env.GITHUB_REPO = 'first-repo';
      const config1 = getConfig();

      resetConfig();
      process.env.GITHUB_REPO = 'second-repo';
      const config2 = getConfig();

      expect(config1.githubRepo).toBe('first-repo');
      expect(config2.githubRepo).toBe('second-repo');
      expect(config1).not.toBe(config2);
    });
  });

  describe('DEFAULTS', () => {
    it('should export expected default values', () => {
      expect(DEFAULTS.GITHUB_REPO).toBe('co-cddo/ndx_try_aws_scenarios');
      expect(DEFAULTS.GITHUB_BRANCH).toBe('main');
      expect(DEFAULTS.GITHUB_PATH).toBe('cloudformation/scenarios');
      expect(DEFAULTS.TARGET_ROLE_NAME).toBe('InnovationSandbox-ndx-DeployerRole');
      expect(DEFAULTS.AWS_REGION).toBe('us-west-2');
      expect(DEFAULTS.DEPLOY_REGION).toBe('us-east-1');
      expect(DEFAULTS.EVENT_SOURCE).toBe('innovation-sandbox');
      expect(DEFAULTS.LOG_LEVEL).toBe('INFO');
    });
  });
});
