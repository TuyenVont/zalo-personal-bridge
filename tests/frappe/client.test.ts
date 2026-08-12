import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FrappeApiClient,
  FrappeConfigError,
  FrappeHttpError,
  FrappeParseError,
  FrappePathError,
  FrappeRequestError,
  FrappeTransportError,
} from '../../src/frappe/index.js';

interface FakeFetchCall {
  url: string;
  init?: RequestInit;
}

function createFakeFetch(
  handler: (
    url: string,
    init?: RequestInit
  ) => Promise<Response> | Response
) {
  const calls: FakeFetchCall[] = [];
  const fakeFetch = async (
    input: string | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = input.toString();
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fakeFetch, calls };
}

function createMockResponse(
  status: number,
  bodyText?: string | null,
  headersMap: Record<string, string> = {}
): Response {
  const headers = new Headers(headersMap);
  const body =
    status === 204 || status === 205 || bodyText === null
      ? null
      : (bodyText ?? '');
  return new Response(body, {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
  });
}

describe('FrappeApiClient (B3.1 Foundation)', () => {
  const validOptions = {
    baseUrl: 'https://frappe.example.com',
    apiKey: 'my_key',
    apiSecret: 'my_secret',
  };

  it('1. valid https baseUrl accepted', () => {
    const { fakeFetch } = createFakeFetch(() => createMockResponse(200, '{}'));
    const client = new FrappeApiClient({ ...validOptions, fetch: fakeFetch });
    assert.ok(client);
  });

  it('2. valid http baseUrl accepted for local/dev use', () => {
    const { fakeFetch } = createFakeFetch(() => createMockResponse(200, '{}'));
    const client = new FrappeApiClient({
      baseUrl: 'http://localhost:8000',
      apiKey: 'key',
      apiSecret: 'secret',
      fetch: fakeFetch,
    });
    assert.ok(client);
  });

  it('3. trailing slash baseUrl normalized correctly', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{"success":true}')
    );
    const client = new FrappeApiClient({
      baseUrl: 'https://frappe.example.com/',
      apiKey: 'key',
      apiSecret: 'secret',
      fetch: fakeFetch,
    });

    await client.get('/api/method/ping');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://frappe.example.com/api/method/ping');
  });

  it('4. invalid baseUrl rejected', () => {
    assert.throws(
      () =>
        new FrappeApiClient({
          ...validOptions,
          baseUrl: 'not-a-url',
        }),
      FrappeConfigError
    );
  });

  it('5. unsupported protocol rejected', () => {
    assert.throws(
      () =>
        new FrappeApiClient({
          ...validOptions,
          baseUrl: 'ftp://frappe.example.com',
        }),
      (err: unknown) =>
        err instanceof FrappeConfigError &&
        err.message.includes('protocol must be http: or https:')
    );
  });

  it('6. baseUrl containing username/password rejected', () => {
    assert.throws(
      () =>
        new FrappeApiClient({
          ...validOptions,
          baseUrl: 'https://admin:pass@frappe.example.com',
        }),
      (err: unknown) =>
        err instanceof FrappeConfigError &&
        err.message.includes('must not contain credentials')
    );
  });

  it('7. empty apiKey rejected', () => {
    assert.throws(
      () =>
        new FrappeApiClient({
          ...validOptions,
          apiKey: '',
        }),
      FrappeConfigError
    );
  });

  it('8. whitespace-only apiKey rejected', () => {
    assert.throws(
      () =>
        new FrappeApiClient({
          ...validOptions,
          apiKey: '   \t\n',
        }),
      FrappeConfigError
    );
  });

  it('9. empty apiSecret rejected', () => {
    assert.throws(
      () =>
        new FrappeApiClient({
          ...validOptions,
          apiSecret: '',
        }),
      FrappeConfigError
    );
  });

  it('10. whitespace-only apiSecret rejected', () => {
    assert.throws(
      () =>
        new FrappeApiClient({
          ...validOptions,
          apiSecret: '   \t\n',
        }),
      FrappeConfigError
    );
  });

  it('11. GET builds correct URL', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{"data":"ok"}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await client.get('/api/resource/Contact');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/Contact'
    );
  });

  it('12. GET includes Accept: application/json and Authorization: token <apiKey>:<apiSecret>', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{"data":"ok"}')
    );
    const client = new FrappeApiClient({
      baseUrl: 'https://frappe.example.com',
      apiKey: 'k123',
      apiSecret: 's456',
      fetch: fakeFetch,
    });

    await client.get('/api/resource/Contact');
    assert.equal(calls.length, 1);
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Accept, 'application/json');
    assert.equal(headers.Authorization, 'token k123:s456');
  });

  it('13. GET sends no body', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{"data":"ok"}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await client.get('/api/resource/Contact');
    assert.equal(calls[0].init?.body, undefined);
  });

  it('14. POST serializes JSON body', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{"data":{"name":"C1"}}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    const payload = { first_name: 'John', last_name: 'Doe' };
    await client.post('/api/resource/Contact', payload);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].init?.body,
      JSON.stringify({ first_name: 'John', last_name: 'Doe' })
    );
  });

  it('15. POST adds Content-Type application/json', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{"data":"ok"}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await client.post('/api/resource/Contact', { name: 'Test' });
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], 'application/json');
  });

  it('16. PUT serializes JSON body', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{"data":"ok"}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    const payload = { status: 'Open' };
    await client.put('/api/resource/Contact/C1', payload);
    assert.equal(calls[0].init?.method, 'PUT');
    assert.equal(calls[0].init?.body, JSON.stringify({ status: 'Open' }));
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], 'application/json');
  });

  it('17. DELETE sends no body', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{"message":"ok"}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await client.delete('/api/resource/Contact/C1');
    assert.equal(calls[0].init?.method, 'DELETE');
    assert.equal(calls[0].init?.body, undefined);
  });

  it('18. successful JSON response is parsed', async () => {
    const expected = { data: { name: 'Contact-100', status: 'Active' } };
    const { fakeFetch } = createFakeFetch(() =>
      createMockResponse(200, JSON.stringify(expected))
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    const result = await client.get<typeof expected>(
      '/api/resource/Contact/Contact-100'
    );
    assert.deepEqual(result, expected);
  });

  it('19. successful empty response returns null', async () => {
    const { fakeFetch } = createFakeFetch(() => createMockResponse(204, ''));
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    const result = await client.delete('/api/resource/Contact/Contact-100');
    assert.equal(result, null);
  });

  it('20. 4xx throws sanitized FrappeHttpError', async () => {
    const { fakeFetch } = createFakeFetch(() =>
      createMockResponse(404, '{"message":"Not Found"}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await assert.rejects(
      async () => {
        await client.get('/api/resource/Contact/Missing');
      },
      (err: unknown) => err instanceof FrappeHttpError && err.status === 404
    );
  });

  it('21. 5xx throws sanitized FrappeHttpError', async () => {
    const { fakeFetch } = createFakeFetch(() =>
      createMockResponse(500, '{"message":"Server Error"}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await assert.rejects(
      async () => {
        await client.post('/api/resource/Contact', { name: 'Test' });
      },
      (err: unknown) => err instanceof FrappeHttpError && err.status === 500
    );
  });

  it('22. HTTP error exposes status/method/path safely', async () => {
    const { fakeFetch } = createFakeFetch(() =>
      createMockResponse(403, 'Forbidden access')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    try {
      await client.get('/api/resource/Secret');
      assert.fail('Expected to throw');
    } catch (err: any) {
      assert.ok(err instanceof FrappeHttpError);
      assert.equal(err.status, 403);
      assert.equal(err.method, 'GET');
      assert.equal(err.path, '/api/resource/Secret');
    }
  });

  it('23. HTTP error message does not contain apiKey', async () => {
    const apiKeySecret = 'MY_API_KEY_SECRET_123';
    const { fakeFetch } = createFakeFetch(() =>
      createMockResponse(401, 'Unauthorized')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      apiKey: apiKeySecret,
      fetch: fakeFetch,
    });

    try {
      await client.get('/api/resource/Contact');
      assert.fail('Expected to throw');
    } catch (err: any) {
      assert.ok(err instanceof Error);
      assert.equal(err.message.includes(apiKeySecret), false);
    }
  });

  it('24. HTTP error message does not contain apiSecret', async () => {
    const secretKeySecret = 'MY_API_SECRET_456';
    const { fakeFetch } = createFakeFetch(() =>
      createMockResponse(401, 'Unauthorized')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      apiSecret: secretKeySecret,
      fetch: fakeFetch,
    });

    try {
      await client.get('/api/resource/Contact');
      assert.fail('Expected to throw');
    } catch (err: any) {
      assert.ok(err instanceof Error);
      assert.equal(err.message.includes(secretKeySecret), false);
    }
  });

  it('25. fetch rejection becomes sanitized transport error', async () => {
    const { fakeFetch } = createFakeFetch(() => {
      throw new Error('Socket closed abruptly');
    });
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await assert.rejects(
      async () => {
        await client.get('/api/resource/Contact');
      },
      FrappeTransportError
    );
  });

  it('26. transport error does not expose credentials', async () => {
    const sensitiveKey = 'SENSITIVE_KEY_999';
    const sensitiveSecret = 'SENSITIVE_SECRET_888';
    const { fakeFetch } = createFakeFetch(() => {
      throw new Error('Connection failed');
    });
    const client = new FrappeApiClient({
      baseUrl: 'https://frappe.example.com',
      apiKey: sensitiveKey,
      apiSecret: sensitiveSecret,
      fetch: fakeFetch,
    });

    try {
      await client.get('/api/resource/Contact');
      assert.fail('Expected to throw');
    } catch (err: any) {
      assert.ok(err instanceof Error);
      assert.equal(err.message.includes(sensitiveKey), false);
      assert.equal(err.message.includes(sensitiveSecret), false);
    }
  });

  it('27. invalid JSON success response throws sanitized parsing error', async () => {
    const { fakeFetch } = createFakeFetch(() =>
      createMockResponse(200, '<html><body>HTML Error</body></html>')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await assert.rejects(
      async () => {
        await client.get('/api/resource/Contact');
      },
      FrappeParseError
    );
  });

  it('28. parsing error does not include raw response body', async () => {
    const rawBody = 'INVALID_JSON_RAW_BODY_CONTENT_12345';
    const { fakeFetch } = createFakeFetch(() =>
      createMockResponse(200, rawBody)
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    try {
      await client.get('/api/resource/Contact');
      assert.fail('Expected to throw');
    } catch (err: any) {
      assert.ok(err instanceof FrappeParseError);
      assert.equal(err.message.includes(rawBody), false);
    }
  });

  it('29. absolute request URL is rejected', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await assert.rejects(
      async () => {
        await client.get('https://evil.example.com/api/resource/Contact');
      },
      FrappePathError
    );
    assert.equal(calls.length, 0);
  });

  it('30. protocol-relative request path is rejected', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await assert.rejects(
      async () => {
        await client.get('//evil.example.com/api/resource/Contact');
      },
      FrappePathError
    );
    assert.equal(calls.length, 0);
  });

  it('31. request path cannot change configured origin', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await assert.rejects(
      async () => {
        await client.get('/api/../../other-path');
      },
      FrappePathError
    );
    assert.equal(calls.length, 0);
  });

  it('32. Authorization header is not exposed by client public state', () => {
    const client = new FrappeApiClient({
      ...validOptions,
      apiKey: 'SECRET_API_KEY',
      apiSecret: 'SECRET_API_SECRET',
    });

    const stringified = JSON.stringify(client);
    assert.equal(stringified.includes('SECRET_API_KEY'), false);
    assert.equal(stringified.includes('SECRET_API_SECRET'), false);
    assert.equal(stringified.includes('Authorization'), false);

    const keys = Object.keys(client);
    assert.equal(keys.includes('apiKey'), false);
    assert.equal(keys.includes('apiSecret'), false);
    assert.equal(keys.includes('Authorization'), false);
  });

  it('33. injected fake fetch receives credentials only via expected Authorization header', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{"data":null}')
    );
    const client = new FrappeApiClient({
      baseUrl: 'https://frappe.example.com',
      apiKey: 'MY_KEY',
      apiSecret: 'MY_SECRET',
      fetch: fakeFetch,
    });

    await client.get('/api/method/ping');
    assert.equal(calls.length, 1);
    const call = calls[0];

    // Assert URL does NOT contain credentials
    assert.equal(call.url.includes('MY_KEY'), false);
    assert.equal(call.url.includes('MY_SECRET'), false);

    // Assert headers container expected token format
    const headers = call.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'token MY_KEY:MY_SECRET');
  });

  it('34. caller body object is not mutated', async () => {
    const { fakeFetch } = createFakeFetch(() =>
      createMockResponse(200, '{"data":"ok"}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    const bodyObject = Object.freeze({ name: 'Original', count: 42 });
    await client.post('/api/resource/Contact', bodyObject);
    assert.equal(bodyObject.name, 'Original');
    assert.equal(bodyObject.count, 42);
  });

  it('35. no request is made when input validation fails', async () => {
    const { fakeFetch, calls } = createFakeFetch(() =>
      createMockResponse(200, '{}')
    );
    const client = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });

    await assert.rejects(
      async () => {
        await client.get('/not-an-api-path');
      },
      FrappePathError
    );

    assert.equal(calls.length, 0);
  });

  describe('Correction 1: Base URL root contract regression tests', () => {
    it('accepts https://frappe.example', () => {
      const client = new FrappeApiClient({
        ...validOptions,
        baseUrl: 'https://frappe.example',
      });
      assert.ok(client);
    });

    it('accepts https://frappe.example/', () => {
      const client = new FrappeApiClient({
        ...validOptions,
        baseUrl: 'https://frappe.example/',
      });
      assert.ok(client);
    });

    it('accepts http://crm.localhost:8000', () => {
      const client = new FrappeApiClient({
        ...validOptions,
        baseUrl: 'http://crm.localhost:8000',
      });
      assert.ok(client);
    });

    it('rejects https://frappe.example/site with subpath', () => {
      assert.throws(
        () =>
          new FrappeApiClient({
            ...validOptions,
            baseUrl: 'https://frappe.example/site',
          }),
        (err: unknown) =>
          err instanceof FrappeConfigError &&
          err.message.includes('no subpaths permitted')
      );
    });

    it('rejects https://frappe.example/frappe/ with trailing subpath', () => {
      assert.throws(
        () =>
          new FrappeApiClient({
            ...validOptions,
            baseUrl: 'https://frappe.example/frappe/',
          }),
        (err: unknown) =>
          err instanceof FrappeConfigError &&
          err.message.includes('no subpaths permitted')
      );
    });

    it('rejects https://frappe.example/?x=1 with query params', () => {
      assert.throws(
        () =>
          new FrappeApiClient({
            ...validOptions,
            baseUrl: 'https://frappe.example/?x=1',
          }),
        (err: unknown) =>
          err instanceof FrappeConfigError &&
          err.message.includes('must not contain query parameters')
      );
    });

    it('rejects https://frappe.example/#test with hash fragment', () => {
      assert.throws(
        () =>
          new FrappeApiClient({
            ...validOptions,
            baseUrl: 'https://frappe.example/#test',
          }),
        (err: unknown) =>
          err instanceof FrappeConfigError &&
          err.message.includes('must not contain a URL hash/fragment')
      );
    });
  });

  describe('Correction 2: Sanitized request body serialization failures', () => {
    const fakeKey = 'FAKE_KEY_SERIALIZE_TEST';
    const fakeSecret = 'FAKE_SECRET_SERIALIZE_TEST';
    const secretContentKey = 'RECOGNIZABLE_SECRET_PAYLOAD_KEY';

    it('1. circular body is rejected before fetch', async () => {
      const { fakeFetch, calls } = createFakeFetch(() =>
        createMockResponse(200, '{}')
      );
      const client = new FrappeApiClient({
        baseUrl: 'https://frappe.example.com',
        apiKey: fakeKey,
        apiSecret: fakeSecret,
        fetch: fakeFetch,
      });

      const circularObj: any = { [secretContentKey]: 'value' };
      circularObj.self = circularObj;

      await assert.rejects(
        async () => {
          await client.post('/api/resource/Contact', circularObj);
        },
        FrappeRequestError
      );

      assert.equal(calls.length, 0);
    });

    it('2. BigInt body is rejected before fetch', async () => {
      const { fakeFetch, calls } = createFakeFetch(() =>
        createMockResponse(200, '{}')
      );
      const client = new FrappeApiClient({
        baseUrl: 'https://frappe.example.com',
        apiKey: fakeKey,
        apiSecret: fakeSecret,
        fetch: fakeFetch,
      });

      const bigintObj = { [secretContentKey]: 12345678901234567890n };

      await assert.rejects(
        async () => {
          await client.post('/api/resource/Contact', bigintObj);
        },
        FrappeRequestError
      );

      assert.equal(calls.length, 0);
    });

    it('3. provided unserializable body producing undefined is rejected', async () => {
      const { fakeFetch, calls } = createFakeFetch(() =>
        createMockResponse(200, '{}')
      );
      const client = new FrappeApiClient({
        baseUrl: 'https://frappe.example.com',
        apiKey: fakeKey,
        apiSecret: fakeSecret,
        fetch: fakeFetch,
      });

      await assert.rejects(
        async () => {
          await client.post('/api/resource/Contact', () => {});
        },
        FrappeRequestError
      );

      assert.equal(calls.length, 0);
    });

    it('5 & 6. serialization errors contain neither fake credentials nor recognizable body content', async () => {
      const { fakeFetch, calls } = createFakeFetch(() =>
        createMockResponse(200, '{}')
      );
      const client = new FrappeApiClient({
        baseUrl: 'https://frappe.example.com',
        apiKey: fakeKey,
        apiSecret: fakeSecret,
        fetch: fakeFetch,
      });

      const bigintObj = { [secretContentKey]: 9999n };

      try {
        await client.put('/api/resource/Contact/1', bigintObj);
        assert.fail('Expected FrappeRequestError');
      } catch (err: any) {
        assert.ok(err instanceof FrappeRequestError);
        const errString = `${err.message} ${JSON.stringify(err)}`;
        assert.equal(errString.includes(fakeKey), false);
        assert.equal(errString.includes(fakeSecret), false);
        assert.equal(errString.includes(secretContentKey), false);
      }

      assert.equal(calls.length, 0);
    });
  });

  describe('Credential-leak regression tests', () => {
    const testKey = 'TEST_API_KEY_DO_NOT_LEAK';
    const testSecret = 'TEST_API_SECRET_DO_NOT_LEAK';

    it('regression: HTTP 500 error does not leak credentials in serialized error', async () => {
      const { fakeFetch } = createFakeFetch(() =>
        createMockResponse(500, 'Internal Server Error')
      );
      const client = new FrappeApiClient({
        baseUrl: 'https://frappe.example.com',
        apiKey: testKey,
        apiSecret: testSecret,
        fetch: fakeFetch,
      });

      try {
        await client.get('/api/resource/Contact');
        assert.fail('Expected HTTP error');
      } catch (err: any) {
        assert.ok(err instanceof FrappeHttpError);
        const errString = `${err.message} ${JSON.stringify(err)}`;
        assert.equal(errString.includes(testKey), false);
        assert.equal(errString.includes(testSecret), false);
      }
    });

    it('regression: transport network rejection does not leak credentials in serialized error', async () => {
      const { fakeFetch } = createFakeFetch(() => {
        throw new TypeError('Failed to fetch');
      });
      const client = new FrappeApiClient({
        baseUrl: 'https://frappe.example.com',
        apiKey: testKey,
        apiSecret: testSecret,
        fetch: fakeFetch,
      });

      try {
        await client.get('/api/resource/Contact');
        assert.fail('Expected transport error');
      } catch (err: any) {
        assert.ok(err instanceof FrappeTransportError);
        const errString = `${err.message} ${JSON.stringify(err)}`;
        assert.equal(errString.includes(testKey), false);
        assert.equal(errString.includes(testSecret), false);
      }
    });

    it('regression: invalid JSON success response does not leak credentials in serialized error', async () => {
      const { fakeFetch } = createFakeFetch(() =>
        createMockResponse(200, 'Malformed HTML payload response')
      );
      const client = new FrappeApiClient({
        baseUrl: 'https://frappe.example.com',
        apiKey: testKey,
        apiSecret: testSecret,
        fetch: fakeFetch,
      });

      try {
        await client.get('/api/resource/Contact');
        assert.fail('Expected parse error');
      } catch (err: any) {
        assert.ok(err instanceof FrappeParseError);
        const errString = `${err.message} ${JSON.stringify(err)}`;
        assert.equal(errString.includes(testKey), false);
        assert.equal(errString.includes(testSecret), false);
      }
    });
  });
});
