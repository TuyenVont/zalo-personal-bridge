import type { ZaloMessageListenerManager } from './listener.js';
import { ZaloMessageDeduplicator } from './dedup.js';
import { parseZaloRawMessage } from './parser.js';
import type { NormalizedZaloMessage } from './normalized.js';

/**
 * Callback handler signature for receiving normalized Zalo messages.
 * Downstream components receive ONLY NormalizedZaloMessage objects
 * without raw SDK payload references.
 */
export type ZaloNormalizedMessageHandler = (
  message: NormalizedZaloMessage,
) => void | Promise<void>;

/**
 * Message processing pipeline (Developer B Phase B2.4).
 * Orchestrates existing Developer B components:
 * Zalo listener -> raw message -> parser -> normalized message -> deduplicator -> normalized consumer.
 */
export class ZaloMessagePipeline {
  private readonly listenerManager: ZaloMessageListenerManager;
  private readonly deduplicator: ZaloMessageDeduplicator;

  constructor(
    listenerManager: ZaloMessageListenerManager,
    deduplicator: ZaloMessageDeduplicator = new ZaloMessageDeduplicator(),
  ) {
    if (!listenerManager) {
      throw new Error(
        'Invalid ZaloMessagePipeline arguments: listenerManager must be provided',
      );
    }
    if (!deduplicator) {
      throw new Error(
        'Invalid ZaloMessagePipeline arguments: deduplicator must be provided',
      );
    }
    this.listenerManager = listenerManager;
    this.deduplicator = deduplicator;
  }

  /**
   * Check if local listener is active for an accountId.
   * Delegates directly to ZaloMessageListenerManager.
   */
  public isListening(accountId: string): boolean {
    return this.listenerManager.isListening(accountId);
  }

  /**
   * Start processing messages for a connected Zalo account.
   * Delegates lifecycle ownership to ZaloMessageListenerManager.
   */
  public async start(
    accountId: string,
    handler: ZaloNormalizedMessageHandler,
  ): Promise<void> {
    if (typeof handler !== 'function') {
      throw new Error('Invalid handler: handler must be a function');
    }

    await this.listenerManager.start(accountId, async (accId, rawMessage) => {
      const normalized = parseZaloRawMessage(accId, rawMessage);
      if (!normalized) {
        return;
      }

      const dedupResult = this.deduplicator.checkAndMark(normalized);
      if (dedupResult === 'duplicate') {
        return;
      }

      await handler(normalized);
    });
  }

  /**
   * Stop listening for messages on a Zalo account.
   * Delegates directly to ZaloMessageListenerManager.
   * Retains in-memory deduplication state across stop/start.
   */
  public async stop(accountId: string): Promise<void> {
    await this.listenerManager.stop(accountId);
  }
}
