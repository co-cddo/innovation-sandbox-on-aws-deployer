import { describe, it, expect } from 'vitest';
import {
  parseTemplateRef,
  resolveEffectiveBranch,
  TemplateRefParseError,
} from './template-ref-parser.js';

describe('template-ref-parser module', () => {
  describe('parseTemplateRef', () => {
    describe('valid inputs without branch', () => {
      it('should parse simple template name', () => {
        const result = parseTemplateRef('localgov-drupal');
        expect(result).toEqual({ name: 'localgov-drupal', branch: undefined });
      });

      it('should parse template name with underscores', () => {
        const result = parseTemplateRef('my_app_template');
        expect(result).toEqual({ name: 'my_app_template', branch: undefined });
      });

      it('should parse template name with numbers', () => {
        const result = parseTemplateRef('app2go');
        expect(result).toEqual({ name: 'app2go', branch: undefined });
      });

      it('should parse single character template name', () => {
        const result = parseTemplateRef('a');
        expect(result).toEqual({ name: 'a', branch: undefined });
      });

      it('should parse numeric template name', () => {
        const result = parseTemplateRef('123');
        expect(result).toEqual({ name: '123', branch: undefined });
      });

      it('should parse template name with mixed case', () => {
        const result = parseTemplateRef('MyApp-Template');
        expect(result).toEqual({ name: 'MyApp-Template', branch: undefined });
      });
    });

    describe('valid inputs with branch', () => {
      it('should parse template name with simple branch', () => {
        const result = parseTemplateRef('localgov-drupal@feature-branch');
        expect(result).toEqual({ name: 'localgov-drupal', branch: 'feature-branch' });
      });

      it('should parse template with version tag branch', () => {
        const result = parseTemplateRef('localgov-drupal@v2.0');
        expect(result).toEqual({ name: 'localgov-drupal', branch: 'v2.0' });
      });

      it('should parse template with semver branch', () => {
        const result = parseTemplateRef('app@v1.2.3');
        expect(result).toEqual({ name: 'app', branch: 'v1.2.3' });
      });

      it('should handle branches with slashes (feature branches)', () => {
        const result = parseTemplateRef('my-app@feature/new-feature');
        expect(result).toEqual({ name: 'my-app', branch: 'feature/new-feature' });
      });

      it('should handle branches with multiple slashes', () => {
        const result = parseTemplateRef('app@user/feature/branch');
        expect(result).toEqual({ name: 'app', branch: 'user/feature/branch' });
      });

      it('should handle single character branch name', () => {
        const result = parseTemplateRef('app@v');
        expect(result).toEqual({ name: 'app', branch: 'v' });
      });

      it('should handle dots in branch name', () => {
        const result = parseTemplateRef('app@release.1.0.0');
        expect(result).toEqual({ name: 'app', branch: 'release.1.0.0' });
      });

      it('should handle underscores in branch name', () => {
        const result = parseTemplateRef('app@feature_branch');
        expect(result).toEqual({ name: 'app', branch: 'feature_branch' });
      });

      it('should handle main branch explicitly', () => {
        const result = parseTemplateRef('app@main');
        expect(result).toEqual({ name: 'app', branch: 'main' });
      });

      it('should handle develop branch', () => {
        const result = parseTemplateRef('app@develop');
        expect(result).toEqual({ name: 'app', branch: 'develop' });
      });
    });

    describe('invalid template names', () => {
      it('should reject empty string', () => {
        expect(() => parseTemplateRef('')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('')).toThrow('cannot be empty');
      });

      it('should reject whitespace-only', () => {
        expect(() => parseTemplateRef('   ')).toThrow(TemplateRefParseError);
      });

      it('should reject template starting with dash', () => {
        expect(() => parseTemplateRef('-invalid')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('-invalid')).toThrow('Must start with alphanumeric');
      });

      it('should reject template starting with underscore', () => {
        expect(() => parseTemplateRef('_invalid')).toThrow(TemplateRefParseError);
      });

      it('should reject template with spaces', () => {
        expect(() => parseTemplateRef('my app')).toThrow(TemplateRefParseError);
      });

      it('should reject template with dots', () => {
        expect(() => parseTemplateRef('my.app')).toThrow(TemplateRefParseError);
      });

      it('should reject template with slashes', () => {
        expect(() => parseTemplateRef('my/app')).toThrow(TemplateRefParseError);
      });

      it('should reject template with path traversal', () => {
        expect(() => parseTemplateRef('../secret')).toThrow(TemplateRefParseError);
      });

      it('should reject template with shell metacharacters', () => {
        expect(() => parseTemplateRef('app;rm -rf')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('app|cat')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('app$(cmd)')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('app`cmd`')).toThrow(TemplateRefParseError);
      });

      it('should reject template with special characters', () => {
        expect(() => parseTemplateRef('app*')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('app?')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('app[')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('app]')).toThrow(TemplateRefParseError);
      });

      it('should reject template name exceeding 100 characters', () => {
        const longName = 'a'.repeat(101);
        expect(() => parseTemplateRef(longName)).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef(longName)).toThrow('too long');
      });

      it('should accept template name at exactly 100 characters', () => {
        const maxName = 'a'.repeat(100);
        const result = parseTemplateRef(maxName);
        expect(result.name).toBe(maxName);
      });
    });

    describe('invalid branch names', () => {
      it('should reject reference starting with @', () => {
        expect(() => parseTemplateRef('@branch')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('@branch')).toThrow('cannot start with @');
      });

      it('should reject reference ending with @', () => {
        expect(() => parseTemplateRef('app@')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('app@')).toThrow('cannot be empty after @');
      });

      it('should reject branch starting with dash', () => {
        expect(() => parseTemplateRef('app@-branch')).toThrow(TemplateRefParseError);
      });

      it('should reject branch starting with dot', () => {
        expect(() => parseTemplateRef('app@.branch')).toThrow(TemplateRefParseError);
      });

      it('should reject branch starting with slash', () => {
        expect(() => parseTemplateRef('app@/branch')).toThrow(TemplateRefParseError);
      });

      it('should reject branch with consecutive dots', () => {
        expect(() => parseTemplateRef('app@branch..name')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('app@branch..name')).toThrow('consecutive dots');
      });

      it('should reject branch with consecutive slashes', () => {
        expect(() => parseTemplateRef('app@feature//branch')).toThrow(TemplateRefParseError);
      });

      it('should reject branch ending with .lock', () => {
        expect(() => parseTemplateRef('app@branch.lock')).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef('app@branch.lock')).toThrow('.lock');
      });

      it('should reject branch with spaces', () => {
        expect(() => parseTemplateRef('app@my branch')).toThrow(TemplateRefParseError);
      });

      it('should reject branch with tilde', () => {
        expect(() => parseTemplateRef('app@branch~1')).toThrow(TemplateRefParseError);
      });

      it('should reject branch with caret', () => {
        expect(() => parseTemplateRef('app@branch^2')).toThrow(TemplateRefParseError);
      });

      it('should reject branch with colon', () => {
        expect(() => parseTemplateRef('app@refs:heads/main')).toThrow(TemplateRefParseError);
      });

      it('should reject branch with question mark', () => {
        expect(() => parseTemplateRef('app@branch?')).toThrow(TemplateRefParseError);
      });

      it('should reject branch with asterisk', () => {
        expect(() => parseTemplateRef('app@branch*')).toThrow(TemplateRefParseError);
      });

      it('should reject branch with backslash', () => {
        expect(() => parseTemplateRef('app@branch\\name')).toThrow(TemplateRefParseError);
      });

      it('should reject branch exceeding 256 characters', () => {
        const longBranch = 'a'.repeat(257);
        expect(() => parseTemplateRef(`app@${longBranch}`)).toThrow(TemplateRefParseError);
        expect(() => parseTemplateRef(`app@${longBranch}`)).toThrow('too long');
      });

      it('should accept branch at exactly 256 characters', () => {
        const maxBranch = 'a'.repeat(256);
        const result = parseTemplateRef(`app@${maxBranch}`);
        expect(result.branch).toBe(maxBranch);
      });
    });

    describe('edge cases', () => {
      it('should split on first @ only', () => {
        // Branch name shouldn't contain @ but if it somehow does,
        // we split on first @ - the branch validation should catch invalid chars
        expect(() => parseTemplateRef('app@branch@extra')).toThrow(TemplateRefParseError);
      });

      it('should handle template name ending with number', () => {
        const result = parseTemplateRef('app123');
        expect(result).toEqual({ name: 'app123', branch: undefined });
      });

      it('should handle template name that is all numbers', () => {
        const result = parseTemplateRef('12345');
        expect(result).toEqual({ name: '12345', branch: undefined });
      });

      it('should handle branch name that is all numbers', () => {
        const result = parseTemplateRef('app@123');
        expect(result).toEqual({ name: 'app', branch: '123' });
      });

      it('should handle complex realistic branch names', () => {
        const result = parseTemplateRef('localgov-drupal@feature/JIRA-123-add-new-module');
        expect(result).toEqual({
          name: 'localgov-drupal',
          branch: 'feature/JIRA-123-add-new-module',
        });
      });

      it('should handle release branch pattern', () => {
        const result = parseTemplateRef('app@release/2024.01');
        expect(result).toEqual({ name: 'app', branch: 'release/2024.01' });
      });

      it('should handle hotfix branch pattern', () => {
        const result = parseTemplateRef('app@hotfix/urgent-fix');
        expect(result).toEqual({ name: 'app', branch: 'hotfix/urgent-fix' });
      });
    });
  });

  describe('resolveEffectiveBranch', () => {
    it('should return override branch when specified', () => {
      const result = resolveEffectiveBranch({ name: 'app', branch: 'feature' }, 'main');
      expect(result).toBe('feature');
    });

    it('should return default branch when no override', () => {
      const result = resolveEffectiveBranch({ name: 'app', branch: undefined }, 'main');
      expect(result).toBe('main');
    });

    it('should return default branch when branch is not in templateRef', () => {
      const result = resolveEffectiveBranch({ name: 'app' }, 'main');
      expect(result).toBe('main');
    });

    it('should handle different default branches', () => {
      expect(resolveEffectiveBranch({ name: 'app' }, 'develop')).toBe('develop');
      expect(resolveEffectiveBranch({ name: 'app' }, 'master')).toBe('master');
      expect(resolveEffectiveBranch({ name: 'app' }, 'production')).toBe('production');
    });

    it('should return override even if same as default', () => {
      // Explicit override even if same value
      const result = resolveEffectiveBranch({ name: 'app', branch: 'main' }, 'main');
      expect(result).toBe('main');
    });

    it('should handle complex branch override', () => {
      const result = resolveEffectiveBranch({ name: 'app', branch: 'feature/new-feature' }, 'main');
      expect(result).toBe('feature/new-feature');
    });
  });
});
