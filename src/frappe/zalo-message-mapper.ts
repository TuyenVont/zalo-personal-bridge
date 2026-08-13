import type { NormalizedZaloMessage } from '../message/normalized.js';
import { FrappeError } from './types.js';
import { buildZaloConversationKey, buildZaloMessageKey } from './zalo-identity.js';

export class ZaloMessageMapperError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'ZaloMessageMapperError';
  }
}

/**
 * Converts a numeric Unix timestamp in milliseconds to a Frappe Datetime format string ('YYYY-MM-DD HH:mm:ss')
 * in the explicit Frappe site IANA timezone using Intl.DateTimeFormat.
 *
 * @param timestamp - Unix epoch timestamp in milliseconds.
 * @param frappeTimeZone - Explicit IANA timezone string (e.g. 'Asia/Ho_Chi_Minh', 'UTC', 'Asia/Kathmandu').
 * @returns Frappe Datetime formatted string in site wall-clock time.
 */
export function formatFrappeDatetime(
  timestamp: number,
  frappeTimeZone: string
): string {
  if (
    typeof timestamp !== 'number' ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0
  ) {
    throw new ZaloMessageMapperError('Timestamp must be a positive safe integer');
  }

  if (
    typeof frappeTimeZone !== 'string' ||
    frappeTimeZone.trim().length === 0
  ) {
    throw new ZaloMessageMapperError('Invalid Frappe timezone');
  }

  let dtf: Intl.DateTimeFormat;
  try {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: frappeTimeZone.trim(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new ZaloMessageMapperError('Invalid Frappe timezone');
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new ZaloMessageMapperError('Invalid timestamp value');
  }

  try {
    const parts = dtf.formatToParts(date);
    const partsMap: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') {
        partsMap[p.type] = p.value;
      }
    }

    const { year, month, day, hour, minute, second } = partsMap;
    if (!year || !month || !day || !hour || !minute || !second) {
      throw new ZaloMessageMapperError('Failed to format datetime parts');
    }

    const YYYY = year.padStart(4, '0');
    const MM = month.padStart(2, '0');
    const DD = day.padStart(2, '0');
    const hh = hour.padStart(2, '0');
    const mm = minute.padStart(2, '0');
    const ss = second.padStart(2, '0');

    return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
  } catch (err) {
    if (err instanceof ZaloMessageMapperError) {
      throw err;
    }
    throw new ZaloMessageMapperError('Failed to format datetime parts');
  }
}

function validateNormalizedMessage(msg: unknown): NormalizedZaloMessage {
  if (!msg || typeof msg !== 'object') {
    throw new ZaloMessageMapperError('Normalized message must be a non-null object');
  }

  const m = msg as Record<string, unknown>;

  if (typeof m.accountId !== 'string' || m.accountId.trim() === '') {
    throw new ZaloMessageMapperError('Invalid accountId in normalized message');
  }
  if (m.threadType !== 'user' && m.threadType !== 'group') {
    throw new ZaloMessageMapperError('Invalid threadType in normalized message');
  }
  if (typeof m.threadId !== 'string' || m.threadId.trim() === '') {
    throw new ZaloMessageMapperError('Invalid threadId in normalized message');
  }
  if (typeof m.messageId !== 'string' || m.messageId.trim() === '') {
    throw new ZaloMessageMapperError('Invalid messageId in normalized message');
  }
  if (typeof m.senderId !== 'string' || m.senderId.trim() === '') {
    throw new ZaloMessageMapperError('Invalid senderId in normalized message');
  }
  if (m.direction !== 'incoming' && m.direction !== 'outgoing') {
    throw new ZaloMessageMapperError('Invalid direction in normalized message');
  }
  if (
    typeof m.timestamp !== 'number' ||
    !Number.isSafeInteger(m.timestamp) ||
    m.timestamp <= 0
  ) {
    throw new ZaloMessageMapperError('Invalid timestamp in normalized message');
  }

  // Strict runtime type validation: textContent and msgType must be string | null only
  if (m.textContent !== null && typeof m.textContent !== 'string') {
    throw new ZaloMessageMapperError('Invalid textContent in normalized message');
  }
  if (m.msgType !== null && typeof m.msgType !== 'string') {
    throw new ZaloMessageMapperError('Invalid msgType in normalized message');
  }

  return msg as NormalizedZaloMessage;
}

/**
 * Maps a NormalizedZaloMessage to a Zalo OA Conversation document payload for Frappe.
 *
 * Sets:
 * - custom_channel_type = "Personal"
 * - custom_account_id = accountId
 * - custom_conversation_key = buildZaloConversationKey(...)
 * - custom_thread_id = threadId
 * - custom_thread_type = threadType
 *
 * Does NOT set customer or OA/business fields.
 */
export function mapZaloConversationPayload(
  msg: NormalizedZaloMessage
): Readonly<Record<string, unknown>> {
  const validMsg = validateNormalizedMessage(msg);

  const conversationKey = buildZaloConversationKey(
    validMsg.accountId,
    validMsg.threadType,
    validMsg.threadId
  );

  return Object.freeze({
    custom_channel_type: 'Personal',
    custom_account_id: validMsg.accountId,
    custom_conversation_key: conversationKey,
    custom_thread_id: validMsg.threadId,
    custom_thread_type: validMsg.threadType,
  });
}

/**
 * Maps a NormalizedZaloMessage and conversation reference name to a Zalo OA Message document payload.
 *
 * Sets:
 * - conversation = conversationName
 * - custom_channel_type = "Personal"
 * - custom_account_id = accountId
 * - custom_message_key = buildZaloMessageKey(...)
 * - custom_thread_id = threadId
 * - custom_thread_type = threadType
 * - custom_sender_id = senderId
 * - custom_direction = direction
 * - custom_sdk_timestamp = String(message.timestamp)
 * - zalo_message_id = messageId
 * - sent_at = Frappe site wall-clock Datetime in explicit frappeTimeZone
 * - custom_zca_msg_type (if msgType !== null)
 * - content (if textContent !== null)
 *
 * Never sets: customer, sender_type, message_type, delivery_status, is_read, raw_payload.
 */
export function mapZaloMessagePayload(
  msg: NormalizedZaloMessage,
  conversationName: string,
  frappeTimeZone: string
): Readonly<Record<string, unknown>> {
  if (typeof conversationName !== 'string' || conversationName.trim() === '') {
    throw new ZaloMessageMapperError('conversationName must be a non-empty string');
  }

  const validMsg = validateNormalizedMessage(msg);

  const messageKey = buildZaloMessageKey(
    validMsg.accountId,
    validMsg.threadType,
    validMsg.threadId,
    validMsg.messageId
  );

  const sentAt = formatFrappeDatetime(validMsg.timestamp, frappeTimeZone);

  const payload: Record<string, unknown> = {
    conversation: conversationName,
    custom_channel_type: 'Personal',
    custom_account_id: validMsg.accountId,
    custom_message_key: messageKey,
    custom_thread_id: validMsg.threadId,
    custom_thread_type: validMsg.threadType,
    custom_sender_id: validMsg.senderId,
    custom_direction: validMsg.direction,
    custom_sdk_timestamp: String(validMsg.timestamp),
    zalo_message_id: validMsg.messageId,
    sent_at: sentAt,
  };

  if (validMsg.msgType !== null) {
    payload.custom_zca_msg_type = validMsg.msgType;
  }

  if (validMsg.textContent !== null) {
    payload.content = validMsg.textContent;
  }

  return Object.freeze(payload);
}
