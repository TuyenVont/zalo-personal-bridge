/**
 * Supported thread/conversation categories in normalized Zalo messages.
 */
export type ThreadTypeCategory = 'user' | 'group';

/**
 * Immutable normalized Zalo message model (Developer B Phase B2.1).
 * Represents a sanitized, normalized internal domain message stripped of raw SDK references.
 */
export interface NormalizedZaloMessage {
  /** Target Zalo bridge account ID */
  readonly accountId: string;

  /** Zalo message identifier (from SDK data.msgId) */
  readonly messageId: string;

  /** Thread or conversation identifier (from SDK wrapper threadId) */
  readonly threadId: string;

  /** Sender Zalo user ID (from SDK data.uidFrom) */
  readonly senderId: string;

  /** Normalized numeric value of SDK data.ts */
  readonly timestamp: number;

  /** Text content of the message if plain text, or null for non-text/media messages */
  readonly textContent: string | null;

  /** Thread type category: 'user' (direct message) or 'group' */
  readonly threadType: ThreadTypeCategory;

  /** Original raw Zalo message type string (e.g., 'webchat', 'chat.photo', etc.) if available */
  readonly msgType: string | null;
}
