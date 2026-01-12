/**
 * Template Reference Parser Module
 *
 * Parses template names that may include branch specifiers using @ syntax.
 * Validates both the template name and branch name components for security.
 *
 * Syntax:
 * - "template-name" - Uses default branch from config.githubBranch
 * - "template-name@branch" - Uses specified branch override
 *
 * @example
 * parseTemplateRef('localgov-drupal')
 * // Returns: { name: 'localgov-drupal', branch: undefined }
 *
 * parseTemplateRef('localgov-drupal@feature-branch')
 * // Returns: { name: 'localgov-drupal', branch: 'feature-branch' }
 */

import type { TemplateRef } from '../types/index.js';

/**
 * Error thrown when template reference parsing fails
 *
 * This error indicates that the template reference string is malformed
 * or contains invalid characters that could be security risks.
 */
export class TemplateRefParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateRefParseError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TemplateRefParseError);
    }
  }
}

/**
 * Regex for valid template names
 * - Must start with alphanumeric
 * - Can contain alphanumeric, dashes, underscores
 * - Cannot contain dots, slashes, or other special characters
 */
const TEMPLATE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const MAX_TEMPLATE_NAME_LENGTH = 100;

/**
 * Regex for valid Git branch names
 * Git branch rules:
 * - Cannot start with dot, slash, or dash
 * - Cannot contain: space, ~, ^, :, ?, *, [, \, control chars
 * - Cannot end with .lock
 * - Cannot contain consecutive dots (..) or slashes (//)
 */
const BRANCH_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
const MAX_BRANCH_NAME_LENGTH = 256;

/**
 * Validates a template name component
 *
 * Template names are used in:
 * - GitHub API URLs
 * - File system paths
 * - CloudFormation stack names
 *
 * @param name - Template name to validate
 * @throws {TemplateRefParseError} If name is invalid
 */
function validateTemplateName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new TemplateRefParseError('Template name cannot be empty');
  }

  if (!TEMPLATE_NAME_REGEX.test(name)) {
    throw new TemplateRefParseError(
      `Invalid template name: ${name}. Must start with alphanumeric and contain only alphanumeric characters, dashes, and underscores.`
    );
  }

  if (name.length > MAX_TEMPLATE_NAME_LENGTH) {
    throw new TemplateRefParseError(
      `Template name too long (max ${MAX_TEMPLATE_NAME_LENGTH} characters)`
    );
  }
}

/**
 * Validates a branch name component
 *
 * Branch names are used in:
 * - GitHub API ref parameter
 * - Git checkout commands
 * - Raw GitHub URLs
 *
 * @param branch - Branch name to validate
 * @throws {TemplateRefParseError} If branch is invalid
 */
function validateBranchName(branch: string): void {
  if (!branch || branch.length === 0) {
    throw new TemplateRefParseError('Branch name cannot be empty');
  }

  if (branch.length > MAX_BRANCH_NAME_LENGTH) {
    throw new TemplateRefParseError(
      `Branch name too long (max ${MAX_BRANCH_NAME_LENGTH} characters)`
    );
  }

  if (!BRANCH_NAME_REGEX.test(branch)) {
    throw new TemplateRefParseError(
      `Invalid branch name: ${branch}. Must contain only alphanumeric characters, dots, dashes, underscores, and slashes.`
    );
  }

  // Additional security checks for dangerous patterns
  if (branch.includes('..') || branch.includes('//')) {
    throw new TemplateRefParseError(
      `Invalid branch name: ${branch}. Cannot contain consecutive dots or slashes.`
    );
  }

  if (branch.endsWith('.lock')) {
    throw new TemplateRefParseError(`Invalid branch name: ${branch}. Cannot end with .lock.`);
  }
}

/**
 * Parses a template reference string into name and optional branch components
 *
 * Supports two formats:
 * - "template-name" - Uses default branch from config
 * - "template-name@branch" - Uses specified branch override
 *
 * @param templateRef - Template reference string (e.g., "localgov-drupal@v2.0")
 * @returns Parsed TemplateRef with name and optional branch
 * @throws {TemplateRefParseError} If parsing or validation fails
 *
 * @example
 * parseTemplateRef('localgov-drupal')
 * // Returns: { name: 'localgov-drupal', branch: undefined }
 *
 * parseTemplateRef('localgov-drupal@feature-branch')
 * // Returns: { name: 'localgov-drupal', branch: 'feature-branch' }
 *
 * parseTemplateRef('my-app@feature/new-feature')
 * // Returns: { name: 'my-app', branch: 'feature/new-feature' }
 */
export function parseTemplateRef(templateRef: string): TemplateRef {
  if (!templateRef || templateRef.trim().length === 0) {
    throw new TemplateRefParseError('Template reference cannot be empty');
  }

  // Check for @ delimiter
  const atIndex = templateRef.indexOf('@');

  if (atIndex === -1) {
    // No branch specifier - just validate the template name
    validateTemplateName(templateRef);
    return { name: templateRef };
  }

  // Handle edge cases
  if (atIndex === 0) {
    throw new TemplateRefParseError('Invalid template reference: cannot start with @');
  }

  if (atIndex === templateRef.length - 1) {
    throw new TemplateRefParseError(
      'Invalid template reference: branch name cannot be empty after @'
    );
  }

  // Split on first @ only (branch names shouldn't contain @ but we're defensive)
  const name = templateRef.substring(0, atIndex);
  const branch = templateRef.substring(atIndex + 1);

  // Validate both components
  validateTemplateName(name);
  validateBranchName(branch);

  return { name, branch };
}

/**
 * Resolves the effective branch for a template reference
 *
 * Returns the branch override if specified, otherwise the default branch.
 *
 * @param templateRef - Parsed template reference
 * @param defaultBranch - Default branch from configuration (config.githubBranch)
 * @returns Effective branch to use for GitHub operations
 *
 * @example
 * resolveEffectiveBranch({ name: 'app', branch: 'feature' }, 'main')
 * // Returns: 'feature'
 *
 * resolveEffectiveBranch({ name: 'app' }, 'main')
 * // Returns: 'main'
 */
export function resolveEffectiveBranch(templateRef: TemplateRef, defaultBranch: string): string {
  return templateRef.branch ?? defaultBranch;
}
