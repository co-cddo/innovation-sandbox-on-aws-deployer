import type { Config } from '../types/index.js';
import { getConfig } from './config.js';

/**
 * Builds a raw GitHub URL for a CloudFormation template
 *
 * Constructs a URL in the format:
 * https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}/{templateName}/template.yaml
 *
 * @param templateName - Name of the template scenario (e.g., 's3-static-website')
 * @param config - Optional configuration override (defaults to singleton config)
 * @returns Fully qualified URL to the raw template.yaml file
 *
 * @example
 * ```typescript
 * // Using default config
 * buildTemplateUrl('s3-static-website')
 * // Returns: https://raw.githubusercontent.com/co-cddo/ndx_try_aws_scenarios/main/cloudformation/scenarios/s3-static-website/template.yaml
 *
 * // Using custom config
 * buildTemplateUrl('my-template', {
 *   githubRepo: 'my-org/my-repo',
 *   githubBranch: 'develop',
 *   githubPath: 'templates'
 * })
 * // Returns: https://raw.githubusercontent.com/my-org/my-repo/develop/templates/my-template/template.yaml
 * ```
 */
export function buildTemplateUrl(templateName: string, config?: Config): string {
  const cfg = config ?? getConfig();

  // URL encode the template name to handle special characters
  const encodedTemplateName = encodeURIComponent(templateName);

  // Construct the URL with all components
  const parts = [
    'https://raw.githubusercontent.com',
    cfg.githubRepo,
    cfg.githubBranch,
    cfg.githubPath,
    encodedTemplateName,
    'template.yaml',
  ];

  return parts.join('/');
}
