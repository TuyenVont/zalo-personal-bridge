/**
 * Handler function signature for raw Zalo incoming message events.
 * The raw message payload must remain internal to Developer B's message adapter layer.
 */
export type ZaloRawMessageHandler = (
  accountId: string,
  rawMessage: unknown,
) => void | Promise<void>;
