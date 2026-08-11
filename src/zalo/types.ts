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

/**
 * Internal credentials captured during authentication.
 * Must NEVER be logged or exposed over HTTP API.
 */
export interface CapturedCredentials {
  cookie: any;
  imei: string;
  userAgent: string;
}

/**
 * Normalized public QR lifecycle events emitted during login.
 * Note: Credentials are NOT exposed in QR events.
 */
export type ZaloQrEvent =
  | {
      type: 'qr_generated';
      qrImage: string;
    }
  | {
      type: 'qr_expired';
    }
  | {
      type: 'qr_scanned';
      displayName?: string;
      avatar?: string;
    }
  | {
      type: 'qr_declined';
      code?: string;
    };

/**
 * Successful QR login result payload.
 */
export interface ZaloLoginResult {
  api: any;
  zaloUid: string;
  credentials: CapturedCredentials;
}

/**
 * Successful session login result payload.
 * Credentials are not returned since caller already owns them.
 */
export interface ZaloSessionLoginResult {
  api: any;
  zaloUid: string;
}

/**
 * Persisted Zalo account session data structure.
 * Stored securely in encrypted storage for session restoration.
 */
export interface PersistedZaloSession {
  version: 1;
  accountId: string;
  zaloUid: string;
  credentials: CapturedCredentials;
  savedAt: string;
}

/**
 * Interface contract for Zalo session persistence storage.
 */
export interface IZaloSessionStore {
  save(accountId: string, session: PersistedZaloSession): Promise<void>;
  load(accountId: string): Promise<PersistedZaloSession | null>;
  remove(accountId: string): Promise<boolean>;
}

