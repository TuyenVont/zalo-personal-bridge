import { IZaloConnectionReader, ZaloAccountStatus, ZaloInstance } from './types.js';

/**
 * In-memory pool for managing personal Zalo account connection instances.
 * Implements IZaloConnectionReader for public consumption by Developer B.
 */
export class ZaloAccountPool implements IZaloConnectionReader {
  private instances: Map<string, ZaloInstance> = new Map();
  private locks: Map<string, Promise<void>> = new Map();

  /**
   * Retrieves an active account instance by accountId if present.
   */
  public getInstance(accountId: string): ZaloInstance | null {
    return this.instances.get(accountId) ?? null;
  }

  /**
   * Returns current account status, defaulting to 'disconnected' if unknown.
   */
  public getStatus(accountId: string): ZaloAccountStatus {
    return this.instances.get(accountId)?.status ?? 'disconnected';
  }

  /**
   * Internal lifecycle helper: retrieves existing instance or creates a new default instance.
   * New instances initialize as 'disconnected' with null zaloUid and api.
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
   * Internal lifecycle helper: updates fields of an existing instance.
   * Prevents accidental mutation of accountId.
   */
  public updateInstance(
    accountId: string,
    patch: Partial<Omit<ZaloInstance, 'accountId'>>
  ): ZaloInstance | null {
    const instance = this.instances.get(accountId);
    if (!instance) {
      return null;
    }

    const { accountId: _, ...validPatch } = patch as Record<string, any>;

    const updated: ZaloInstance = {
      ...instance,
      ...validPatch,
      accountId: instance.accountId,
    };

    this.instances.set(accountId, updated);
    return updated;
  }

  /**
   * Internal lifecycle helper: removes an instance from the pool.
   */
  public removeInstance(accountId: string): boolean {
    return this.instances.delete(accountId);
  }

  /**
   * Internal/test helper to inspect total active lock map entries.
   * @internal
   */
  public get activeLockCount(): number {
    return this.locks.size;
  }

  /**
   * Per-account concurrency protection.
   * Ensures async operations for the SAME accountId execute sequentially,
   * while operations for DIFFERENT accountIds run independently without blocking each other.
   */
  public async withAccountLock<T>(
    accountId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.locks.get(accountId) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tail = previous.catch(() => {}).then(() => gate);
    this.locks.set(accountId, tail);

    try {
      await previous.catch(() => {});
      return await operation();
    } finally {
      release();

      if (this.locks.get(accountId) === tail) {
        this.locks.delete(accountId);
      }
    }
  }
}
