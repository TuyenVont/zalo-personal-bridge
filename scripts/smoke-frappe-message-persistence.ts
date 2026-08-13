import type { NormalizedZaloMessage } from '../src/message/normalized.js';
import {
  buildZaloConversationKey,
  buildZaloMessageKey,
  type FetchImplementation,
  formatFrappeDatetime,
  FrappeApiClient,
  FrappeHttpError,
  FrappeResourceClient,
  FrappeTransportError,
  ZALO_CONVERSATION_DOCTYPE,
  ZALO_MESSAGE_DOCTYPE,
  ZaloMessageMapperError,
  ZaloMessagePersistenceError,
  ZaloMessageRepository,
} from '../src/frappe/index.js';

export function isUnsetFrappeValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export async function main(
  args: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: FetchImplementation
): Promise<number> {
  const hasConfirmWrite = args.includes('--confirm-write');
  const extraArgs = args.filter((arg) => arg !== '--confirm-write');

  if (extraArgs.length > 0) {
    console.error('[ERROR] Unknown command line argument');
    console.error(
      'Usage: npm run smoke:frappe-message-persistence -- --confirm-write'
    );
    return 1;
  }

  if (!hasConfirmWrite) {
    console.error(
      '[ERROR] CLI write guard flag required: specify --confirm-write'
    );
    console.error(
      'Usage: npm run smoke:frappe-message-persistence -- --confirm-write'
    );
    return 1;
  }

  const baseUrl = env.FRAPPE_BASE_URL?.trim();
  const apiKey = env.FRAPPE_API_KEY?.trim();
  const apiSecret = env.FRAPPE_API_SECRET?.trim();
  const frappeTimeZone = env.FRAPPE_TIME_ZONE?.trim();

  if (!baseUrl || !apiKey || !apiSecret || !frappeTimeZone) {
    console.error(
      '[ERROR] Missing required environment variables: FRAPPE_BASE_URL, FRAPPE_API_KEY, FRAPPE_API_SECRET, FRAPPE_TIME_ZONE'
    );
    return 1;
  }

  const nowMs = Date.now();
  try {
    formatFrappeDatetime(nowMs, frappeTimeZone);
  } catch {
    console.error('[ERROR] Invalid Frappe timezone');
    return 1;
  }

  try {
    const apiClient = new FrappeApiClient({
      baseUrl,
      apiKey,
      apiSecret,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
    const resourceClient = new FrappeResourceClient(apiClient);
    const repo = new ZaloMessageRepository(resourceClient, { frappeTimeZone });

    console.log('[FRAPPE] Client initialized');
    console.log('[INFO] Frappe timezone validated');

    const runToken = String(nowMs);

    const syntheticMessage: NormalizedZaloMessage = Object.freeze({
      accountId: 'b44b-smoke-account',
      threadType: 'user',
      threadId: `b44b-smoke-thread-${runToken}`,
      senderId: 'b44b-smoke-sender',
      messageId: `b44b-smoke-message-${runToken}`,
      timestamp: nowMs,
      textContent: 'B4.4B persistence smoke test',
      direction: 'incoming',
      msgType: 'text',
    });

    const res1 = await repo.persistMessage(syntheticMessage);
    if (
      res1.conversationStatus !== 'created' ||
      res1.messageStatus !== 'created'
    ) {
      console.error('[ERROR] Unexpected status on first persistence');
      return 1;
    }
    console.log(
      '[WRITE] First persistence: conversation=created, message=created'
    );

    const res2 = await repo.persistMessage(syntheticMessage);
    if (
      res2.conversationStatus !== 'existing' ||
      res2.messageStatus !== 'existing'
    ) {
      console.error('[ERROR] Unexpected status on second persistence');
      return 1;
    }
    console.log(
      '[CHECK] Second persistence: conversation=existing, message=existing'
    );

    const convKey = buildZaloConversationKey(
      syntheticMessage.accountId,
      syntheticMessage.threadType,
      syntheticMessage.threadId
    );
    const msgKey = buildZaloMessageKey(
      syntheticMessage.accountId,
      syntheticMessage.threadType,
      syntheticMessage.threadId,
      syntheticMessage.messageId
    );

    const convList = await resourceClient.list(ZALO_CONVERSATION_DOCTYPE, {
      filters: [['custom_conversation_key', '=', convKey]],
      fields: [
        'name',
        'customer',
        'custom_channel_type',
        'custom_account_id',
        'custom_conversation_key',
        'custom_thread_id',
        'custom_thread_type',
      ],
    });

    if (convList.length !== 1) {
      console.error('[ERROR] Direct read-back expected exactly 1 conversation');
      return 1;
    }

    const convRecord = convList[0];
    if (
      convRecord.custom_channel_type !== 'Personal' ||
      convRecord.custom_account_id !== syntheticMessage.accountId ||
      convRecord.custom_conversation_key !== convKey ||
      convRecord.custom_thread_id !== syntheticMessage.threadId ||
      convRecord.custom_thread_type !== 'user' ||
      !isUnsetFrappeValue(convRecord.customer)
    ) {
      console.error('[ERROR] Conversation read-back field verification failed');
      return 1;
    }
    console.log('[CHECK] Conversation count: 1');

    const msgList = await resourceClient.list(ZALO_MESSAGE_DOCTYPE, {
      filters: [['custom_message_key', '=', msgKey]],
      fields: [
        'name',
        'conversation',
        'custom_channel_type',
        'custom_account_id',
        'custom_message_key',
        'custom_thread_id',
        'custom_thread_type',
        'custom_sender_id',
        'custom_direction',
        'custom_sdk_timestamp',
        'custom_zca_msg_type',
        'zalo_message_id',
        'sent_at',
        'content',
        'customer',
        'sender_type',
        'message_type',
        'raw_payload',
      ],
    });

    if (msgList.length !== 1) {
      console.error('[ERROR] Direct read-back expected exactly 1 message');
      return 1;
    }
    console.log('[CHECK] Message count: 1');

    const msgRecord = msgList[0];
    const expectedSentAt = formatFrappeDatetime(nowMs, frappeTimeZone);

    if (
      msgRecord.conversation !== res1.conversationName ||
      msgRecord.custom_channel_type !== 'Personal' ||
      msgRecord.custom_account_id !== syntheticMessage.accountId ||
      msgRecord.custom_message_key !== msgKey ||
      msgRecord.custom_thread_id !== syntheticMessage.threadId ||
      msgRecord.custom_thread_type !== 'user' ||
      msgRecord.custom_sender_id !== syntheticMessage.senderId ||
      msgRecord.custom_direction !== 'incoming' ||
      msgRecord.custom_sdk_timestamp !== String(nowMs) ||
      msgRecord.custom_zca_msg_type !== 'text' ||
      msgRecord.zalo_message_id !== syntheticMessage.messageId ||
      msgRecord.content !== 'B4.4B persistence smoke test' ||
      msgRecord.sent_at !== expectedSentAt
    ) {
      console.error('[ERROR] Direct read-back field verification failed');
      return 1;
    }

    if (
      !isUnsetFrappeValue(msgRecord.customer) ||
      !isUnsetFrappeValue(msgRecord.sender_type) ||
      !isUnsetFrappeValue(msgRecord.message_type) ||
      !isUnsetFrappeValue(msgRecord.raw_payload)
    ) {
      console.error('[ERROR] Persisted record contains forbidden field');
      return 1;
    }

    console.log('[PASS] B4.4B live persistence smoke succeeded');
    return 0;
  } catch (err) {
    if (
      err instanceof ZaloMessagePersistenceError ||
      err instanceof ZaloMessageMapperError
    ) {
      console.error(`[ERROR] ${err.message}`);
    } else if (err instanceof FrappeHttpError) {
      console.error(`[ERROR] Frappe HTTP error (status ${err.status})`);
    } else if (err instanceof FrappeTransportError) {
      console.error('[ERROR] Unable to reach Frappe server');
    } else {
      console.error('[ERROR] B4.4B persistence smoke failed');
    }
    return 1;
  }
}

if (
  process.argv[1] &&
  process.argv[1].endsWith('smoke-frappe-message-persistence.ts')
) {
  main().then((code) => {
    process.exitCode = code;
  });
}
