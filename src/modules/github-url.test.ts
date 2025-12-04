import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTemplateUrl } from './github-url.js';
import { resetConfig, DEFAULTS } from './config.js';
import type { Config } from '../types/index.js';

describe('github-url module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetConfig();
    process.env = { ...originalEnv };
    // Set required env var for config
    process.env.LEASE_TABLE_NAME = 'test-lease-table';
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  describe('buildTemplateUrl', () => {
    describe('with default configuration', () => {
      it('should build URL with default config values', () => {
        const url = buildTemplateUrl('s3-static-website');

        expect(url).toBe(
          'https://raw.githubusercontent.com/co-cddo/ndx_try_aws_scenarios/main/cloudformation/scenarios/s3-static-website/template.yaml'
        );
      });

      it('should build URL for simple template name', () => {
        const url = buildTemplateUrl('basic-template');

        expect(url).toBe(
          'https://raw.githubusercontent.com/co-cddo/ndx_try_aws_scenarios/main/cloudformation/scenarios/basic-template/template.yaml'
        );
      });

      it('should use environment variables when set', () => {
        resetConfig();
        process.env.LEASE_TABLE_NAME = 'test-lease-table';
        process.env.GITHUB_REPO = 'test-org/test-repo';
        process.env.GITHUB_BRANCH = 'develop';
        process.env.GITHUB_PATH = 'templates';

        const url = buildTemplateUrl('my-template');

        expect(url).toBe(
          'https://raw.githubusercontent.com/test-org/test-repo/develop/templates/my-template/template.yaml'
        );
      });
    });

    describe('with custom configuration', () => {
      it('should build URL with custom config object', () => {
        const customConfig: Config = {
          githubRepo: 'custom-org/custom-repo',
          githubBranch: 'feature-branch',
          githubPath: 'cfn/templates',
          leaseTableName: 'custom-table',
          targetRoleName: 'CustomRole',
          awsRegion: 'us-east-1',
          eventSource: 'custom-source',
          logLevel: 'DEBUG',
        };

        const url = buildTemplateUrl('custom-template', customConfig);

        expect(url).toBe(
          'https://raw.githubusercontent.com/custom-org/custom-repo/feature-branch/cfn/templates/custom-template/template.yaml'
        );
      });

      it('should override default config with custom config', () => {
        const customConfig: Config = {
          githubRepo: 'override-org/override-repo',
          githubBranch: 'staging',
          githubPath: 'infrastructure',
          leaseTableName: 'lease-table',
          targetRoleName: 'Role',
          awsRegion: 'us-west-2',
          eventSource: 'source',
          logLevel: 'INFO',
        };

        const url = buildTemplateUrl('test-template', customConfig);

        expect(url).toBe(
          'https://raw.githubusercontent.com/override-org/override-repo/staging/infrastructure/test-template/template.yaml'
        );
      });

      it('should work with different repo formats', () => {
        const customConfig: Config = {
          githubRepo: 'user/repo-with-dashes_and_underscores',
          githubBranch: 'main',
          githubPath: 'templates',
          leaseTableName: 'table',
          targetRoleName: 'Role',
          awsRegion: 'us-west-2',
          eventSource: 'source',
          logLevel: 'INFO',
        };

        const url = buildTemplateUrl('template', customConfig);

        expect(url).toContain('user/repo-with-dashes_and_underscores');
      });
    });

    describe('URL encoding for special characters', () => {
      it('should encode spaces in template name', () => {
        const url = buildTemplateUrl('my template with spaces');

        expect(url).toContain('my%20template%20with%20spaces');
        expect(url).toBe(
          'https://raw.githubusercontent.com/co-cddo/ndx_try_aws_scenarios/main/cloudformation/scenarios/my%20template%20with%20spaces/template.yaml'
        );
      });

      it('should encode forward slashes in template name', () => {
        const url = buildTemplateUrl('folder/template');

        expect(url).toContain('folder%2Ftemplate');
        expect(url).toBe(
          'https://raw.githubusercontent.com/co-cddo/ndx_try_aws_scenarios/main/cloudformation/scenarios/folder%2Ftemplate/template.yaml'
        );
      });

      it('should encode special characters in template name', () => {
        const url = buildTemplateUrl('template@#$%^&*()');

        expect(url).toContain('template%40%23%24%25%5E%26*()');
      });

      it('should encode unicode characters in template name', () => {
        const url = buildTemplateUrl('template-日本語');

        expect(url).toContain('template-%E6%97%A5%E6%9C%AC%E8%AA%9E');
      });

      it('should encode question marks and ampersands', () => {
        const url = buildTemplateUrl('template?with&query');

        expect(url).toContain('template%3Fwith%26query');
      });

      it('should encode plus signs and equals', () => {
        const url = buildTemplateUrl('template+with=special');

        expect(url).toContain('template%2Bwith%3Dspecial');
      });

      it('should handle already-encoded characters correctly', () => {
        const url = buildTemplateUrl('template%20name');

        // encodeURIComponent will double-encode the %
        expect(url).toContain('template%2520name');
      });
    });

    describe('different repo/branch/path combinations', () => {
      it('should handle short branch names', () => {
        const customConfig: Config = {
          githubRepo: 'org/repo',
          githubBranch: 'v1',
          githubPath: 'cfn',
          leaseTableName: 'table',
          targetRoleName: 'Role',
          awsRegion: 'us-west-2',
          eventSource: 'source',
          logLevel: 'INFO',
        };

        const url = buildTemplateUrl('template', customConfig);

        expect(url).toBe(
          'https://raw.githubusercontent.com/org/repo/v1/cfn/template/template.yaml'
        );
      });

      it('should handle long branch names with version numbers', () => {
        const customConfig: Config = {
          githubRepo: 'org/repo',
          githubBranch: 'release/v2.5.3-beta',
          githubPath: 'templates',
          leaseTableName: 'table',
          targetRoleName: 'Role',
          awsRegion: 'us-west-2',
          eventSource: 'source',
          logLevel: 'INFO',
        };

        const url = buildTemplateUrl('template', customConfig);

        expect(url).toContain('release/v2.5.3-beta');
      });

      it('should handle nested paths', () => {
        const customConfig: Config = {
          githubRepo: 'org/repo',
          githubBranch: 'main',
          githubPath: 'infrastructure/cloudformation/templates',
          leaseTableName: 'table',
          targetRoleName: 'Role',
          awsRegion: 'us-west-2',
          eventSource: 'source',
          logLevel: 'INFO',
        };

        const url = buildTemplateUrl('template', customConfig);

        expect(url).toBe(
          'https://raw.githubusercontent.com/org/repo/main/infrastructure/cloudformation/templates/template/template.yaml'
        );
      });

      it('should handle single-level paths', () => {
        const customConfig: Config = {
          githubRepo: 'org/repo',
          githubBranch: 'main',
          githubPath: 'templates',
          leaseTableName: 'table',
          targetRoleName: 'Role',
          awsRegion: 'us-west-2',
          eventSource: 'source',
          logLevel: 'INFO',
        };

        const url = buildTemplateUrl('template', customConfig);

        expect(url).toBe(
          'https://raw.githubusercontent.com/org/repo/main/templates/template/template.yaml'
        );
      });
    });

    describe('template names with various characters', () => {
      it('should handle hyphenated template names', () => {
        const url = buildTemplateUrl('s3-static-website-v2');

        expect(url).toContain('s3-static-website-v2');
      });

      it('should handle underscored template names', () => {
        const url = buildTemplateUrl('ec2_instance_template');

        expect(url).toContain('ec2_instance_template');
      });

      it('should handle mixed case template names', () => {
        const url = buildTemplateUrl('MyTemplateWithCamelCase');

        expect(url).toContain('MyTemplateWithCamelCase');
      });

      it('should handle numeric template names', () => {
        const url = buildTemplateUrl('12345');

        expect(url).toContain('12345');
      });

      it('should handle dots in template names', () => {
        const url = buildTemplateUrl('template.v2.1');

        expect(url).toContain('template.v2.1');
      });

      it('should handle empty string template name', () => {
        const url = buildTemplateUrl('');

        expect(url).toBe(
          'https://raw.githubusercontent.com/co-cddo/ndx_try_aws_scenarios/main/cloudformation/scenarios//template.yaml'
        );
      });

      it('should handle very long template names', () => {
        const longName = 'a'.repeat(200);
        const url = buildTemplateUrl(longName);

        expect(url).toContain(longName);
      });
    });

    describe('URL format verification', () => {
      it('should always start with https://raw.githubusercontent.com', () => {
        const url = buildTemplateUrl('test-template');

        expect(url).toMatch(/^https:\/\/raw\.githubusercontent\.com/);
      });

      it('should always end with /template.yaml', () => {
        const url = buildTemplateUrl('test-template');

        expect(url).toMatch(/\/template\.yaml$/);
      });

      it('should have correct component order', () => {
        const customConfig: Config = {
          githubRepo: 'owner/repo',
          githubBranch: 'branch',
          githubPath: 'path',
          leaseTableName: 'table',
          targetRoleName: 'Role',
          awsRegion: 'us-west-2',
          eventSource: 'source',
          logLevel: 'INFO',
        };

        const url = buildTemplateUrl('template', customConfig);

        expect(url).toBe(
          'https://raw.githubusercontent.com/owner/repo/branch/path/template/template.yaml'
        );
      });

      it('should use forward slashes as separators', () => {
        const url = buildTemplateUrl('test-template');

        const parts = url.split('/');
        expect(parts.length).toBeGreaterThan(5);
        expect(parts).toContain('https:');
        expect(parts).toContain('');
        expect(parts).toContain('raw.githubusercontent.com');
      });
    });

    describe('integration with default constants', () => {
      it('should use correct default repository', () => {
        const url = buildTemplateUrl('template');

        expect(url).toContain(DEFAULTS.GITHUB_REPO);
        expect(url).toContain('co-cddo/ndx_try_aws_scenarios');
      });

      it('should use correct default branch', () => {
        const url = buildTemplateUrl('template');

        expect(url).toContain(DEFAULTS.GITHUB_BRANCH);
        expect(url).toContain('/main/');
      });

      it('should use correct default path', () => {
        const url = buildTemplateUrl('template');

        expect(url).toContain(DEFAULTS.GITHUB_PATH);
        expect(url).toContain('cloudformation/scenarios');
      });
    });
  });
});
