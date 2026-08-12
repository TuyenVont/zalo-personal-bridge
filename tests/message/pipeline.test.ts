import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ZaloMessagePipeline } from '../../src/message/pipeline.js';
import { ZaloMessageListenerManager } from '../../src/message/listener.js';
import { ZaloMessageDeduplicator } from '../../src/message/dedup.js';
import type { NormalizedZaloMessage } from '../../src/message/normalized.js';
import type { IZaloConnectionReader, ZaloAccountStatus, ZaloInstance } from '../../src/zalo/types.js';

class MockZaloListener {
  public listeners = new Map<string, Array<(data: any) => void>>();
  public startCalls = 0;
  public stopCalls = 0;

  public on(event: string, callback: (data: any) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(callback);
    this.listeners.set(event, list);
  }

  public off(event: string, callback: (data: any) => void): void {
    const list = this.listeners.get(event) ?? [];
    const filtered = list.filter((cb) => cb !== callback);
    this.listeners.set(event, filtered);
  }

  public removeListener(event: string, callback: (data: any) => void): void {
    this.off(event, callback);
  }

  public start(): void {
    this.startCalls++;
  }

  public stop(): void {
    this.stopCalls++;
  }

  public emit(event: string, data: any): void {
    const list = this.listeners.get(event) ?? [];
    for (const cb of list) {
      cb(data);
    }
  }
}

class MockConnectionReader implements IZaloConnectionReader {
  public instances = new Map<string, ZaloInstance>();

  public getInstance(accountId: string): ZaloInstance | null {
    return this.instances.get(accountId) ?? null;
  }

  public getStatus(accountId: string): ZaloAccountStatus {
    return this.instances.get(accountId)?.status ?? 'disconnected';
  }

  public setInstance(
    accountId: string,
    status: ZaloAccountStatus,
    api: any = null,
  ): void {
    this.instances.set(accountId, {
      accountId,
      status,
      zaloUid: status === 'connected' ? 'zalo-uid-123' : null,
      api,
    });
  }
}

function createTestHarness() {
  const reader = new MockConnectionReader();
  const mockListener1 = new MockZaloListener();
  const mockListener2 = new MockZaloListener();

  reader.setInstance('acc-1', 'connected', { listener: mockListener1 });
  reader.setInstance('acc-2', 'connected', { listener: mockListener2 });

  const listenerManager = new ZaloMessageListenerManager(reader);
  const deduplicator = new ZaloMessageDeduplicator();
  const pipeline = new ZaloMessagePipeline(listenerManager, deduplicator);

  return {
    reader,
    mockListener1,
    mockListener2,
    listenerManager,
    deduplicator,
    pipeline,
  };
}

describe('ZaloMessagePipeline (Developer B Phase B2.4)', () => {
  it('1. start delegates to listener for correct accountId', async () => {
    const { pipeline, listenerManager } = createTestHarness();

    assert.equal(pipeline.isListening('acc-1'), false);
    await pipeline.start('acc-1', () => {});
    assert.equal(pipeline.isListening('acc-1'), true);
    assert.equal(listenerManager.isListening('acc-1'), true);
  });

  it('2. valid raw event is parsed and delivered as NormalizedZaloMessage', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    const received: NormalizedZaloMessage[] = [];

    await pipeline.start('acc-1', (msg) => {
      received.push(msg);
    });

    const rawMsg = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: {
        msgId: 'msg-1',
        uidFrom: 'user-100',
        ts: '1700000000000',
        content: 'Hello world',
        msgType: 'webchat',
      },
    };

    mockListener1.emit('message', rawMsg);

    assert.equal(received.length, 1);
    assert.deepEqual(received[0], {
      accountId: 'acc-1',
      messageId: 'msg-1',
      threadId: 'user-100',
      senderId: 'user-100',
      timestamp: 1700000000000,
      textContent: 'Hello world',
      threadType: 'user',
      direction: 'incoming',
      msgType: 'webchat',
    });
  });

  it('3. incoming direction is preserved', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let capturedDirection: string | null = null;

    await pipeline.start('acc-1', (msg) => {
      capturedDirection = msg.direction;
    });

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: {
        msgId: 'msg-inc',
        uidFrom: 'user-100',
        ts: '1700000000000',
      },
    });

    assert.equal(capturedDirection, 'incoming');
  });

  it('4. outgoing direction is preserved', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let capturedDirection: string | null = null;

    await pipeline.start('acc-1', (msg) => {
      capturedDirection = msg.direction;
    });

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: true,
      data: {
        msgId: 'msg-out',
        uidFrom: 'my-uid',
        ts: '1700000000000',
      },
    });

    assert.equal(capturedDirection, 'outgoing');
  });

  it('5. User thread type is preserved', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let capturedThreadType: string | null = null;

    await pipeline.start('acc-1', (msg) => {
      capturedThreadType = msg.threadType;
    });

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: {
        msgId: 'msg-u',
        uidFrom: 'user-100',
        ts: '1700000000000',
      },
    });

    assert.equal(capturedThreadType, 'user');
  });

  it('6. Group thread type is preserved', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let capturedThreadType: string | null = null;

    await pipeline.start('acc-1', (msg) => {
      capturedThreadType = msg.threadType;
    });

    mockListener1.emit('message', {
      threadId: 'group-200',
      type: 1,
      isSelf: false,
      data: {
        msgId: 'msg-g',
        uidFrom: 'user-101',
        ts: '1700000000000',
      },
    });

    assert.equal(capturedThreadType, 'group');
  });

  it('7. malformed raw event is dropped', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let callCount = 0;

    await pipeline.start('acc-1', () => {
      callCount++;
    });

    mockListener1.emit('message', { invalid: 'payload' });
    mockListener1.emit('message', null);
    mockListener1.emit('message', 'string-payload');

    assert.equal(callCount, 0);
  });

  it('8. unsupported wrapper type is dropped', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let callCount = 0;

    await pipeline.start('acc-1', () => {
      callCount++;
    });

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 99, // unsupported type
      isSelf: false,
      data: {
        msgId: 'msg-unsupported',
        uidFrom: 'user-100',
        ts: '1700000000000',
      },
    });

    assert.equal(callCount, 0);
  });

  it('9. malformed event does not call deduplicator', async () => {
    const { listenerManager, mockListener1 } = createTestHarness();
    let dedupCheckCount = 0;

    const mockDedup = {
      checkAndMark: () => {
        dedupCheckCount++;
        return 'accepted' as const;
      },
      clear: () => {},
      size: 0,
    } as any;

    const pipeline = new ZaloMessagePipeline(listenerManager, mockDedup);
    await pipeline.start('acc-1', () => {});

    mockListener1.emit('message', { malformed: true });

    assert.equal(dedupCheckCount, 0);
  });

  it('10. malformed event does not call normalized consumer', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let consumerCalled = false;

    await pipeline.start('acc-1', () => {
      consumerCalled = true;
    });

    mockListener1.emit('message', { type: 0, missingData: true });

    assert.equal(consumerCalled, false);
  });

  it('11. first valid event is accepted and delivered', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    const delivered: string[] = [];

    await pipeline.start('acc-1', (msg) => {
      delivered.push(msg.messageId);
    });

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: {
        msgId: 'first-msg',
        uidFrom: 'user-100',
        ts: '1700000000000',
      },
    });

    assert.deepEqual(delivered, ['first-msg']);
  });

  it('12. exact duplicate event is not delivered twice', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let count = 0;

    await pipeline.start('acc-1', () => {
      count++;
    });

    const rawMsg = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: {
        msgId: 'msg-dup',
        uidFrom: 'user-100',
        ts: '1700000000000',
      },
    };

    mockListener1.emit('message', rawMsg);
    mockListener1.emit('message', rawMsg);

    assert.equal(count, 1);
  });

  it('13. duplicate event does not call normalized consumer', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let consumerCallCount = 0;

    await pipeline.start('acc-1', () => {
      consumerCallCount++;
    });

    const rawMsg = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: {
        msgId: 'msg-dup-2',
        uidFrom: 'user-100',
        ts: '1700000000000',
      },
    };

    mockListener1.emit('message', rawMsg);
    assert.equal(consumerCallCount, 1);

    mockListener1.emit('message', rawMsg);
    assert.equal(consumerCallCount, 1);
  });

  it('14. different messageId is delivered', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    const deliveredMsgIds: string[] = [];

    await pipeline.start('acc-1', (msg) => {
      deliveredMsgIds.push(msg.messageId);
    });

    const msgA = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'id-1', uidFrom: 'user-100', ts: '1700000000000' },
    };
    const msgB = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'id-2', uidFrom: 'user-100', ts: '1700000001000' },
    };

    mockListener1.emit('message', msgA);
    mockListener1.emit('message', msgB);

    assert.deepEqual(deliveredMsgIds, ['id-1', 'id-2']);
  });

  it('15. same identity with changed text/content remains duplicate', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    const deliveredTexts: Array<string | null> = [];

    await pipeline.start('acc-1', (msg) => {
      deliveredTexts.push(msg.textContent);
    });

    const original = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: {
        msgId: 'id-same',
        uidFrom: 'user-100',
        ts: '1700000000000',
        content: 'Original text',
      },
    };
    const modified = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: {
        msgId: 'id-same',
        uidFrom: 'user-100',
        ts: '1700000000000',
        content: 'Edited text',
      },
    };

    mockListener1.emit('message', original);
    mockListener1.emit('message', modified);

    assert.deepEqual(deliveredTexts, ['Original text']);
  });

  it('16. same identity with changed direction remains duplicate', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let count = 0;

    await pipeline.start('acc-1', () => {
      count++;
    });

    const incoming = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'id-same-dir', uidFrom: 'user-100', ts: '1700000000000' },
    };
    const outgoing = {
      threadId: 'user-100',
      type: 0,
      isSelf: true,
      data: { msgId: 'id-same-dir', uidFrom: 'user-100', ts: '1700000000000' },
    };

    mockListener1.emit('message', incoming);
    mockListener1.emit('message', outgoing);

    assert.equal(count, 1);
  });

  it('17. same messageId in different account is independently delivered', async () => {
    const { pipeline, mockListener1, mockListener2 } = createTestHarness();
    const receivedAccounts: string[] = [];

    await pipeline.start('acc-1', (msg) => {
      receivedAccounts.push(`acc-1:${msg.accountId}:${msg.messageId}`);
    });
    await pipeline.start('acc-2', (msg) => {
      receivedAccounts.push(`acc-2:${msg.accountId}:${msg.messageId}`);
    });

    const msg = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'shared-msg-id', uidFrom: 'user-100', ts: '1700000000000' },
    };

    mockListener1.emit('message', msg);
    mockListener2.emit('message', msg);

    assert.deepEqual(receivedAccounts, [
      'acc-1:acc-1:shared-msg-id',
      'acc-2:acc-2:shared-msg-id',
    ]);
  });

  it('18. normalized handler receives no raw payload argument', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let argumentCount = 0;

    await pipeline.start('acc-1', (...args: any[]) => {
      argumentCount = args.length;
    });

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'arg-test', uidFrom: 'user-100', ts: '1700000000000' },
    });

    assert.equal(argumentCount, 1);
  });

  it('19. normalized output contains no raw event reference', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let capturedKeys: string[] = [];

    await pipeline.start('acc-1', (msg) => {
      capturedKeys = Object.keys(msg);
    });

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: {
        msgId: 'ref-test',
        uidFrom: 'user-100',
        ts: '1700000000000',
        content: 'test',
        extraSDKField: 'secret-sdk-data',
      },
    });

    assert.deepEqual(capturedKeys.sort(), [
      'accountId',
      'direction',
      'messageId',
      'msgType',
      'senderId',
      'textContent',
      'threadId',
      'threadType',
      'timestamp',
    ]);
    assert.equal(capturedKeys.includes('extraSDKField'), false);
    assert.equal(capturedKeys.includes('data'), false);
    assert.equal(capturedKeys.includes('rawMessage'), false);
  });

  it('20. raw event is not mutated', async () => {
    const { pipeline, mockListener1 } = createTestHarness();

    const rawMsg = Object.freeze({
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: Object.freeze({
        msgId: 'freeze-test',
        uidFrom: 'user-100',
        ts: '1700000000000',
        content: 'do not mutate me',
      }),
    });

    await pipeline.start('acc-1', () => {});

    assert.doesNotThrow(() => {
      mockListener1.emit('message', rawMsg);
    });
  });

  it('21. normalized consumer sync throw does not corrupt pipeline lifecycle', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let deliveredAfterThrow = false;

    await pipeline.start('acc-1', (msg) => {
      if (msg.messageId === 'msg-throw') {
        throw new Error('Sync consumer crash');
      }
      if (msg.messageId === 'msg-after') {
        deliveredAfterThrow = true;
      }
    });

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'msg-throw', uidFrom: 'user-100', ts: '1700000000000' },
    });

    assert.equal(pipeline.isListening('acc-1'), true);

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'msg-after', uidFrom: 'user-100', ts: '1700000001000' },
    });

    assert.equal(deliveredAfterThrow, true);
  });

  it('22. normalized consumer async rejection does not create an unhandled rejection when invoked through the existing listener boundary', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    const unhandledRejections: unknown[] = [];

    const onUnhandled = (reason: unknown) => {
      unhandledRejections.push(reason);
    };

    process.on('unhandledRejection', onUnhandled);

    try {
      await pipeline.start('acc-1', async () => {
        throw new Error('Async handler rejection');
      });

      mockListener1.emit('message', {
        threadId: 'user-100',
        type: 0,
        isSelf: false,
        data: { msgId: 'async-fail', uidFrom: 'user-100', ts: '1700000000000' },
      });

      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.equal(unhandledRejections.length, 0);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('23. accepted message remains deduplicated even if normalized consumer throws/rejects', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let handlerCallCount = 0;

    await pipeline.start('acc-1', async () => {
      handlerCallCount++;
      throw new Error('Downstream failure during persistence');
    });

    const msg = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'msg-fail-dedup', uidFrom: 'user-100', ts: '1700000000000' },
    };

    mockListener1.emit('message', msg);
    assert.equal(handlerCallCount, 1);

    // Emit exact same raw message again after consumer failed
    mockListener1.emit('message', msg);

    // Dedup still rejected the second emission, so handler was NOT called again
    assert.equal(handlerCallCount, 1);
  });

  it('24. stop delegates to existing listener manager', async () => {
    const { pipeline, listenerManager, mockListener1 } = createTestHarness();

    await pipeline.start('acc-1', () => {});
    assert.equal(pipeline.isListening('acc-1'), true);

    await pipeline.stop('acc-1');

    assert.equal(pipeline.isListening('acc-1'), false);
    assert.equal(listenerManager.isListening('acc-1'), false);
    assert.equal(mockListener1.stopCalls, 1);
  });

  it('25. stop does not clear dedup state', async () => {
    const { pipeline, mockListener1, deduplicator } = createTestHarness();

    await pipeline.start('acc-1', () => {});

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'msg-persist-dedup', uidFrom: 'user-100', ts: '1700000000000' },
    });

    assert.equal(deduplicator.size, 1);

    await pipeline.stop('acc-1');

    assert.equal(deduplicator.size, 1);
  });

  it('26. stop then start within same pipeline instance still rejects a recently-seen duplicate within TTL', async () => {
    const { pipeline, mockListener1 } = createTestHarness();
    let count = 0;

    await pipeline.start('acc-1', () => {
      count++;
    });

    const msg = {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'msg-restart-dedup', uidFrom: 'user-100', ts: '1700000000000' },
    };

    mockListener1.emit('message', msg);
    assert.equal(count, 1);

    await pipeline.stop('acc-1');
    await pipeline.start('acc-1', () => {
      count++;
    });

    mockListener1.emit('message', msg);
    assert.equal(count, 1); // Second start still rejects duplicate
  });

  it('27. isListening delegates to listener manager', async () => {
    const { pipeline } = createTestHarness();

    assert.equal(pipeline.isListening('acc-1'), false);
    await pipeline.start('acc-1', () => {});
    assert.equal(pipeline.isListening('acc-1'), true);
    await pipeline.stop('acc-1');
    assert.equal(pipeline.isListening('acc-1'), false);
  });

  it('28. different accounts remain independent', async () => {
    const { pipeline, mockListener1, mockListener2 } = createTestHarness();
    const events: string[] = [];

    await pipeline.start('acc-1', (msg) => {
      events.push(`acc-1:${msg.messageId}`);
    });
    await pipeline.start('acc-2', (msg) => {
      events.push(`acc-2:${msg.messageId}`);
    });

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'm1', uidFrom: 'user-100', ts: '1700000000000' },
    });
    mockListener2.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'm2', uidFrom: 'user-100', ts: '1700000000000' },
    });

    assert.deepEqual(events, ['acc-1:m1', 'acc-2:m2']);

    await pipeline.stop('acc-1');

    assert.equal(pipeline.isListening('acc-1'), false);
    assert.equal(pipeline.isListening('acc-2'), true);
  });

  it('29. deduplicator instance is reused rather than recreated per message', async () => {
    const { listenerManager, mockListener1 } = createTestHarness();
    const customDedup = new ZaloMessageDeduplicator();
    const pipeline = new ZaloMessagePipeline(listenerManager, customDedup);

    await pipeline.start('acc-1', () => {});

    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'reuse-1', uidFrom: 'user-100', ts: '1700000000000' },
    });
    mockListener1.emit('message', {
      threadId: 'user-100',
      type: 0,
      isSelf: false,
      data: { msgId: 'reuse-2', uidFrom: 'user-100', ts: '1700000001000' },
    });

    assert.equal(customDedup.size, 2);
  });

  it('30. no raw payload/content is included in sanitized error messages', async () => {
    const listenerManager = null as any;

    assert.throws(
      () => {
        new ZaloMessagePipeline(listenerManager);
      },
      (err: any) => {
        assert.match(err.message, /listenerManager must be provided/i);
        assert.equal(err.message.includes('cookie'), false);
        assert.equal(err.message.includes('imei'), false);
        return true;
      },
    );

    const { pipeline } = createTestHarness();
    await assert.rejects(
      async () => {
        await pipeline.start('acc-1', null as any);
      },
      (err: any) => {
        assert.match(err.message, /handler must be a function/i);
        return true;
      },
    );
  });
});
