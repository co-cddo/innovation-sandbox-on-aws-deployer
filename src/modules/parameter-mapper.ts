import type { LeaseDetails } from './lease-lookup.js';
import type { CloudFormationParameter } from './stack-deployer.js';

/**
 * Custom error class for parameter mapping failures
 */
export class ParameterMappingError extends Error {
  constructor(
    message: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'ParameterMappingError';
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ParameterMappingError);
    }
  }
}

/**
 * Mapping configuration between CloudFormation parameter names and LeaseDetails properties
 *
 * This mapping supports common parameter naming conventions:
 * - AccountId, Account, AWSAccountId -> accountId
 * - LeaseId, Lease -> leaseId
 * - Budget, BudgetAmount -> budgetAmount
 * - RequesterEmail, Email, UserEmail -> requesterEmail
 * - ExpirationDate, Expiration, LeaseExpiration -> expirationDate
 * - TemplateName, Template -> templateName
 * - Status, LeaseStatus -> status
 */
const PARAMETER_MAPPINGS: Record<string, keyof LeaseDetails> = {
  // Account ID mappings
  AccountId: 'accountId',
  Account: 'accountId',
  AWSAccountId: 'accountId',
  AwsAccountId: 'accountId',

  // Lease ID mappings
  LeaseId: 'leaseId',
  Lease: 'leaseId',

  // Budget mappings
  Budget: 'budgetAmount',
  BudgetAmount: 'budgetAmount',

  // Email mappings
  RequesterEmail: 'requesterEmail',
  Email: 'requesterEmail',
  UserEmail: 'requesterEmail',

  // Expiration date mappings
  ExpirationDate: 'expirationDate',
  Expiration: 'expirationDate',
  LeaseExpiration: 'expirationDate',

  // Template name mappings
  TemplateName: 'templateName',
  Template: 'templateName',

  // Status mappings
  Status: 'status',
  LeaseStatus: 'status',
};

/**
 * Maps lease details to CloudFormation parameters based on template requirements
 *
 * This function:
 * - Takes lease details and a list of CloudFormation parameter names from the template
 * - Maps template parameter names to corresponding lease attributes using PARAMETER_MAPPINGS
 * - Converts all values to strings (CloudFormation requirement)
 * - Handles numeric values (like budgetAmount) by converting to string
 * - Skips parameters gracefully if:
 *   - No mapping exists for the parameter name
 *   - The mapped lease attribute is undefined or null
 *   - The mapped lease attribute is an empty string
 * - Returns an array of CloudFormationParameter objects ready for stack deployment
 *
 * @param leaseDetails - Lease information from DynamoDB lookup
 * @param templateParameters - List of parameter names required by the CloudFormation template
 * @returns Array of CloudFormation parameters with ParameterKey and ParameterValue
 *
 * @example
 * ```typescript
 * const lease = {
 *   leaseId: 'lease-12345',
 *   accountId: '123456789012',
 *   budgetAmount: 1000,
 *   requesterEmail: 'user@example.com'
 * };
 *
 * const templateParams = ['LeaseId', 'AccountId', 'Budget', 'Email', 'UnknownParam'];
 * const cfnParams = mapParameters(lease, templateParams);
 * // Returns:
 * // [
 * //   { ParameterKey: 'LeaseId', ParameterValue: 'lease-12345' },
 * //   { ParameterKey: 'AccountId', ParameterValue: '123456789012' },
 * //   { ParameterKey: 'Budget', ParameterValue: '1000' },
 * //   { ParameterKey: 'Email', ParameterValue: 'user@example.com' }
 * // ]
 * // Note: 'UnknownParam' is skipped because there's no mapping
 * ```
 */
export function mapParameters(
  leaseDetails: LeaseDetails,
  templateParameters: string[]
): CloudFormationParameter[] {
  const parameters: CloudFormationParameter[] = [];

  for (const parameterName of templateParameters) {
    // Check if we have a mapping for this parameter
    const leasePropertyName = PARAMETER_MAPPINGS[parameterName];

    if (!leasePropertyName) {
      // No mapping exists - skip this parameter gracefully
      continue;
    }

    // Get the value from lease details
    const value = leaseDetails[leasePropertyName];

    // Skip if value is undefined, null, or empty string
    if (value === undefined || value === null || value === '') {
      continue;
    }

    // Convert value to string (CloudFormation parameters are always strings)
    const stringValue = String(value);

    parameters.push({
      ParameterKey: parameterName,
      ParameterValue: stringValue,
    });
  }

  return parameters;
}
