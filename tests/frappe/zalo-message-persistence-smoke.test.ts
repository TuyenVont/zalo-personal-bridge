import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isUnsetFrappeValue, main } from '../../scripts/smoke-frappe-message-persistence.js';
import type { FetchImplementation } from '../../src/frappe/types.js';

describe('B4.4B-A Message Persistence Smoke Harness (Offline)', () => {
  const validEnv = {
    FRAPPE_BASE_URL: 'http://localhost:8000',
    FRAPPE_API_KEY: 'test_key',
    FRAPPE_API_SECRET: 'test_secret',
    FRAPPE_TIME_ZONE: 'Asia/Ho_Chi_Minh',
  };

  it('1. no --confirm-write -> returns 1 and performs zero network requests', async () => {
    let fetchCalled = false;
    const mockFetch: FetchImplementation = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const code = await main([], validEnv, mockFetch);

    assert.equal(code, 1);
    assert.equal(fetchCalled, false);
  });

  it('2. unknown flag -> returns 1 and performs zero network requests', async () => {
    let fetchCalled = false;
    const mockFetch: FetchImplementation = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const code = await main(['--confirm-write', '--invalid-flag'], validEnv, mockFetch);

    assert.equal(code, 1);
    assert.equal(fetchCalled, false);
  });

  it('3. missing env -> returns 1 and performs zero network requests', async () => {
    let fetchCalled = false;
    const mockFetch: FetchImplementation = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const code = await main(['--confirm-write'], { ...validEnv, FRAPPE_API_KEY: '' }, mockFetch);

    assert.equal(code, 1);
    assert.equal(fetchCalled, false);
  });

  it('4. invalid timezone -> returns 1 and performs zero network requests', async () => {
    let fetchCalled = false;
    const mockFetch: FetchImplementation = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const code = await main(['--confirm-write'], { ...validEnv, FRAPPE_TIME_ZONE: 'Invalid/Timezone' }, mockFetch);

    assert.equal(code, 1);
    assert.equal(fetchCalled, false);
  });

  it('5. isUnsetFrappeValue accepts undefined, null, and empty string as unset', () => {
    assert.equal(isUnsetFrappeValue(undefined), true);
    assert.equal(isUnsetFrappeValue(null), true);
    assert.equal(isUnsetFrappeValue(''), true);

    assert.equal(isUnsetFrappeValue('CUST-123'), false);
    assert.equal(isUnsetFrappeValue('User'), false);
    assert.equal(isUnsetFrappeValue(0), false);
    assert.equal(isUnsetFrappeValue(false), false);
  });

  it('6-17. full offline smoke flow: created/created, existing/existing, read-back verification, forbidden fields, no customer/update/delete, secrets sanitized', async () => {
    const fetchedPaths: string[] = [];
    const fetchedMethods: string[] = [];
    const fetchedBodies: string[] = [];
    const logs: string[] = [];

    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));

    let createdConvName = '';
    let createdMsgName = '';

    const mockFetch: FetchImplementation = async (input, init) => {
      const urlStr = String(input);
      const method = init?.method || 'GET';
      fetchedPaths.push(urlStr);
      fetchedMethods.push(method);
      if (init?.body) {
        fetchedBodies.push(String(init.body));
      }

      if (urlStr.includes('/api/resource/Zalo%20OA%20Customer')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      if (urlStr.includes('/api/resource/Zalo%20OA%20Conversation')) {
        if (method === 'GET') {
          if (!createdConvName) {
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
          } else {
            const firstConvBody = JSON.parse(fetchedBodies[0] || '{}');
            const searchParams = new URL(urlStr).searchParams;
            const filterParam = searchParams.get('filters');
            let queryConvKey = '';
            if (filterParam) {
              const parsedFilters = JSON.parse(filterParam);
              queryConvKey = parsedFilters[0]?.[2] || '';
            }
            return new Response(
              JSON.stringify({
                data: [
                  {
                    name: createdConvName,
                    customer: null,
                    custom_channel_type: 'Personal',
                    custom_account_id: 'b44b-smoke-account',
                    custom_conversation_key: queryConvKey,
                    custom_thread_id: firstConvBody.custom_thread_id,
                    custom_thread_type: 'user',
                  },
                ],
              }),
              { status: 200 }
            );
          }
        }
        if (method === 'POST') {
          createdConvName = 'CONV-SMOKE-001';
          return new Response(JSON.stringify({ data: { name: createdConvName } }), { status: 200 });
        }
      }

      if (urlStr.includes('/api/resource/Zalo%20OA%20Message')) {
        if (method === 'GET') {
          if (!createdMsgName) {
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
          } else {
            const firstConvBody = JSON.parse(fetchedBodies[0] || '{}');
            const firstMsgBody = JSON.parse(fetchedBodies[1] || '{}');

            const searchParams = new URL(urlStr).searchParams;
            const filterParam = searchParams.get('filters');
            let queryMsgKey = '';
            if (filterParam) {
              const parsedFilters = JSON.parse(filterParam);
              queryMsgKey = parsedFilters[0]?.[2] || '';
            }

            return new Response(
              JSON.stringify({
                data: [
                  {
                    name: createdMsgName,
                    conversation: createdConvName,
                    custom_channel_type: 'Personal',
                    custom_account_id: 'b44b-smoke-account',
                    custom_message_key: queryMsgKey,
                    custom_thread_id: firstConvBody.custom_thread_id,
                    custom_thread_type: 'user',
                    custom_sender_id: 'b44b-smoke-sender',
                    custom_direction: 'incoming',
                    custom_sdk_timestamp: firstMsgBody.custom_sdk_timestamp,
                    custom_zca_msg_type: 'text',
                    zalo_message_id: firstMsgBody.zalo_message_id,
                    sent_at: firstMsgBody.sent_at,
                    content: 'B4.4B persistence smoke test',
                    customer: null,
                    sender_type: null,
                    message_type: null,
                    raw_payload: null,
                  },
                ],
              }),
              { status: 200 }
            );
          }
        }
        if (method === 'POST') {
          createdMsgName = 'MSG-SMOKE-001';
          return new Response(JSON.stringify({ data: { name: createdMsgName } }), { status: 200 });
        }
      }

      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    try {
      const exitCode = await main(['--confirm-write'], validEnv, mockFetch);
      assert.equal(exitCode, 0);

      // Verify Conversation direct read-back requested customer and technical fields
      const convGetUrls = fetchedPaths.filter((p) => p.includes('Zalo%20OA%20Conversation') && p.includes('fields='));
      const lastConvGetUrl = decodeURIComponent(convGetUrls[convGetUrls.length - 1]);
      assert.ok(lastConvGetUrl.includes('customer'));
      assert.ok(lastConvGetUrl.includes('custom_channel_type'));
      assert.ok(lastConvGetUrl.includes('custom_account_id'));
      assert.ok(lastConvGetUrl.includes('custom_conversation_key'));
      assert.ok(lastConvGetUrl.includes('custom_thread_id'));
      assert.ok(lastConvGetUrl.includes('custom_thread_type'));

      // Verify Message direct read-back requested customer, sender_type, message_type, raw_payload
      const msgGetUrls = fetchedPaths.filter((p) => p.includes('Zalo%20OA%20Message') && p.includes('fields='));
      const lastMsgGetUrl = decodeURIComponent(msgGetUrls[msgGetUrls.length - 1]);
      assert.ok(lastMsgGetUrl.includes('customer'));
      assert.ok(lastMsgGetUrl.includes('sender_type'));
      assert.ok(lastMsgGetUrl.includes('message_type'));
      assert.ok(lastMsgGetUrl.includes('raw_payload'));

      // Verify no Customer API call made
      assert.equal(fetchedPaths.some((p) => p.includes('Zalo%20OA%20Customer')), false);

      // Verify no PUT/DELETE calls
      assert.equal(fetchedMethods.includes('PUT'), false);
      assert.equal(fetchedMethods.includes('DELETE'), false);

      // Verify secrets and internal keys/hashes not logged
      const fullLogString = logs.join('\n');
      assert.equal(fullLogString.includes('test_key'), false);
      assert.equal(fullLogString.includes('test_secret'), false);
      assert.equal(fullLogString.includes('CONV-SMOKE-001'), false);
      assert.equal(fullLogString.includes('MSG-SMOKE-001'), false);

      // Verify corrected log wording: "Client initialized" (NOT "Authenticated client initialized")
      assert.ok(fullLogString.includes('[FRAPPE] Client initialized'));
      assert.equal(fullLogString.includes('Authenticated client initialized'), false);

      assert.ok(fullLogString.includes('[INFO] Frappe timezone validated'));
      assert.ok(fullLogString.includes('[WRITE] First persistence: conversation=created, message=created'));
      assert.ok(fullLogString.includes('[CHECK] Second persistence: conversation=existing, message=existing'));
      assert.ok(fullLogString.includes('[CHECK] Conversation count: 1'));
      assert.ok(fullLogString.includes('[CHECK] Message count: 1'));
      assert.ok(fullLogString.includes('[PASS] B4.4B live persistence smoke succeeded'));
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });

  it('18. fails smoke if Conversation.customer is populated with non-empty string', async () => {
    let createdConvName = '';
    let createdMsgName = '';

    const mockFetch: FetchImplementation = async (input, init) => {
      const urlStr = String(input);
      const method = init?.method || 'GET';

      if (urlStr.includes('/api/resource/Zalo%20OA%20Conversation')) {
        if (method === 'GET') {
          if (!createdConvName) {
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
          } else {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    name: createdConvName,
                    customer: 'CUST-ILLEGAL-001', // populated forbidden field
                    custom_channel_type: 'Personal',
                    custom_account_id: 'b44b-smoke-account',
                    custom_conversation_key: 'convKey',
                    custom_thread_id: 'thread-1',
                    custom_thread_type: 'user',
                  },
                ],
              }),
              { status: 200 }
            );
          }
        }
        if (method === 'POST') {
          createdConvName = 'CONV-1';
          return new Response(JSON.stringify({ data: { name: createdConvName } }), { status: 200 });
        }
      }

      if (urlStr.includes('/api/resource/Zalo%20OA%20Message')) {
        if (method === 'GET') {
          return new Response(JSON.stringify({ data: createdMsgName ? [{ name: createdMsgName }] : [] }), { status: 200 });
        }
        if (method === 'POST') {
          createdMsgName = 'MSG-1';
          return new Response(JSON.stringify({ data: { name: createdMsgName } }), { status: 200 });
        }
      }

      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const code = await main(['--confirm-write'], validEnv, mockFetch);
    assert.equal(code, 1);
  });

  it('19. fails smoke if Message.raw_payload is populated with non-empty value', async () => {
    let createdConvName = '';
    let createdMsgName = '';

    const mockFetch: FetchImplementation = async (input, init) => {
      const urlStr = String(input);
      const method = init?.method || 'GET';

      if (urlStr.includes('/api/resource/Zalo%20OA%20Conversation')) {
        if (method === 'GET') {
          return new Response(JSON.stringify({ data: createdConvName ? [{
            name: createdConvName,
            customer: null,
            custom_channel_type: 'Personal',
            custom_account_id: 'b44b-smoke-account',
            custom_conversation_key: 'convKey',
            custom_thread_id: 'thread-1',
            custom_thread_type: 'user',
          }] : [] }), { status: 200 });
        }
        if (method === 'POST') {
          createdConvName = 'CONV-1';
          return new Response(JSON.stringify({ data: { name: createdConvName } }), { status: 200 });
        }
      }

      if (urlStr.includes('/api/resource/Zalo%20OA%20Message')) {
        if (method === 'GET') {
          if (!createdMsgName) {
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
          } else {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    name: createdMsgName,
                    conversation: createdConvName,
                    custom_channel_type: 'Personal',
                    custom_account_id: 'b44b-smoke-account',
                    custom_message_key: 'msgKey',
                    custom_thread_id: 'thread-1',
                    custom_thread_type: 'user',
                    custom_sender_id: 'b44b-smoke-sender',
                    custom_direction: 'incoming',
                    custom_sdk_timestamp: '123456',
                    custom_zca_msg_type: 'text',
                    zalo_message_id: 'msg-1',
                    sent_at: '2026-08-13 09:00:00',
                    content: 'B4.4B persistence smoke test',
                    customer: null,
                    sender_type: null,
                    message_type: null,
                    raw_payload: '{"raw": true}',
                  },
                ],
              }),
              { status: 200 }
            );
          }
        }
        if (method === 'POST') {
          createdMsgName = 'MSG-1';
          return new Response(JSON.stringify({ data: { name: createdMsgName } }), { status: 200 });
        }
      }

      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const code = await main(['--confirm-write'], validEnv, mockFetch);
    assert.equal(code, 1);
  });
});
