import { describe, it, expect } from 'vitest';
import {
  generateStackName,
  sanitizeForStackName,
  StackNameError,
} from './stack-name.js';

describe('stack-name module', () => {
  describe('StackNameError', () => {
    it('should create error with correct name property', () => {
      const error = new StackNameError('Test error message');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('StackNameError');
      expect(error.message).toBe('Test error message');
    });

    it('should capture stack trace', () => {
      const error = new StackNameError('Test error');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('StackNameError');
    });
  });

  describe('sanitizeForStackName', () => {
    describe('valid input sanitization', () => {
      it('should keep valid alphanumeric characters and hyphens', () => {
        const result = sanitizeForStackName('Valid-Name-123');

        expect(result).toBe('Valid-Name-123');
      });

      it('should replace underscores with hyphens', () => {
        const result = sanitizeForStackName('my_template_name');

        expect(result).toBe('my-template-name');
      });

      it('should replace dots with hyphens', () => {
        const result = sanitizeForStackName('my.template.yaml');

        expect(result).toBe('my-template-yaml');
      });

      it('should replace both underscores and dots with hyphens', () => {
        const result = sanitizeForStackName('my_template.v2.1_final');

        expect(result).toBe('my-template-v2-1-final');
      });

      it('should remove invalid special characters', () => {
        const result = sanitizeForStackName('my@template#name$');

        expect(result).toBe('mytemplatename');
      });

      it('should handle multiple special characters', () => {
        const result = sanitizeForStackName('name!@#$%^&*()+={}[]|\\:";\'<>?,./');

        expect(result).toBe('name');
      });

      it('should preserve letter case', () => {
        const result = sanitizeForStackName('MyTemplateName');

        expect(result).toBe('MyTemplateName');
      });
    });

    describe('leading character handling', () => {
      it('should remove leading numbers', () => {
        const result = sanitizeForStackName('123-template');

        expect(result).toBe('template');
      });

      it('should remove leading hyphens', () => {
        const result = sanitizeForStackName('---template');

        expect(result).toBe('template');
      });

      it('should remove leading numbers and hyphens', () => {
        const result = sanitizeForStackName('123-456-template');

        expect(result).toBe('template');
      });

      it('should keep names starting with letters', () => {
        const result = sanitizeForStackName('Template123');

        expect(result).toBe('Template123');
      });

      it('should handle mixed leading invalid characters', () => {
        const result = sanitizeForStackName('9-8-7-abc');

        expect(result).toBe('abc');
      });
    });

    describe('consecutive hyphen handling', () => {
      it('should collapse multiple consecutive hyphens to one', () => {
        const result = sanitizeForStackName('my---template');

        expect(result).toBe('my-template');
      });

      it('should collapse many consecutive hyphens', () => {
        const result = sanitizeForStackName('template------name');

        expect(result).toBe('template-name');
      });

      it('should handle multiple groups of consecutive hyphens', () => {
        const result = sanitizeForStackName('a--b---c----d');

        expect(result).toBe('a-b-c-d');
      });
    });

    describe('trailing hyphen handling', () => {
      it('should remove trailing hyphens', () => {
        const result = sanitizeForStackName('template---');

        expect(result).toBe('template');
      });

      it('should remove single trailing hyphen', () => {
        const result = sanitizeForStackName('template-');

        expect(result).toBe('template');
      });

      it('should remove trailing hyphens after sanitization', () => {
        const result = sanitizeForStackName('template_name.');

        expect(result).toBe('template-name');
      });
    });

    describe('error cases', () => {
      it('should throw error on empty string', () => {
        expect(() => sanitizeForStackName('')).toThrow(StackNameError);
        expect(() => sanitizeForStackName('')).toThrow(
          'Input string cannot be empty or null'
        );
      });

      it('should throw error on whitespace-only string', () => {
        expect(() => sanitizeForStackName('   ')).toThrow(StackNameError);
        expect(() => sanitizeForStackName('   ')).toThrow(
          'Input string cannot be empty or null'
        );
      });

      it('should throw error on tabs and newlines only', () => {
        expect(() => sanitizeForStackName('\t\n\r')).toThrow(StackNameError);
      });

      it('should throw error when sanitization results in empty string', () => {
        expect(() => sanitizeForStackName('!@#$%^&*()')).toThrow(StackNameError);
        expect(() => sanitizeForStackName('!@#$%^&*()')).toThrow(
          'contains no valid characters after sanitization'
        );
      });

      it('should throw error when only numbers and hyphens remain', () => {
        expect(() => sanitizeForStackName('123-456-789')).toThrow(StackNameError);
        expect(() => sanitizeForStackName('123-456-789')).toThrow(
          'contains no valid characters after sanitization'
        );
      });

      it('should throw error when only hyphens remain', () => {
        expect(() => sanitizeForStackName('---')).toThrow(StackNameError);
      });
    });

    describe('complex sanitization scenarios', () => {
      it('should handle combination of all transformations', () => {
        const result = sanitizeForStackName('123_my.template@name!-final_v1.0');

        expect(result).toBe('my-templatename-final-v1-0');
      });

      it('should sanitize file extensions correctly', () => {
        const result = sanitizeForStackName('vpc-setup.yaml');

        expect(result).toBe('vpc-setup-yaml');
      });

      it('should handle CamelCase with special characters', () => {
        const result = sanitizeForStackName('MyTemplate_V2.Final');

        expect(result).toBe('MyTemplate-V2-Final');
      });

      it('should handle paths with slashes', () => {
        const result = sanitizeForStackName('folder/subfolder/template');

        expect(result).toBe('foldersubfoldertemplate');
      });
    });
  });

  describe('generateStackName', () => {
    describe('valid stack name generation', () => {
      it('should generate stack name with simple inputs', () => {
        const result = generateStackName('vpc-setup', 'lease-123');

        expect(result).toBe('isb-vpc-setup-lease-123');
      });

      it('should generate stack name with alphanumeric inputs', () => {
        const result = generateStackName('template1', 'abc456');

        expect(result).toBe('isb-template1-abc456');
      });

      it('should sanitize template name with underscores', () => {
        const result = generateStackName('my_template', 'lease-001');

        expect(result).toBe('isb-my-template-lease-001');
      });

      it('should sanitize template name with dots', () => {
        const result = generateStackName('template.yaml', 'lease-002');

        expect(result).toBe('isb-template-yaml-lease-002');
      });

      it('should sanitize both template name and lease ID', () => {
        const result = generateStackName('my_template.v1', 'lease_id_123');

        expect(result).toBe('isb-my-template-v1-lease-id-123');
      });

      it('should handle uppercase characters', () => {
        const result = generateStackName('MyTemplate', 'LeaseID');

        expect(result).toBe('isb-MyTemplate-LeaseID');
      });
    });

    describe('CloudFormation pattern compliance', () => {
      it('should start with letter (from prefix "isb")', () => {
        const result = generateStackName('template', 'lease-123');

        expect(result).toMatch(/^[a-zA-Z]/);
        expect(result.charAt(0)).toBe('i');
      });

      it('should match CloudFormation pattern [a-zA-Z][-a-zA-Z0-9]*', () => {
        const result = generateStackName('vpc-setup', 'lease-456');

        expect(result).toMatch(/^[a-zA-Z][-a-zA-Z0-9]*$/);
      });

      it('should contain only alphanumeric and hyphens', () => {
        const result = generateStackName('test_template.v1', 'lease_789');

        expect(result).toMatch(/^[a-zA-Z0-9-]+$/);
      });

      it('should not contain consecutive hyphens', () => {
        const result = generateStackName('my___template', 'lease---id');

        expect(result).not.toContain('--');
      });

      it('should not end with hyphen', () => {
        const result = generateStackName('template_', 'lease_');

        expect(result).not.toMatch(/-$/);
      });
    });

    describe('invalid character removal', () => {
      it('should remove special characters from template name', () => {
        const result = generateStackName('my@template#name', 'lease-123');

        expect(result).toBe('isb-mytemplatename-lease-123');
      });

      it('should remove special characters from lease ID', () => {
        const result = generateStackName('template', 'lease@#$123');

        expect(result).toBe('isb-template-lease123');
      });

      it('should handle multiple special characters', () => {
        const result = generateStackName('test!@#$%template', 'lease^&*()id');

        expect(result).toBe('isb-testtemplate-leaseid');
      });
    });

    describe('leading number and hyphen removal', () => {
      it('should remove leading numbers from template name', () => {
        const result = generateStackName('123-template', 'lease-123');

        expect(result).toBe('isb-template-lease-123');
      });

      it('should remove leading numbers from lease ID', () => {
        const result = generateStackName('template', '456-lease');

        expect(result).toBe('isb-template-lease');
      });

      it('should remove leading hyphens from template name', () => {
        const result = generateStackName('---template', 'lease-123');

        expect(result).toBe('isb-template-lease-123');
      });
    });

    describe('maximum length truncation', () => {
      it('should not truncate names under 128 characters', () => {
        const result = generateStackName('short-template', 'lease-123');

        expect(result.length).toBeLessThan(128);
        expect(result).toBe('isb-short-template-lease-123');
      });

      it('should truncate template name when total length exceeds 128', () => {
        const longTemplate = 'a'.repeat(120);
        const leaseId = 'lease-123';
        const result = generateStackName(longTemplate, leaseId);

        expect(result.length).toBe(128);
        expect(result).toContain('lease-123');
        expect(result.startsWith('isb-')).toBe(true);
      });

      it('should prioritize lease ID during truncation', () => {
        const longTemplate = 'template-' + 'x'.repeat(130);
        const leaseId = 'important-lease-id';
        const result = generateStackName(longTemplate, leaseId);

        expect(result.length).toBe(128);
        expect(result).toContain('important-lease-id');
        expect(result.endsWith('important-lease-id')).toBe(true);
      });

      it('should truncate to exactly 128 characters', () => {
        const longTemplate = 'very-long-template-name-' + 'x'.repeat(100);
        const leaseId = 'lease-12345';
        const result = generateStackName(longTemplate, leaseId);

        expect(result.length).toBe(128);
      });

      it('should maintain valid format after truncation', () => {
        const longTemplate = 'template-' + 'a'.repeat(150);
        const leaseId = 'lease-xyz';
        const result = generateStackName(longTemplate, leaseId);

        expect(result).toMatch(/^isb-.*-lease-xyz$/);
        expect(result).toMatch(/^[a-zA-Z][-a-zA-Z0-9]*$/);
      });
    });

    describe('error cases', () => {
      it('should throw error on empty template name', () => {
        expect(() => generateStackName('', 'lease-123')).toThrow(StackNameError);
        expect(() => generateStackName('', 'lease-123')).toThrow(
          'Template name cannot be empty or null'
        );
      });

      it('should throw error on whitespace-only template name', () => {
        expect(() => generateStackName('   ', 'lease-123')).toThrow(StackNameError);
        expect(() => generateStackName('   ', 'lease-123')).toThrow(
          'Template name cannot be empty or null'
        );
      });

      it('should throw error on empty lease ID', () => {
        expect(() => generateStackName('template', '')).toThrow(StackNameError);
        expect(() => generateStackName('template', '')).toThrow(
          'Lease ID cannot be empty or null'
        );
      });

      it('should throw error on whitespace-only lease ID', () => {
        expect(() => generateStackName('template', '   ')).toThrow(StackNameError);
        expect(() => generateStackName('template', '   ')).toThrow(
          'Lease ID cannot be empty or null'
        );
      });

      it('should throw error when template name becomes empty after sanitization', () => {
        expect(() => generateStackName('!@#$%', 'lease-123')).toThrow(StackNameError);
        expect(() => generateStackName('!@#$%', 'lease-123')).toThrow(
          'contains no valid characters after sanitization'
        );
      });

      it('should throw error when lease ID becomes empty after sanitization', () => {
        expect(() => generateStackName('template', '!@#$%')).toThrow(StackNameError);
        expect(() => generateStackName('template', '!@#$%')).toThrow(
          'contains no valid characters after sanitization'
        );
      });

      it('should throw error when lease ID is too long', () => {
        const veryLongLeaseId = 'lease-' + 'x'.repeat(130);

        expect(() => generateStackName('template', veryLongLeaseId)).toThrow(StackNameError);
        expect(() => generateStackName('template', veryLongLeaseId)).toThrow(
          'Lease ID'
        );
        expect(() => generateStackName('template', veryLongLeaseId)).toThrow(
          'too long'
        );
      });
    });

    describe('stack name format validation', () => {
      it('should always start with "isb-" prefix', () => {
        const result = generateStackName('template', 'lease-123');

        expect(result.startsWith('isb-')).toBe(true);
      });

      it('should follow format isb-{template}-{leaseId}', () => {
        const result = generateStackName('mytemplate', 'mylease');

        expect(result).toBe('isb-mytemplate-mylease');
      });

      it('should have three parts separated by hyphens (at minimum)', () => {
        const result = generateStackName('template', 'lease');
        const parts = result.split('-');

        expect(parts.length).toBeGreaterThanOrEqual(3);
        expect(parts[0]).toBe('isb');
      });
    });

    describe('edge cases', () => {
      it('should handle single character template name', () => {
        const result = generateStackName('a', 'lease-123');

        expect(result).toBe('isb-a-lease-123');
      });

      it('should handle single character lease ID', () => {
        const result = generateStackName('template', 'x');

        expect(result).toBe('isb-template-x');
      });

      it('should handle template name with only valid characters', () => {
        const result = generateStackName('ABCdef123', 'XYZ789');

        expect(result).toBe('isb-ABCdef123-XYZ789');
      });

      it('should handle mixed case with numbers', () => {
        const result = generateStackName('Template1V2', 'Lease3ID4');

        expect(result).toBe('isb-Template1V2-Lease3ID4');
      });

      it('should handle template names that are just file extensions', () => {
        const result = generateStackName('.yaml', 'lease-123');

        expect(result).toBe('isb-yaml-lease-123');
      });

      it('should handle very long lease ID that fills most of the limit', () => {
        const leaseId = 'lease-' + 'a'.repeat(100);
        const result = generateStackName('template', leaseId);

        expect(result.length).toBeLessThanOrEqual(128);
        expect(result).toContain(leaseId);
      });

      it('should handle lease ID at boundary of acceptable length', () => {
        // isb- = 3 chars, - = 1 char, template = 8 chars, - = 1 char, total = 13
        // Lease ID can be at most 128 - 13 = 115 chars
        const maxLeaseId = 'a'.repeat(115);
        const result = generateStackName('template', maxLeaseId);

        expect(result.length).toBe(128);
        expect(result).toContain(maxLeaseId);
      });
    });

    describe('real-world scenarios', () => {
      it('should handle AWS CloudFormation template names', () => {
        const result = generateStackName('s3-static-website', 'lease-abc123');

        expect(result).toBe('isb-s3-static-website-lease-abc123');
      });

      it('should handle template with version in name', () => {
        const result = generateStackName('vpc-setup-v2.1', 'lease-xyz789');

        expect(result).toBe('isb-vpc-setup-v2-1-lease-xyz789');
      });

      it('should handle template file names with extensions', () => {
        const result = generateStackName('ec2-instance.template.yaml', 'lease-001');

        expect(result).toBe('isb-ec2-instance-template-yaml-lease-001');
      });

      it('should handle snake_case template names', () => {
        const result = generateStackName('lambda_function_template', 'lease-002');

        expect(result).toBe('isb-lambda-function-template-lease-002');
      });

      it('should handle camelCase template names', () => {
        const result = generateStackName('rdsInstanceTemplate', 'lease-003');

        expect(result).toBe('isb-rdsInstanceTemplate-lease-003');
      });

      it('should handle kebab-case template names', () => {
        const result = generateStackName('api-gateway-setup', 'lease-004');

        expect(result).toBe('isb-api-gateway-setup-lease-004');
      });

      it('should handle UUID-like lease IDs', () => {
        const result = generateStackName('template', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

        expect(result).toBe('isb-template-a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      });

      it('should handle lease IDs with leading letters and numbers', () => {
        const result = generateStackName('template', 'lease12345');

        expect(result).toBe('isb-template-lease12345');
      });

      it('should handle lease IDs with prefixes', () => {
        const result = generateStackName('vpc-template', 'lease-prod-001');

        expect(result).toBe('isb-vpc-template-lease-prod-001');
      });
    });
  });
});
