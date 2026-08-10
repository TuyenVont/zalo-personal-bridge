/**
 * Possible lifecycle connection states of a Zalo account instance.
 */
export type ZaloAccountStatus =
  | 'disconnected'
  | 'qr_pending'
  | 'connecting'
  | 'connected'
  | 'needs_qr'
  | 'error';

/**
 * Internal Zalo instance state container.
 * Note: `api` is internal only and must never be exposed via HTTP responses.
 */
export interface ZaloInstance {
  accountId: string;
  status: ZaloAccountStatus;
  zaloUid: string | null;
  /** Internal raw API handle */
  api: any | null;
}

/**
 * Public connection reader interface exposed to Developer B (Message Sync).
 */
export interface IZaloConnectionReader {
  getInstance(accountId: string): ZaloInstance | null;
  getStatus(accountId: string): ZaloAccountStatus;
}
