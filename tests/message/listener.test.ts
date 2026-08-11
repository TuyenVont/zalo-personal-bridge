import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ZaloMessageListenerManager } from '../../src/message/listener.js';
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

describe('ZaloMessageListenerManager', () => {
  it('1. disconnected account cannot start listener', async () => {
    const reader = new MockConnectionReader();
    reader.setInstance('acc-1', 'disconnected');
    const manager = new ZaloMessageListenerManager(reader);

    await assert.rejects(
      async () => {
        await manager.start('acc-1', () => {});
      },
      {
        message: /account status is 'disconnected'/i,
      },
    );
  });

  it('2. connected account with missing API cannot start listener', async () => {
    const reader = new MockConnectionReader();
    reader.setInstance('acc-1', 'connected', null);
    const manager = new ZaloMessageListenerManager(reader);

    await assert.rejects(
      async () => {
        await manager.start('acc-1', () => {});
      },
      {
        message: /Zalo API instance is missing/i,
      },
    );
  });

  it('3. invalid/missing api.listener is rejected', async () => {
    const reader = new MockConnectionReader();
    reader.setInstance('acc-1', 'connected', { listener: null });
    const manager = new ZaloMessageListenerManager(reader);

    await assert.rejects(
      async () => {
        await manager.start('acc-1', () => {});
      },
      {
        message: /Zalo API listener is invalid or missing/i,
      },
    );

    // Missing start method
    reader.setInstance('acc-2', 'connected', { listener: { on: () => {} } });
    await assert.rejects(
      async () => {
        await manager.start('acc-2', () => {});
      },
      {
        message: /Zalo API listener is invalid or missing/i,
      },
    );
  });

  it('4. start registers exactly one "message" callback', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();
    reader.setInstance('acc-1', 'connected', { listener: mockListener });

    const manager = new ZaloMessageListenerManager(reader);
    await manager.start('acc-1', () => {});

    const registered = mockListener.listeners.get('message') ?? [];
    assert.equal(registered.length, 1);
  });

  it('5. start calls the listener start method exactly once', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();
    reader.setInstance('acc-1', 'connected', { listener: mockListener });

    const manager = new ZaloMessageListenerManager(reader);
    await manager.start('acc-1', () => {});

    assert.equal(mockListener.startCalls, 1);
  });

  it('6. emitted raw message is forwarded to handler with the correct accountId', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();
    reader.setInstance('acc-1', 'connected', { listener: mockListener });

    const manager = new ZaloMessageListenerManager(reader);

    let receivedAccountId: string | null = null;
    let receivedPayload: any = null;

    await manager.start('acc-1', (accId, raw) => {
      receivedAccountId = accId;
      receivedPayload = raw;
    });

    const testMsg = { msgId: '12345', data: 'hello' };
    mockListener.emit('message', testMsg);

    assert.equal(receivedAccountId, 'acc-1');
    assert.strictEqual(receivedPayload, testMsg);
  });

  it('7. raw message object is forwarded without mutation', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();
    reader.setInstance('acc-1', 'connected', { listener: mockListener });

    const manager = new ZaloMessageListenerManager(reader);

    const originalMsg = Object.freeze({
      msgId: 'msg-999',
      content: 'test content',
      sender: { id: 'user-1' },
    });

    let capturedMsg: any = null;
    await manager.start('acc-1', (_accId, raw) => {
      capturedMsg = raw;
    });

    mockListener.emit('message', originalMsg);

    assert.strictEqual(capturedMsg, originalMsg);
    assert.deepEqual(capturedMsg, {
      msgId: 'msg-999',
      content: 'test content',
      sender: { id: 'user-1' },
    });
  });

  it('8. starting same account twice does not duplicate registration', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();
    reader.setInstance('acc-1', 'connected', { listener: mockListener });

    const manager = new ZaloMessageListenerManager(reader);

    await manager.start('acc-1', () => {});
    await manager.start('acc-1', () => {});

    const registered = mockListener.listeners.get('message') ?? [];
    assert.equal(registered.length, 1);
  });

  it('9. starting same account twice does not start underlying listener twice', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();
    reader.setInstance('acc-1', 'connected', { listener: mockListener });

    const manager = new ZaloMessageListenerManager(reader);

    await manager.start('acc-1', () => {});
    await manager.start('acc-1', () => {});

    assert.equal(mockListener.startCalls, 1);
  });

  it('10. different accounts can start independently', async () => {
    const reader = new MockConnectionReader();
    const mockListener1 = new MockZaloListener();
    const mockListener2 = new MockZaloListener();

    reader.setInstance('acc-1', 'connected', { listener: mockListener1 });
    reader.setInstance('acc-2', 'connected', { listener: mockListener2 });

    const manager = new ZaloMessageListenerManager(reader);

    const received: string[] = [];

    await manager.start('acc-1', (accId) => received.push(`acc-1:${accId}`));
    await manager.start('acc-2', (accId) => received.push(`acc-2:${accId}`));

    assert.equal(manager.isListening('acc-1'), true);
    assert.equal(manager.isListening('acc-2'), true);
    assert.equal(mockListener1.startCalls, 1);
    assert.equal(mockListener2.startCalls, 1);

    mockListener1.emit('message', { msg: 1 });
    mockListener2.emit('message', { msg: 2 });

    assert.deepEqual(received, ['acc-1:acc-1', 'acc-2:acc-2']);
  });

  it('11. isListening reflects local listener state', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();
    reader.setInstance('acc-1', 'connected', { listener: mockListener });

    const manager = new ZaloMessageListenerManager(reader);

    assert.equal(manager.isListening('acc-1'), false);

    await manager.start('acc-1', () => {});
    assert.equal(manager.isListening('acc-1'), true);

    await manager.stop('acc-1');
    assert.equal(manager.isListening('acc-1'), false);
  });

  it('12. rejected async consumer handler does not cause an unhandled rejection', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();
    reader.setInstance('acc-1', 'connected', { listener: mockListener });

    const manager = new ZaloMessageListenerManager(reader);

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };

    process.on('unhandledRejection', onUnhandledRejection);

    try {
      await manager.start('acc-1', async () => {
        throw new Error('Async consumer failure');
      });

      mockListener.emit('message', { msg: 'fail' });

      // Wait one event-loop turn using setImmediate (NOT setTimeout)
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.equal(unhandledRejections.length, 0);
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection);
    }
  });

  it('13. stop removes/stops listening correctly', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();
    reader.setInstance('acc-1', 'connected', { listener: mockListener });

    const manager = new ZaloMessageListenerManager(reader);

    let count = 0;
    await manager.start('acc-1', () => {
      count++;
    });

    mockListener.emit('message', { test: 1 });
    assert.equal(count, 1);

    await manager.stop('acc-1');

    assert.equal(mockListener.stopCalls, 1);
    const registered = mockListener.listeners.get('message') ?? [];
    assert.equal(registered.length, 0);

    mockListener.emit('message', { test: 2 });
    assert.equal(count, 1); // Handler should not be invoked after stop

    // Connection status in pool must remain 'connected'
    assert.equal(reader.getStatus('acc-1'), 'connected');
  });

  it('14. stop is idempotent', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();
    reader.setInstance('acc-1', 'connected', { listener: mockListener });

    const manager = new ZaloMessageListenerManager(reader);

    await manager.start('acc-1', () => {});

    await manager.stop('acc-1');
    await manager.stop('acc-1');
    await manager.stop('acc-1');

    assert.equal(mockListener.stopCalls, 1);
    assert.equal(manager.isListening('acc-1'), false);
  });

  it('15. one account stopping does not affect another account\'s bookkeeping', async () => {
    const reader = new MockConnectionReader();
    const mockListener1 = new MockZaloListener();
    const mockListener2 = new MockZaloListener();

    reader.setInstance('acc-1', 'connected', { listener: mockListener1 });
    reader.setInstance('acc-2', 'connected', { listener: mockListener2 });

    const manager = new ZaloMessageListenerManager(reader);

    await manager.start('acc-1', () => {});
    await manager.start('acc-2', () => {});

    assert.equal(manager.isListening('acc-1'), true);
    assert.equal(manager.isListening('acc-2'), true);

    await manager.stop('acc-1');

    assert.equal(manager.isListening('acc-1'), false);
    assert.equal(manager.isListening('acc-2'), true);

    assert.equal(mockListener1.stopCalls, 1);
    assert.equal(mockListener2.stopCalls, 0);
  });

  it('16. start-failure cleanup removes callback and allows subsequent start', async () => {
    const reader = new MockConnectionReader();
    const mockListener = new MockZaloListener();

    let shouldFail = true;
    mockListener.start = () => {
      if (shouldFail) {
        throw new Error('WebSocket connection failed during start');
      }
      mockListener.startCalls++;
    };

    reader.setInstance('acc-1', 'connected', { listener: mockListener });
    const manager = new ZaloMessageListenerManager(reader);

    // 1. Verify manager.start() rejects with that error
    await assert.rejects(
      async () => {
        await manager.start('acc-1', () => {});
      },
      {
        message: /WebSocket connection failed during start/i,
      },
    );

    // 2. Verify registered "message" callback is removed
    const registeredAfterFail = mockListener.listeners.get('message') ?? [];
    assert.equal(registeredAfterFail.length, 0);

    // 3. Verify manager.isListening(accountId) remains false
    assert.equal(manager.isListening('acc-1'), false);

    // 4. A subsequent start attempt on the same account can succeed
    shouldFail = false;
    await manager.start('acc-1', () => {});

    assert.equal(manager.isListening('acc-1'), true);

    // 5. Verify there is no duplicate callback left from the failed attempt
    const registeredAfterSuccess = mockListener.listeners.get('message') ?? [];
    assert.equal(registeredAfterSuccess.length, 1);
  });
});

