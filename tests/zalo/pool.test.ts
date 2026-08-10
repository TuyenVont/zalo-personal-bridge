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
});
