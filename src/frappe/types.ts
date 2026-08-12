export type FrappeHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type FetchImplementation = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface FrappeApiClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly fetch?: FetchImplementation;
}

export class FrappeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrappeError';
  }
}

export class FrappeConfigError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'FrappeConfigError';
  }
}

export class FrappePathError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'FrappePathError';
  }
}

export class FrappeHttpError extends FrappeError {
  readonly status: number;
  readonly method: FrappeHttpMethod;
  readonly path: string;

  constructor(
    status: number,
    method: FrappeHttpMethod,
    path: string,
    message?: string
  ) {
    super(
      message ??
        `Frappe HTTP request failed with status ${status} (${method} ${path})`
    );
    this.name = 'FrappeHttpError';
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

export class FrappeTransportError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'FrappeTransportError';
  }
}

export class FrappeParseError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'FrappeParseError';
  }
}

export class FrappeRequestError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'FrappeRequestError';
  }
}

export type FrappeDocument = Readonly<Record<string, unknown>>;

export type FrappeFilter = readonly [
  field: string,
  operator: string,
  value: unknown
];

export interface FrappeListOptions {
  readonly fields?: readonly string[];
  readonly filters?: readonly FrappeFilter[];
  readonly orFilters?: readonly FrappeFilter[];
  readonly orderBy?: string;
  readonly limitStart?: number;
  readonly limitPageLength?: number;
}

export class FrappeResourceError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'FrappeResourceError';
  }
}

export class FrappeResponseError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'FrappeResponseError';
  }
}


