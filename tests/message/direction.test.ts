import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectZaloMessageDirection } from '../../src/message/direction.js';
import { parseZaloRawMessage } from '../../src/message/parser.js';

describe('Zalo Message Direction Detection & Parsing (Phase B2.2)', () => {
  // ==================================================
  // DIRECT HELPER TEST CASES (detectZaloMessageDirection)
  // ==================================================

  it('1. isSelf false -> incoming', () => {
    const rawMsg = { isSelf: false };
    assert.equal(detectZaloMessageDirection(rawMsg), 'incoming');
  });

  it('2. isSelf true -> outgoing', () => {
    const rawMsg = { isSelf: true };
    assert.equal(detectZaloMessageDirection(rawMsg), 'outgoing');
  });

  it('3. missing isSelf -> null', () => {
    const rawMsg = { type: 0, threadId: 't1' };
    assert.equal(detectZaloMessageDirection(rawMsg), null);
    assert.equal(detectZaloMessageDirection(null), null);
    assert.equal(detectZaloMessageDirection(undefined), null);
  });

  it('4. isSelf string "true" -> null', () => {
    const rawMsg = { isSelf: 'true' };
    assert.equal(detectZaloMessageDirection(rawMsg), null);
  });

  it('5. isSelf number 1 -> null', () => {
    const rawMsg = { isSelf: 1 };
    assert.equal(detectZaloMessageDirection(rawMsg), null);
  });

  it('6. data.isSelf cannot override wrapper.isSelf', () => {
    const wrapperWithConflictingData = {
      isSelf: false, // wrapper isSelf is false
      data: {
        isSelf: true, // malicious / invalid data.isSelf override attempt
      },
    };
    assert.equal(detectZaloMessageDirection(wrapperWithConflictingData), 'incoming');

    const wrapperOutgoingConflictingData = {
      isSelf: true,
      data: {
        isSelf: false,
      },
    };
    assert.equal(detectZaloMessageDirection(wrapperOutgoingConflictingData), 'outgoing');
  });

  // ==================================================
  // PARSER INTEGRATION TEST CASES (parseZaloRawMessage)
  // ==================================================

  it('7. incoming UserMessage-like wrapper normalizes direction incoming', () => {
    const rawUserMsg = {
      type: 0,
      threadId: 'user-777',
      isSelf: false,
      data: {
        msgId: 'msg-101',
        uidFrom: 'user-777',
        ts: '1712345678900',
        content: 'Hello friend',
      },
    };
    const parsed = parseZaloRawMessage('acc-1', rawUserMsg);
    assert.notEqual(parsed, null);
    assert.equal(parsed?.direction, 'incoming');
  });

  it('8. outgoing UserMessage-like wrapper normalizes direction outgoing', () => {
    const rawUserMsg = {
      type: 0,
      threadId: 'user-777',
      isSelf: true,
      data: {
        msgId: 'msg-102',
        uidFrom: 'my-own-uid-999',
        ts: '1712345678901',
        content: 'Hi back',
      },
    };
    const parsed = parseZaloRawMessage('acc-1', rawUserMsg);
    assert.notEqual(parsed, null);
    assert.equal(parsed?.direction, 'outgoing');
  });

  it('9. incoming GroupMessage-like wrapper normalizes direction incoming', () => {
    const rawGroupMsg = {
      type: 1,
      threadId: 'group-888',
      isSelf: false,
      data: {
        msgId: 'msg-201',
        uidFrom: 'group-member-555',
        ts: '1712345678902',
        content: 'Group chat update',
      },
    };
    const parsed = parseZaloRawMessage('acc-1', rawGroupMsg);
    assert.notEqual(parsed, null);
    assert.equal(parsed?.direction, 'incoming');
  });

  it('10. outgoing GroupMessage-like wrapper normalizes direction outgoing', () => {
    const rawGroupMsg = {
      type: 1,
      threadId: 'group-888',
      isSelf: true,
      data: {
        msgId: 'msg-202',
        uidFrom: 'my-own-uid-999',
        ts: '1712345678903',
        content: 'My reply in group',
      },
    };
    const parsed = parseZaloRawMessage('acc-1', rawGroupMsg);
    assert.notEqual(parsed, null);
    assert.equal(parsed?.direction, 'outgoing');
  });

  it('11. parser returns null when wrapper.isSelf missing', () => {
    const missingIsSelfWrapper = {
      type: 0,
      threadId: 'user-123',
      // isSelf missing!
      data: {
        msgId: 'msg-301',
        uidFrom: 'user-123',
        ts: '1712345678900',
      },
    };
    assert.equal(parseZaloRawMessage('acc-1', missingIsSelfWrapper), null);
  });

  it('12. parser returns null when wrapper.isSelf invalid', () => {
    const invalidIsSelfString = {
      type: 0,
      threadId: 'user-123',
      isSelf: 'true', // string instead of boolean
      data: {
        msgId: 'msg-302',
        uidFrom: 'user-123',
        ts: '1712345678900',
      },
    };
    assert.equal(parseZaloRawMessage('acc-1', invalidIsSelfString), null);

    const invalidIsSelfNum = {
      type: 0,
      threadId: 'user-123',
      isSelf: 1, // number instead of boolean
      data: {
        msgId: 'msg-303',
        uidFrom: 'user-123',
        ts: '1712345678900',
      },
    };
    assert.equal(parseZaloRawMessage('acc-1', invalidIsSelfNum), null);
  });

  it('13. senderId is preserved and is not used to infer direction', () => {
    const rawMsg = {
      type: 0,
      threadId: 'user-444',
      isSelf: true,
      data: {
        msgId: 'm-401',
        uidFrom: 'unrelated-sender-uid-123',
        ts: '1712345678900',
      },
    };
    const parsed = parseZaloRawMessage('acc-1', rawMsg);
    assert.equal(parsed?.senderId, 'unrelated-sender-uid-123');
    assert.equal(parsed?.direction, 'outgoing');
  });

  it('14. accountId is not used to infer direction', () => {
    // accountId equals senderId in string value, but wrapper.isSelf === false
    const rawMsg = {
      type: 0,
      threadId: 'user-999',
      isSelf: false,
      data: {
        msgId: 'm-402',
        uidFrom: 'account-id-matching-string',
        ts: '1712345678900',
      },
    };
    const parsed = parseZaloRawMessage('account-id-matching-string', rawMsg);
    assert.equal(parsed?.accountId, 'account-id-matching-string');
    assert.equal(parsed?.direction, 'incoming');
  });

  it('15. raw input is not mutated during direction detection or parsing', () => {
    const rawMsg = Object.freeze({
      type: 0,
      threadId: 'user-100',
      isSelf: false,
      data: Object.freeze({
        msgId: 'm-500',
        uidFrom: 'u-100',
        ts: '1712345678900',
        content: 'Immutable test',
      }),
    });

    const parsed = parseZaloRawMessage('acc-1', rawMsg);
    assert.notEqual(parsed, null);
    assert.equal(parsed?.direction, 'incoming');
    assert.equal(rawMsg.isSelf, false);
    assert.equal(rawMsg.data.content, 'Immutable test');
  });

  // ==================================================
  // REGRESSION TESTS FOR DIRECTION DIRECTION CLASSIFICATION
  // ==================================================

  it('REGRESSION 1: wrapper.isSelf = true with unrelated data.uidFrom MUST still be outgoing', () => {
    const rawMsg = {
      type: 0,
      threadId: 'user-abc',
      isSelf: true,
      data: {
        msgId: 'm-reg-1',
        uidFrom: 'completely-unrelated-sender-id-99999',
        ts: '1712345678900',
        content: 'Self message test',
      },
    };

    const result = parseZaloRawMessage('acc-123', rawMsg);
    assert.notEqual(result, null);
    assert.equal(result?.direction, 'outgoing');
    assert.equal(result?.senderId, 'completely-unrelated-sender-id-99999');
  });

  it('REGRESSION 2: wrapper.isSelf = false with account-looking data.uidFrom MUST still be incoming', () => {
    const rawMsg = {
      type: 0,
      threadId: 'user-xyz',
      isSelf: false,
      data: {
        msgId: 'm-reg-2',
        uidFrom: 'acc-123', // Matches bridge account ID string!
        ts: '1712345678900',
        content: 'Incoming message test',
      },
    };

    const result = parseZaloRawMessage('acc-123', rawMsg);
    assert.notEqual(result, null);
    assert.equal(result?.direction, 'incoming');
    assert.equal(result?.senderId, 'acc-123');
  });
});
