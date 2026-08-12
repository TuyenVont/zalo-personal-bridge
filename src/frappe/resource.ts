import type { FrappeApiClient } from './client.js';
import {
  FrappeResourceError,
  FrappeResponseError,
  type FrappeDocument,
  type FrappeFilter,
  type FrappeListOptions,
} from './types.js';

export class FrappeResourceClient {
  readonly #client: FrappeApiClient;

  constructor(client: FrappeApiClient) {
    if (!client || typeof (client as FrappeApiClient).request !== 'function') {
      throw new FrappeResourceError(
        'Client must be a valid FrappeApiClient instance'
      );
    }
    this.#client = client;
  }

  async list<T extends Record<string, unknown> = FrappeDocument>(
    doctype: string,
    options?: FrappeListOptions
  ): Promise<T[]> {
    const validatedDoctype = this.#validateDoctype(doctype);
    const queryString = this.#buildQueryString(options);
    const path = `/api/resource/${encodeURIComponent(validatedDoctype)}${queryString}`;

    const res = await this.#client.get<unknown>(path);
    return this.#unwrapListEnvelope<T>(res);
  }

  async get<T extends Record<string, unknown> = FrappeDocument>(
    doctype: string,
    name: string
  ): Promise<T> {
    const validatedDoctype = this.#validateDoctype(doctype);
    const validatedName = this.#validateName(name);
    const path = `/api/resource/${encodeURIComponent(validatedDoctype)}/${encodeURIComponent(validatedName)}`;

    const res = await this.#client.get<unknown>(path);
    return this.#unwrapSingleEnvelope<T>(res);
  }

  async create<T extends Record<string, unknown> = FrappeDocument>(
    doctype: string,
    doc: Readonly<Record<string, unknown>>
  ): Promise<T> {
    const validatedDoctype = this.#validateDoctype(doctype);
    this.#validateBody(doc, 'create');
    const path = `/api/resource/${encodeURIComponent(validatedDoctype)}`;

    const res = await this.#client.post<unknown>(path, doc);
    return this.#unwrapSingleEnvelope<T>(res);
  }

  async update<T extends Record<string, unknown> = FrappeDocument>(
    doctype: string,
    name: string,
    fields: Readonly<Record<string, unknown>>
  ): Promise<T> {
    const validatedDoctype = this.#validateDoctype(doctype);
    const validatedName = this.#validateName(name);
    this.#validateBody(fields, 'update');
    const path = `/api/resource/${encodeURIComponent(validatedDoctype)}/${encodeURIComponent(validatedName)}`;

    const res = await this.#client.put<unknown>(path, fields);
    return this.#unwrapSingleEnvelope<T>(res);
  }

  async delete(doctype: string, name: string): Promise<void> {
    const validatedDoctype = this.#validateDoctype(doctype);
    const validatedName = this.#validateName(name);
    const path = `/api/resource/${encodeURIComponent(validatedDoctype)}/${encodeURIComponent(validatedName)}`;

    await this.#client.delete<unknown>(path);
  }

  #validateDoctype(doctype: unknown): string {
    if (typeof doctype !== 'string' || doctype.trim().length === 0) {
      throw new FrappeResourceError('doctype must be a non-empty string');
    }
    if (doctype === '.' || doctype === '..') {
      throw new FrappeResourceError(
        'doctype must not be dot path segment "." or ".."'
      );
    }
    return doctype;
  }

  #validateName(name: unknown): string {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new FrappeResourceError('name must be a non-empty string');
    }
    if (name === '.' || name === '..') {
      throw new FrappeResourceError(
        'name must not be dot path segment "." or ".."'
      );
    }
    return name;
  }


  #validateBody(body: unknown, action: string): void {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new FrappeResourceError(
        `${action} body must be a non-null object and not an array`
      );
    }
  }

  #buildQueryString(options?: FrappeListOptions): string {
    if (!options) {
      return '';
    }

    const params = new URLSearchParams();

    if (options.fields !== undefined) {
      if (!Array.isArray(options.fields) || options.fields.length === 0) {
        throw new FrappeResourceError(
          'fields option must be a non-empty array of non-empty strings'
        );
      }
      for (const field of options.fields) {
        if (typeof field !== 'string' || field.trim().length === 0) {
          throw new FrappeResourceError(
            'fields option contains invalid or empty field name'
          );
        }
      }
      params.append('fields', JSON.stringify(options.fields));
    }

    if (options.filters !== undefined) {
      this.#validateFilters(options.filters, 'filters');
      try {
        params.append('filters', JSON.stringify(options.filters));
      } catch {
        throw new FrappeResourceError('Failed to serialize filters to JSON');
      }
    }

    if (options.orFilters !== undefined) {
      this.#validateFilters(options.orFilters, 'orFilters');
      try {
        params.append('or_filters', JSON.stringify(options.orFilters));
      } catch {
        throw new FrappeResourceError('Failed to serialize orFilters to JSON');
      }
    }

    if (options.orderBy !== undefined) {
      if (
        typeof options.orderBy !== 'string' ||
        options.orderBy.trim().length === 0
      ) {
        throw new FrappeResourceError(
          'orderBy option must be a non-empty string'
        );
      }
      params.append('order_by', options.orderBy);
    }

    if (options.limitStart !== undefined) {
      if (!Number.isSafeInteger(options.limitStart) || options.limitStart < 0) {
        throw new FrappeResourceError(
          'limitStart option must be a non-negative safe integer'
        );
      }
      params.append('limit_start', String(options.limitStart));
    }

    if (options.limitPageLength !== undefined) {
      if (
        !Number.isSafeInteger(options.limitPageLength) ||
        options.limitPageLength <= 0
      ) {
        throw new FrappeResourceError(
          'limitPageLength option must be a positive safe integer'
        );
      }
      params.append('limit_page_length', String(options.limitPageLength));
    }

    const str = params.toString();
    return str.length > 0 ? `?${str}` : '';
  }

  #validateFilters(filters: unknown, name: string): void {
    if (!Array.isArray(filters)) {
      throw new FrappeResourceError(`${name} option must be an array`);
    }
    for (const filter of filters) {
      if (!Array.isArray(filter) || filter.length !== 3) {
        throw new FrappeResourceError(
          `${name} entry must be a 3-element filter tuple [field, operator, value]`
        );
      }
      const [field, operator] = filter as [unknown, unknown, unknown];
      if (typeof field !== 'string' || field.trim().length === 0) {
        throw new FrappeResourceError(
          `${name} filter field must be a non-empty string`
        );
      }
      if (typeof operator !== 'string' || operator.trim().length === 0) {
        throw new FrappeResourceError(
          `${name} filter operator must be a non-empty string`
        );
      }
    }
  }

  #unwrapSingleEnvelope<T>(res: unknown): T {
    if (!res || typeof res !== 'object' || Array.isArray(res)) {
      throw new FrappeResponseError(
        'Frappe resource response must be a non-null object'
      );
    }
    if (!('data' in res)) {
      throw new FrappeResponseError(
        'Frappe resource response missing data property'
      );
    }
    const data = (res as Record<string, unknown>).data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new FrappeResponseError(
        'Frappe resource data property must be a non-null object'
      );
    }
    return data as T;
  }

  #unwrapListEnvelope<T>(res: unknown): T[] {
    if (!res || typeof res !== 'object' || Array.isArray(res)) {
      throw new FrappeResponseError(
        'Frappe resource response must be a non-null object'
      );
    }
    if (!('data' in res)) {
      throw new FrappeResponseError(
        'Frappe resource response missing data property'
      );
    }
    const data = (res as Record<string, unknown>).data;
    if (!Array.isArray(data)) {
      throw new FrappeResponseError(
        'Frappe resource data property must be an array'
      );
    }
    for (const item of data) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new FrappeResponseError(
          'Frappe list resource data array contains invalid non-object item'
        );
      }
    }
    return data as T[];
  }

}
