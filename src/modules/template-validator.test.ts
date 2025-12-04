/**
 * Tests for CloudFormation Template Validation Module
 */

import { describe, it, expect } from 'vitest';
import {
  validateTemplate,
  TemplateValidationError,
  type ValidatedTemplate,
} from './template-validator';

describe('validateTemplate', () => {
  describe('Valid Templates', () => {
    it('should validate a template with AWSTemplateFormatVersion and Resources', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Description: Test template
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

      const result = validateTemplate(yamlContent);

      expect(result).toBeDefined();
      expect(result.template).toBeDefined();
      expect(result.template.AWSTemplateFormatVersion).toBe('2010-09-09');
      expect(result.template.Resources).toBeDefined();
      expect(result.hasParameters).toBe(false);
      expect(result.parameters).toEqual([]);
    });

    it('should validate a template with only AWSTemplateFormatVersion (no Resources)', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Description: Minimal template
`;

      const result = validateTemplate(yamlContent);

      expect(result).toBeDefined();
      expect(result.template.AWSTemplateFormatVersion).toBe('2010-09-09');
      expect(result.hasParameters).toBe(false);
    });

    it('should validate a template with only Resources (no AWSTemplateFormatVersion)', () => {
      const yamlContent = `
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-test-bucket
`;

      const result = validateTemplate(yamlContent);

      expect(result).toBeDefined();
      expect(result.template.Resources).toBeDefined();
      expect(result.template.AWSTemplateFormatVersion).toBeUndefined();
      expect(result.hasParameters).toBe(false);
    });

    it('should extract parameters from Parameters section', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Parameters:
  BucketName:
    Type: String
    Description: Name of the S3 bucket
  Environment:
    Type: String
    Default: dev
  LeaseId:
    Type: String
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

      const result = validateTemplate(yamlContent);

      expect(result.hasParameters).toBe(true);
      expect(result.parameters).toHaveLength(3);
      expect(result.parameters).toContain('BucketName');
      expect(result.parameters).toContain('Environment');
      expect(result.parameters).toContain('LeaseId');
    });

    it('should handle template with empty Parameters section', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Parameters:
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

      const result = validateTemplate(yamlContent);

      // Empty Parameters section (null/undefined) should not be considered as having parameters
      expect(result.hasParameters).toBe(false);
      expect(result.parameters).toEqual([]);
    });

    it('should handle template with complex nested structure', () => {
      // Note: CloudFormation intrinsic functions like !Ref are CloudFormation-specific
      // and not standard YAML. We test basic structure without intrinsic functions.
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Description: Complex template
Metadata:
  AWS::CloudFormation::Interface:
    ParameterGroups:
      - Label:
          default: Network Configuration
Parameters:
  VpcCidr:
    Type: String
Mappings:
  RegionMap:
    us-west-2:
      AMI: ami-12345
Conditions:
  IsProduction:
    Fn::Equals:
      - Ref: Environment
      - prod
Resources:
  MyVPC:
    Type: AWS::EC2::VPC
Outputs:
  VpcId:
    Value:
      Ref: MyVPC
`;

      const result = validateTemplate(yamlContent);

      expect(result.template.AWSTemplateFormatVersion).toBe('2010-09-09');
      expect(result.template.Metadata).toBeDefined();
      expect(result.template.Mappings).toBeDefined();
      expect(result.template.Conditions).toBeDefined();
      expect(result.template.Outputs).toBeDefined();
      expect(result.hasParameters).toBe(true);
      expect(result.parameters).toEqual(['VpcCidr']);
    });
  });

  describe('Invalid YAML Syntax', () => {
    it('should throw error for invalid YAML syntax', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties: [unclosed bracket
`;

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
      expect(() => validateTemplate(yamlContent)).toThrow(/Failed to parse YAML/);
    });

    it('should throw error for malformed indentation', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
   Properties:
     BucketName: test
`;

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
      expect(() => validateTemplate(yamlContent)).toThrow(/Failed to parse YAML/);
    });

    it('should throw error for invalid YAML characters', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Resources: @#$%^&*
`;

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
    });
  });

  describe('Invalid Template Structure', () => {
    it('should throw error for empty string', () => {
      expect(() => validateTemplate('')).toThrow(TemplateValidationError);
      expect(() => validateTemplate('')).toThrow(/Template content cannot be empty/);
    });

    it('should throw error for whitespace-only content', () => {
      expect(() => validateTemplate('   \n\t  ')).toThrow(TemplateValidationError);
      expect(() => validateTemplate('   \n\t  ')).toThrow(/Template content cannot be empty/);
    });

    it('should throw error for template with only comments', () => {
      const yamlContent = `
# This is a comment
# Another comment
`;

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
      expect(() => validateTemplate(yamlContent)).toThrow(
        /Template is empty or contains only comments/
      );
    });

    it('should throw error for YAML array instead of object', () => {
      const yamlContent = `
- item1
- item2
- item3
`;

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
      expect(() => validateTemplate(yamlContent)).toThrow(
        /Template must be a YAML object, got array/
      );
    });

    it('should throw error for YAML string instead of object', () => {
      const yamlContent = 'just a plain string';

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
      expect(() => validateTemplate(yamlContent)).toThrow(
        /Template must be a YAML object, got string/
      );
    });

    it('should throw error for YAML number instead of object', () => {
      const yamlContent = '12345';

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
      expect(() => validateTemplate(yamlContent)).toThrow(
        /Template must be a YAML object, got number/
      );
    });

    it('should throw error for template missing both AWSTemplateFormatVersion and Resources', () => {
      const yamlContent = `
Description: Invalid template
Parameters:
  BucketName:
    Type: String
`;

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
      expect(() => validateTemplate(yamlContent)).toThrow(
        /Template must contain either AWSTemplateFormatVersion or Resources section/
      );
    });

    it('should throw error for template with empty object', () => {
      const yamlContent = '{}';

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
      expect(() => validateTemplate(yamlContent)).toThrow(
        /Template must contain either AWSTemplateFormatVersion or Resources section/
      );
    });

    it('should throw error for invalid Parameters section (array)', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Parameters:
  - param1
  - param2
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
      expect(() => validateTemplate(yamlContent)).toThrow(/Parameters section must be an object/);
    });

    it('should throw error for invalid Parameters section (string)', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Parameters: "invalid"
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

      expect(() => validateTemplate(yamlContent)).toThrow(TemplateValidationError);
      expect(() => validateTemplate(yamlContent)).toThrow(/Parameters section must be an object/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle template with null values', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Description: null
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

      const result = validateTemplate(yamlContent);

      expect(result.template.Description).toBeNull();
      expect(result.template.Resources).toBeDefined();
    });

    it('should handle template with boolean values', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        IgnorePublicAcls: false
`;

      const result = validateTemplate(yamlContent);

      expect(result.template.Resources).toBeDefined();
    });

    it('should handle template with special characters in parameter names', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Parameters:
  Environment-Name:
    Type: String
  Budget_Amount:
    Type: Number
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

      const result = validateTemplate(yamlContent);

      expect(result.hasParameters).toBe(true);
      expect(result.parameters).toContain('Environment-Name');
      expect(result.parameters).toContain('Budget_Amount');
    });

    it('should handle template with unicode characters', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Description: Template with unicode chars ñ é ü 中文
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

      const result = validateTemplate(yamlContent);

      expect(result.template.Description).toContain('ñ');
      expect(result.template.Description).toContain('中文');
    });

    it('should handle very long template', () => {
      // Generate a template with many resources
      const resources = Array.from(
        { length: 100 },
        (_, i) => `
  Bucket${i}:
    Type: AWS::S3::Bucket`
      ).join('');

      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Resources:${resources}
`;

      const result = validateTemplate(yamlContent);

      expect(result.template.Resources).toBeDefined();
      const resourcesObj = result.template.Resources as Record<string, unknown>;
      expect(Object.keys(resourcesObj)).toHaveLength(100);
    });
  });

  describe('TemplateValidationError', () => {
    it('should create error with message only', () => {
      const error = new TemplateValidationError('Test error message');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TemplateValidationError);
      expect(error.name).toBe('TemplateValidationError');
      expect(error.message).toBe('Test error message');
      expect(error.cause).toBeUndefined();
    });

    it('should create error with message and cause', () => {
      const originalError = new Error('Original error');
      const error = new TemplateValidationError('Wrapped error', originalError);

      expect(error.name).toBe('TemplateValidationError');
      expect(error.message).toBe('Wrapped error');
      expect(error.cause).toBe(originalError);
    });

    it('should have proper stack trace', () => {
      const error = new TemplateValidationError('Test error');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('TemplateValidationError');
    });
  });

  describe('Return Type Validation', () => {
    it('should return ValidatedTemplate interface', () => {
      const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Parameters:
  Param1:
    Type: String
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

      const result: ValidatedTemplate = validateTemplate(yamlContent);

      // Check type structure
      expect(result).toHaveProperty('template');
      expect(result).toHaveProperty('parameters');
      expect(result).toHaveProperty('hasParameters');
      expect(typeof result.template).toBe('object');
      expect(Array.isArray(result.parameters)).toBe(true);
      expect(typeof result.hasParameters).toBe('boolean');
    });
  });
});
