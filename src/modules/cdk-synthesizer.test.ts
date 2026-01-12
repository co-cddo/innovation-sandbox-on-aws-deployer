import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  detectCDKVersion,
  detectInstalledCDKVersion,
  mapLibVersionToCliVersion,
  CdkSynthesisError,
  DependencyInstallError,
  VersionDetectionError,
} from './cdk-synthesizer.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

describe('cdk-synthesizer module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectCDKVersion', () => {
    it('should detect CDK version from aws-cdk-lib in dependencies', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          dependencies: {
            'aws-cdk-lib': '^2.173.1',
          },
        })
      );

      const version = detectCDKVersion('/tmp/project');

      expect(version).toBe('2.173.1');
    });

    it('should detect CDK version from aws-cdk in devDependencies', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          devDependencies: {
            'aws-cdk': '~2.100.0',
          },
        })
      );

      const version = detectCDKVersion('/tmp/project');

      expect(version).toBe('2.100.0');
    });

    it('should detect CDK version from aws-cdk-lib in devDependencies', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          devDependencies: {
            'aws-cdk-lib': '>=2.50.0',
          },
        })
      );

      const version = detectCDKVersion('/tmp/project');

      expect(version).toBe('2.50.0');
    });

    it('should detect CDK version from peerDependencies', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          peerDependencies: {
            'aws-cdk-lib': '2.200.0',
          },
        })
      );

      const version = detectCDKVersion('/tmp/project');

      expect(version).toBe('2.200.0');
    });

    it('should throw VersionDetectionError if package.json does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => detectCDKVersion('/tmp/project')).toThrow(VersionDetectionError);
      expect(() => detectCDKVersion('/tmp/project')).toThrow('No package.json found');
    });

    it('should throw VersionDetectionError if CDK not in package.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          dependencies: {
            'some-other-package': '1.0.0',
          },
        })
      );

      expect(() => detectCDKVersion('/tmp/project')).toThrow(VersionDetectionError);
      expect(() => detectCDKVersion('/tmp/project')).toThrow('Could not find CDK version');
    });

    it('should strip various version range operators', () => {
      const testCases = [
        ['^2.173.1', '2.173.1'],
        ['~2.173.1', '2.173.1'],
        ['>=2.173.1', '2.173.1'],
        ['<2.173.1', '2.173.1'],
        ['2.173.1', '2.173.1'],
      ];

      for (const [input, expected] of testCases) {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({
            dependencies: {
              'aws-cdk-lib': input,
            },
          })
        );

        const version = detectCDKVersion('/tmp/project');
        expect(version).toBe(expected);
      }
    });
  });

  describe('detectInstalledCDKVersion', () => {
    it('should read version from installed aws-cdk-lib package.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          name: 'aws-cdk-lib',
          version: '2.185.0',
        })
      );

      const version = detectInstalledCDKVersion('/tmp/project');

      expect(version).toBe('2.185.0');
      expect(fs.readFileSync).toHaveBeenCalledWith(
        path.join('/tmp/project', 'node_modules', 'aws-cdk-lib', 'package.json'),
        'utf-8'
      );
    });

    it('should throw VersionDetectionError if aws-cdk-lib not in node_modules', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => detectInstalledCDKVersion('/tmp/project')).toThrow(VersionDetectionError);
      expect(() => detectInstalledCDKVersion('/tmp/project')).toThrow(
        'aws-cdk-lib not found in node_modules'
      );
    });

    it('should throw VersionDetectionError if version not in package.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          name: 'aws-cdk-lib',
          // Missing version field
        })
      );

      expect(() => detectInstalledCDKVersion('/tmp/project')).toThrow(VersionDetectionError);
      expect(() => detectInstalledCDKVersion('/tmp/project')).toThrow('Could not read version');
    });
  });

  describe('mapLibVersionToCliVersion', () => {
    it('should return same version for pre-2.179.0 library versions', () => {
      expect(mapLibVersionToCliVersion('2.0.0')).toBe('2.0.0');
      expect(mapLibVersionToCliVersion('2.100.0')).toBe('2.100.0');
      expect(mapLibVersionToCliVersion('2.178.0')).toBe('2.178.0');
      expect(mapLibVersionToCliVersion('2.178.99')).toBe('2.178.99');
      expect(mapLibVersionToCliVersion('1.200.0')).toBe('1.200.0');
    });

    it('should return pinned CLI version for 2.179.0+ library versions', () => {
      // All versions >= 2.179.0 should return the pinned version
      const pinnedVersion = '2.1033.0';

      expect(mapLibVersionToCliVersion('2.179.0')).toBe(pinnedVersion);
      expect(mapLibVersionToCliVersion('2.180.0')).toBe(pinnedVersion);
      expect(mapLibVersionToCliVersion('2.200.0')).toBe(pinnedVersion);
      expect(mapLibVersionToCliVersion('2.233.0')).toBe(pinnedVersion);
      expect(mapLibVersionToCliVersion('2.300.0')).toBe(pinnedVersion);
    });

    it('should handle edge case at version boundary', () => {
      const pinnedVersion = '2.1033.0';

      // 2.178.x should return same version
      expect(mapLibVersionToCliVersion('2.178.999')).toBe('2.178.999');

      // 2.179.0 should return pinned version
      expect(mapLibVersionToCliVersion('2.179.0')).toBe(pinnedVersion);
    });

    it('should handle major version 1 (always lockstep)', () => {
      expect(mapLibVersionToCliVersion('1.0.0')).toBe('1.0.0');
      expect(mapLibVersionToCliVersion('1.200.0')).toBe('1.200.0');
    });

    it('should handle future major version 3', () => {
      // Major version 3 would be >= 2, and minor is 0 which is < 179
      // However, the function checks major < 2 OR (major === 2 AND minor < 179)
      // For major=3, minor=0: 3 < 2 is false, 3 === 2 is false, so it falls through
      // This means versions >= 3.0.0 get the pinned version
      // This is a reasonable behavior since we don't know the CLI versioning for v3
      const pinnedVersion = '2.1033.0';
      expect(mapLibVersionToCliVersion('3.0.0')).toBe(pinnedVersion);
    });
  });

  describe('error classes', () => {
    describe('CdkSynthesisError', () => {
      it('should include message, cause, and stderr', () => {
        const cause = new Error('Original error');
        const error = new CdkSynthesisError('Synthesis failed', cause, 'Some stderr output');

        expect(error.name).toBe('CdkSynthesisError');
        expect(error.message).toBe('Synthesis failed');
        expect(error.cause).toBe(cause);
        expect(error.stderr).toBe('Some stderr output');
      });

      it('should work without cause or stderr', () => {
        const error = new CdkSynthesisError('Synthesis failed');

        expect(error.name).toBe('CdkSynthesisError');
        expect(error.message).toBe('Synthesis failed');
        expect(error.cause).toBeUndefined();
        expect(error.stderr).toBeUndefined();
      });
    });

    describe('DependencyInstallError', () => {
      it('should include message and cause', () => {
        const cause = new Error('npm error');
        const error = new DependencyInstallError('Install failed', cause);

        expect(error.name).toBe('DependencyInstallError');
        expect(error.message).toBe('Install failed');
        expect(error.cause).toBe(cause);
      });

      it('should work without cause', () => {
        const error = new DependencyInstallError('Install failed');

        expect(error.name).toBe('DependencyInstallError');
        expect(error.message).toBe('Install failed');
        expect(error.cause).toBeUndefined();
      });
    });

    describe('VersionDetectionError', () => {
      it('should have correct name and message', () => {
        const error = new VersionDetectionError('Cannot detect version');

        expect(error.name).toBe('VersionDetectionError');
        expect(error.message).toBe('Cannot detect version');
      });
    });
  });
});
