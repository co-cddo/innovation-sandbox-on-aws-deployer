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
    it('should throw when LEASE_TABLE_NAME is not set', () => {
      delete process.env.LEASE_TABLE_NAME;

      expect(() => loadConfig()).toThrow(
        'Required environment variable LEASE_TABLE_NAME is not set'
      );
    });

    it('should load config with required env and defaults', () => {
      // Clear all optional env vars to ensure defaults are used
      delete process.env.GITHUB_REPO;
      delete process.env.GITHUB_BRANCH;
      delete process.env.GITHUB_PATH;
      delete process.env.TARGET_ROLE_NAME;
      delete process.env.AWS_REGION;
      delete process.env.EVENT_SOURCE;
      delete process.env.LOG_LEVEL;
      process.env.LEASE_TABLE_NAME = 'test-lease-table';

      const config = loadConfig();

      expect(config).toEqual({
        githubRepo: DEFAULTS.GITHUB_REPO,
        githubBranch: DEFAULTS.GITHUB_BRANCH,
        githubPath: DEFAULTS.GITHUB_PATH,
        leaseTableName: 'test-lease-table',
        targetRoleName: DEFAULTS.TARGET_ROLE_NAME,
        awsRegion: DEFAULTS.AWS_REGION,
        eventSource: DEFAULTS.EVENT_SOURCE,
        logLevel: DEFAULTS.LOG_LEVEL,
      });
    });

    it('should load config with all custom values', () => {
      process.env.LEASE_TABLE_NAME = 'custom-lease-table';
      process.env.GITHUB_REPO = 'custom-org/custom-repo';
      process.env.GITHUB_BRANCH = 'develop';
      process.env.GITHUB_PATH = 'templates';
      process.env.TARGET_ROLE_NAME = 'CustomRole';
      process.env.AWS_REGION = 'us-east-1';
      process.env.EVENT_SOURCE = 'custom-source';
      process.env.LOG_LEVEL = 'DEBUG';

      const config = loadConfig();

      expect(config).toEqual({
        githubRepo: 'custom-org/custom-repo',
        githubBranch: 'develop',
        githubPath: 'templates',
        leaseTableName: 'custom-lease-table',
        targetRoleName: 'CustomRole',
        awsRegion: 'us-east-1',
        eventSource: 'custom-source',
        logLevel: 'DEBUG',
      });
    });

    it('should use default log level for invalid LOG_LEVEL', () => {
      process.env.LEASE_TABLE_NAME = 'test-table';
      process.env.LOG_LEVEL = 'INVALID';

      const config = loadConfig();

      expect(config.logLevel).toBe('INFO');
    });

    it('should accept all valid log levels', () => {
      const validLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

      for (const level of validLevels) {
        resetConfig();
        process.env.LEASE_TABLE_NAME = 'test-table';
        process.env.LOG_LEVEL = level;

        const config = loadConfig();
        expect(config.logLevel).toBe(level);
      }
    });
  });

  describe('getConfig', () => {
    it('should return singleton instance', () => {
      process.env.LEASE_TABLE_NAME = 'test-table';

      const config1 = getConfig();
      const config2 = getConfig();

      expect(config1).toBe(config2);
    });

    it('should throw on first call if required env not set', () => {
      delete process.env.LEASE_TABLE_NAME;

      expect(() => getConfig()).toThrow(
        'Required environment variable LEASE_TABLE_NAME is not set'
      );
    });
  });

  describe('resetConfig', () => {
    it('should reset singleton allowing new config load', () => {
      process.env.LEASE_TABLE_NAME = 'first-table';
      const config1 = getConfig();

      resetConfig();
      process.env.LEASE_TABLE_NAME = 'second-table';
      const config2 = getConfig();

      expect(config1.leaseTableName).toBe('first-table');
      expect(config2.leaseTableName).toBe('second-table');
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
      expect(DEFAULTS.EVENT_SOURCE).toBe('isb-deployer');
      expect(DEFAULTS.LOG_LEVEL).toBe('INFO');
    });
  });
});
