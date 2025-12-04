/**
 * Template Fetcher Module
 *
 * Fetches CloudFormation template YAML files from GitHub using native fetch API.
 * Implements timeout handling and comprehensive error management.
 */

/**
 * Custom error class for template fetch failures
 */
export class TemplateFetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string
  ) {
    super(message);
    this.name = 'TemplateFetchError';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TemplateFetchError);
    }
  }
}

/**
 * Timeout duration for HTTP requests in milliseconds
 */
export const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetches a CloudFormation template from a given URL
 *
 * Uses native Node.js fetch with a 5-second timeout. Returns the raw YAML content
 * as a string if successful.
 *
 * @param url - The full URL to the template.yaml file
 * @returns Promise resolving to the template content as a string
 * @throws {TemplateFetchError} If the fetch fails, times out, or returns an error status
 *
 * @example
 * ```typescript
 * try {
 *   const template = await fetchTemplate('https://raw.githubusercontent.com/...');
 *   console.log('Fetched template:', template);
 * } catch (error) {
 *   if (error instanceof TemplateFetchError) {
 *     console.error(`Failed to fetch template: ${error.message}`, error.statusCode);
 *   }
 * }
 * ```
 */
export async function fetchTemplate(url: string): Promise<string> {
  // Create an AbortController for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Fetch the template with timeout signal
    const response = await fetch(url, {
      signal: controller.signal,
    });

    // Clear the timeout since fetch completed
    clearTimeout(timeoutId);

    // Handle HTTP error responses
    if (!response.ok) {
      throw new TemplateFetchError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        url
      );
    }

    // Read and return the response body as text
    const content = await response.text();
    return content;
  } catch (error) {
    // Clear timeout in case of error
    clearTimeout(timeoutId);

    // Handle abort (timeout) errors
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TemplateFetchError(`Request timed out after ${FETCH_TIMEOUT_MS}ms`, undefined, url);
    }

    // Re-throw TemplateFetchError instances
    if (error instanceof TemplateFetchError) {
      throw error;
    }

    // Handle other network errors
    if (error instanceof Error) {
      throw new TemplateFetchError(`Network error: ${error.message}`, undefined, url);
    }

    // Handle unknown errors
    throw new TemplateFetchError(
      `Unknown error fetching template: ${String(error)}`,
      undefined,
      url
    );
  }
}
