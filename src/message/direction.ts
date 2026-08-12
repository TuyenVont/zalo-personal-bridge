import type { ZaloMessageDirection } from './normalized.js';

/**
 * Pure, side-effect free helper function to detect Zalo message direction
 * based strictly on the zca-js wrapper's `isSelf` boolean property.
 *
 * Requirements:
 * - rawMessage must be a non-null object.
 * - `isSelf` must exist on rawMessage wrapper as a strict boolean (`typeof isSelf === 'boolean'`).
 * - `isSelf === true`  -> 'outgoing'
 * - `isSelf === false` -> 'incoming'
 * - missing or non-boolean `isSelf` -> null
 * - does NOT inspect `rawMessage.data` for direction.
 * - does NOT mutate raw input.
 * - no logging, no side-effects, deterministic.
 *
 * @param rawMessage - Raw event payload received from Zalo SDK listener.
 * @returns ZaloMessageDirection ('incoming' | 'outgoing') or null if invalid/missing isSelf.
 */
export function detectZaloMessageDirection(
  rawMessage: unknown,
): ZaloMessageDirection | null {
  if (rawMessage === null || typeof rawMessage !== 'object') {
    return null;
  }

  const rawObj = rawMessage as Record<string, unknown>;

  if (typeof rawObj.isSelf !== 'boolean') {
    return null;
  }

  return rawObj.isSelf ? 'outgoing' : 'incoming';
}
