import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FrappeApiClient,
  FrappeHttpError,
  FrappeResourceClient,
  FrappeResourceError,
  FrappeResponseError,
  type FrappeListOptions,
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

describe('FrappeResourceClient (B3.2 REST Resource & Query Primitives)', () => {
  const validOptions = {
    baseUrl: 'https://frappe.example.com',
    apiKey: 'my_key',
    apiSecret: 'my_secret',
  };

  function createClient(
    handler: (
      url: string,
      init?: RequestInit
    ) => Promise<Response> | Response
  ) {
    const { fakeFetch, calls } = createFakeFetch(handler);
    const apiClient = new FrappeApiClient({
      ...validOptions,
      fetch: fakeFetch,
    });
    const resourceClient = new FrappeResourceClient(apiClient);
    return { resourceClient, apiClient, calls };
  }

  it('1. list builds /api/resource/{encodedDoctype}', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await resourceClient.list('Contact');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/Contact'
    );
  });

  it('2. get builds correct encoded doctype/name path', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'C100' } }))
    );

    await resourceClient.get('Contact', 'C100');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/Contact/C100'
    );
  });

  it('3. create uses POST resource collection path', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'C101' } }))
    );

    await resourceClient.create('Contact', { first_name: 'John' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/Contact'
    );
  });

  it('4. update uses PUT document path', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'C101' } }))
    );

    await resourceClient.update('Contact', 'C101', { first_name: 'Jane' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init?.method, 'PUT');
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/Contact/C101'
    );
  });

  it('5. delete uses DELETE document path', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ message: 'ok' }))
    );

    await resourceClient.delete('Contact', 'C101');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init?.method, 'DELETE');
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/Contact/C101'
    );
  });

  it('6. doctype with spaces is encoded', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await resourceClient.list('CRM Conversation');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/CRM%20Conversation'
    );
  });

  it('7. document name containing "/" cannot inject a path segment', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'ABC/123' } }))
    );

    await resourceClient.get('Contact', 'ABC/123');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/Contact/ABC%2F123'
    );
  });

  it('8. document name containing "?" cannot inject query', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'ABC?x=1' } }))
    );

    await resourceClient.get('Contact', 'ABC?x=1');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/Contact/ABC%3Fx%3D1'
    );
  });

  it('9. document name containing "#" cannot inject fragment', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'ABC#frag' } }))
    );

    await resourceClient.get('Contact', 'ABC#frag');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/Contact/ABC%23frag'
    );
  });

  it('10. unicode doctype/name encoding is deterministic', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'Nguyễn Văn A' } }))
    );

    await resourceClient.get('Thông Tin', 'Nguyễn Văn A');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      `https://frappe.example.com/api/resource/${encodeURIComponent('Thông Tin')}/${encodeURIComponent('Nguyễn Văn A')}`
    );
  });

  it('11. empty doctype rejected before client request', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('');
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('12. whitespace-only doctype rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('   \t\n');
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('13. empty name rejected where required', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: {} }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.get('Contact', '');
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('14. whitespace-only name rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: {} }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.get('Contact', '   \n');
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('15. list without options produces no query string', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await resourceClient.list('Contact');
    assert.equal(
      calls[0].url,
      'https://frappe.example.com/api/resource/Contact'
    );
  });

  it('16. fields is serialized as JSON query parameter', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await resourceClient.list('Contact', { fields: ['name', 'first_name'] });
    const url = new URL(calls[0].url);
    assert.equal(
      url.searchParams.get('fields'),
      JSON.stringify(['name', 'first_name'])
    );
  });

  it('17. filters serialized as JSON query parameter', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    const filters = [['status', '=', 'Open']] as const;
    await resourceClient.list('Issue', { filters });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('filters'), JSON.stringify(filters));
  });

  it('18. orFilters serialized as `or_filters`', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    const orFilters = [['status', '=', 'Open'], ['status', '=', 'Pending']] as const;
    await resourceClient.list('Issue', { orFilters });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('or_filters'), JSON.stringify(orFilters));
  });

  it('19. orderBy serialized as `order_by`', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await resourceClient.list('Issue', { orderBy: 'creation desc' });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('order_by'), 'creation desc');
  });

  it('20. limitStart serialized as `limit_start`', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await resourceClient.list('Issue', { limitStart: 20 });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('limit_start'), '20');
  });

  it('21. limitPageLength serialized as `limit_page_length`', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await resourceClient.list('Issue', { limitPageLength: 50 });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('limit_page_length'), '50');
  });

  it('22. combined query uses URL-safe construction', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    const options: FrappeListOptions = {
      fields: ['name', 'status'],
      filters: [['status', '=', 'Open']],
      orFilters: [['priority', '=', 'High']],
      orderBy: 'modified desc',
      limitStart: 10,
      limitPageLength: 25,
    };

    await resourceClient.list('Task', options);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/api/resource/Task');
    assert.equal(url.searchParams.get('fields'), JSON.stringify(['name', 'status']));
    assert.equal(url.searchParams.get('filters'), JSON.stringify([['status', '=', 'Open']]));
    assert.equal(url.searchParams.get('or_filters'), JSON.stringify([['priority', '=', 'High']]));
    assert.equal(url.searchParams.get('order_by'), 'modified desc');
    assert.equal(url.searchParams.get('limit_start'), '10');
    assert.equal(url.searchParams.get('limit_page_length'), '25');
  });

  it('23. fields input is not mutated', async () => {
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    const fields = Object.freeze(['name', 'email']);
    await resourceClient.list('Contact', { fields });
    assert.deepEqual(fields, ['name', 'email']);
  });

  it('24. filters input is not mutated', async () => {
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    const filters = Object.freeze([Object.freeze(['status', '=', 'Open'])]);
    await resourceClient.list('Contact', { filters });
    assert.deepEqual(filters, [['status', '=', 'Open']]);
  });

  it('25. invalid/empty field name rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', { fields: ['name', '   '] });
      },
      FrappeResourceError
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', { fields: [] });
      },
      FrappeResourceError
    );

    assert.equal(calls.length, 0);
  });

  it('26. malformed filter tuple rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', {
          filters: [['status', '='] as any],
        });
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('27. empty filter field rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', {
          filters: [['', '=', 'value']],
        });
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('28. empty filter operator rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', {
          filters: [['status', '  ', 'value']],
        });
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('29. invalid limitStart rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', { limitStart: 1.5 });
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('30. negative limitStart rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', { limitStart: -5 });
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('31. invalid limitPageLength rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', { limitPageLength: 2.7 });
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('32. zero limitPageLength rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', { limitPageLength: 0 });
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('33. non-safe-integer pagination rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', {
          limitStart: Number.MAX_SAFE_INTEGER + 1,
        });
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('34. filter JSON serialization failure is sanitized', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    const secretValueKey = 'SECRET_FILTER_PAYLOAD';
    const circularVal: any = { [secretValueKey]: 'value' };
    circularVal.self = circularVal;

    try {
      await resourceClient.list('Contact', {
        filters: [['field', '=', circularVal]],
      });
      assert.fail('Expected FrappeResourceError');
    } catch (err: any) {
      assert.ok(err instanceof FrappeResourceError);
      const msg = `${err.message} ${JSON.stringify(err)}`;
      assert.equal(msg.includes(secretValueKey), false);
    }
    assert.equal(calls.length, 0);
  });

  it('35. serialization failure does not call underlying client', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    const circularVal: any = {};
    circularVal.self = circularVal;

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact', {
          filters: [['field', '=', circularVal]],
        });
      },
      FrappeResourceError
    );

    assert.equal(calls.length, 0);
  });

  it('36. create body object is passed without mutation', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'C1' } }))
    );

    const bodyObj = Object.freeze({ first_name: 'John', age: 30 });
    await resourceClient.create('Contact', bodyObj);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].init?.body,
      JSON.stringify({ first_name: 'John', age: 30 })
    );
    assert.equal(bodyObj.first_name, 'John');
  });

  it('37. update body object is passed without mutation', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'C1' } }))
    );

    const fieldsObj = Object.freeze({ last_name: 'Doe' });
    await resourceClient.update('Contact', 'C1', fieldsObj);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init?.body, JSON.stringify({ last_name: 'Doe' }));
    assert.equal(fieldsObj.last_name, 'Doe');
  });

  it('38. array create body rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: {} }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.create('Contact', [{ name: 'C1' }] as any);
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('39. null create body rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: {} }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.create('Contact', null as any);
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('40. array update body rejected', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: {} }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.update('Contact', 'C1', [{ name: 'C1' }] as any);
      },
      FrappeResourceError
    );
    assert.equal(calls.length, 0);
  });

  it('41. successful list unwraps `data` array', async () => {
    const items = [{ name: 'C1' }, { name: 'C2' }];
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: items }))
    );

    const result = await resourceClient.list('Contact');
    assert.deepEqual(result, items);
  });

  it('42. successful get unwraps `data` object', async () => {
    const doc = { name: 'C100', email: 'c100@example.com' };
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: doc }))
    );

    const result = await resourceClient.get('Contact', 'C100');
    assert.deepEqual(result, doc);
  });

  it('43. successful create unwraps `data` object', async () => {
    const created = { name: 'C101', first_name: 'Alice' };
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: created }))
    );

    const result = await resourceClient.create('Contact', {
      first_name: 'Alice',
    });
    assert.deepEqual(result, created);
  });

  it('44. successful update unwraps `data` object', async () => {
    const updated = { name: 'C101', first_name: 'Alice', last_name: 'Smith' };
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: updated }))
    );

    const result = await resourceClient.update('Contact', 'C101', {
      last_name: 'Smith',
    });
    assert.deepEqual(result, updated);
  });

  it('45. malformed list envelope throws sanitized response error', async () => {
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ result: [] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact');
      },
      FrappeResponseError
    );
  });

  it('46. missing data for single resource throws sanitized response error', async () => {
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ message: 'success' }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.get('Contact', 'C1');
      },
      FrappeResponseError
    );
  });

  it('47. null transport result where envelope required throws sanitized error', async () => {
    const { resourceClient } = createClient(() =>
      createMockResponse(204, '')
    );

    await assert.rejects(
      async () => {
        await resourceClient.get('Contact', 'C1');
      },
      FrappeResponseError
    );
  });

  it('48. single-resource data array is rejected', async () => {
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [{ name: 'C1' }] }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.get('Contact', 'C1');
      },
      FrappeResponseError
    );
  });

  it('49. list-resource data non-array is rejected', async () => {
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'C1' } }))
    );

    await assert.rejects(
      async () => {
        await resourceClient.list('Contact');
      },
      FrappeResponseError
    );
  });

  it('50. malformed response error contains no raw payload content', async () => {
    const rawSecretPayload = 'SENSITIVE_SERVER_PAYLOAD_BODY_CONTENT_999';
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ secret_field: rawSecretPayload }))
    );

    try {
      await resourceClient.get('Contact', 'C1');
      assert.fail('Expected FrappeResponseError');
    } catch (err: any) {
      assert.ok(err instanceof FrappeResponseError);
      const errStr = `${err.message} ${JSON.stringify(err)}`;
      assert.equal(errStr.includes(rawSecretPayload), false);
    }
  });

  it('51. DELETE success resolves void', async () => {
    const { resourceClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ message: 'ok' }))
    );

    const result = await resourceClient.delete('Contact', 'C1');
    assert.equal(result, undefined);
  });

  it('52. underlying FrappeHttpError propagates without being replaced', async () => {
    const { resourceClient } = createClient(() =>
      createMockResponse(404, '{"message":"Not Found"}')
    );

    await assert.rejects(
      async () => {
        await resourceClient.get('Contact', 'NonExistent');
      },
      (err: unknown) => err instanceof FrappeHttpError && err.status === 404
    );
  });

  it('53. no credentials are introduced/logged by resource layer', async () => {
    const { resourceClient, apiClient } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: [] }))
    );

    const resStr = JSON.stringify(resourceClient);
    assert.equal(resStr.includes('my_key'), false);
    assert.equal(resStr.includes('my_secret'), false);

    const apiStr = JSON.stringify(apiClient);
    assert.equal(apiStr.includes('my_key'), false);
    assert.equal(apiStr.includes('my_secret'), false);
  });

  it('54. Path-injection regression: doctype="CRM Conversation" & name="../ABC?x=1#frag"', async () => {
    const { resourceClient, calls } = createClient(() =>
      createMockResponse(200, JSON.stringify({ data: { name: 'test' } }))
    );

    const doctype = 'CRM Conversation';
    const name = '../ABC?x=1#frag';

    await resourceClient.get(doctype, name);
    assert.equal(calls.length, 1);
    const callUrl = calls[0].url;
    assert.equal(
      callUrl,
      'https://frappe.example.com/api/resource/CRM%20Conversation/..%2FABC%3Fx%3D1%23frag'
    );
    const parsed = new URL(callUrl);
    assert.equal(
      parsed.pathname,
      '/api/resource/CRM%20Conversation/..%2FABC%3Fx%3D1%23frag'
    );
    assert.equal(parsed.search, '');
    assert.equal(parsed.hash, '');
  });

  describe('Correction 1: Reject dot path segments', () => {
    it('1. doctype "." rejected before client call', async () => {
      const { resourceClient, calls } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: [] }))
      );
      await assert.rejects(
        async () => {
          await resourceClient.list('.');
        },
        FrappeResourceError
      );
      assert.equal(calls.length, 0);
    });

    it('2. doctype ".." rejected before client call', async () => {
      const { resourceClient, calls } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: [] }))
      );
      await assert.rejects(
        async () => {
          await resourceClient.list('..');
        },
        FrappeResourceError
      );
      assert.equal(calls.length, 0);
    });

    it('3. name "." rejected before client call', async () => {
      const { resourceClient, calls } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: {} }))
      );
      await assert.rejects(
        async () => {
          await resourceClient.get('Contact', '.');
        },
        FrappeResourceError
      );
      assert.equal(calls.length, 0);
    });

    it('4. name ".." rejected before client call', async () => {
      const { resourceClient, calls } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: {} }))
      );
      await assert.rejects(
        async () => {
          await resourceClient.get('Contact', '..');
        },
        FrappeResourceError
      );
      assert.equal(calls.length, 0);
    });

    it('5. "ABC..123" remains valid', async () => {
      const { resourceClient, calls } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: { name: 'ABC..123' } }))
      );
      await resourceClient.get('Contact', 'ABC..123');
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        'https://frappe.example.com/api/resource/Contact/ABC..123'
      );
    });

    it('6. "..ABC" and "ABC.." remain valid', async () => {
      const { resourceClient, calls } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: [] }))
      );
      await resourceClient.list('..ABC');
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        'https://frappe.example.com/api/resource/..ABC'
      );

      await resourceClient.list('ABC..');
      assert.equal(calls.length, 2);
      assert.equal(
        calls[1].url,
        'https://frappe.example.com/api/resource/ABC..'
      );
    });
  });

  describe('Correction 2: Validate list envelope items', () => {
    it('1. list rejects data containing null', async () => {
      const { resourceClient } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: [{ name: 'A' }, null] }))
      );
      await assert.rejects(
        async () => {
          await resourceClient.list('Contact');
        },
        FrappeResponseError
      );
    });

    it('2. list rejects data containing number', async () => {
      const { resourceClient } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: [42] }))
      );
      await assert.rejects(
        async () => {
          await resourceClient.list('Contact');
        },
        FrappeResponseError
      );
    });

    it('3. list rejects data containing string', async () => {
      const { resourceClient } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: ['name1', 'name2'] }))
      );
      await assert.rejects(
        async () => {
          await resourceClient.list('Contact');
        },
        FrappeResponseError
      );
    });

    it('4. list rejects data containing nested array', async () => {
      const { resourceClient } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: [[{ name: 'A' }]] }))
      );
      await assert.rejects(
        async () => {
          await resourceClient.list('Contact');
        },
        FrappeResponseError
      );
    });

    it('5. list accepts empty array []', async () => {
      const { resourceClient } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: [] }))
      );
      const res = await resourceClient.list('Contact');
      assert.deepEqual(res, []);
    });

    it('6. list accepts single object record [{ name: "A" }]', async () => {
      const { resourceClient } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: [{ name: 'A' }] }))
      );
      const res = await resourceClient.list('Contact');
      assert.deepEqual(res, [{ name: 'A' }]);
    });

    it('7. list accepts multiple object records', async () => {
      const records = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
      const { resourceClient } = createClient(() =>
        createMockResponse(200, JSON.stringify({ data: records }))
      );
      const res = await resourceClient.list('Contact');
      assert.deepEqual(res, records);
    });

    it('8. list item error does not leak item contents or payload', async () => {
      const secretItemPayload = 'RECOGNIZABLE_SECRET_ITEM_CONTENT_777';
      const { resourceClient } = createClient(() =>
        createMockResponse(
          200,
          JSON.stringify({ data: [secretItemPayload] })
        )
      );
      try {
        await resourceClient.list('Contact');
        assert.fail('Expected FrappeResponseError');
      } catch (err: any) {
        assert.ok(err instanceof FrappeResponseError);
        const errStr = `${err.message} ${JSON.stringify(err)}`;
        assert.equal(errStr.includes(secretItemPayload), false);
      }
    });
  });
});


