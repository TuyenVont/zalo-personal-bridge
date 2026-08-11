import { ZaloClient } from './client.js';

import type {
  CapturedCredentials,
  IZaloConnectionReader,
  IZaloSessionStore,
  PersistedZaloSession,
  ZaloAccountStatus,
  ZaloInstance,
  ZaloLoginResult,
  ZaloQrEvent,
  ZaloSessionLoginResult,
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
 * Minimal session client contract used by ZaloAccountPool.
 */
export type ISessionClientLike = {
  loginWithSession(
    credentials: CapturedCredentials
  ): Promise<ZaloSessionLoginResult>;
};

/**
 * Options container for initializing ZaloAccountPool.
 */
export interface ZaloAccountPoolOptions {
  sessionStore?: IZaloSessionStore;
}

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

  private readonly sessionStore?: IZaloSessionStore;

  constructor(options: ZaloAccountPoolOptions = {}) {
    this.sessionStore = options.sessionStore;
  }

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
   */
  public async startQrLogin(
    accountId: string,
    onQrEvent?: (event: ZaloQrEvent) => void,
    clientFactory?: () => IQrClientLike,
  ): Promise<ZaloInstance> {
    return this.withAccountLock(accountId, async () => {
      this.createOrGetInstance(accountId);

      this.updateInstance(accountId, {
        status: 'qr_pending',
        zaloUid: null,
        api: null,
      });

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

            onQrEvent?.(event);
          },
        );

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

        if (this.sessionStore) {
          try {
            await this.sessionStore.save(accountId, {
              version: 1,
              accountId,
              zaloUid: result.zaloUid,
              credentials: result.credentials,
              savedAt: new Date().toISOString(),
            });
          } catch (storageError) {
            this.updateInstance(accountId, {
              status: 'error',
              api: null,
              zaloUid: null,
            });
            throw storageError;
          }
        }

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
          this.updateInstance(accountId, {
            status: 'needs_qr',
            api: null,
            zaloUid: null,
          });
        } else {
          this.updateInstance(accountId, {
            status: 'error',
            api: null,
          });
        }

        throw error;
      }
    });
  }

  /**
   * Restore a Zalo account connection using encrypted persisted session.
   */
  public async restoreSession(
    accountId: string,
    clientFactory?: () => ISessionClientLike,
  ): Promise<ZaloInstance> {
    return this.withAccountLock(accountId, async () => {
      this.createOrGetInstance(accountId);

      this.updateInstance(accountId, {
        status: 'connecting',
        zaloUid: null,
        api: null,
      });

      if (!this.sessionStore) {
        this.updateInstance(accountId, {
          status: 'error',
          zaloUid: null,
          api: null,
        });
        throw new Error('Zalo session store is not configured');
      }

      let persisted: PersistedZaloSession | null;
      try {
        persisted = await this.sessionStore.load(accountId);
      } catch (loadError) {
        this.updateInstance(accountId, {
          status: 'error',
          zaloUid: null,
          api: null,
        });
        throw loadError;
      }

      if (!persisted) {
        const updated = this.updateInstance(accountId, {
          status: 'needs_qr',
          zaloUid: null,
          api: null,
        });
        return updated!;
      }

      let loginResult: ZaloSessionLoginResult;
      try {
        const client = clientFactory ? clientFactory() : new ZaloClient();
        loginResult = await client.loginWithSession(persisted.credentials);
      } catch (sdkError) {
        this.updateInstance(accountId, {
          status: 'error',
          zaloUid: null,
          api: null,
        });
        throw sdkError;
      }

      const returnedUid = loginResult.zaloUid ? loginResult.zaloUid.trim() : '';
      const expectedUid = persisted.zaloUid ? persisted.zaloUid.trim() : '';

      if (returnedUid === '' || returnedUid !== expectedUid) {
        this.updateInstance(accountId, {
          status: 'needs_qr',
          zaloUid: null,
          api: null,
        });

        await this.sessionStore.remove(accountId).catch(() => {});

        throw new Error('Restored Zalo UID does not match persisted session');
      }

      const updated = this.updateInstance(accountId, {
        status: 'connected',
        zaloUid: returnedUid,
        api: loginResult.api,
      });

      if (!updated) {
        throw new Error(
          `Zalo instance disappeared during session restore: ${accountId}`,
        );
      }

      return updated;
    });
  }

  /**
   * Remove persisted session for an account and clear in-memory instance state.
   */
  public async clearSession(accountId: string): Promise<boolean> {
    return this.withAccountLock(accountId, async () => {
      this.createOrGetInstance(accountId);

      if (!this.sessionStore) {
        this.updateInstance(accountId, {
          status: 'error',
          zaloUid: null,
          api: null,
        });
        throw new Error('Zalo session store is not configured');
      }

      const removed = await this.sessionStore.remove(accountId);
      this.updateInstance(accountId, {
        status: 'needs_qr',
        zaloUid: null,
        api: null,
      });

      return removed;
    });
  }
}