import type { IZaloConnectionReader } from '../zalo/types.js';
import type { ZaloRawMessageHandler } from './types.js';

interface ListenerState {
  callback: (rawMessage: unknown) => void;
  apiListener: any;
}

/**
 * Zalo Message Listener Manager (Developer B foundation).
 *
 * Manages raw Zalo event listener lifecycles without exposing the raw API
 * or connection details outside the message adapter boundary.
 */
export class ZaloMessageListenerManager {
  private readonly listeningAccounts = new Map<string, ListenerState>();

  constructor(private readonly connectionReader: IZaloConnectionReader) {}

  /**
   * Check if local listener is active for an accountId.
   *
   * Note: This reflects local listener state only and does not alter
   * the underlying ZaloAccountPool connection status.
   */
  public isListening(accountId: string): boolean {
    return this.listeningAccounts.has(accountId);
  }

  /**
   * Start listening for raw incoming messages on a connected Zalo account.
   */
  public async start(
    accountId: string,
    handler: ZaloRawMessageHandler,
  ): Promise<void> {
    if (!accountId || typeof accountId !== 'string' || accountId.trim() === '') {
      throw new Error('Invalid accountId: accountId must be a non-empty string');
    }

    if (typeof handler !== 'function') {
      throw new Error('Invalid handler: handler must be a function');
    }

    if (this.isListening(accountId)) {
      // Idempotent start: account is already listening.
      return;
    }

    const status = this.connectionReader.getStatus(accountId);
    if (status !== 'connected') {
      throw new Error(
        `Cannot start message listener for account '${accountId}': account status is '${status}' (expected 'connected')`,
      );
    }

    const instance = this.connectionReader.getInstance(accountId);
    if (!instance || !instance.api) {
      throw new Error(
        `Cannot start message listener for account '${accountId}': Zalo API instance is missing`,
      );
    }

    const apiListener = instance.api.listener;
    if (
      !apiListener ||
      typeof apiListener.on !== 'function' ||
      typeof apiListener.start !== 'function'
    ) {
      throw new Error(
        `Cannot start message listener for account '${accountId}': Zalo API listener is invalid or missing required methods`,
      );
    }

    const messageCallback = (rawMessage: unknown) => {
      try {
        const result = handler(accountId, rawMessage);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {
            // Sanitized handling: prevent unhandled promise rejections
          });
        }
      } catch {
        // Sanitized handling: prevent unhandled sync exceptions from bubbling
      }
    };

    apiListener.on('message', messageCallback);

    try {
      apiListener.start();
    } catch (err) {
      // Clean up callback if listener.start() fails
      if (typeof apiListener.off === 'function') {
        apiListener.off('message', messageCallback);
      } else if (typeof apiListener.removeListener === 'function') {
        apiListener.removeListener('message', messageCallback);
      }
      throw err;
    }

    this.listeningAccounts.set(accountId, {
      callback: messageCallback,
      apiListener,
    });
  }

  /**
   * Stop listening for raw incoming messages on a Zalo account.
   *
   * Idempotent: safe to call multiple times or on accounts that are not listening.
   */
  public async stop(accountId: string): Promise<void> {
    const state = this.listeningAccounts.get(accountId);
    if (!state) {
      return;
    }

    this.listeningAccounts.delete(accountId);

    const { callback, apiListener } = state;

    if (typeof apiListener.off === 'function') {
      apiListener.off('message', callback);
    } else if (typeof apiListener.removeListener === 'function') {
      apiListener.removeListener('message', callback);
    }

    if (typeof apiListener.stop === 'function') {
      try {
        apiListener.stop();
      } catch {
        // Sanitized error handling on stop
      }
    }
  }
}
