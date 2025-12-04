/**
 * CloudFormation Template Validation Module
 *
 * Validates CloudFormation template YAML structure and extracts parameters.
 * Ensures templates contain required CloudFormation sections before deployment.
 */

import yaml from 'js-yaml';

/**
 * CloudFormation intrinsic function tags that need custom handling
 * These are treated as passthrough types that preserve their structure
 */
const CF_INTRINSIC_TAGS = [
  '!Ref',
  '!Sub',
  '!GetAtt',
  '!Join',
  '!Select',
  '!Split',
  '!If',
  '!Not',
  '!Equals',
  '!And',
  '!Or',
  '!Condition',
  '!Base64',
  '!Cidr',
  '!FindInMap',
  '!GetAZs',
  '!ImportValue',
  '!Transform',
];

/**
 * Create custom YAML types for CloudFormation intrinsic functions
 * These handlers preserve the tag and value as an object
 */
const cfTypes = CF_INTRINSIC_TAGS.flatMap((tag) => [
  new yaml.Type(tag, {
    kind: 'scalar',
    construct: (data: unknown) => ({ [tag.substring(1)]: data }),
  }),
  new yaml.Type(tag, {
    kind: 'sequence',
    construct: (data: unknown) => ({ [tag.substring(1)]: data }),
  }),
  new yaml.Type(tag, {
    kind: 'mapping',
    construct: (data: unknown) => ({ [tag.substring(1)]: data }),
  }),
]);

/**
 * Custom YAML schema that extends the default schema with CloudFormation intrinsic functions
 */
const CF_SCHEMA = yaml.DEFAULT_SCHEMA.extend(cfTypes);

/**
 * Custom error class for template validation failures
 */
export class TemplateValidationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'TemplateValidationError';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TemplateValidationError);
    }
  }
}

/**
 * Result of template validation
 */
export interface ValidatedTemplate {
  /** Parsed template as JavaScript object */
  template: Record<string, unknown>;
  /** List of parameter names extracted from Parameters section */
  parameters: string[];
  /** Whether the template has a Parameters section */
  hasParameters: boolean;
}

/**
 * Validates a CloudFormation template YAML string
 *
 * Performs the following validation:
 * 1. Parses YAML content into JavaScript object
 * 2. Validates template is an object (not array, string, etc.)
 * 3. Validates template has either AWSTemplateFormatVersion or Resources section
 * 4. Extracts parameter names from Parameters section if present
 *
 * @param yamlContent - Raw YAML content as a string
 * @returns ValidatedTemplate with parsed template and parameter information
 * @throws {TemplateValidationError} If YAML is invalid or doesn't meet CloudFormation requirements
 *
 * @example
 * ```typescript
 * const yamlContent = `
 * AWSTemplateFormatVersion: '2010-09-09'
 * Parameters:
 *   BucketName:
 *     Type: String
 * Resources:
 *   MyBucket:
 *     Type: AWS::S3::Bucket
 * `;
 * const validated = validateTemplate(yamlContent);
 * // validated.parameters => ['BucketName']
 * // validated.hasParameters => true
 * ```
 */
export function validateTemplate(yamlContent: string): ValidatedTemplate {
  // Validate input
  if (!yamlContent || yamlContent.trim().length === 0) {
    throw new TemplateValidationError('Template content cannot be empty');
  }

  // Parse YAML content using CloudFormation-aware schema
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlContent, { schema: CF_SCHEMA });
  } catch (error) {
    // Handle YAML parsing errors
    if (error instanceof Error) {
      throw new TemplateValidationError(
        `Failed to parse YAML: ${error.message}`,
        error
      );
    }
    throw new TemplateValidationError(
      `Failed to parse YAML: ${String(error)}`,
      error
    );
  }

  // Validate parsed content is not null/undefined
  if (parsed === null || parsed === undefined) {
    throw new TemplateValidationError(
      'Template is empty or contains only comments'
    );
  }

  // Validate parsed content is an object
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TemplateValidationError(
      `Template must be a YAML object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`
    );
  }

  // Type assertion now that we've validated it's a non-null, non-array object
  const template = parsed as Record<string, unknown>;

  // Validate required CloudFormation structure
  // Template must have either AWSTemplateFormatVersion or Resources section
  const hasFormatVersion = 'AWSTemplateFormatVersion' in template;
  const hasResources = 'Resources' in template;

  if (!hasFormatVersion && !hasResources) {
    throw new TemplateValidationError(
      'Template must contain either AWSTemplateFormatVersion or Resources section'
    );
  }

  // Extract parameters if Parameters section exists
  const parameters: string[] = [];
  let hasParameters = false;

  if ('Parameters' in template) {
    const parametersSection = template.Parameters;

    // Validate Parameters section is an object
    if (
      parametersSection &&
      typeof parametersSection === 'object' &&
      !Array.isArray(parametersSection)
    ) {
      hasParameters = true;
      parameters.push(...Object.keys(parametersSection as Record<string, unknown>));
    } else if (parametersSection !== null && parametersSection !== undefined) {
      // Parameters section exists but is not a valid object
      throw new TemplateValidationError(
        'Parameters section must be an object'
      );
    }
  }

  return {
    template,
    parameters,
    hasParameters,
  };
}
