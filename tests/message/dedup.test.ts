import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ZaloMessageDeduplicator } from '../../src/message/dedup.js';
import type { NormalizedZaloMessage } from '../../src/message/normalized.js';

function createFixture(
  overrides: Partial<NormalizedZaloMessage> = {},
): NormalizedZaloMessage {
  return Object.freeze({
    accountId: 'acc-1',
    messageId: 'msg-1',
    threadId: 'thread-1',
    senderId: 'user-1',
    timestamp: 1700000000000,
    textContent: 'Hello World',
    threadType: 'user',
    direction: 'incoming',
    msgType: 'webchat',
    ...overrides,
  });
}

describe('ZaloMessageDeduplicator (B2.3)', () => {
  it('1. first observation returns accepted', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg = createFixture();
    assert.equal(dedup.checkAndMark(msg), 'accepted');
  });

  it('2. exact second observation returns duplicate', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg = createFixture();
    assert.equal(dedup.checkAndMark(msg), 'accepted');
    assert.equal(dedup.checkAndMark(msg), 'duplicate');
  });

  it('3. same messageId in different accountId is accepted', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg1 = createFixture({ accountId: 'acc-1' });
    const msg2 = createFixture({ accountId: 'acc-2' });
    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'accepted');
  });

  it('4. same messageId in different threadId is accepted', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg1 = createFixture({ threadId: 'thread-1' });
    const msg2 = createFixture({ threadId: 'thread-2' });
    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'accepted');
  });

  it('5. same messageId/threadId but different threadType is accepted', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg1 = createFixture({ threadType: 'user' });
    const msg2 = createFixture({ threadType: 'group' });
    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'accepted');
  });

  it('6. different messageId in same account/thread is accepted', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg1 = createFixture({ messageId: 'msg-1' });
    const msg2 = createFixture({ messageId: 'msg-2' });
    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'accepted');
  });

  it('7. same identity remains duplicate even if textContent differs', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg1 = createFixture({ textContent: 'Hello' });
    const msg2 = createFixture({ textContent: 'World' });
    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'duplicate');
  });

  it('8. same identity remains duplicate even if senderId differs', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg1 = createFixture({ senderId: 'sender-1' });
    const msg2 = createFixture({ senderId: 'sender-2' });
    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'duplicate');
  });

  it('9. same identity remains duplicate even if timestamp differs', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg1 = createFixture({ timestamp: 1000 });
    const msg2 = createFixture({ timestamp: 2000 });
    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'duplicate');
  });

  it('10. same identity remains duplicate even if direction differs', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg1 = createFixture({ direction: 'incoming' });
    const msg2 = createFixture({ direction: 'outgoing' });
    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'duplicate');
  });

  it('11. same identity remains duplicate even if msgType differs', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg1 = createFixture({ msgType: 'webchat' });
    const msg2 = createFixture({ msgType: 'chat.photo' });
    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'duplicate');
  });

  it('12. duplicate before TTL boundary returns duplicate', () => {
    let clock = 1000;
    const dedup = new ZaloMessageDeduplicator({
      ttlMs: 1000,
      now: () => clock,
    });
    const msg = createFixture();

    assert.equal(dedup.checkAndMark(msg), 'accepted'); // at t=1000
    clock = 1999; // age = 999 < 1000
    assert.equal(dedup.checkAndMark(msg), 'duplicate');
  });

  it('13. exact TTL boundary age === ttlMs is expired and returns accepted', () => {
    let clock = 1000;
    const dedup = new ZaloMessageDeduplicator({
      ttlMs: 1000,
      now: () => clock,
    });
    const msg = createFixture();

    assert.equal(dedup.checkAndMark(msg), 'accepted'); // at t=1000
    clock = 2000; // age = 1000 === ttlMs (1000) -> expired
    assert.equal(dedup.checkAndMark(msg), 'accepted');
  });

  it('14. after TTL returns accepted', () => {
    let clock = 1000;
    const dedup = new ZaloMessageDeduplicator({
      ttlMs: 1000,
      now: () => clock,
    });
    const msg = createFixture();

    assert.equal(dedup.checkAndMark(msg), 'accepted'); // at t=1000
    clock = 5000; // age = 4000 > 1000
    assert.equal(dedup.checkAndMark(msg), 'accepted');
  });

  it('15. expired entries are pruned', () => {
    let clock = 1000;
    const dedup = new ZaloMessageDeduplicator({
      ttlMs: 1000,
      now: () => clock,
    });
    const msg1 = createFixture({ messageId: 'msg-1' });
    const msg2 = createFixture({ messageId: 'msg-2' });

    assert.equal(dedup.checkAndMark(msg1), 'accepted'); // t=1000
    assert.equal(dedup.size, 1);

    clock = 2000; // t=2000, msg1 expires (age=1000)
    // msg2 checked -> triggers lazy pruning -> msg1 deleted
    assert.equal(dedup.checkAndMark(msg2), 'accepted');
    assert.equal(dedup.size, 1); // only msg2 remains
  });

  it('16. maxEntries is never exceeded', () => {
    const dedup = new ZaloMessageDeduplicator({ maxEntries: 3 });
    for (let i = 1; i <= 10; i++) {
      dedup.checkAndMark(createFixture({ messageId: `msg-${i}` }));
      assert.ok(dedup.size <= 3, `size ${dedup.size} exceeded maxEntries 3`);
    }
    assert.equal(dedup.size, 3);
  });

  it('17. when capacity is exceeded, oldest retained entry is evicted', () => {
    const dedup = new ZaloMessageDeduplicator({ maxEntries: 2 });
    const msg1 = createFixture({ messageId: 'msg-1' });
    const msg2 = createFixture({ messageId: 'msg-2' });
    const msg3 = createFixture({ messageId: 'msg-3' });

    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'accepted');
    assert.equal(dedup.size, 2);

    // Adding msg3 should evict msg1
    assert.equal(dedup.checkAndMark(msg3), 'accepted');
    assert.equal(dedup.size, 2);

    // msg1 was evicted, so msg1 should now be accepted
    assert.equal(dedup.checkAndMark(msg1), 'accepted');
  });

  it('18. an evicted key can later be accepted again', () => {
    const dedup = new ZaloMessageDeduplicator({ maxEntries: 1 });
    const msg1 = createFixture({ messageId: 'msg-1' });
    const msg2 = createFixture({ messageId: 'msg-2' });

    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'accepted'); // evicts msg1
    assert.equal(dedup.checkAndMark(msg1), 'accepted'); // accepted again
  });

  it('19. clear() resets state', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg = createFixture();
    assert.equal(dedup.checkAndMark(msg), 'accepted');
    assert.equal(dedup.size, 1);

    dedup.clear();
    assert.equal(dedup.size, 0);
    assert.equal(dedup.checkAndMark(msg), 'accepted');
  });

  it('20. clear() is idempotent', () => {
    const dedup = new ZaloMessageDeduplicator();
    dedup.clear();
    dedup.clear();
    assert.equal(dedup.size, 0);
  });

  it('21. size reflects retained entries correctly', () => {
    const dedup = new ZaloMessageDeduplicator();
    assert.equal(dedup.size, 0);
    dedup.checkAndMark(createFixture({ messageId: 'msg-1' }));
    assert.equal(dedup.size, 1);
    dedup.checkAndMark(createFixture({ messageId: 'msg-2' }));
    assert.equal(dedup.size, 2);
    dedup.checkAndMark(createFixture({ messageId: 'msg-1' })); // duplicate
    assert.equal(dedup.size, 2);
  });

  it('22. invalid ttlMs is rejected', () => {
    assert.throws(
      () => new ZaloMessageDeduplicator({ ttlMs: 0 }),
      /ttlMs must be a positive safe integer/,
    );
    assert.throws(
      () => new ZaloMessageDeduplicator({ ttlMs: -100 }),
      /ttlMs must be a positive safe integer/,
    );
    assert.throws(
      () => new ZaloMessageDeduplicator({ ttlMs: 1.5 as any }),
      /ttlMs must be a positive safe integer/,
    );
  });

  it('23. invalid maxEntries is rejected', () => {
    assert.throws(
      () => new ZaloMessageDeduplicator({ maxEntries: 0 }),
      /maxEntries must be a positive safe integer/,
    );
    assert.throws(
      () => new ZaloMessageDeduplicator({ maxEntries: -5 }),
      /maxEntries must be a positive safe integer/,
    );
  });

  it('24. injected invalid clock value is handled with sanitized error', () => {
    let clockVal: any = NaN;
    const dedup = new ZaloMessageDeduplicator({ now: () => clockVal });
    const msg = createFixture();

    assert.throws(
      () => dedup.checkAndMark(msg),
      /Clock returned an invalid timestamp/,
    );

    clockVal = -50;
    assert.throws(
      () => dedup.checkAndMark(msg),
      /Clock returned an invalid timestamp/,
    );

    clockVal = () => {
      throw new Error('Clock crash');
    };
    const dedup2 = new ZaloMessageDeduplicator({ now: clockVal });
    assert.throws(
      () => dedup2.checkAndMark(msg),
      /Clock function threw an error/,
    );
  });

  it('25. checkAndMark does not mutate NormalizedZaloMessage', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg = createFixture();
    const frozenCopy = JSON.stringify(msg);

    dedup.checkAndMark(msg);

    assert.equal(JSON.stringify(msg), frozenCopy);
  });

  it('26. dedup key does not contain textContent or other payload content', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg = createFixture({
      textContent: 'CONFIDENTIAL_TEXT_PAYLOAD_SECRET',
    });

    dedup.checkAndMark(msg);

    // Private property check via reflection to verify map key does not leak content
    const entriesMap = (dedup as any).entries as Map<string, number>;
    for (const key of entriesMap.keys()) {
      assert.equal(key.includes('CONFIDENTIAL_TEXT_PAYLOAD_SECRET'), false);
    }
  });

  it('27. IDs containing delimiter-like characters cannot produce key collisions', () => {
    const dedup = new ZaloMessageDeduplicator();
    const msg1 = createFixture({
      accountId: 'acc:1',
      threadType: 'user',
      threadId: 'thread',
      messageId: 'msg',
    });
    const msg2 = createFixture({
      accountId: 'acc',
      threadType: 'user',
      threadId: '1:thread',
      messageId: 'msg',
    });

    assert.equal(dedup.checkAndMark(msg1), 'accepted');
    assert.equal(dedup.checkAndMark(msg2), 'accepted');
  });

  it('regression: same identity with all different attributes is still duplicate', () => {
    const dedup = new ZaloMessageDeduplicator();

    const messageA = createFixture({
      accountId: 'acc-1',
      threadType: 'user',
      threadId: 'thread-1',
      messageId: 'msg-1',
      direction: 'incoming',
      senderId: 'sender-1',
      timestamp: 1000,
      textContent: 'original text',
      msgType: 'webchat',
    });

    const messageB = createFixture({
      accountId: 'acc-1',
      threadType: 'user',
      threadId: 'thread-1',
      messageId: 'msg-1',
      direction: 'outgoing',
      senderId: 'sender-2',
      timestamp: 9999,
      textContent: 'different text',
      msgType: 'chat.photo',
    });

    assert.equal(dedup.checkAndMark(messageA), 'accepted');
    assert.equal(dedup.checkAndMark(messageB), 'duplicate');
  });

  describe('strict normalized identity validation', () => {
    it('1. rejects empty accountId', () => {
      const dedup = new ZaloMessageDeduplicator();
      const msg = createFixture({ accountId: '' });
      assert.throws(
        () => dedup.checkAndMark(msg),
        /Invalid message payload provided for deduplication/,
      );
    });

    it('2. rejects whitespace-only accountId', () => {
      const dedup = new ZaloMessageDeduplicator();
      const msg = createFixture({ accountId: '   ' });
      assert.throws(
        () => dedup.checkAndMark(msg),
        /Invalid message payload provided for deduplication/,
      );
    });

    it('3. rejects empty threadId', () => {
      const dedup = new ZaloMessageDeduplicator();
      const msg = createFixture({ threadId: '' });
      assert.throws(
        () => dedup.checkAndMark(msg),
        /Invalid message payload provided for deduplication/,
      );
    });

    it('4. rejects whitespace-only threadId', () => {
      const dedup = new ZaloMessageDeduplicator();
      const msg = createFixture({ threadId: '   ' });
      assert.throws(
        () => dedup.checkAndMark(msg),
        /Invalid message payload provided for deduplication/,
      );
    });

    it('5. rejects empty messageId', () => {
      const dedup = new ZaloMessageDeduplicator();
      const msg = createFixture({ messageId: '' });
      assert.throws(
        () => dedup.checkAndMark(msg),
        /Invalid message payload provided for deduplication/,
      );
    });

    it('6. rejects whitespace-only messageId', () => {
      const dedup = new ZaloMessageDeduplicator();
      const msg = createFixture({ messageId: '   ' });
      assert.throws(
        () => dedup.checkAndMark(msg),
        /Invalid message payload provided for deduplication/,
      );
    });

    it('7. rejects invalid threadType such as unknown', () => {
      const dedup = new ZaloMessageDeduplicator();
      const msg = createFixture({ threadType: 'unknown' as any });
      assert.throws(
        () => dedup.checkAndMark(msg),
        /Invalid message payload provided for deduplication/,
      );
    });

    it('8. rejects malformed runtime object with non-string identity field', () => {
      const dedup = new ZaloMessageDeduplicator();
      const msg1 = createFixture({ accountId: 123 as any });
      const msg2 = createFixture({ threadId: null as any });
      const msg3 = createFixture({ messageId: undefined as any });
      assert.throws(
        () => dedup.checkAndMark(msg1),
        /Invalid message payload provided for deduplication/,
      );
      assert.throws(
        () => dedup.checkAndMark(msg2),
        /Invalid message payload provided for deduplication/,
      );
      assert.throws(
        () => dedup.checkAndMark(msg3),
        /Invalid message payload provided for deduplication/,
      );
    });
  });
});
