export const ZALO_CUSTOMER_DOCTYPE = 'Zalo OA Customer' as const;
export const ZALO_CONVERSATION_DOCTYPE = 'Zalo OA Conversation' as const;
export const ZALO_MESSAGE_DOCTYPE = 'Zalo OA Message' as const;

export type FrappeCustomFieldType = 'Select' | 'Data';

export interface CustomFieldDefinition {
  readonly fieldname: string;
  readonly label: string;
  readonly fieldtype: FrappeCustomFieldType;
  readonly options?: readonly string[];
  readonly default?: string;
  readonly required: boolean;
  readonly unique: boolean;
  readonly readOnly: boolean;
  readonly noCopy?: boolean;
  readonly insertAfter?: string;
}

export const ZALO_CUSTOMER_CUSTOM_FIELDS: readonly CustomFieldDefinition[] = [
  {
    fieldname: 'custom_channel_type',
    label: 'Channel Type',
    fieldtype: 'Select',
    options: ['OA', 'Personal'],
    default: 'OA',
    required: false,
    unique: false,
    readOnly: false,
    insertAfter: 'source',
  },
  {
    fieldname: 'custom_account_id',
    label: 'Zalo Account ID',
    fieldtype: 'Data',
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_channel_type',
  },
  {
    fieldname: 'custom_customer_key',
    label: 'Customer Key',
    fieldtype: 'Data',
    required: false,
    unique: true,
    readOnly: true,
    noCopy: true,
    insertAfter: 'custom_account_id',
  },
] as const;

export const ZALO_CONVERSATION_CUSTOM_FIELDS: readonly CustomFieldDefinition[] = [
  {
    fieldname: 'custom_channel_type',
    label: 'Channel Type',
    fieldtype: 'Select',
    options: ['OA', 'Personal'],
    default: 'OA',
    required: false,
    unique: false,
    readOnly: false,
    insertAfter: 'customer',
  },
  {
    fieldname: 'custom_account_id',
    label: 'Zalo Account ID',
    fieldtype: 'Data',
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_channel_type',
  },
  {
    fieldname: 'custom_conversation_key',
    label: 'Conversation Key',
    fieldtype: 'Data',
    required: false,
    unique: true,
    readOnly: true,
    noCopy: true,
    insertAfter: 'custom_account_id',
  },
  {
    fieldname: 'custom_thread_id',
    label: 'Thread ID',
    fieldtype: 'Data',
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_conversation_key',
  },
  {
    fieldname: 'custom_thread_type',
    label: 'Thread Type',
    fieldtype: 'Select',
    options: ['user', 'group'],
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_thread_id',
  },
] as const;

export const ZALO_MESSAGE_CUSTOM_FIELDS: readonly CustomFieldDefinition[] = [
  {
    fieldname: 'custom_channel_type',
    label: 'Channel Type',
    fieldtype: 'Select',
    options: ['OA', 'Personal'],
    default: 'OA',
    required: false,
    unique: false,
    readOnly: false,
    insertAfter: 'customer',
  },
  {
    fieldname: 'custom_account_id',
    label: 'Zalo Account ID',
    fieldtype: 'Data',
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_channel_type',
  },
  {
    fieldname: 'custom_message_key',
    label: 'Message Key',
    fieldtype: 'Data',
    required: false,
    unique: true,
    readOnly: true,
    noCopy: true,
    insertAfter: 'custom_account_id',
  },
  {
    fieldname: 'custom_thread_id',
    label: 'Thread ID',
    fieldtype: 'Data',
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_message_key',
  },
  {
    fieldname: 'custom_thread_type',
    label: 'Thread Type',
    fieldtype: 'Select',
    options: ['user', 'group'],
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_thread_id',
  },
  {
    fieldname: 'custom_sender_id',
    label: 'Sender ID',
    fieldtype: 'Data',
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_thread_type',
  },
  {
    fieldname: 'custom_direction',
    label: 'Direction',
    fieldtype: 'Select',
    options: ['incoming', 'outgoing'],
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_sender_id',
  },
  {
    fieldname: 'custom_zca_msg_type',
    label: 'ZCA Message Type',
    fieldtype: 'Data',
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_direction',
  },
  {
    fieldname: 'custom_sdk_timestamp',
    label: 'SDK Timestamp',
    fieldtype: 'Data',
    required: false,
    unique: false,
    readOnly: true,
    insertAfter: 'custom_zca_msg_type',
  },
] as const;

export interface FieldOverrideDefinition {
  readonly fieldname: string;
  readonly required: boolean;
}

export const ZALO_CONVERSATION_FIELD_OVERRIDES: readonly FieldOverrideDefinition[] = [
  {
    fieldname: 'customer',
    required: false,
  },
] as const;

export const ZALO_MESSAGE_FIELD_OVERRIDES: readonly FieldOverrideDefinition[] = [
  {
    fieldname: 'content',
    required: false,
  },
  {
    fieldname: 'sender_type',
    required: false,
  },
] as const;
