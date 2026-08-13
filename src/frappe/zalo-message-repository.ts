import type { NormalizedZaloMessage } from '../message/normalized.js';
import type { FrappeResourceClient } from './resource.js';
import { FrappeError } from './types.js';
import {
  mapZaloConversationPayload,
  mapZaloMessagePayload,
  ZaloMessageMapperError,
} from './zalo-message-mapper.js';
import {
  ZALO_CONVERSATION_DOCTYPE,
  ZALO_MESSAGE_DOCTYPE,
} from './zalo-shared-schema.js';

export class ZaloMessagePersistenceError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'ZaloMessagePersistenceError';
  }
}

export interface ZaloMessagePersistenceOptions {
  readonly frappeTimeZone: string;
}

export type ZaloMessageRepositoryOptions = ZaloMessagePersistenceOptions;

export interface ZaloMessagePersistenceResult {
  readonly conversationName: string;
  readonly conversationStatus: 'created' | 'existing';
  readonly messageName: string;
  readonly messageStatus: 'created' | 'existing';
}

export class ZaloMessageRepository {
  readonly #resourceClient: FrappeResourceClient;
  readonly #frappeTimeZone: string;

  constructor(
    resourceClient: FrappeResourceClient,
    options: ZaloMessageRepositoryOptions
  ) {
    if (!resourceClient || typeof resourceClient.list !== 'function') {
      throw new ZaloMessagePersistenceError(
        'Resource client must be a valid FrappeResourceClient instance'
      );
    }
    if (
      !options ||
      typeof options !== 'object' ||
      typeof options.frappeTimeZone !== 'string' ||
      options.frappeTimeZone.trim().length === 0
    ) {
      throw new ZaloMessagePersistenceError(
        'Invalid or missing repository options: frappeTimeZone is required'
      );
    }
    this.#resourceClient = resourceClient;
    this.#frappeTimeZone = options.frappeTimeZone.trim();
  }

  async persistMessage(
    message: NormalizedZaloMessage
  ): Promise<ZaloMessagePersistenceResult> {
    let conversationPayload: Readonly<Record<string, unknown>>;
    try {
      conversationPayload = mapZaloConversationPayload(message);
    } catch (err) {
      if (err instanceof ZaloMessageMapperError) {
        throw new ZaloMessagePersistenceError(err.message);
      }
      throw new ZaloMessagePersistenceError('Invalid message mapping payload');
    }

    const conversationKey = conversationPayload.custom_conversation_key as string;

    let conversationName: string;
    let conversationStatus: 'created' | 'existing';

    try {
      const matches = await this.#resourceClient.list(
        ZALO_CONVERSATION_DOCTYPE,
        {
          filters: [['custom_conversation_key', '=', conversationKey]],
          fields: ['name'],
        }
      );

      if (matches.length > 1) {
        throw new ZaloMessagePersistenceError(
          'Multiple conversations matched single conversation key'
        );
      }

      if (matches.length === 1) {
        const foundName = matches[0]?.name;
        if (typeof foundName !== 'string' || foundName.trim() === '') {
          throw new ZaloMessagePersistenceError(
            'Invalid conversation name returned from list query'
          );
        }
        conversationName = foundName;
        conversationStatus = 'existing';
      } else {
        // 0 matches: attempt create
        try {
          const createdDoc = await this.#resourceClient.create(
            ZALO_CONVERSATION_DOCTYPE,
            conversationPayload
          );
          const createdName = createdDoc.name;
          if (typeof createdName !== 'string' || createdName.trim() === '') {
            throw new ZaloMessagePersistenceError(
              'Invalid conversation name returned from creation'
            );
          }
          conversationName = createdName;
          conversationStatus = 'created';
        } catch {
          // Race recovery: exact 1 lookup
          const retryMatches = await this.#resourceClient.list(
            ZALO_CONVERSATION_DOCTYPE,
            {
              filters: [['custom_conversation_key', '=', conversationKey]],
              fields: ['name'],
            }
          );

          if (
            retryMatches.length === 1 &&
            typeof retryMatches[0]?.name === 'string' &&
            retryMatches[0].name.trim() !== ''
          ) {
            conversationName = retryMatches[0].name;
            conversationStatus = 'existing';
          } else {
            throw new ZaloMessagePersistenceError(
              'Failed to persist conversation'
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof ZaloMessagePersistenceError) {
        throw err;
      }
      throw new ZaloMessagePersistenceError('Failed to query conversation resource');
    }

    let messagePayload: Readonly<Record<string, unknown>>;
    try {
      messagePayload = mapZaloMessagePayload(
        message,
        conversationName,
        this.#frappeTimeZone
      );
    } catch (err) {
      if (err instanceof ZaloMessageMapperError) {
        throw new ZaloMessagePersistenceError(err.message);
      }
      throw new ZaloMessagePersistenceError('Invalid message payload mapping');
    }

    const messageKey = messagePayload.custom_message_key as string;

    let messageName: string;
    let messageStatus: 'created' | 'existing';

    try {
      const matches = await this.#resourceClient.list(ZALO_MESSAGE_DOCTYPE, {
        filters: [['custom_message_key', '=', messageKey]],
        fields: ['name'],
      });

      if (matches.length > 1) {
        throw new ZaloMessagePersistenceError(
          'Multiple messages matched single message key'
        );
      }

      if (matches.length === 1) {
        const foundName = matches[0]?.name;
        if (typeof foundName !== 'string' || foundName.trim() === '') {
          throw new ZaloMessagePersistenceError(
            'Invalid message name returned from list query'
          );
        }
        messageName = foundName;
        messageStatus = 'existing';
      } else {
        // 0 matches: attempt create
        try {
          const createdDoc = await this.#resourceClient.create(
            ZALO_MESSAGE_DOCTYPE,
            messagePayload
          );
          const createdName = createdDoc.name;
          if (typeof createdName !== 'string' || createdName.trim() === '') {
            throw new ZaloMessagePersistenceError(
              'Invalid message name returned from creation'
            );
          }
          messageName = createdName;
          messageStatus = 'created';
        } catch {
          // Race recovery: exact 1 lookup
          const retryMatches = await this.#resourceClient.list(
            ZALO_MESSAGE_DOCTYPE,
            {
              filters: [['custom_message_key', '=', messageKey]],
              fields: ['name'],
            }
          );

          if (
            retryMatches.length === 1 &&
            typeof retryMatches[0]?.name === 'string' &&
            retryMatches[0].name.trim() !== ''
          ) {
            messageName = retryMatches[0].name;
            messageStatus = 'existing';
          } else {
            throw new ZaloMessagePersistenceError('Failed to persist message');
          }
        }
      }
    } catch (err) {
      if (err instanceof ZaloMessagePersistenceError) {
        throw err;
      }
      throw new ZaloMessagePersistenceError('Failed to query message resource');
    }

    return Object.freeze({
      conversationName,
      conversationStatus,
      messageName,
      messageStatus,
    });
  }
}
