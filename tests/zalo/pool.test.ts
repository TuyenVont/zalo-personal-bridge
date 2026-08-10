import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ZaloAccountPool } from '../../src/zalo/pool.js';

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

    const mockApi = { sendMessage: () => {} };
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
});
