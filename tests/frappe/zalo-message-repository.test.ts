import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NormalizedZaloMessage } from '../../src/message/normalized.js';
import type { FrappeResourceClient } from '../../src/frappe/resource.js';
import {
  ZaloMessagePersistenceError,
  ZaloMessageRepository,
} from '../../src/frappe/zalo-message-repository.js';
import {
  ZALO_CONVERSATION_DOCTYPE,
  ZALO_CUSTOMER_DOCTYPE,
  ZALO_MESSAGE_DOCTYPE,
} from '../../src/frappe/zalo-shared-schema.js';

interface ResourceCall {
  method: 'list' | 'create' | 'update' | 'delete';
  doctype: string;
  arg2?: unknown;
}

function createMockResourceClient(handlers?: {
  list?: (doctype: string, options?: unknown) => Promise<Record<string, unknown>[]>;
  create?: (doctype: string, doc: Record<string, unknown>) => Promise<Record<string, unknown>>;
}): { client: FrappeResourceClient; calls: ResourceCall[] } {
  const calls: ResourceCall[] = [];

  const client = {
    list: async (doctype: string, options?: unknown) => {
      calls.push({ method: 'list', doctype, arg2: options });
      if (handlers?.list) {
        return handlers.list(doctype, options);
      }
      return [];
    },
    create: async (doctype: string, doc: Record<string, unknown>) => {
      calls.push({ method: 'create', doctype, arg2: doc });
      if (handlers?.create) {
        return handlers.create(doctype, doc);
      }
      return { name: `MOCK-DOC-${Date.now()}` };
    },
    update: async (doctype: string, name: string, fields: Record<string, unknown>) => {
      calls.push({ method: 'update', doctype, arg2: { name, fields } });
      return { name };
    },
    delete: async (doctype: string, name: string) => {
      calls.push({ method: 'delete', doctype, arg2: name });
    },
  } as unknown as FrappeResourceClient;

  return { client, calls };
}

describe('ZaloMessageRepository', () => {
  const epochInstant = Date.parse('2026-08-13T02:00:00.000Z'); // 1786586400000

  const sampleMessage: NormalizedZaloMessage = Object.freeze({
    accountId: 'acc-test-1',
    messageId: 'msg-test-1',
    threadId: 'thread-test-1',
    senderId: 'user-test-1',
    timestamp: epochInstant,
    textContent: 'Secret payload message content',
    threadType: 'user',
    direction: 'incoming',
    msgType: 'webchat',
  });

  const defaultOptions = Object.freeze({ frappeTimeZone: 'Asia/Ho_Chi_Minh' });

  it('1. rejects invalid resourceClient or missing options in constructor', () => {
    assert.throws(
      () => new ZaloMessageRepository(null as unknown as FrappeResourceClient, defaultOptions),
      (err: unknown) => err instanceof ZaloMessagePersistenceError
    );

    const { client } = createMockResourceClient();

    assert.throws(
      () => new ZaloMessageRepository(client, null as unknown as { frappeTimeZone: string }),
      (err: unknown) => err instanceof ZaloMessagePersistenceError
    );

    assert.throws(
      () => new ZaloMessageRepository(client, { frappeTimeZone: '' }),
      (err: unknown) => err instanceof ZaloMessagePersistenceError
    );
  });

  it('2. creates conversation then message using configured frappeTimeZone', async () => {
    const { client, calls } = createMockResourceClient({
      list: async (doctype) => {
        if (doctype === ZALO_CONVERSATION_DOCTYPE) return [];
        if (doctype === ZALO_MESSAGE_DOCTYPE) return [];
        return [];
      },
      create: async (doctype) => {
        if (doctype === ZALO_CONVERSATION_DOCTYPE) return { name: 'CONV-CREATED-001' };
        if (doctype === ZALO_MESSAGE_DOCTYPE) return { name: 'MSG-CREATED-001' };
        return {};
      },
    });

    const repo = new ZaloMessageRepository(client, defaultOptions);
    const result = await repo.persistMessage(sampleMessage);

    assert.ok(Object.isFrozen(result));
    assert.deepEqual(result, {
      conversationName: 'CONV-CREATED-001',
      conversationStatus: 'created',
      messageName: 'MSG-CREATED-001',
      messageStatus: 'created',
    });

    // Order verification: list conv -> create conv -> list msg -> create msg
    assert.equal(calls.length, 4);

    // Verify message payload has sent_at formatted in configured Asia/Ho_Chi_Minh timezone
    const msgPayload = calls[3].arg2 as Record<string, unknown>;
    assert.equal(msgPayload.conversation, 'CONV-CREATED-001');
    assert.equal(msgPayload.zalo_message_id, 'msg-test-1');
    assert.equal(msgPayload.custom_sdk_timestamp, String(epochInstant));
    assert.equal(msgPayload.sent_at, '2026-08-13 09:00:00');
  });

  it('3. reuses existing conversation (1 match) and creates message (0 matches)', async () => {
    const { client, calls } = createMockResourceClient({
      list: async (doctype) => {
        if (doctype === ZALO_CONVERSATION_DOCTYPE) return [{ name: 'CONV-EXISTING-001' }];
        if (doctype === ZALO_MESSAGE_DOCTYPE) return [];
        return [];
      },
      create: async () => {
        return { name: 'MSG-CREATED-002' };
      },
    });

    const repo = new ZaloMessageRepository(client, defaultOptions);
    const result = await repo.persistMessage(sampleMessage);

    assert.deepEqual(result, {
      conversationName: 'CONV-EXISTING-001',
      conversationStatus: 'existing',
      messageName: 'MSG-CREATED-002',
      messageStatus: 'created',
    });

    // Verify conversation create was NOT called
    assert.equal(calls.filter((c) => c.doctype === ZALO_CONVERSATION_DOCTYPE).length, 1);
  });

  it('4. returns existing for both conversation (1 match) and message (1 match)', async () => {
    const { client, calls } = createMockResourceClient({
      list: async (doctype) => {
        if (doctype === ZALO_CONVERSATION_DOCTYPE) return [{ name: 'CONV-EXISTING-001' }];
        if (doctype === ZALO_MESSAGE_DOCTYPE) return [{ name: 'MSG-EXISTING-001' }];
        return [];
      },
    });

    const repo = new ZaloMessageRepository(client, defaultOptions);
    const result = await repo.persistMessage(sampleMessage);

    assert.deepEqual(result, {
      conversationName: 'CONV-EXISTING-001',
      conversationStatus: 'existing',
      messageName: 'MSG-EXISTING-001',
      messageStatus: 'existing',
    });

    assert.equal(calls.filter((c) => c.method === 'create').length, 0);
  });

  it('5. throws sanitized error if multiple (>1) conversations match key', async () => {
    const { client } = createMockResourceClient({
      list: async (doctype) => {
        if (doctype === ZALO_CONVERSATION_DOCTYPE) {
          return [{ name: 'CONV-DUP-1' }, { name: 'CONV-DUP-2' }];
        }
        return [];
      },
    });

    const repo = new ZaloMessageRepository(client, defaultOptions);

    await assert.rejects(
      async () => repo.persistMessage(sampleMessage),
      (err: unknown) => {
        assert.ok(err instanceof ZaloMessagePersistenceError);
        assert.ok(err.message.includes('Multiple conversations matched'));
        assert.equal(err.message.includes('Secret payload'), false);
        return true;
      }
    );
  });

  it('6. throws sanitized error if multiple (>1) messages match key', async () => {
    const { client } = createMockResourceClient({
      list: async (doctype) => {
        if (doctype === ZALO_CONVERSATION_DOCTYPE) return [{ name: 'CONV-001' }];
        if (doctype === ZALO_MESSAGE_DOCTYPE) {
          return [{ name: 'MSG-DUP-1' }, { name: 'MSG-DUP-2' }];
        }
        return [];
      },
    });

    const repo = new ZaloMessageRepository(client, defaultOptions);

    await assert.rejects(
      async () => repo.persistMessage(sampleMessage),
      (err: unknown) => {
        assert.ok(err instanceof ZaloMessagePersistenceError);
        assert.ok(err.message.includes('Multiple messages matched'));
        return true;
      }
    );
  });

  it('7. recovers from conversation creation race condition via exact 1 retry lookup', async () => {
    let convListCalls = 0;

    const { client } = createMockResourceClient({
      list: async (doctype) => {
        if (doctype === ZALO_CONVERSATION_DOCTYPE) {
          convListCalls++;
          if (convListCalls === 1) return [];
          return [{ name: 'CONV-RACE-RECOVERED' }];
        }
        if (doctype === ZALO_MESSAGE_DOCTYPE) return [];
        return [];
      },
      create: async (doctype) => {
        if (doctype === ZALO_CONVERSATION_DOCTYPE) {
          throw new Error('Duplicate key constraint violation in database');
        }
        return { name: 'MSG-RACE-001' };
      },
    });

    const repo = new ZaloMessageRepository(client, defaultOptions);
    const result = await repo.persistMessage(sampleMessage);

    assert.deepEqual(result, {
      conversationName: 'CONV-RACE-RECOVERED',
      conversationStatus: 'existing',
      messageName: 'MSG-RACE-001',
      messageStatus: 'created',
    });
  });

  it('8. fails with sanitized error if conversation race recovery retry returns 0 matches', async () => {
    const { client } = createMockResourceClient({
      list: async () => [],
      create: async () => {
        throw new Error('Network creation failure');
      },
    });

    const repo = new ZaloMessageRepository(client, defaultOptions);

    await assert.rejects(
      async () => repo.persistMessage(sampleMessage),
      (err: unknown) => {
        assert.ok(err instanceof ZaloMessagePersistenceError);
        assert.ok(err.message.includes('Failed to persist conversation'));
        assert.equal(err.message.includes('Network creation failure'), false);
        return true;
      }
    );
  });

  it('9. recovers from message creation race condition via exact 1 retry lookup', async () => {
    let msgListCalls = 0;

    const { client } = createMockResourceClient({
      list: async (doctype) => {
        if (doctype === ZALO_CONVERSATION_DOCTYPE) return [{ name: 'CONV-001' }];
        if (doctype === ZALO_MESSAGE_DOCTYPE) {
          msgListCalls++;
          if (msgListCalls === 1) return [];
          return [{ name: 'MSG-RACE-RECOVERED' }];
        }
        return [];
      },
      create: async (doctype) => {
        if (doctype === ZALO_MESSAGE_DOCTYPE) {
          throw new Error('Duplicate key error on custom_message_key');
        }
        return { name: 'CONV-001' };
      },
    });

    const repo = new ZaloMessageRepository(client, defaultOptions);
    const result = await repo.persistMessage(sampleMessage);

    assert.deepEqual(result, {
      conversationName: 'CONV-001',
      conversationStatus: 'existing',
      messageName: 'MSG-RACE-RECOVERED',
      messageStatus: 'existing',
    });
  });

  it('10. never calls update, delete, or Zalo OA Customer creation', async () => {
    const { client, calls } = createMockResourceClient({
      list: async () => [],
      create: async (doctype) => ({ name: `${doctype}-1` }),
    });

    const repo = new ZaloMessageRepository(client, defaultOptions);
    await repo.persistMessage(sampleMessage);

    assert.equal(calls.filter((c) => c.method === 'update').length, 0);
    assert.equal(calls.filter((c) => c.method === 'delete').length, 0);
    assert.equal(calls.filter((c) => c.doctype === ZALO_CUSTOMER_DOCTYPE).length, 0);
  });

  it('11. leaves input message object unmodified and frozen', async () => {
    const originalInput = Object.freeze({ ...sampleMessage });
    const { client } = createMockResourceClient({
      list: async () => [],
      create: async (doctype) => ({ name: `${doctype}-1` }),
    });

    const repo = new ZaloMessageRepository(client, defaultOptions);
    await repo.persistMessage(originalInput);

    assert.deepEqual(originalInput, sampleMessage);
    assert.ok(Object.isFrozen(originalInput));
  });
});
