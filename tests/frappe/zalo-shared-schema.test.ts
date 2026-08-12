import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ZALO_CONVERSATION_CUSTOM_FIELDS,
  ZALO_CONVERSATION_DOCTYPE,
  ZALO_CONVERSATION_FIELD_OVERRIDES,
  ZALO_CUSTOMER_CUSTOM_FIELDS,
  ZALO_CUSTOMER_DOCTYPE,
  ZALO_MESSAGE_CUSTOM_FIELDS,
  ZALO_MESSAGE_DOCTYPE,
  ZALO_MESSAGE_FIELD_OVERRIDES,
} from '../../src/frappe/index.js';

describe('Shared Zalo Frappe Schema Contract', () => {
  it('defines exact DocType names', () => {
    assert.equal(ZALO_CUSTOMER_DOCTYPE, 'Zalo OA Customer');
    assert.equal(ZALO_CONVERSATION_DOCTYPE, 'Zalo OA Conversation');
    assert.equal(ZALO_MESSAGE_DOCTYPE, 'Zalo OA Message');
  });

  describe('Zalo OA Customer Custom Fields', () => {
    it('defines exact custom field names', () => {
      const fieldnames = ZALO_CUSTOMER_CUSTOM_FIELDS.map((f) => f.fieldname);
      assert.deepEqual(fieldnames, [
        'custom_channel_type',
        'custom_account_id',
        'custom_customer_key',
      ]);
    });

    it('defines exact fieldname -> label mapping', () => {
      const labelMap = Object.fromEntries(
        ZALO_CUSTOMER_CUSTOM_FIELDS.map((f) => [f.fieldname, f.label])
      );
      assert.deepEqual(labelMap, {
        custom_channel_type: 'Channel Type',
        custom_account_id: 'Zalo Account ID',
        custom_customer_key: 'Customer Key',
      });
    });

    it('defines custom_channel_type attributes', () => {
      const field = ZALO_CUSTOMER_CUSTOM_FIELDS.find(
        (f) => f.fieldname === 'custom_channel_type'
      );
      assert.ok(field);
      assert.equal(field.label, 'Channel Type');
      assert.equal(field.fieldtype, 'Select');
      assert.deepEqual(field.options, ['OA', 'Personal']);
      assert.equal(field.default, 'OA');
      assert.equal(field.required, false);
      assert.equal(field.unique, false);
      assert.equal(field.readOnly, false);
      assert.equal(field.insertAfter, 'source');
    });

    it('defines custom_account_id attributes', () => {
      const field = ZALO_CUSTOMER_CUSTOM_FIELDS.find(
        (f) => f.fieldname === 'custom_account_id'
      );
      assert.ok(field);
      assert.equal(field.label, 'Zalo Account ID');
      assert.equal(field.fieldtype, 'Data');
      assert.equal(field.required, false);
      assert.equal(field.unique, false);
      assert.equal(field.readOnly, true);
      assert.equal(field.insertAfter, 'custom_channel_type');
    });

    it('defines custom_customer_key attributes', () => {
      const field = ZALO_CUSTOMER_CUSTOM_FIELDS.find(
        (f) => f.fieldname === 'custom_customer_key'
      );
      assert.ok(field);
      assert.equal(field.label, 'Customer Key');
      assert.equal(field.fieldtype, 'Data');
      assert.equal(field.required, false);
      assert.equal(field.unique, true);
      assert.equal(field.readOnly, true);
      assert.equal(field.noCopy, true);
      assert.equal(field.insertAfter, 'custom_account_id');
    });
  });

  describe('Zalo OA Conversation Custom Fields', () => {
    it('defines exact custom field names', () => {
      const fieldnames = ZALO_CONVERSATION_CUSTOM_FIELDS.map((f) => f.fieldname);
      assert.deepEqual(fieldnames, [
        'custom_channel_type',
        'custom_account_id',
        'custom_conversation_key',
        'custom_thread_id',
        'custom_thread_type',
      ]);
    });

    it('defines exact fieldname -> label mapping', () => {
      const labelMap = Object.fromEntries(
        ZALO_CONVERSATION_CUSTOM_FIELDS.map((f) => [f.fieldname, f.label])
      );
      assert.deepEqual(labelMap, {
        custom_channel_type: 'Channel Type',
        custom_account_id: 'Zalo Account ID',
        custom_conversation_key: 'Conversation Key',
        custom_thread_id: 'Thread ID',
        custom_thread_type: 'Thread Type',
      });
    });

    it('defines exact insertAfter chain for Zalo OA Conversation', () => {
      const insertAfterChain = ZALO_CONVERSATION_CUSTOM_FIELDS.map((f) => ({
        fieldname: f.fieldname,
        insertAfter: f.insertAfter,
      }));

      assert.deepEqual(insertAfterChain, [
        { fieldname: 'custom_channel_type', insertAfter: 'customer' },
        { fieldname: 'custom_account_id', insertAfter: 'custom_channel_type' },
        { fieldname: 'custom_conversation_key', insertAfter: 'custom_account_id' },
        { fieldname: 'custom_thread_id', insertAfter: 'custom_conversation_key' },
        { fieldname: 'custom_thread_type', insertAfter: 'custom_thread_id' },
      ]);
    });

    it('defines custom_channel_type attributes', () => {
      const field = ZALO_CONVERSATION_CUSTOM_FIELDS.find(
        (f) => f.fieldname === 'custom_channel_type'
      );
      assert.ok(field);
      assert.equal(field.label, 'Channel Type');
      assert.equal(field.fieldtype, 'Select');
      assert.deepEqual(field.options, ['OA', 'Personal']);
      assert.equal(field.default, 'OA');
      assert.equal(field.required, false);
    });

    it('defines custom_conversation_key attributes including unique, readOnly, and noCopy', () => {
      const field = ZALO_CONVERSATION_CUSTOM_FIELDS.find(
        (f) => f.fieldname === 'custom_conversation_key'
      );
      assert.ok(field);
      assert.equal(field.label, 'Conversation Key');
      assert.equal(field.fieldtype, 'Data');
      assert.equal(field.unique, true);
      assert.equal(field.readOnly, true);
      assert.equal(field.noCopy, true);
    });

    it('defines custom_thread_type attributes with options ["user", "group"]', () => {
      const field = ZALO_CONVERSATION_CUSTOM_FIELDS.find(
        (f) => f.fieldname === 'custom_thread_type'
      );
      assert.ok(field);
      assert.equal(field.label, 'Thread Type');
      assert.equal(field.fieldtype, 'Select');
      assert.deepEqual(field.options, ['user', 'group']);
      assert.equal(field.readOnly, true);
    });
  });

  describe('Zalo OA Message Custom Fields', () => {
    it('defines exact custom field names', () => {
      const fieldnames = ZALO_MESSAGE_CUSTOM_FIELDS.map((f) => f.fieldname);
      assert.deepEqual(fieldnames, [
        'custom_channel_type',
        'custom_account_id',
        'custom_message_key',
        'custom_thread_id',
        'custom_thread_type',
        'custom_sender_id',
        'custom_direction',
        'custom_zca_msg_type',
        'custom_sdk_timestamp',
      ]);
    });

    it('defines exact fieldname -> label mapping', () => {
      const labelMap = Object.fromEntries(
        ZALO_MESSAGE_CUSTOM_FIELDS.map((f) => [f.fieldname, f.label])
      );
      assert.deepEqual(labelMap, {
        custom_channel_type: 'Channel Type',
        custom_account_id: 'Zalo Account ID',
        custom_message_key: 'Message Key',
        custom_thread_id: 'Thread ID',
        custom_thread_type: 'Thread Type',
        custom_sender_id: 'Sender ID',
        custom_direction: 'Direction',
        custom_zca_msg_type: 'ZCA Message Type',
        custom_sdk_timestamp: 'SDK Timestamp',
      });
    });

    it('defines exact insertAfter chain for Zalo OA Message', () => {
      const insertAfterChain = ZALO_MESSAGE_CUSTOM_FIELDS.map((f) => ({
        fieldname: f.fieldname,
        insertAfter: f.insertAfter,
      }));

      assert.deepEqual(insertAfterChain, [
        { fieldname: 'custom_channel_type', insertAfter: 'customer' },
        { fieldname: 'custom_account_id', insertAfter: 'custom_channel_type' },
        { fieldname: 'custom_message_key', insertAfter: 'custom_account_id' },
        { fieldname: 'custom_thread_id', insertAfter: 'custom_message_key' },
        { fieldname: 'custom_thread_type', insertAfter: 'custom_thread_id' },
        { fieldname: 'custom_sender_id', insertAfter: 'custom_thread_type' },
        { fieldname: 'custom_direction', insertAfter: 'custom_sender_id' },
        { fieldname: 'custom_zca_msg_type', insertAfter: 'custom_direction' },
        { fieldname: 'custom_sdk_timestamp', insertAfter: 'custom_zca_msg_type' },
      ]);
    });

    it('defines custom_direction attributes with options ["incoming", "outgoing"]', () => {
      const field = ZALO_MESSAGE_CUSTOM_FIELDS.find(
        (f) => f.fieldname === 'custom_direction'
      );
      assert.ok(field);
      assert.equal(field.label, 'Direction');
      assert.equal(field.fieldtype, 'Select');
      assert.deepEqual(field.options, ['incoming', 'outgoing']);
      assert.equal(field.readOnly, true);
    });

    it('defines custom_message_key attributes including unique, readOnly, and noCopy', () => {
      const field = ZALO_MESSAGE_CUSTOM_FIELDS.find(
        (f) => f.fieldname === 'custom_message_key'
      );
      assert.ok(field);
      assert.equal(field.label, 'Message Key');
      assert.equal(field.fieldtype, 'Data');
      assert.equal(field.unique, true);
      assert.equal(field.readOnly, true);
      assert.equal(field.noCopy, true);
    });
  });

  describe('Existing Field Overrides', () => {
    it('encodes customer.required = false on Zalo OA Conversation', () => {
      const override = ZALO_CONVERSATION_FIELD_OVERRIDES.find(
        (o) => o.fieldname === 'customer'
      );
      assert.ok(override);
      assert.equal(override.required, false);
    });

    it('encodes content.required = false and sender_type.required = false on Zalo OA Message', () => {
      const contentOverride = ZALO_MESSAGE_FIELD_OVERRIDES.find(
        (o) => o.fieldname === 'content'
      );
      assert.ok(contentOverride);
      assert.equal(contentOverride.required, false);

      const senderTypeOverride = ZALO_MESSAGE_FIELD_OVERRIDES.find(
        (o) => o.fieldname === 'sender_type'
      );
      assert.ok(senderTypeOverride);
      assert.equal(senderTypeOverride.required, false);
    });

    it('asserts sent_at has NO field override defined', () => {
      const sentAtOverride = ZALO_MESSAGE_FIELD_OVERRIDES.find(
        (o) => o.fieldname === 'sent_at'
      );
      assert.equal(sentAtOverride, undefined);
    });
  });
});
