import type { NormalizedZaloMessage, ThreadTypeCategory } from './normalized.js';

/**
 * Pure parser that validates and converts a raw zca-js listener message wrapper
 * (UserMessage or GroupMessage instance shape) into a NormalizedZaloMessage.
 *
 * Requirements:
 * 1. Side-effect free and deterministic.
 * 2. Accepts ONLY live listener message wrapper objects containing { type, threadId, isSelf, data }.
 * 3. Extracts threadId ONLY from wrapper.threadId as a non-empty string.
 * 4. Extracts threadType ONLY from wrapper.type (0 -> 'user', 1 -> 'group').
 * 5. Requires string data.msgId and data.uidFrom identifiers (no numeric conversion).
 * 6. Requires string data.ts consisting of digits, normalized to safe positive integer number.
 * 7. Preserves the exact accountId value passed in.
 * 8. Does not mutate the raw input object.
 * 9. Does not retain references to the raw event payload.
 * 10. Does not leak raw payload contents in thrown or logged errors.
 * 11. Returns null for unwrapped payloads, malformed structure, or unsupported wrapper types.
 *
 * @param accountId - Target bridge Zalo account ID.
 * @param rawMessage - Raw event payload received from Zalo SDK listener.
 * @returns NormalizedZaloMessage object (frozen), or null if parsing fails/unsupported.
 */
export function parseZaloRawMessage(
  accountId: string,
  rawMessage: unknown,
): NormalizedZaloMessage | null {
  try {
    if (typeof accountId !== 'string' || accountId.trim() === '') {
      return null;
    }

    if (rawMessage === null || typeof rawMessage !== 'object') {
      return null;
    }

    const rawObj = rawMessage as Record<string, unknown>;

    // Require listener message wrapper: data property must exist and be an object
    if (
      !('data' in rawObj) ||
      rawObj.data === null ||
      typeof rawObj.data !== 'object'
    ) {
      return null;
    }

    // Extract threadType ONLY from wrapper.type (0 -> 'user', 1 -> 'group')
    const wrapperType = rawObj.type;
    let threadType: ThreadTypeCategory;
    if (wrapperType === 0) {
      threadType = 'user';
    } else if (wrapperType === 1) {
      threadType = 'group';
    } else {
      return null;
    }

    // Extract threadId ONLY from wrapper.threadId (must be a non-empty string per zca-js declaration)
    const rawWrapperThreadId = rawObj.threadId;
    if (
      typeof rawWrapperThreadId !== 'string' ||
      rawWrapperThreadId.trim() === ''
    ) {
      return null;
    }
    const threadId = rawWrapperThreadId.trim();

    const msgObj = rawObj.data as Record<string, unknown>;

    // Extract messageId from data.msgId (must be a non-empty string per zca-js declaration)
    const rawMsgId = msgObj.msgId;
    if (typeof rawMsgId !== 'string' || rawMsgId.trim() === '') {
      return null;
    }
    const messageId = rawMsgId.trim();

    // Extract senderId from data.uidFrom (must be a non-empty string per zca-js declaration)
    const rawUidFrom = msgObj.uidFrom;
    if (typeof rawUidFrom !== 'string' || rawUidFrom.trim() === '') {
      return null;
    }
    const senderId = rawUidFrom.trim();

    // Extract and normalize timestamp from data.ts (must be a non-empty digit string per zca-js declaration)
    const rawTs = msgObj.ts;
    if (typeof rawTs !== 'string') {
      return null;
    }

    const trimmedTs = rawTs.trim();
    if (trimmedTs === '' || !/^\d+$/.test(trimmedTs)) {
      return null;
    }

    const tsNum = Number(trimmedTs);
    if (!Number.isSafeInteger(tsNum) || tsNum <= 0) {
      return null;
    }

    // Extract textContent from data.content
    const rawContent = msgObj.content;
    let textContent: string | null = null;
    if (typeof rawContent === 'string') {
      textContent = rawContent;
    }

    // Extract msgType from data.msgType
    const rawMsgType = msgObj.msgType;
    let msgType: string | null = null;
    if (typeof rawMsgType === 'string' && rawMsgType.trim() !== '') {
      msgType = rawMsgType.trim();
    }

    return Object.freeze({
      accountId, // Preserved exact value
      messageId,
      threadId,
      senderId,
      timestamp: tsNum,
      textContent,
      threadType,
      msgType,
    });
  } catch {
    // Sanitized error handling: catch any unexpected runtime errors without leaking payload data
    return null;
  }
}
