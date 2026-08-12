import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildZaloConversationKey,
  buildZaloCustomerKey,
  buildZaloMessageKey,
  ZaloFrappeSchemaContractError,
} from '../../src/frappe/index.js';

describe('Zalo Identity Key Builders Contract', () => {
  const accountId = 'acc_12345';
  const zaloUserId = 'user_67890';
  const threadId = 'thread_111';
  const messageId = 'msg_99999';

  describe('Customer Key Builder', () => {
    it('produces a deterministic 64 lowercase hex character string', () => {
      const key1 = buildZaloCustomerKey(accountId, zaloUserId);
      const key2 = buildZaloCustomerKey(accountId, zaloUserId);

      assert.equal(key1, key2);
      assert.match(key1, /^[0-9a-f]{64}$/);
      assert.equal(key1.length, 64);
    });

    it('produces different keys for different accounts', () => {
      const keyA = buildZaloCustomerKey('acc_1', zaloUserId);
      const keyB = buildZaloCustomerKey('acc_2', zaloUserId);
      assert.notEqual(keyA, keyB);
    });

    it('produces different keys for different user IDs', () => {
      const keyA = buildZaloCustomerKey(accountId, 'user_1');
      const keyB = buildZaloCustomerKey(accountId, 'user_2');
      assert.notEqual(keyA, keyB);
    });

    it('prevents collisions with delimiter-like identifiers', () => {
      const key1 = buildZaloCustomerKey('acc', '1:2');
      const key2 = buildZaloCustomerKey('acc:1', '2');
      assert.notEqual(key1, key2);
    });

    it('preserves exact identifiers including internal spaces for hash input', () => {
      const keyExact = buildZaloCustomerKey('acc 1', 'user 1');
      const keyNoSpace = buildZaloCustomerKey('acc1', 'user1');
      assert.notEqual(keyExact, keyNoSpace);
    });

    it('rejects whitespace-only accountId or zaloUserId with sanitized error', () => {
      assert.throws(
        () => buildZaloCustomerKey('   ', zaloUserId),
        ZaloFrappeSchemaContractError
      );
      assert.throws(
        () => buildZaloCustomerKey(accountId, '\t\n '),
        ZaloFrappeSchemaContractError
      );

      try {
        buildZaloCustomerKey('   ', zaloUserId);
      } catch (err) {
        assert.ok(err instanceof ZaloFrappeSchemaContractError);
        assert.ok(!(err as Error).message.includes(accountId));
        assert.ok(!(err as Error).message.includes(zaloUserId));
      }
    });

    it('rejects identifiers exceeding 140 characters', () => {
      const longId = 'a'.repeat(141);
      assert.throws(
        () => buildZaloCustomerKey(longId, zaloUserId),
        ZaloFrappeSchemaContractError
      );
      assert.throws(
        () => buildZaloCustomerKey(accountId, longId),
        ZaloFrappeSchemaContractError
      );
    });
  });

  describe('Conversation Key Builder', () => {
    it('produces a deterministic 64 lowercase hex character string', () => {
      const key1 = buildZaloConversationKey(accountId, 'user', threadId);
      const key2 = buildZaloConversationKey(accountId, 'user', threadId);

      assert.equal(key1, key2);
      assert.match(key1, /^[0-9a-f]{64}$/);
      assert.equal(key1.length, 64);
    });

    it('produces different keys for different thread types', () => {
      const userKey = buildZaloConversationKey(accountId, 'user', threadId);
      const groupKey = buildZaloConversationKey(accountId, 'group', threadId);
      assert.notEqual(userKey, groupKey);
    });

    it('produces different keys for different thread IDs', () => {
      const key1 = buildZaloConversationKey(accountId, 'user', 'thread_1');
      const key2 = buildZaloConversationKey(accountId, 'user', 'thread_2');
      assert.notEqual(key1, key2);
    });

    it('rejects invalid threadType with sanitized error', () => {
      assert.throws(
        () => buildZaloConversationKey(accountId, 'invalid' as any, threadId),
        ZaloFrappeSchemaContractError
      );

      try {
        buildZaloConversationKey(accountId, 'invalid' as any, threadId);
      } catch (err) {
        assert.ok(err instanceof ZaloFrappeSchemaContractError);
        assert.equal((err as Error).message, "Invalid threadType: must be 'user' or 'group'");
      }
    });
  });

  describe('Message Key Builder', () => {
    it('produces a deterministic 64 lowercase hex character string', () => {
      const key1 = buildZaloMessageKey(accountId, 'user', threadId, messageId);
      const key2 = buildZaloMessageKey(accountId, 'user', threadId, messageId);

      assert.equal(key1, key2);
      assert.match(key1, /^[0-9a-f]{64}$/);
      assert.equal(key1.length, 64);
    });

    it('produces different keys for different message IDs', () => {
      const key1 = buildZaloMessageKey(accountId, 'user', threadId, 'msg_1');
      const key2 = buildZaloMessageKey(accountId, 'user', threadId, 'msg_2');
      assert.notEqual(key1, key2);
    });

    it('sanitizes error messages and contains no input values or credentials', () => {
      const secretAccountId = 'secret_acc_123';
      try {
        buildZaloMessageKey(secretAccountId, 'user', threadId, '  ');
      } catch (err) {
        assert.ok(err instanceof ZaloFrappeSchemaContractError);
        assert.ok(!(err as Error).message.includes(secretAccountId));
        assert.ok(!(err as Error).message.includes(threadId));
      }
    });
  });
});
