import { createHash } from 'node:crypto';
import { FrappeError } from './types.js';

export class ZaloFrappeSchemaContractError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'ZaloFrappeSchemaContractError';
  }
}

function validateIdentifier(name: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new ZaloFrappeSchemaContractError(`Invalid ${name}: identifier must be a string`);
  }
  if (value.trim().length === 0) {
    throw new ZaloFrappeSchemaContractError(`Invalid ${name}: identifier cannot be empty or whitespace-only`);
  }
  if (value.length > 140) {
    throw new ZaloFrappeSchemaContractError(`Invalid ${name}: identifier exceeds maximum capacity of 140 characters`);
  }
  return value;
}

function validateThreadType(threadType: unknown): 'user' | 'group' {
  if (threadType !== 'user' && threadType !== 'group') {
    throw new ZaloFrappeSchemaContractError("Invalid threadType: must be 'user' or 'group'");
  }
  return threadType;
}

export function buildZaloCustomerKey(accountId: string, zaloUserId: string): string {
  const validAccount = validateIdentifier('accountId', accountId);
  const validUser = validateIdentifier('zaloUserId', zaloUserId);

  const payload = JSON.stringify(['zalo-personal-customer-v1', validAccount, validUser]);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function buildZaloConversationKey(
  accountId: string,
  threadType: 'user' | 'group',
  threadId: string
): string {
  const validAccount = validateIdentifier('accountId', accountId);
  const validThreadType = validateThreadType(threadType);
  const validThread = validateIdentifier('threadId', threadId);

  const payload = JSON.stringify([
    'zalo-personal-conversation-v1',
    validAccount,
    validThreadType,
    validThread,
  ]);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function buildZaloMessageKey(
  accountId: string,
  threadType: 'user' | 'group',
  threadId: string,
  messageId: string
): string {
  const validAccount = validateIdentifier('accountId', accountId);
  const validThreadType = validateThreadType(threadType);
  const validThread = validateIdentifier('threadId', threadId);
  const validMessage = validateIdentifier('messageId', messageId);

  const payload = JSON.stringify([
    'zalo-personal-message-v1',
    validAccount,
    validThreadType,
    validThread,
    validMessage,
  ]);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
