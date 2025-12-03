/**
 * CloudFormation Stack Name Generation Module
 *
 * Generates unique CloudFormation stack names following AWS naming rules:
 * - Must match pattern: [a-zA-Z][-a-zA-Z0-9]*
 * - Must start with a letter
 * - Can contain letters, numbers, and hyphens
 * - Maximum length: 128 characters
 *
 * Format: isb-{templateName}-{leaseId}
 *
 * @module stack-name
 */

const STACK_NAME_MAX_LENGTH = 128;
const STACK_NAME_PREFIX = 'isb';

/**
 * Error thrown when stack name generation fails
 */
export class StackNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StackNameError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Sanitizes a string to be compatible with CloudFormation stack naming rules.
 * Removes all characters that are not letters, numbers, or hyphens.
 * Ensures the result starts with a letter.
 *
 * @param input - The string to sanitize
 * @returns Sanitized string containing only valid characters
 * @throws {StackNameError} If input is empty/null or results in empty string after sanitization
 *
 * @example
 * ```typescript
 * sanitizeForStackName('my_template.yaml') // 'my-template-yaml'
 * sanitizeForStackName('123-invalid') // 'invalid'
 * sanitizeForStackName('VPC-Setup') // 'VPC-Setup'
 * ```
 */
export function sanitizeForStackName(input: string): string {
  if (!input || input.trim().length === 0) {
    throw new StackNameError('Input string cannot be empty or null');
  }

  // Replace underscores and dots with hyphens for readability
  let sanitized = input.replace(/[_.]/g, '-');

  // Remove all characters that are not alphanumeric or hyphens
  sanitized = sanitized.replace(/[^a-zA-Z0-9-]/g, '');

  // Remove leading hyphens and numbers (must start with letter)
  sanitized = sanitized.replace(/^[-0-9]+/, '');

  // Remove multiple consecutive hyphens
  sanitized = sanitized.replace(/-+/g, '-');

  // Remove trailing hyphens
  sanitized = sanitized.replace(/-+$/, '');

  if (sanitized.length === 0) {
    throw new StackNameError(
      `Input string "${input}" contains no valid characters after sanitization`
    );
  }

  return sanitized;
}

/**
 * Generates a unique CloudFormation stack name following AWS naming conventions.
 *
 * Format: isb-{sanitizedTemplateName}-{leaseId}
 *
 * The generated name:
 * - Starts with the prefix 'isb-'
 * - Includes a sanitized version of the template name
 * - Ends with the lease ID
 * - Is truncated to 128 characters if necessary (prioritizing lease ID)
 * - Complies with CloudFormation naming rules: [a-zA-Z][-a-zA-Z0-9]*
 *
 * @param templateName - Name of the CloudFormation template (e.g., 'vpc-setup.yaml')
 * @param leaseId - Unique identifier for the lease
 * @returns A valid CloudFormation stack name
 * @throws {StackNameError} If inputs are invalid or result in invalid stack name
 *
 * @example
 * ```typescript
 * generateStackName('vpc-setup.yaml', 'lease-123')
 * // Returns: 'isb-vpc-setup-yaml-lease-123'
 *
 * generateStackName('My_Template_Name', 'abc-456')
 * // Returns: 'isb-My-Template-Name-abc-456'
 * ```
 */
export function generateStackName(templateName: string, leaseId: string): string {
  if (!templateName || templateName.trim().length === 0) {
    throw new StackNameError('Template name cannot be empty or null');
  }

  if (!leaseId || leaseId.trim().length === 0) {
    throw new StackNameError('Lease ID cannot be empty or null');
  }

  // Sanitize the template name
  const sanitizedTemplate = sanitizeForStackName(templateName);

  // Sanitize the lease ID
  const sanitizedLeaseId = sanitizeForStackName(leaseId);

  // Build the stack name: isb-{template}-{leaseId}
  let stackName = `${STACK_NAME_PREFIX}-${sanitizedTemplate}-${sanitizedLeaseId}`;

  // Truncate if necessary, prioritizing the lease ID
  if (stackName.length > STACK_NAME_MAX_LENGTH) {
    // Calculate how much space we have for the template name
    // Format: isb-{template}-{leaseId}
    // Required: prefix (3) + hyphen (1) + leaseId + hyphen (1)
    const requiredSpace = STACK_NAME_PREFIX.length + 1 + sanitizedLeaseId.length + 1;
    const availableForTemplate = STACK_NAME_MAX_LENGTH - requiredSpace;

    if (availableForTemplate <= 0) {
      throw new StackNameError(
        `Lease ID "${leaseId}" is too long. Maximum allowed length for stack name is ${STACK_NAME_MAX_LENGTH} characters`
      );
    }

    // Truncate the template name to fit
    const truncatedTemplate = sanitizedTemplate.substring(0, availableForTemplate);
    stackName = `${STACK_NAME_PREFIX}-${truncatedTemplate}-${sanitizedLeaseId}`;
  }

  // Final validation: ensure it starts with a letter
  if (!/^[a-zA-Z]/.test(stackName)) {
    throw new StackNameError(
      `Generated stack name "${stackName}" does not start with a letter`
    );
  }

  // Final validation: ensure it matches the CloudFormation pattern
  if (!/^[a-zA-Z][-a-zA-Z0-9]*$/.test(stackName)) {
    throw new StackNameError(
      `Generated stack name "${stackName}" contains invalid characters. Must match pattern: [a-zA-Z][-a-zA-Z0-9]*`
    );
  }

  return stackName;
}
