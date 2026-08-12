import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseZaloRawMessage } from '../../src/message/parser.js';

describe('parseZaloRawMessage (B2.1 Strictness Corrections)', () => {
  it('1. valid supported raw UserMessage wrapper parses successfully', () => {
    const rawUserMessageWrapper = {
      type: 0, // ThreadType.User
      threadId: 'user-456',
      isSelf: false,
      data: {
        msgId: 'msg-1001',
        cliMsgId: 'cli-1001',
        msgType: 'webchat',
        uidFrom: 'user-456',
        idTo: 'my-uid',
        dName: 'Alice',
        ts: '1712345678901',
        content: 'Hello, this is a test message',
      },
    };

    const result = parseZaloRawMessage('acc-test-1', rawUserMessageWrapper);

    assert.notEqual(result, null);
    assert.equal(result?.accountId, 'acc-test-1');
    assert.equal(result?.messageId, 'msg-1001');
    assert.equal(result?.threadId, 'user-456');
    assert.equal(result?.senderId, 'user-456');
    assert.equal(result?.timestamp, 1712345678901);
    assert.equal(result?.textContent, 'Hello, this is a test message');
    assert.equal(result?.threadType, 'user');
    assert.equal(result?.msgType, 'webchat');
  });

  it('2. accountId is preserved EXACTLY in normalized output', () => {
    const rawMsg = {
      type: 0,
      threadId: 'user-1',
      isSelf: false,
      data: {
        msgId: 'm1',
        uidFrom: 'u1',
        idTo: 't1',
        ts: '1700000000000',
        content: 'hello',
      },
    };

    // Exact string value (including untrimmed whitespace) must be preserved
    const resExact = parseZaloRawMessage('  acc-untrimmed-999  ', rawMsg);
    assert.equal(resExact?.accountId, '  acc-untrimmed-999  ');

    // Invalid/empty accountIds return null
    assert.equal(parseZaloRawMessage('', rawMsg), null);
    assert.equal(parseZaloRawMessage('   ', rawMsg), null);
    assert.equal(parseZaloRawMessage(null as any, rawMsg), null);
    assert.equal(parseZaloRawMessage(undefined as any, rawMsg), null);
  });

  it('3. messageId maps correctly from string data.msgId, numeric msgId returns null', () => {
    const stringMsgIdPayload = {
      type: 0,
      threadId: 'user-1',
      isSelf: false,
      data: {
        msgId: '7592837492817263541',
        uidFrom: 'u123',
        idTo: 't456',
        ts: '1712345678901',
      },
    };
    const resString = parseZaloRawMessage('acc-1', stringMsgIdPayload);
    assert.equal(resString?.messageId, '7592837492817263541');

    // Strict string check: numeric msgId MUST return null
    const numericMsgIdPayload = {
      type: 0,
      threadId: 'user-1',
      isSelf: false,
      data: {
        msgId: 99887766,
        uidFrom: 'u123',
        idTo: 't456',
        ts: '1712345678901',
      },
    };
    assert.equal(parseZaloRawMessage('acc-1', numericMsgIdPayload), null);
  });

  it('4. senderId maps correctly from string data.uidFrom, numeric uidFrom returns null', () => {
    const stringPayload = {
      type: 0,
      threadId: 'sender-uid-777',
      isSelf: false,
      data: {
        msgId: 'm123',
        uidFrom: 'sender-uid-777',
        idTo: 'recipient-uid-888',
        ts: '1712345678901',
      },
    };
    const result = parseZaloRawMessage('acc-1', stringPayload);
    assert.equal(result?.senderId, 'sender-uid-777');

    // Strict string check: numeric uidFrom MUST return null
    const numericPayload = {
      type: 0,
      threadId: 'sender-uid-777',
      isSelf: false,
      data: {
        msgId: 'm123',
        uidFrom: 777888999,
        idTo: 'recipient-uid-888',
        ts: '1712345678901',
      },
    };
    assert.equal(parseZaloRawMessage('acc-1', numericPayload), null);
  });

  it('5. wrapper.threadId must be a string, numeric threadId returns null', () => {
    const stringThreadWrapper = {
      type: 0,
      threadId: 'thread-string-123',
      isSelf: false,
      data: {
        msgId: 'm1',
        uidFrom: 'u1',
        ts: '1712345678900',
      },
    };
    assert.equal(
      parseZaloRawMessage('acc-1', stringThreadWrapper)?.threadId,
      'thread-string-123',
    );

    const numericThreadWrapper = {
      type: 0,
      threadId: 998877, // Numeric threadId!
      isSelf: false,
      data: {
        msgId: 'm1',
        uidFrom: 'u1',
        ts: '1712345678900',
      },
    };
    assert.equal(parseZaloRawMessage('acc-1', numericThreadWrapper), null);
  });

  it('6. timestamp follows zca-js string declaration strictly', () => {
    const makePayload = (ts: any) => ({
      type: 0,
      threadId: 'user-1',
      isSelf: false,
      data: {
        msgId: 'm1',
        uidFrom: 'u1',
        idTo: 't1',
        ts,
      },
    });

    // Valid digit string succeeds
    assert.equal(
      parseZaloRawMessage('acc-1', makePayload('1712345678900'))?.timestamp,
      1712345678900,
    );

    // Numeric ts returns null (must be string per SDK declaration)
    assert.equal(parseZaloRawMessage('acc-1', makePayload(1712345678900)), null);

    // Empty / non-numeric / floating / zero / negative strings return null
    assert.equal(parseZaloRawMessage('acc-1', makePayload('')), null);
    assert.equal(parseZaloRawMessage('acc-1', makePayload('   ')), null);
    assert.equal(parseZaloRawMessage('acc-1', makePayload('abc')), null);
    assert.equal(parseZaloRawMessage('acc-1', makePayload('1712345.67')), null);
    assert.equal(parseZaloRawMessage('acc-1', makePayload('0')), null);
    assert.equal(parseZaloRawMessage('acc-1', makePayload('-1000')), null);
    assert.equal(parseZaloRawMessage('acc-1', makePayload(null)), null);
    assert.equal(parseZaloRawMessage('acc-1', makePayload(undefined)), null);

    // Unsafe integer string returns null
    const unsafeIntStr = '9007199254740992'; // Number.MAX_SAFE_INTEGER + 1
    assert.equal(parseZaloRawMessage('acc-1', makePayload(unsafeIntStr)), null);
  });

  it('7. plain text content maps correctly when present', () => {
    const textPayload = {
      type: 0,
      threadId: 'user-1',
      isSelf: false,
      data: {
        msgId: 'm1',
        uidFrom: 'u1',
        idTo: 't1',
        ts: '1712345678900',
        content: 'Xin chào Zalo!',
      },
    };
    const result = parseZaloRawMessage('acc-1', textPayload);
    assert.equal(result?.textContent, 'Xin chào Zalo!');
  });

  it('8. non-text message does not fabricate text', () => {
    const photoPayload = {
      type: 0,
      threadId: 'user-1',
      isSelf: false,
      data: {
        msgId: 'm1',
        uidFrom: 'u1',
        idTo: 't1',
        ts: '1712345678900',
        msgType: 'chat.photo',
        content: {
          title: 'Photo',
          description: 'Image caption',
          href: 'https://zalo.me/photo.jpg',
        },
      },
    };
    const result = parseZaloRawMessage('acc-1', photoPayload);
    assert.equal(result?.textContent, null);
    assert.equal(result?.msgType, 'chat.photo');
  });

  it('9. raw input object is not mutated', () => {
    const original = Object.freeze({
      type: 0,
      threadId: 't-123',
      isSelf: false,
      data: Object.freeze({
        msgId: 'm-123',
        uidFrom: 'u-123',
        idTo: 't-123',
        ts: '1712345678900',
        content: 'Unchanged test',
      }),
    });

    const result = parseZaloRawMessage('acc-1', original);
    assert.notEqual(result, null);
    assert.equal(original.data.content, 'Unchanged test');
  });

  it('10. normalized output does not contain the full raw event', () => {
    const rawMsg = {
      type: 0,
      threadId: 't1',
      isSelf: false,
      extraSecretData: 'should-not-exist',
      data: {
        msgId: 'm1',
        uidFrom: 'u1',
        idTo: 't1',
        ts: '1712345678900',
        content: 'text',
        propertyExt: { color: 1 },
      },
    };

    const result = parseZaloRawMessage('acc-1', rawMsg);
    assert.notEqual(result, null);

    const keys = Object.keys(result!);
    assert.deepEqual(keys.sort(), [
      'accountId',
      'messageId',
      'msgType',
      'senderId',
      'textContent',
      'threadId',
      'threadType',
      'timestamp',
    ]);
    assert.equal(Object.isFrozen(result), true);
    assert.equal('extraSecretData' in (result as any), false);
    assert.equal('data' in (result as any), false);
  });

  it('11. malformed null/primitive payload returns null', () => {
    assert.equal(parseZaloRawMessage('acc-1', null), null);
    assert.equal(parseZaloRawMessage('acc-1', undefined), null);
    assert.equal(parseZaloRawMessage('acc-1', 'string payload'), null);
    assert.equal(parseZaloRawMessage('acc-1', 12345), null);
    assert.equal(parseZaloRawMessage('acc-1', true), null);
  });

  it('12. missing required identifier returns null', () => {
    // Missing msgId
    assert.equal(
      parseZaloRawMessage('acc-1', {
        type: 0,
        threadId: 't1',
        isSelf: false,
        data: { uidFrom: 'u1', idTo: 't1', ts: '1712345678900' },
      }),
      null,
    );

    // Missing uidFrom
    assert.equal(
      parseZaloRawMessage('acc-1', {
        type: 0,
        threadId: 't1',
        isSelf: false,
        data: { msgId: 'm1', idTo: 't1', ts: '1712345678900' },
      }),
      null,
    );
  });

  it('13. parser does not leak raw payload content through thrown errors', () => {
    const throwingRawMsg = {
      type: 0,
      threadId: 't1',
      get data() {
        throw new Error('Secret credentials or sensitive payload error');
      },
    };

    let result: any = undefined;
    assert.doesNotThrow(() => {
      result = parseZaloRawMessage('acc-1', throwingRawMsg);
    });

    assert.equal(result, null);
  });

  // ==================================================
  // REGRESSION TESTS FOR B2.1 SCHEMA & STRICTNESS
  // ==================================================

  it('REGRESSION 1: UserMessage-like wrapper uses wrapper.threadId even when data.idTo is different', () => {
    const userWrapper = {
      type: 0, // ThreadType.User
      threadId: 'wrapper-thread-user-123',
      isSelf: true,
      data: {
        msgId: 'm100',
        uidFrom: 'logged-in-user-uid',
        idTo: 'different-id-to-999',
        ts: '1712345678900',
        content: 'hello',
      },
    };

    const result = parseZaloRawMessage('acc-1', userWrapper);
    assert.equal(result?.threadId, 'wrapper-thread-user-123');
    assert.equal(result?.threadType, 'user');
  });

  it('REGRESSION 2: GroupMessage-like wrapper uses wrapper.threadId', () => {
    const groupWrapper = {
      type: 1, // ThreadType.Group
      threadId: 'group-thread-888',
      isSelf: false,
      data: {
        msgId: 'm200',
        uidFrom: 'member-uid',
        idTo: 'group-thread-888',
        ts: '1712345678900',
        content: 'group chat msg',
      },
    };

    const result = parseZaloRawMessage('acc-1', groupWrapper);
    assert.equal(result?.threadId, 'group-thread-888');
    assert.equal(result?.threadType, 'group');
  });

  it('REGRESSION 3: data.type is ignored and cannot override wrapper.type', () => {
    const wrapper = {
      type: 0, // ThreadType.User
      threadId: 't-123',
      isSelf: false,
      data: {
        type: 1, // Malicious/spurious data.type attempt
        msgId: 'm300',
        uidFrom: 'u-123',
        ts: '1712345678900',
        content: 'test',
      },
    };

    const result = parseZaloRawMessage('acc-1', wrapper);
    assert.equal(result?.threadType, 'user');
  });

  it('REGRESSION 4: unwrapped TMessage-like object returns null', () => {
    const unwrappedTMessage = {
      msgId: 'm400',
      cliMsgId: 'cli-400',
      msgType: 'webchat',
      uidFrom: 'u-123',
      idTo: 'u-456',
      dName: 'Alice',
      ts: '1712345678900',
      content: 'unwrapped message content',
    };

    const result = parseZaloRawMessage('acc-1', unwrappedTMessage);
    assert.equal(result, null);
  });

  it('REGRESSION 5: missing wrapper.threadId returns null', () => {
    const missingThreadIdWrapper = {
      type: 0,
      // threadId missing!
      isSelf: false,
      data: {
        msgId: 'm500',
        uidFrom: 'u-123',
        idTo: 'id-to-should-be-ignored',
        ts: '1712345678900',
        content: 'test',
      },
    };

    const result = parseZaloRawMessage('acc-1', missingThreadIdWrapper);
    assert.equal(result, null);
  });

  it('REGRESSION 6: unknown wrapper.type is handled predictably (returns null)', () => {
    const unknownTypeWrapper = {
      type: 99, // Unknown wrapper type
      threadId: 't-123',
      isSelf: false,
      data: {
        msgId: 'm600',
        uidFrom: 'u-123',
        ts: '1712345678900',
        content: 'test',
      },
    };

    const result = parseZaloRawMessage('acc-1', unknownTypeWrapper);
    assert.equal(result, null);
  });

  it('REGRESSION 7: direct-message parser never derives threadId from data.idTo or data.uidFrom', () => {
    const wrapper = {
      type: 0,
      threadId: 'exact-wrapper-thread-id',
      isSelf: false,
      data: {
        msgId: 'm700',
        uidFrom: 'fallback-uid-from-should-be-ignored',
        idTo: 'fallback-id-to-should-be-ignored',
        ts: '1712345678900',
        content: 'test',
      },
    };

    const result = parseZaloRawMessage('acc-1', wrapper);
    assert.equal(result?.threadId, 'exact-wrapper-thread-id');
    assert.notEqual(result?.threadId, 'fallback-uid-from-should-be-ignored');
    assert.notEqual(result?.threadId, 'fallback-id-to-should-be-ignored');
  });
});
