import { ZaloClient } from './client.js';

import type {
  IZaloConnectionReader,
  ZaloAccountStatus,
  ZaloInstance,
  ZaloLoginResult,
  ZaloQrEvent,
} from './types.js';

/**
 * Minimal QR client contract used by ZaloAccountPool.
 *
 * This keeps the pool testable without requiring a real zca-js connection.
 */
export type IQrClientLike = {
  loginQR(
    onQrEvent?: (event: ZaloQrEvent) => void,
  ): Promise<ZaloLoginResult>;
};

/**
 * In-memory pool for managing personal Zalo account connection instances.
 *
 * Implements IZaloConnectionReader for consumption by Developer B.
 */
export class ZaloAccountPool implements IZaloConnectionReader {
  private readonly instances = new Map<string, ZaloInstance>();

  /**
   * Per-account operation queue.
   *
   * Each accountId has its own tail Promise so operations for the same
   * account execute sequentially while different accounts stay independent.
   */
  private readonly locks = new Map<string, Promise<void>>();

  /**
   * Retrieve a Zalo instance by accountId.
   */
  public getInstance(accountId: string): ZaloInstance | null {
    return this.instances.get(accountId) ?? null;
  }

  /**
   * Return current account status.
   *
   * Unknown accounts are treated as disconnected.
   */
  public getStatus(accountId: string): ZaloAccountStatus {
    return this.instances.get(accountId)?.status ?? 'disconnected';
  }

  /**
   * Retrieve an existing instance or create a default disconnected instance.
   */
  public createOrGetInstance(accountId: string): ZaloInstance {
    const existing = this.instances.get(accountId);

    if (existing) {
      return existing;
    }

    const newInstance: ZaloInstance = {
      accountId,
      status: 'disconnected',
      zaloUid: null,
      api: null,
    };

    this.instances.set(accountId, newInstance);

    return newInstance;
  }

  /**
   * Update mutable fields of an existing instance.
   *
   * accountId is intentionally immutable.
   */
  public updateInstance(
    accountId: string,
    patch: Partial<Omit<ZaloInstance, 'accountId'>>,
  ): ZaloInstance | null {
    const instance = this.instances.get(accountId);

    if (!instance) {
      return null;
    }

    /**
     * Runtime protection in case an untyped caller bypasses the TypeScript
     * contract and attempts to inject accountId into the patch.
     */
    const runtimePatch = {
      ...(patch as Record<string, unknown>),
    };

    delete runtimePatch.accountId;

    const updated: ZaloInstance = {
      ...instance,
      ...(runtimePatch as Partial<Omit<ZaloInstance, 'accountId'>>),
      accountId: instance.accountId,
    };

    this.instances.set(accountId, updated);

    return updated;
  }

  /**
   * Remove an instance from the in-memory pool.
   */
  public removeInstance(accountId: string): boolean {
    return this.instances.delete(accountId);
  }

  /**
   * Testing/diagnostic helper.
   *
   * Not part of IZaloConnectionReader and therefore not part of
   * Developer B's public connection contract.
   */
  public get activeLockCount(): number {
    return this.locks.size;
  }

  /**
   * Execute an async operation under a per-account lock.
   *
   * Behavior:
   * - same accountId: operations execute sequentially
   * - different accountIds: operations can execute concurrently
   * - failure does not permanently block the account
   * - lock bookkeeping is removed after the final queued operation
   */
  public async withAccountLock<T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.locks.get(accountId) ?? Promise.resolve();

    let release!: () => void;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tail = previous
      .catch(() => { })
      .then(() => gate);

    this.locks.set(accountId, tail);

    try {
      /**
       * Wait for the previous operation on this account.
       *
       * A previous rejection must not poison the queue.
       */
      await previous.catch(() => { });

      return await operation();
    } finally {
      /**
       * Release the next queued operation.
       */
      release();

      /**
       * Only delete the lock if this operation is still the final tail.
       *
       * If another operation has already queued behind this one,
       * this.locks.get(accountId) points at a newer Promise and must remain.
       */
      if (this.locks.get(accountId) === tail) {
        this.locks.delete(accountId);
      }
    }
  }

  /**
   * Start a fresh QR login for a personal Zalo account.
   *
   * This phase handles only:
   * - QR lifecycle
   * - account status
   * - api handle
   * - Zalo UID
   *
   * Session credentials returned by ZaloClient are deliberately NOT stored
   * here. Secure persistence belongs to Phase A4.
   */
  public async startQrLogin(
    accountId: string,
    onQrEvent?: (event: ZaloQrEvent) => void,
    clientFactory?: () => IQrClientLike,
  ): Promise<ZaloInstance> {
    return this.withAccountLock(accountId, async () => {
      /**
       * A manually-started QR login is a fresh authentication attempt.
       *
       * Clear any stale UID/API left from an older connection before
       * beginning authentication.
       */
      this.createOrGetInstance(accountId);

      this.updateInstance(accountId, {
        status: 'qr_pending',
        zaloUid: null,
        api: null,
      });

      /**
       * Once QR expires or is declined, that QR session is terminal.
       *
       * We preserve needs_qr even if the SDK subsequently rejects or
       * unexpectedly resolves.
       */
      let reachedTerminalQrState = false;

      try {
        const client = clientFactory
          ? clientFactory()
          : new ZaloClient();

        const result = await client.loginQR(
          (event: ZaloQrEvent) => {
            switch (event.type) {
              case 'qr_generated': {
                this.updateInstance(accountId, {
                  status: 'qr_pending',
                });

                break;
              }

              case 'qr_scanned': {
                this.updateInstance(accountId, {
                  status: 'connecting',
                });

                break;
              }

              case 'qr_expired':
              case 'qr_declined': {
                reachedTerminalQrState = true;

                this.updateInstance(accountId, {
                  status: 'needs_qr',
                  api: null,
                  zaloUid: null,
                });

                break;
              }
            }

            /**
             * Forward only normalized public QR events.
             *
             * ZaloQrEvent does not contain cookie, imei or userAgent.
             */
            onQrEvent?.(event);
          },
        );

        /**
         * Defensive guard.
         *
         * If the QR was already expired/declined, a strange SDK/mock
         * resolution must never revive that QR session into connected.
         */
        if (reachedTerminalQrState) {
          this.updateInstance(accountId, {
            status: 'needs_qr',
            api: null,
            zaloUid: null,
          });

          throw new Error(
            'QR login resolved after QR session reached a terminal state',
          );
        }

        /**
         * Credentials contained in result are intentionally ignored here.
         *
         * Phase A4 will persist:
         * - cookie
         * - imei
         * - userAgent
         */
        const updated = this.updateInstance(accountId, {
          status: 'connected',
          zaloUid: result.zaloUid,
          api: result.api,
        });

        if (!updated) {
          throw new Error(
            `Zalo instance disappeared during QR login: ${accountId}`,
          );
        }

        return updated;
      } catch (error) {
        if (reachedTerminalQrState) {
          /**
           * Keep the meaningful terminal status.
           *
           * Do not convert needs_qr into generic error.
           */
          this.updateInstance(accountId, {
            status: 'needs_qr',
            api: null,
            zaloUid: null,
          });
        } else {
          /**
           * Unexpected SDK/runtime failure.
           */
          this.updateInstance(accountId, {
            status: 'error',
            api: null,
          });
        }

        throw error;
      }
    });
  }
}