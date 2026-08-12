import type { NormalizedZaloMessage } from './normalized.js';

export type ZaloDedupResult = 'accepted' | 'duplicate';

export interface ZaloMessageDeduplicatorOptions {
  /** Time-to-live for deduplication entries in milliseconds (default: 10 minutes) */
  ttlMs?: number;
  /** Maximum number of retained deduplication entries before eviction (default: 10,000) */
  maxEntries?: number;
  /** Clock function producing current observation time in milliseconds (default: Date.now) */
  now?: () => number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Bounded in-memory deduplicator for NormalizedZaloMessage instances (Developer B Phase B2.3).
 * Operates strictly on NormalizedZaloMessage routing identifiers (accountId, threadType, threadId, messageId).
 */
export class ZaloMessageDeduplicator {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly nowFn: () => number;
  private readonly entries = new Map<string, number>();

  constructor(options?: ZaloMessageDeduplicatorOptions) {
    const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    if (
      typeof ttlMs !== 'number' ||
      !Number.isSafeInteger(ttlMs) ||
      ttlMs <= 0
    ) {
      throw new Error(
        'Invalid ZaloMessageDeduplicator options: ttlMs must be a positive safe integer',
      );
    }
    this.ttlMs = ttlMs;

    const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (
      typeof maxEntries !== 'number' ||
      !Number.isSafeInteger(maxEntries) ||
      maxEntries <= 0
    ) {
      throw new Error(
        'Invalid ZaloMessageDeduplicator options: maxEntries must be a positive safe integer',
      );
    }
    this.maxEntries = maxEntries;

    const now = options?.now ?? Date.now;
    if (typeof now !== 'function') {
      throw new Error(
        'Invalid ZaloMessageDeduplicator options: now must be a function',
      );
    }
    this.nowFn = now;
  }

  /**
   * Check if a normalized Zalo message has been observed recently.
   * If not observed (or if previous observation expired), mark it as observed and return 'accepted'.
   * If observed recently within TTL, return 'duplicate'.
   *
   * @param message - NormalizedZaloMessage instance to check.
   * @returns 'accepted' if message is new or expired; 'duplicate' if previously seen within TTL.
   */
  public checkAndMark(message: NormalizedZaloMessage): ZaloDedupResult {
    if (
      !message ||
      typeof message !== 'object' ||
      typeof message.accountId !== 'string' ||
      message.accountId.trim() === '' ||
      typeof message.threadId !== 'string' ||
      message.threadId.trim() === '' ||
      typeof message.messageId !== 'string' ||
      message.messageId.trim() === '' ||
      (message.threadType !== 'user' && message.threadType !== 'group')
    ) {
      throw new Error('Invalid message payload provided for deduplication');
    }

    let currentTime: number;
    try {
      currentTime = this.nowFn();
    } catch {
      throw new Error('Clock function threw an error');
    }

    if (
      typeof currentTime !== 'number' ||
      !Number.isSafeInteger(currentTime) ||
      currentTime < 0
    ) {
      throw new Error('Clock returned an invalid timestamp');
    }

    // Composite key serialization using JSON array tuple of stable routing fields
    const key = JSON.stringify([
      message.accountId,
      message.threadType,
      message.threadId,
      message.messageId,
    ]);

    // Lazy pruning of expired entries
    for (const [k, timestamp] of this.entries.entries()) {
      if (currentTime - timestamp >= this.ttlMs) {
        this.entries.delete(k);
      }
    }

    const existingTimestamp = this.entries.get(key);
    if (existingTimestamp !== undefined) {
      const age = currentTime - existingTimestamp;
      if (age < this.ttlMs) {
        return 'duplicate';
      }
      // If age >= ttlMs, entry is expired. Remove old entry to refresh.
      this.entries.delete(key);
    }

    // Store key with current observation time
    this.entries.set(key, currentTime);

    // Enforce maxEntries capacity bound by evicting oldest entries
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      } else {
        break;
      }
    }

    return 'accepted';
  }

  /**
   * Remove all in-memory deduplication entries.
   * Idempotent operation.
   */
  public clear(): void {
    this.entries.clear();
  }

  /**
   * Returns current count of retained deduplication entries.
   */
  public get size(): number {
    return this.entries.size;
  }
}
