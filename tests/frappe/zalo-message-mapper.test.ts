import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NormalizedZaloMessage } from '../../src/message/normalized.js';
import {
  formatFrappeDatetime,
  mapZaloConversationPayload,
  mapZaloMessagePayload,
  ZaloMessageMapperError,
} from '../../src/frappe/zalo-message-mapper.js';
import {
  buildZaloConversationKey,
  buildZaloMessageKey,
} from '../../src/frappe/zalo-identity.js';

describe('zalo-message-mapper', () => {
  const epochInstant = Date.parse('2026-08-13T02:00:00.000Z'); // 1786586400000

  const sampleMessage: NormalizedZaloMessage = Object.freeze({
    accountId: 'acc-123',
    messageId: 'msg-999',
    threadId: 'user-456',
    senderId: 'user-456',
    timestamp: epochInstant,
    textContent: 'Hello World',
    threadType: 'user',
    direction: 'incoming',
    msgType: 'webchat',
  });

  describe('formatFrappeDatetime', () => {
    it('1. formats UTC timezone correctly', () => {
      const result = formatFrappeDatetime(epochInstant, 'UTC');
      assert.equal(result, '2026-08-13 02:00:00');
    });

    it('2. formats Asia/Ho_Chi_Minh timezone (+7) correctly', () => {
      const result = formatFrappeDatetime(epochInstant, 'Asia/Ho_Chi_Minh');
      assert.equal(result, '2026-08-13 09:00:00');
    });

    it('3. formats non-whole-hour timezone (Asia/Kathmandu +5:45) correctly', () => {
      const result = formatFrappeDatetime(epochInstant, 'Asia/Kathmandu');
      assert.equal(result, '2026-08-13 07:45:00');
    });

    it('4. rejects invalid IANA timezone with sanitized error', () => {
      assert.throws(
        () => formatFrappeDatetime(epochInstant, 'Invalid/Timezone_Name'),
        (err: unknown) =>
          err instanceof ZaloMessageMapperError &&
          err.message === 'Invalid Frappe timezone'
      );
    });

    it('5. rejects empty or whitespace-only timezone with sanitized error', () => {
      assert.throws(
        () => formatFrappeDatetime(epochInstant, ''),
        (err: unknown) =>
          err instanceof ZaloMessageMapperError &&
          err.message === 'Invalid Frappe timezone'
      );
      assert.throws(
        () => formatFrappeDatetime(epochInstant, '   '),
        (err: unknown) =>
          err instanceof ZaloMessageMapperError &&
          err.message === 'Invalid Frappe timezone'
      );
    });

    it('6. local machine timezone cannot influence result when explicit timezone is passed', () => {
      // Regardless of local node timezone, explicit Asia/Singapore must yield +8
      const result = formatFrappeDatetime(epochInstant, 'Asia/Singapore');
      assert.equal(result, '2026-08-13 10:00:00');
    });

    it('rejects invalid or non-positive timestamps with sanitized ZaloMessageMapperError', () => {
      assert.throws(
        () => formatFrappeDatetime(0, 'UTC'),
        (err: unknown) =>
          err instanceof ZaloMessageMapperError &&
          err.message.includes('positive safe integer')
      );
      assert.throws(
        () => formatFrappeDatetime(-100, 'UTC'),
        (err: unknown) => err instanceof ZaloMessageMapperError
      );
      assert.throws(
        () => formatFrappeDatetime(NaN, 'UTC'),
        (err: unknown) => err instanceof ZaloMessageMapperError
      );
    });
  });

  describe('mapZaloConversationPayload', () => {
    it('maps exact conversation payload with derived key and freezes result', () => {
      const expectedKey = buildZaloConversationKey('acc-123', 'user', 'user-456');
      const payload = mapZaloConversationPayload(sampleMessage);

      assert.ok(Object.isFrozen(payload));
      assert.deepEqual(payload, {
        custom_channel_type: 'Personal',
        custom_account_id: 'acc-123',
        custom_conversation_key: expectedKey,
        custom_thread_id: 'user-456',
        custom_thread_type: 'user',
      });
    });

    it('never includes customer or OA fields in conversation payload', () => {
      const payload = mapZaloConversationPayload(sampleMessage);

      assert.equal('customer' in payload, false);
      assert.equal('oa_id' in payload, false);
    });

    it('rejects invalid message object with sanitized error', () => {
      assert.throws(
        () => mapZaloConversationPayload({} as NormalizedZaloMessage),
        (err: unknown) => err instanceof ZaloMessageMapperError
      );
    });
  });

  describe('mapZaloMessagePayload', () => {
    it('7. custom_sdk_timestamp remains unchanged as string of raw epoch ms', () => {
      const payload = mapZaloMessagePayload(sampleMessage, 'CONV-1', 'Asia/Ho_Chi_Minh');
      assert.equal(payload.custom_sdk_timestamp, String(epochInstant));
    });

    it('8. sent_at is formatted in the explicit site-time timezone', () => {
      const payloadUTC = mapZaloMessagePayload(sampleMessage, 'CONV-1', 'UTC');
      const payloadHCM = mapZaloMessagePayload(sampleMessage, 'CONV-1', 'Asia/Ho_Chi_Minh');

      assert.equal(payloadUTC.sent_at, '2026-08-13 02:00:00');
      assert.equal(payloadHCM.sent_at, '2026-08-13 09:00:00');
    });

    it('maps exact message payload when all fields are present', () => {
      const expectedMessageKey = buildZaloMessageKey(
        'acc-123',
        'user',
        'user-456',
        'msg-999'
      );
      const conversationName = 'ZALO-CONV-001';

      const payload = mapZaloMessagePayload(sampleMessage, conversationName, 'Asia/Ho_Chi_Minh');

      assert.ok(Object.isFrozen(payload));
      assert.deepEqual(payload, {
        conversation: 'ZALO-CONV-001',
        custom_channel_type: 'Personal',
        custom_account_id: 'acc-123',
        custom_message_key: expectedMessageKey,
        custom_thread_id: 'user-456',
        custom_thread_type: 'user',
        custom_sender_id: 'user-456',
        custom_direction: 'incoming',
        custom_sdk_timestamp: String(epochInstant),
        zalo_message_id: 'msg-999',
        sent_at: '2026-08-13 09:00:00',
        custom_zca_msg_type: 'webchat',
        content: 'Hello World',
      });
    });

    it('omits optional fields (content, custom_zca_msg_type) when null', () => {
      const nullFieldsMsg: NormalizedZaloMessage = Object.freeze({
        ...sampleMessage,
        textContent: null,
        msgType: null,
      });

      const payload = mapZaloMessagePayload(nullFieldsMsg, 'ZALO-CONV-002', 'UTC');

      assert.equal('content' in payload, false);
      assert.equal('custom_zca_msg_type' in payload, false);
      assert.equal(payload.conversation, 'ZALO-CONV-002');
      assert.equal(payload.zalo_message_id, 'msg-999');
    });

    it('tightened runtime validation: rejects non-string and non-null textContent', () => {
      const badMsg = {
        ...sampleMessage,
        textContent: 12345,
      };

      assert.throws(
        () => mapZaloMessagePayload(badMsg as unknown as NormalizedZaloMessage, 'C1', 'UTC'),
        (err: unknown) =>
          err instanceof ZaloMessageMapperError &&
          err.message === 'Invalid textContent in normalized message'
      );

      const undefinedMsg = {
        ...sampleMessage,
        textContent: undefined,
      };

      assert.throws(
        () => mapZaloMessagePayload(undefinedMsg as unknown as NormalizedZaloMessage, 'C1', 'UTC'),
        (err: unknown) =>
          err instanceof ZaloMessageMapperError &&
          err.message === 'Invalid textContent in normalized message'
      );
    });

    it('tightened runtime validation: rejects non-string and non-null msgType', () => {
      const badMsg = {
        ...sampleMessage,
        msgType: { type: 'chat' },
      };

      assert.throws(
        () => mapZaloMessagePayload(badMsg as unknown as NormalizedZaloMessage, 'C1', 'UTC'),
        (err: unknown) =>
          err instanceof ZaloMessageMapperError &&
          err.message === 'Invalid msgType in normalized message'
      );

      const undefinedMsg = {
        ...sampleMessage,
        msgType: undefined,
      };

      assert.throws(
        () => mapZaloMessagePayload(undefinedMsg as unknown as NormalizedZaloMessage, 'C1', 'UTC'),
        (err: unknown) =>
          err instanceof ZaloMessageMapperError &&
          err.message === 'Invalid msgType in normalized message'
      );
    });

    it('never sets forbidden fields (customer, sender_type, message_type, delivery_status, is_read, raw_payload)', () => {
      const payload = mapZaloMessagePayload(sampleMessage, 'ZALO-CONV-003', 'UTC');

      assert.equal('customer' in payload, false);
      assert.equal('sender_type' in payload, false);
      assert.equal('message_type' in payload, false);
      assert.equal('delivery_status' in payload, false);
      assert.equal('is_read' in payload, false);
      assert.equal('raw_payload' in payload, false);
    });

    it('rejects invalid conversationName with sanitized error', () => {
      assert.throws(
        () => mapZaloMessagePayload(sampleMessage, '', 'UTC'),
        (err: unknown) =>
          err instanceof ZaloMessageMapperError &&
          err.message.includes('conversationName must be a non-empty string')
      );
    });
  });
});
