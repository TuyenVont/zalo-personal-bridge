import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ZaloAccountPool, IQrClientLike } from '../../src/zalo/pool.js';
import { ZaloQrEvent } from '../../src/zalo/types.js';

describe('ZaloAccountPool', () => {
  it('1. createOrGetInstance creates default disconnected instance', () => {
    const pool = new ZaloAccountPool();
    const instance = pool.createOrGetInstance('acc-1');

    assert.equal(instance.accountId, 'acc-1');
    assert.equal(instance.status, 'disconnected');
    assert.equal(instance.zaloUid, null);
    assert.equal(instance.api, null);
  });

  it('2. same accountId returns the same stored instance', () => {
    const pool = new ZaloAccountPool();
    const inst1 = pool.createOrGetInstance('acc-1');
    const inst2 = pool.createOrGetInstance('acc-1');
    const inst3 = pool.getInstance('acc-1');

    assert.strictEqual(inst1, inst2);
    assert.strictEqual(inst1, inst3);
  });

  it('3. getStatus for unknown account returns disconnected', () => {
    const pool = new ZaloAccountPool();

    assert.equal(pool.getStatus('unknown-acc'), 'disconnected');
    assert.equal(pool.getInstance('unknown-acc'), null);
  });

  it('4. updateInstance updates status/zaloUid/api and prevents accountId mutation', () => {
    const pool = new ZaloAccountPool();
    pool.createOrGetInstance('acc-1');

    const mockApi = { sendMessage: () => { } };
    const updated = pool.updateInstance('acc-1', {
      status: 'connected',
      zaloUid: 'zalo-uid-123',
      api: mockApi,
      accountId: 'hacked-id',
    } as any);

    assert.notEqual(updated, null);
    assert.equal(updated?.accountId, 'acc-1');
    assert.equal(updated?.status, 'connected');
    assert.equal(updated?.zaloUid, 'zalo-uid-123');
    assert.strictEqual(updated?.api, mockApi);

    // Verify stored instance matches
    const stored = pool.getInstance('acc-1');
    assert.equal(stored?.accountId, 'acc-1');
    assert.equal(stored?.status, 'connected');
    assert.equal(stored?.zaloUid, 'zalo-uid-123');

    // Updating non-existent account returns null
    assert.equal(pool.updateInstance('unknown-acc', { status: 'connecting' }), null);
  });

  it('5. removeInstance removes the instance', () => {
    const pool = new ZaloAccountPool();
    pool.createOrGetInstance('acc-1');

    assert.notEqual(pool.getInstance('acc-1'), null);
    const removed = pool.removeInstance('acc-1');
    assert.equal(removed, true);
    assert.equal(pool.getInstance('acc-1'), null);
    assert.equal(pool.getStatus('acc-1'), 'disconnected');

    // Subsequent remove returns false
    assert.equal(pool.removeInstance('acc-1'), false);
  });

  it('6. same-account concurrent operations execute sequentially', async () => {
    const pool = new ZaloAccountPool();
    const executionOrder: string[] = [];

    const op1 = pool.withAccountLock('acc-1', async () => {
      executionOrder.push('op1-start');
      await new Promise((resolve) => setTimeout(resolve, 50));
      executionOrder.push('op1-end');
      return 'op1-result';
    });

    const op2 = pool.withAccountLock('acc-1', async () => {
      executionOrder.push('op2-start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push('op2-end');
      return 'op2-result';
    });

    const [res1, res2] = await Promise.all([op1, op2]);

    assert.equal(res1, 'op1-result');
    assert.equal(res2, 'op2-result');
    assert.deepEqual(executionOrder, [
      'op1-start',
      'op1-end',
      'op2-start',
      'op2-end',
    ]);
    assert.equal(pool.activeLockCount, 0);
  });

  it('7. different-account operations can run independently', async () => {
    const pool = new ZaloAccountPool();
    const executionOrder: string[] = [];

    const op1 = pool.withAccountLock('acc-1', async () => {
      executionOrder.push('acc1-start');
      await new Promise((resolve) => setTimeout(resolve, 50));
      executionOrder.push('acc1-end');
    });

    const op2 = pool.withAccountLock('acc-2', async () => {
      executionOrder.push('acc2-start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push('acc2-end');
    });

    await Promise.all([op1, op2]);

    // acc2 starts before acc1 ends because they are on different account locks
    assert.equal(executionOrder[0], 'acc1-start');
    assert.equal(executionOrder[1], 'acc2-start');
    assert.equal(executionOrder[2], 'acc2-end');
    assert.equal(executionOrder[3], 'acc1-end');
    assert.equal(pool.activeLockCount, 0);
  });

  it('8. lock is released after an operation throws', async () => {
    const pool = new ZaloAccountPool();

    const op1 = pool.withAccountLock('acc-1', async () => {
      throw new Error('Op1 failed');
    });

    await assert.rejects(op1, { message: 'Op1 failed' });
    assert.equal(pool.activeLockCount, 0);

    // Subsequent operation on same account should succeed and not deadlock
    const op2 = pool.withAccountLock('acc-1', async () => {
      return 'op2-success';
    });

    const res2 = await op2;
    assert.equal(res2, 'op2-success');
    assert.equal(pool.activeLockCount, 0);
  });

  it('9. verifies lock map entry is deleted only after the final queued operation finishes', async () => {
    const pool = new ZaloAccountPool();
    assert.equal(pool.activeLockCount, 0);

    const op1 = pool.withAccountLock('acc-1', async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const op2 = pool.withAccountLock('acc-1', async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // While op1 and op2 are queued/executing, lock map entry must exist
    assert.equal(pool.activeLockCount, 1);

    await Promise.all([op1, op2]);

    // After all queued operations for acc-1 complete, lock map must be cleaned up to 0 entries
    assert.equal(pool.activeLockCount, 0);
  });

  // --- Phase A3.4 startQrLogin Tests ---

  it('10. startQrLogin starts with qr_pending status', async () => {
    const pool = new ZaloAccountPool();
    let barrierResolve!: () => void;
    const barrier = new Promise<void>((resolve) => {
      barrierResolve = resolve;
    });

    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async (_onQrEvent) => {
        await barrier;
        return {
          api: { mock: true },
          zaloUid: 'uid-100',
          credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
        };
      },
    });

    const qrPromise = pool.startQrLogin('acc-1', undefined, mockClientFactory);

    // Allow microtasks to settle so withAccountLock operation() begins execution
    await new Promise((r) => queueMicrotask(r));
    await Promise.resolve();

    // Assert status is qr_pending while loginQR is in-flight
    assert.equal(pool.getStatus('acc-1'), 'qr_pending');

    barrierResolve();
    await qrPromise;

    assert.equal(pool.getStatus('acc-1'), 'connected');
  });

  it('11. qr_generated is forwarded and status remains qr_pending', async () => {
    const pool = new ZaloAccountPool();
    const events: ZaloQrEvent[] = [];

    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async (onQrEvent) => {
        if (onQrEvent) {
          onQrEvent({ type: 'qr_generated', qrImage: 'data:image/png;base64,img' });
        }
        return {
          api: { mock: true },
          zaloUid: 'uid-100',
          credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
        };
      },
    });

    await pool.startQrLogin('acc-1', (e) => events.push(e), mockClientFactory);

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: 'qr_generated', qrImage: 'data:image/png;base64,img' });
  });

  it('12. qr_scanned transitions status to connecting', async () => {
    const pool = new ZaloAccountPool();
    const statusHistory: string[] = [];

    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async (onQrEvent) => {
        if (onQrEvent) {
          onQrEvent({ type: 'qr_scanned', displayName: 'John Doe' });
        }
        statusHistory.push(pool.getStatus('acc-1'));
        return {
          api: { mock: true },
          zaloUid: 'uid-100',
          credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
        };
      },
    });

    await pool.startQrLogin('acc-1', undefined, mockClientFactory);

    assert.equal(statusHistory[0], 'connecting');
    assert.equal(pool.getStatus('acc-1'), 'connected');
  });

  it('13. successful login transitions to connected and stores api + zaloUid', async () => {
    const pool = new ZaloAccountPool();
    const mockApi = { getOwnId: async () => 'uid-555' };

    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async () => ({
        api: mockApi,
        zaloUid: 'uid-555',
        credentials: { cookie: ['c1'], imei: 'i1', userAgent: 'u1' },
      }),
    });

    const instance = await pool.startQrLogin('acc-1', undefined, mockClientFactory);

    assert.equal(instance.status, 'connected');
    assert.equal(instance.zaloUid, 'uid-555');
    assert.strictEqual(instance.api, mockApi);

    // Verify getInstance in pool
    const stored = pool.getInstance('acc-1');
    assert.equal(stored?.status, 'connected');
    assert.equal(stored?.zaloUid, 'uid-555');
    assert.strictEqual(stored?.api, mockApi);
  });

  it('14. credentials returned by mocked ZaloClient are NOT stored in ZaloInstance', async () => {
    const pool = new ZaloAccountPool();

    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async () => ({
        api: {},
        zaloUid: 'uid-777',
        credentials: { cookie: 'SECRET_COOKIE', imei: 'SECRET_IMEI', userAgent: 'SECRET_UA' },
      }),
    });

    const instance = await pool.startQrLogin('acc-1', undefined, mockClientFactory);

    assert.equal((instance as any).credentials, undefined);
    assert.equal((instance as any).cookie, undefined);
    assert.equal((instance as any).imei, undefined);

    const stringified = JSON.stringify(instance);
    assert.equal(stringified.includes('SECRET_COOKIE'), false);
    assert.equal(stringified.includes('SECRET_IMEI'), false);
  });

  it('15. qr_expired transitions to needs_qr', async () => {
    const pool = new ZaloAccountPool();

    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async (onQrEvent) => {
        onQrEvent?.({
          type: 'qr_expired',
        });

        // Giả lập SDK bất thường vẫn resolve dù QR đã hết hạn.
        return {
          api: { mock: true },
          zaloUid: 'uid-100',
          credentials: {
            cookie: 'c',
            imei: 'i',
            userAgent: 'u',
          },
        };
      },
    });

    await assert.rejects(
      () =>
        pool.startQrLogin(
          'acc-1',
          undefined,
          mockClientFactory,
        ),
      {
        message:
          'QR login resolved after QR session reached a terminal state',
      },
    );

    const instance = pool.getInstance('acc-1');

    assert.notEqual(instance, null);
    assert.equal(instance?.status, 'needs_qr');
    assert.equal(instance?.api, null);
    assert.equal(instance?.zaloUid, null);
  });

  it('16. qr_declined transitions to needs_qr', async () => {
    const pool = new ZaloAccountPool();

    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async (onQrEvent) => {
        onQrEvent?.({
          type: 'qr_declined',
          code: 'user_declined',
        });

        // Giả lập SDK bất thường vẫn resolve dù QR đã bị từ chối.
        return {
          api: { mock: true },
          zaloUid: 'uid-100',
          credentials: {
            cookie: 'c',
            imei: 'i',
            userAgent: 'u',
          },
        };
      },
    });

    await assert.rejects(
      () =>
        pool.startQrLogin(
          'acc-1',
          undefined,
          mockClientFactory,
        ),
      {
        message:
          'QR login resolved after QR session reached a terminal state',
      },
    );

    const instance = pool.getInstance('acc-1');

    assert.notEqual(instance, null);
    assert.equal(instance?.status, 'needs_qr');
    assert.equal(instance?.api, null);
    assert.equal(instance?.zaloUid, null);
  });

  it('17. unexpected loginQR failure transitions to error and rethrows', async () => {
    const pool = new ZaloAccountPool();

    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async () => {
        throw new Error('Unexpected network crash');
      },
    });

    await assert.rejects(
      async () => pool.startQrLogin('acc-1', undefined, mockClientFactory),
      { message: 'Unexpected network crash' }
    );

    assert.equal(pool.getStatus('acc-1'), 'error');
    assert.equal(pool.getInstance('acc-1')?.api, null);
  });

  it('18. expired/declined state is preserved as needs_qr if SDK then rejects', async () => {
    const pool = new ZaloAccountPool();

    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async (onQrEvent) => {
        if (onQrEvent) {
          onQrEvent({ type: 'qr_expired' });
        }
        throw new Error('QR session expired SDK error');
      },
    });

    await assert.rejects(
      async () => pool.startQrLogin('acc-1', undefined, mockClientFactory),
      { message: 'QR session expired SDK error' }
    );

    // Status must be needs_qr, NOT overwritten by error
    assert.equal(pool.getStatus('acc-1'), 'needs_qr');
    assert.equal(pool.getInstance('acc-1')?.api, null);
  });

  it('19. two concurrent startQrLogin calls for the SAME account execute sequentially', async () => {
    const pool = new ZaloAccountPool();
    const executionOrder: string[] = [];

    const mockClientFactory1 = (): IQrClientLike => ({
      loginQR: async () => {
        executionOrder.push('op1-start');
        await new Promise((r) => setTimeout(r, 40));
        executionOrder.push('op1-end');
        return {
          api: { id: 1 },
          zaloUid: 'uid-1',
          credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
        };
      },
    });

    const mockClientFactory2 = (): IQrClientLike => ({
      loginQR: async () => {
        executionOrder.push('op2-start');
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push('op2-end');
        return {
          api: { id: 2 },
          zaloUid: 'uid-2',
          credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
        };
      },
    });

    const p1 = pool.startQrLogin('acc-1', undefined, mockClientFactory1);
    const p2 = pool.startQrLogin('acc-1', undefined, mockClientFactory2);

    await Promise.all([p1, p2]);

    assert.deepEqual(executionOrder, [
      'op1-start',
      'op1-end',
      'op2-start',
      'op2-end',
    ]);
  });

  it('20. QR login for DIFFERENT accounts is not globally blocked', async () => {
    const pool = new ZaloAccountPool();
    const executionOrder: string[] = [];

    const mockClientFactory1 = (): IQrClientLike => ({
      loginQR: async () => {
        executionOrder.push('acc1-start');
        await new Promise((r) => setTimeout(r, 40));
        executionOrder.push('acc1-end');
        return {
          api: { id: 1 },
          zaloUid: 'uid-1',
          credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
        };
      },
    });

    const mockClientFactory2 = (): IQrClientLike => ({
      loginQR: async () => {
        executionOrder.push('acc2-start');
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push('acc2-end');
        return {
          api: { id: 2 },
          zaloUid: 'uid-2',
          credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
        };
      },
    });

    const p1 = pool.startQrLogin('acc-1', undefined, mockClientFactory1);
    const p2 = pool.startQrLogin('acc-2', undefined, mockClientFactory2);

    await Promise.all([p1, p2]);

    assert.equal(executionOrder[0], 'acc1-start');
    assert.equal(executionOrder[1], 'acc2-start');
    assert.equal(executionOrder[2], 'acc2-end');
    assert.equal(executionOrder[3], 'acc1-end');
  });

  it('21. starting a fresh QR login clears stale api and stale zaloUid before authentication', async () => {
    const pool = new ZaloAccountPool();

    // Pre-populate with stale connected instance
    pool.createOrGetInstance('acc-1');
    pool.updateInstance('acc-1', {
      status: 'connected',
      zaloUid: 'stale-uid-123',
      api: { staleApi: true },
    });

    assert.equal(pool.getInstance('acc-1')?.zaloUid, 'stale-uid-123');

    let barrierResolve!: () => void;
    const barrier = new Promise<void>((r) => {
      barrierResolve = r;
    });

    let stateDuringAuth: any = null;

    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async () => {
        stateDuringAuth = {
          status: pool.getStatus('acc-1'),
          zaloUid: pool.getInstance('acc-1')?.zaloUid,
          api: pool.getInstance('acc-1')?.api,
        };
        await barrier;
        return {
          api: { freshApi: true },
          zaloUid: 'fresh-uid-456',
          credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
        };
      },
    });

    const loginPromise = pool.startQrLogin('acc-1', undefined, mockClientFactory);

    // Allow microtasks to settle so withAccountLock operation() begins execution
    await new Promise((r) => queueMicrotask(r));
    await Promise.resolve();

    // State captured during authentication should have cleared stale zaloUid and api
    assert.notEqual(stateDuringAuth, null);
    assert.equal(stateDuringAuth.status, 'qr_pending');
    assert.equal(stateDuringAuth.zaloUid, null);
    assert.equal(stateDuringAuth.api, null);

    barrierResolve();
    const finalInstance = await loginPromise;

    assert.equal(finalInstance.status, 'connected');
    assert.equal(finalInstance.zaloUid, 'fresh-uid-456');
    assert.deepEqual(finalInstance.api, { freshApi: true });
  });

  // --- Phase A4.3 Session Persistence & Restore Tests ---

  class MockSessionStore implements IZaloSessionStore {
    public sessions = new Map<string, PersistedZaloSession>();
    public saveCalls: { accountId: string; session: PersistedZaloSession }[] = [];
    public loadCalls: string[] = [];
    public removeCalls: string[] = [];
    public shouldFailSave = false;
    public shouldFailLoad = false;
    public shouldFailRemove = false;

    async save(accountId: string, session: PersistedZaloSession): Promise<void> {
      this.saveCalls.push({ accountId, session });
      if (this.shouldFailSave) {
        throw new Error('Mock SessionStore save failed');
      }
      this.sessions.set(accountId, session);
    }

    async load(accountId: string): Promise<PersistedZaloSession | null> {
      this.loadCalls.push(accountId);
      if (this.shouldFailLoad) {
        throw new Error('Mock SessionStore load failed');
      }
      return this.sessions.get(accountId) ?? null;
    }

    async remove(accountId: string): Promise<boolean> {
      this.removeCalls.push(accountId);
      if (this.shouldFailRemove) {
        throw new Error('Mock SessionStore remove failed');
      }
      return this.sessions.delete(accountId);
    }
  }

  const createDummyPersistedSession = (
    accountId = 'acc-1',
    zaloUid = 'uid-100'
  ): PersistedZaloSession => ({
    version: 1,
    accountId,
    zaloUid,
    credentials: {
      cookie: ['mock_cookie_123'],
      imei: 'mock_imei_456',
      userAgent: 'mock_ua_789',
    },
    savedAt: new Date().toISOString(),
  });

  it('22. pool without SessionStore preserves existing startQrLogin behavior', async () => {
    const pool = new ZaloAccountPool();
    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async () => ({
        api: { id: 22 },
        zaloUid: 'uid-22',
        credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
      }),
    });

    const instance = await pool.startQrLogin('acc-1', undefined, mockClientFactory);
    assert.equal(instance.status, 'connected');
    assert.equal(instance.zaloUid, 'uid-22');
  });

  it('23. successful QR login saves PersistedZaloSession with version 1, correct accountId, zaloUid, credentials, and valid savedAt', async () => {
    const store = new MockSessionStore();
    const pool = new ZaloAccountPool({ sessionStore: store });

    const mockCredentials = { cookie: ['c23'], imei: 'i23', userAgent: 'u23' };
    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async () => ({
        api: { id: 23 },
        zaloUid: 'uid-23',
        credentials: mockCredentials,
      }),
    });

    await pool.startQrLogin('acc-1', undefined, mockClientFactory);

    assert.equal(store.saveCalls.length, 1);
    const saved = store.saveCalls[0].session;
    assert.equal(saved.version, 1);
    assert.equal(saved.accountId, 'acc-1');
    assert.equal(saved.zaloUid, 'uid-23');
    assert.deepEqual(saved.credentials, mockCredentials);
    assert.equal(Number.isNaN(Date.parse(saved.savedAt)), false);
  });

  it('24. pool does NOT become connected before sessionStore.save resolves', async () => {
    const store = new MockSessionStore();
    let saveBarrierResolve!: () => void;
    const saveBarrier = new Promise<void>((r) => {
      saveBarrierResolve = r;
    });

    const originalSave = store.save.bind(store);
    store.save = async (accId, sess) => {
      await saveBarrier;
      return originalSave(accId, sess);
    };

    const pool = new ZaloAccountPool({ sessionStore: store });
    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async () => ({
        api: { id: 24 },
        zaloUid: 'uid-24',
        credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
      }),
    });

    const loginPromise = pool.startQrLogin('acc-1', undefined, mockClientFactory);

    await new Promise((r) => queueMicrotask(r));
    await Promise.resolve();

    // Pool status must not be connected while save is pending
    assert.notEqual(pool.getStatus('acc-1'), 'connected');

    saveBarrierResolve();
    const instance = await loginPromise;

    assert.equal(instance.status, 'connected');
  });

  it('25. sessionStore.save failure results in status error, api null, zaloUid null, and error rethrown', async () => {
    const store = new MockSessionStore();
    store.shouldFailSave = true;

    const pool = new ZaloAccountPool({ sessionStore: store });
    const mockClientFactory = (): IQrClientLike => ({
      loginQR: async () => ({
        api: { id: 25 },
        zaloUid: 'uid-25',
        credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
      }),
    });

    await assert.rejects(
      async () => pool.startQrLogin('acc-1', undefined, mockClientFactory),
      { message: 'Mock SessionStore save failed' }
    );

    const instance = pool.getInstance('acc-1');
    assert.equal(instance?.status, 'error');
    assert.equal(instance?.api, null);
    assert.equal(instance?.zaloUid, null);
  });

  it('26. restoreSession with no configured store throws sanitized config error and status becomes error', async () => {
    const pool = new ZaloAccountPool();

    await assert.rejects(
      async () => pool.restoreSession('acc-1'),
      { message: 'Zalo session store is not configured' }
    );

    assert.equal(pool.getStatus('acc-1'), 'error');
  });

  it('27. missing persisted session resulting in no SDK call, status needs_qr, api/zaloUid null', async () => {
    const store = new MockSessionStore();
    const pool = new ZaloAccountPool({ sessionStore: store });

    let sdkCalled = false;
    const mockSessionClientFactory = (): ISessionClientLike => ({
      loginWithSession: async () => {
        sdkCalled = true;
        return { api: {}, zaloUid: 'uid-27' };
      },
    });

    const instance = await pool.restoreSession('acc-1', mockSessionClientFactory);

    assert.equal(sdkCalled, false);
    assert.equal(instance.status, 'needs_qr');
    assert.equal(instance.api, null);
    assert.equal(instance.zaloUid, null);
  });

  it('28. restoreSession transitions to connecting before session login finishes', async () => {
    const store = new MockSessionStore();
    store.sessions.set('acc-1', createDummyPersistedSession('acc-1', 'uid-28'));

    const pool = new ZaloAccountPool({ sessionStore: store });

    let barrierResolve!: () => void;
    const barrier = new Promise<void>((r) => {
      barrierResolve = r;
    });

    const mockSessionClientFactory = (): ISessionClientLike => ({
      loginWithSession: async () => {
        await barrier;
        return { api: { id: 28 }, zaloUid: 'uid-28' };
      },
    });

    const restorePromise = pool.restoreSession('acc-1', mockSessionClientFactory);

    await new Promise((r) => queueMicrotask(r));
    await Promise.resolve();

    assert.equal(pool.getStatus('acc-1'), 'connecting');

    barrierResolve();
    const instance = await restorePromise;

    assert.equal(instance.status, 'connected');
  });

  it('29. restoreSession passes loaded credentials exactly to loginWithSession', async () => {
    const store = new MockSessionStore();
    const persisted = createDummyPersistedSession('acc-1', 'uid-29');
    store.sessions.set('acc-1', persisted);

    const pool = new ZaloAccountPool({ sessionStore: store });
    let passedCredentials: any = null;

    const mockSessionClientFactory = (): ISessionClientLike => ({
      loginWithSession: async (creds) => {
        passedCredentials = creds;
        return { api: { id: 29 }, zaloUid: 'uid-29' };
      },
    });

    await pool.restoreSession('acc-1', mockSessionClientFactory);

    assert.deepEqual(passedCredentials, persisted.credentials);
  });

  it('30. successful restore with matching UID results in connected status, stored api, and stored zaloUid', async () => {
    const store = new MockSessionStore();
    store.sessions.set('acc-1', createDummyPersistedSession('acc-1', 'uid-30'));

    const pool = new ZaloAccountPool({ sessionStore: store });
    const mockApi = { id: 30 };

    const mockSessionClientFactory = (): ISessionClientLike => ({
      loginWithSession: async () => ({
        api: mockApi,
        zaloUid: 'uid-30',
      }),
    });

    const instance = await pool.restoreSession('acc-1', mockSessionClientFactory);

    assert.equal(instance.status, 'connected');
    assert.equal(instance.zaloUid, 'uid-30');
    assert.strictEqual(instance.api, mockApi);
  });

  it('31. restored credentials are NEVER stored in ZaloInstance', async () => {
    const store = new MockSessionStore();
    store.sessions.set('acc-1', createDummyPersistedSession('acc-1', 'uid-31'));

    const pool = new ZaloAccountPool({ sessionStore: store });

    const mockSessionClientFactory = (): ISessionClientLike => ({
      loginWithSession: async () => ({
        api: { id: 31 },
        zaloUid: 'uid-31',
      }),
    });

    const instance = await pool.restoreSession('acc-1', mockSessionClientFactory);

    assert.equal((instance as any).credentials, undefined);
    assert.equal((instance as any).cookie, undefined);

    const stringified = JSON.stringify(instance);
    assert.equal(stringified.includes('mock_cookie_123'), false);
    assert.equal(stringified.includes('mock_imei_456'), false);
  });

  it('32. UID mismatch does not expose api, sets status needs_qr, clears zaloUid, calls sessionStore.remove, and throws sanitized error', async () => {
    const store = new MockSessionStore();
    store.sessions.set('acc-1', createDummyPersistedSession('acc-1', 'expected-uid-32'));

    const pool = new ZaloAccountPool({ sessionStore: store });
    const mockApi = { id: 32 };

    const mockSessionClientFactory = (): ISessionClientLike => ({
      loginWithSession: async () => ({
        api: mockApi,
        zaloUid: 'DIFFERENT-UNEXPECTED-UID',
      }),
    });

    await assert.rejects(
      async () => pool.restoreSession('acc-1', mockSessionClientFactory),
      { message: 'Restored Zalo UID does not match persisted session' }
    );

    const instance = pool.getInstance('acc-1');
    assert.equal(instance?.status, 'needs_qr');
    assert.equal(instance?.zaloUid, null);
    assert.equal(instance?.api, null);
    assert.equal(store.removeCalls.length, 1);
    assert.equal(store.removeCalls[0], 'acc-1');
  });

  it('33. generic loginWithSession failure sets status error, api/zaloUid null, keeps persisted session, and rethrows original error', async () => {
    const store = new MockSessionStore();
    store.sessions.set('acc-1', createDummyPersistedSession('acc-1', 'uid-33'));

    const pool = new ZaloAccountPool({ sessionStore: store });

    const mockSessionClientFactory = (): ISessionClientLike => ({
      loginWithSession: async () => {
        throw new Error('Temporary Zalo gateway timeout');
      },
    });

    await assert.rejects(
      async () => pool.restoreSession('acc-1', mockSessionClientFactory),
      { message: 'Temporary Zalo gateway timeout' }
    );

    const instance = pool.getInstance('acc-1');
    assert.equal(instance?.status, 'error');
    assert.equal(instance?.zaloUid, null);
    assert.equal(instance?.api, null);

    // Persisted session must NOT be deleted on generic SDK error
    assert.equal(store.sessions.has('acc-1'), true);
    assert.equal(store.removeCalls.length, 0);
  });

  it('34. sessionStore.load error sets status error and does NOT call SDK login', async () => {
    const store = new MockSessionStore();
    store.shouldFailLoad = true;

    const pool = new ZaloAccountPool({ sessionStore: store });
    let sdkCalled = false;

    const mockSessionClientFactory = (): ISessionClientLike => ({
      loginWithSession: async () => {
        sdkCalled = true;
        return { api: {}, zaloUid: 'uid-34' };
      },
    });

    await assert.rejects(
      async () => pool.restoreSession('acc-1', mockSessionClientFactory),
      { message: 'Mock SessionStore load failed' }
    );

    assert.equal(sdkCalled, false);
    assert.equal(pool.getStatus('acc-1'), 'error');
  });

  it('35. two restoreSession calls for same account execute sequentially', async () => {
    const store = new MockSessionStore();
    store.sessions.set('acc-1', createDummyPersistedSession('acc-1', 'uid-35'));

    const pool = new ZaloAccountPool({ sessionStore: store });
    const executionOrder: string[] = [];

    let releaseRestore1!: () => void;
    const restore1Gate = new Promise<void>((resolve) => {
      releaseRestore1 = resolve;
    });

    let restore2Entered = false;

    const mockFactory1 = (): ISessionClientLike => ({
      loginWithSession: async () => {
        executionOrder.push('op1-start');
        await restore1Gate;
        executionOrder.push('op1-end');
        return { api: { id: 1 }, zaloUid: 'uid-35' };
      },
    });

    const mockFactory2 = (): ISessionClientLike => ({
      loginWithSession: async () => {
        restore2Entered = true;
        executionOrder.push('op2-start');
        executionOrder.push('op2-end');
        return { api: { id: 2 }, zaloUid: 'uid-35' };
      },
    });

    const p1 = pool.restoreSession('acc-1', mockFactory1);
    const p2 = pool.restoreSession('acc-1', mockFactory2);

    await new Promise((r) => queueMicrotask(r));
    await Promise.resolve();

    assert.equal(executionOrder.includes('op1-start'), true);
    assert.equal(restore2Entered, false);

    releaseRestore1();

    await Promise.all([p1, p2]);

    assert.deepEqual(executionOrder, [
      'op1-start',
      'op1-end',
      'op2-start',
      'op2-end',
    ]);
  });

  it('36. restoreSession and startQrLogin for SAME account are serialized', async () => {
    const store = new MockSessionStore();
    store.sessions.set('acc-1', createDummyPersistedSession('acc-1', 'uid-36'));

    const pool = new ZaloAccountPool({ sessionStore: store });
    const executionOrder: string[] = [];

    let releaseRestore!: () => void;
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });

    let qrEntered = false;

    const mockRestoreFactory = (): ISessionClientLike => ({
      loginWithSession: async () => {
        executionOrder.push('restore-start');
        await restoreGate;
        executionOrder.push('restore-end');
        return { api: { id: 'restore' }, zaloUid: 'uid-36' };
      },
    });

    const mockQrFactory = (): IQrClientLike => ({
      loginQR: async () => {
        qrEntered = true;
        executionOrder.push('qr-start');
        executionOrder.push('qr-end');
        return {
          api: { id: 'qr' },
          zaloUid: 'uid-36-qr',
          credentials: { cookie: 'c', imei: 'i', userAgent: 'u' },
        };
      },
    });

    const pRestore = pool.restoreSession('acc-1', mockRestoreFactory);
    const pQr = pool.startQrLogin('acc-1', undefined, mockQrFactory);

    await new Promise((r) => queueMicrotask(r));
    await Promise.resolve();

    assert.equal(executionOrder.includes('restore-start'), true);
    assert.equal(qrEntered, false);

    releaseRestore();

    await Promise.all([pRestore, pQr]);

    assert.deepEqual(executionOrder, [
      'restore-start',
      'restore-end',
      'qr-start',
      'qr-end',
    ]);
  });

  it('37. restore operations for DIFFERENT accounts can execute independently', async () => {
    const store = new MockSessionStore();
    store.sessions.set('acc-1', createDummyPersistedSession('acc-1', 'uid-1'));
    store.sessions.set('acc-2', createDummyPersistedSession('acc-2', 'uid-2'));

    const pool = new ZaloAccountPool({ sessionStore: store });
    const executionOrder: string[] = [];

    let releaseAcc1!: () => void;
    const acc1Gate = new Promise<void>((resolve) => {
      releaseAcc1 = resolve;
    });

    let releaseAcc2!: () => void;
    const acc2Gate = new Promise<void>((resolve) => {
      releaseAcc2 = resolve;
    });

    const mockFactory1 = (): ISessionClientLike => ({
      loginWithSession: async () => {
        executionOrder.push('acc1-start');
        await acc1Gate;
        executionOrder.push('acc1-end');
        return { api: { id: 1 }, zaloUid: 'uid-1' };
      },
    });

    const mockFactory2 = (): ISessionClientLike => ({
      loginWithSession: async () => {
        executionOrder.push('acc2-start');
        await acc2Gate;
        executionOrder.push('acc2-end');
        return { api: { id: 2 }, zaloUid: 'uid-2' };
      },
    });

    const p1 = pool.restoreSession('acc-1', mockFactory1);
    const p2 = pool.restoreSession('acc-2', mockFactory2);

    await new Promise((r) => queueMicrotask(r));
    await Promise.resolve();

    assert.equal(executionOrder.includes('acc1-start'), true);
    assert.equal(executionOrder.includes('acc2-start'), true);

    releaseAcc2();
    await p2;
    releaseAcc1();
    await p1;

    assert.deepEqual(executionOrder, [
      'acc1-start',
      'acc2-start',
      'acc2-end',
      'acc1-end',
    ]);
  });

  it('38. SECURITY TEST: JSON.stringify(pool.getInstance(accountId)) does not contain cookie/imei/userAgent secrets', async () => {
    const store = new MockSessionStore();
    store.sessions.set('acc-1', createDummyPersistedSession('acc-1', 'uid-38'));

    const pool = new ZaloAccountPool({ sessionStore: store });
    const mockSessionClientFactory = (): ISessionClientLike => ({
      loginWithSession: async () => ({
        api: { getOwnId: async () => 'uid-38' },
        zaloUid: 'uid-38',
      }),
    });

    await pool.restoreSession('acc-1', mockSessionClientFactory);

    const instance = pool.getInstance('acc-1');
    const jsonText = JSON.stringify(instance);

    assert.equal(jsonText.includes('mock_cookie_123'), false);
    assert.equal(jsonText.includes('mock_imei_456'), false);
    assert.equal(jsonText.includes('mock_ua_789'), false);
  });

  it('39. clearSession on unknown account with no configured store sets status error and throws config error', async () => {
    const pool = new ZaloAccountPool();

    await assert.rejects(
      async () => pool.clearSession('unknown-acc'),
      { message: 'Zalo session store is not configured' }
    );

    assert.equal(pool.getStatus('unknown-acc'), 'error');
    const instance = pool.getInstance('unknown-acc');
    assert.notEqual(instance, null);
    assert.equal(instance?.status, 'error');
  });
});

