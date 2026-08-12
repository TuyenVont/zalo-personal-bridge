import {
  FrappeConfigError,
  FrappeHttpError,
  FrappeParseError,
  FrappePathError,
  FrappeRequestError,
  FrappeTransportError,
  type FetchImplementation,
  type FrappeApiClientOptions,
  type FrappeHttpMethod,
} from './types.js';

export class FrappeApiClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #apiSecret: string;
  readonly #fetchImpl: FetchImplementation;

  constructor(options: FrappeApiClientOptions) {
    if (!options || typeof options !== 'object') {
      throw new FrappeConfigError('Options must be a valid configuration object');
    }

    const { baseUrl, apiKey, apiSecret, fetch: customFetch } = options;

    // Validate baseUrl
    if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
      throw new FrappeConfigError('baseUrl must be a non-empty string');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new FrappeConfigError('Invalid baseUrl format');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new FrappeConfigError('baseUrl protocol must be http: or https:');
    }

    if (!parsedUrl.hostname) {
      throw new FrappeConfigError('baseUrl must include a hostname');
    }

    if (parsedUrl.username || parsedUrl.password) {
      throw new FrappeConfigError('baseUrl must not contain credentials');
    }

    if (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') {
      throw new FrappeConfigError('baseUrl pathname must be root (no subpaths permitted)');
    }

    if (parsedUrl.search !== '') {
      throw new FrappeConfigError('baseUrl must not contain query parameters');
    }

    if (parsedUrl.hash !== '') {
      throw new FrappeConfigError('baseUrl must not contain a URL hash/fragment');
    }

    this.#baseUrl = parsedUrl.origin;

    // Validate apiKey
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new FrappeConfigError('apiKey must be a non-empty string');
    }
    this.#apiKey = apiKey;

    // Validate apiSecret
    if (typeof apiSecret !== 'string' || apiSecret.trim().length === 0) {
      throw new FrappeConfigError('apiSecret must be a non-empty string');
    }
    this.#apiSecret = apiSecret;

    // Validate fetch implementation
    const fetchImpl = customFetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new FrappeConfigError('No fetch implementation available');
    }
    this.#fetchImpl = fetchImpl;
  }

  async request<T>(
    method: FrappeHttpMethod,
    path: string,
    body?: unknown
  ): Promise<T | null> {
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      throw new FrappePathError(`Unsupported HTTP method: ${method}`);
    }

    this.#validatePath(path);

    const fullUrlString = this.#baseUrl + path;
    const targetUrl = new URL(fullUrlString);
    const baseOrigin = new URL(this.#baseUrl).origin;

    if (
      targetUrl.origin !== baseOrigin ||
      !targetUrl.pathname.startsWith('/api/')
    ) {
      throw new FrappePathError(
        'Request path is outside configured baseUrl origin or API scope'
      );
    }

    const headers: Record<string, string> = {
      Authorization: `token ${this.#apiKey}:${this.#apiSecret}`,
      Accept: 'application/json',
    };

    let reqBody: string | undefined = undefined;
    if ((method === 'POST' || method === 'PUT') && body !== undefined) {
      try {
        const serialized = JSON.stringify(body);
        if (typeof serialized !== 'string') {
          throw new FrappeRequestError(
            'Failed to serialize request body to JSON'
          );
        }
        reqBody = serialized;
      } catch (err: unknown) {
        if (err instanceof FrappeRequestError) {
          throw err;
        }
        throw new FrappeRequestError(
          'Failed to serialize request body to JSON'
        );
      }
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await this.#fetchImpl(targetUrl.toString(), {
        method,
        headers,
        body: reqBody,
      });
    } catch {
      throw new FrappeTransportError('Frappe HTTP transport request failed');
    }

    if (!response.ok) {
      throw new FrappeHttpError(response.status, method, path);
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new FrappeTransportError('Failed to read Frappe response body');
    }

    if (!text || text.trim().length === 0) {
      return null;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new FrappeParseError(
        'Failed to parse successful Frappe response as JSON'
      );
    }
  }

  async get<T>(path: string): Promise<T | null> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T | null> {
    return this.request<T>('POST', path, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T | null> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T>(path: string): Promise<T | null> {
    return this.request<T>('DELETE', path);
  }

  #validatePath(path: string): void {
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new FrappePathError('Request path must be a non-empty string');
    }

    if (
      !path.startsWith('/api/') ||
      path.startsWith('//') ||
      path.includes('://')
    ) {
      throw new FrappePathError(
        'Request path must be a relative site API path starting with /api/'
      );
    }
  }
}
