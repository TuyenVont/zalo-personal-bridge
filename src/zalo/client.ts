import { createRequire } from 'module';
import {
  CapturedCredentials,
  ZaloLoginResult,
  ZaloQrEvent,
  ZaloSessionLoginResult,
} from './types.js';

const require = createRequire(import.meta.url);

export type ZaloFactoryOptions = {
  logging: boolean;
  selfListen: boolean;
};

export type ZaloFactory = (options: ZaloFactoryOptions) => {
  loginQR(
    options: Record<string, never>,
    callback: (event: any) => void
  ): Promise<any>;
  login(options: {
    cookie: any;
    imei: string;
    userAgent: string;
  }): Promise<any>;
};

const defaultZaloFactory: ZaloFactory = (options) => {
  const { Zalo } = require('zca-js');
  return new Zalo(options);
};

export interface IZaloClientOptions {
  logging?: boolean;
  selfListen?: boolean;
  maxQrRetries?: number;
}

/**
 * Zalo SDK adapter wrapping zca-js login flows.
 */
export class ZaloClient {
  private zaloInstance: any;
  private loginEpoch = 0;
  private activeLoginAbort: ((reason: Error) => void) | null = null;
  public readonly options: Required<IZaloClientOptions>;

  constructor(
    options: IZaloClientOptions = {},
    zaloFactory: ZaloFactory = defaultZaloFactory
  ) {
    if (
      options.maxQrRetries !== undefined &&
      (!Number.isInteger(options.maxQrRetries) || options.maxQrRetries < 0)
    ) {
      throw new Error('maxQrRetries must be a non-negative integer');
    }

    this.options = {
      logging: options.logging ?? false,
      selfListen: options.selfListen ?? true,
      maxQrRetries: options.maxQrRetries ?? 2,
    };

    // Pass only logging and selfListen to the zca-js factory
    this.zaloInstance = zaloFactory({
      logging: this.options.logging,
      selfListen: this.options.selfListen,
    });
  }

  /**
   * Reconnects using previously captured session credentials.
   * Validates credentials and returned API, resolving ZaloSessionLoginResult.
   */
  public async loginWithSession(
    credentials: CapturedCredentials
  ): Promise<ZaloSessionLoginResult> {
    if (!credentials || typeof credentials !== 'object') {
      throw new Error('credentials object is required');
    }

    if (credentials.cookie === undefined || credentials.cookie === null) {
      throw new Error('credentials.cookie is required');
    }

    if (
      typeof credentials.imei !== 'string' ||
      credentials.imei.trim() === ''
    ) {
      throw new Error('credentials.imei must be a non-empty string');
    }

    if (
      typeof credentials.userAgent !== 'string' ||
      credentials.userAgent.trim() === ''
    ) {
      throw new Error('credentials.userAgent must be a non-empty string');
    }

    // Actively terminate any previously active login attempt on this client instance
    if (this.activeLoginAbort) {
      this.activeLoginAbort(
        new Error('Login was superseded by a newer login attempt')
      );
      this.activeLoginAbort = null;
    }

    const epoch = ++this.loginEpoch;

    let isTerminal = false;
    let rejectTerminal!: (reason: Error) => void;
    const terminalPromise = new Promise<never>((_, reject) => {
      rejectTerminal = reject;
    });
    terminalPromise.catch(() => {});

    const triggerTerminal = (err: Error) => {
      if (isTerminal || epoch !== this.loginEpoch) return;
      isTerminal = true;
      rejectTerminal(err);
    };

    this.activeLoginAbort = (reason: Error) => {
      triggerTerminal(reason);
    };

    const sdkPromise = Promise.resolve().then(() =>
      this.zaloInstance.login({
        cookie: credentials.cookie,
        imei: credentials.imei,
        userAgent: credentials.userAgent,
      })
    );

    const executionPromise = (async () => {
      const api = await sdkPromise;

      if (epoch !== this.loginEpoch) {
        throw new Error('Session login was superseded by a newer login attempt');
      }

      if (isTerminal) {
        throw new Error('Session login failed: session reached a terminal state');
      }

      if (!api || typeof api.getOwnId !== 'function') {
        throw new Error(
          'Session login returned invalid API handle without getOwnId method'
        );
      }

      const zaloUid = await api.getOwnId();
      if (!zaloUid || typeof zaloUid !== 'string' || zaloUid.trim() === '') {
        throw new Error(
          'Session login failed: getOwnId returned an invalid or empty UID'
        );
      }

      return {
        api,
        zaloUid: zaloUid.trim(),
      };
    })();
    executionPromise.catch(() => {});

    try {
      return await Promise.race([executionPromise, terminalPromise]);
    } catch (err) {
      if (epoch !== this.loginEpoch) {
        throw new Error('Session login was superseded by a newer login attempt');
      }
      throw err;
    } finally {
      if (this.activeLoginAbort && epoch === this.loginEpoch) {
        this.activeLoginAbort = null;
      }
    }
  }

  /**
   * Initiates QR code login flow.
   * Converts raw zca-js events into clean ZaloQrEvents (never exposing credentials via callbacks).
   * Captures credentials internally and resolves ZaloLoginResult.
   */
  public async loginQR(
    onQrEvent?: (event: ZaloQrEvent) => void
  ): Promise<ZaloLoginResult> {
    // Actively terminate any previously active login attempt on this client instance
    if (this.activeLoginAbort) {
      this.activeLoginAbort(
        new Error('QR login was superseded by a newer login attempt')
      );
      this.activeLoginAbort = null;
    }

    const epoch = ++this.loginEpoch;

    let capturedCredentials: CapturedCredentials | null = null;
    let retryCount = 0;
    let isWaitingForRetry = false;
    let isTerminal = false;

    let rejectTerminal!: (reason: Error) => void;
    const terminalPromise = new Promise<never>((_, reject) => {
      rejectTerminal = reject;
    });
    // Suppress unhandled rejection warning if normal flow resolves first or when aborted
    terminalPromise.catch(() => {});

    const triggerTerminal = (err: Error) => {
      if (isTerminal || epoch !== this.loginEpoch) return;
      isTerminal = true;
      rejectTerminal(err);
    };

    this.activeLoginAbort = (reason: Error) => {
      triggerTerminal(reason);
    };

    const sdkPromise = this.zaloInstance.loginQR({}, (event: any) => {
      if (!event || isTerminal || epoch !== this.loginEpoch) {
        return;
      }

      switch (event.type) {
        case 0: { // QRCodeGenerated
          isWaitingForRetry = false;
          if (onQrEvent && event.data?.image) {
            onQrEvent({
              type: 'qr_generated',
              qrImage: event.data.image,
            });
          }
          break;
        }
        case 1: { // QRCodeExpired
          if (isWaitingForRetry) {
            break;
          }

          if (
            retryCount < this.options.maxQrRetries &&
            typeof event.actions?.retry === 'function'
          ) {
            isWaitingForRetry = true;
            retryCount++;
            try {
              event.actions.retry();
            } catch (retryErr: any) {
              if (onQrEvent) {
                onQrEvent({ type: 'qr_expired' });
              }
              const err =
                retryErr instanceof Error
                  ? retryErr
                  : new Error(String(retryErr));
              triggerTerminal(err);
            }
            break;
          }

          if (onQrEvent) {
            onQrEvent({ type: 'qr_expired' });
          }
          triggerTerminal(new Error('QR login expired'));
          break;
        }
        case 2: { // QRCodeScanned
          if (onQrEvent) {
            onQrEvent({
              type: 'qr_scanned',
              displayName: event.data?.display_name,
              avatar: event.data?.avatar,
            });
          }
          break;
        }
        case 3: { // QRCodeDeclined
          if (onQrEvent) {
            onQrEvent({
              type: 'qr_declined',
              code: event.data?.code,
            });
          }
          triggerTerminal(new Error('QR login was declined'));
          break;
        }
        case 4: { // GotLoginInfo
          if (event.data?.cookie && event.data?.imei && event.data?.userAgent) {
            capturedCredentials = {
              cookie: event.data.cookie,
              imei: event.data.imei,
              userAgent: event.data.userAgent,
            };
          }
          // Do NOT emit any public event for GotLoginInfo
          break;
        }
        default:
          break;
      }
    });

    const executionPromise = (async () => {
      const api = await sdkPromise;

      if (epoch !== this.loginEpoch) {
        throw new Error('QR login was superseded by a newer login attempt');
      }

      if (isTerminal) {
        throw new Error('QR login failed: session reached a terminal state');
      }

      if (!capturedCredentials) {
        throw new Error(
          'QR login completed but session credentials were not captured'
        );
      }

      if (!api || typeof api.getOwnId !== 'function') {
        throw new Error(
          'QR login returned invalid API handle without getOwnId method'
        );
      }

      const zaloUid = await api.getOwnId();
      if (!zaloUid || typeof zaloUid !== 'string' || zaloUid.trim() === '') {
        throw new Error(
          'QR login failed: getOwnId returned an invalid or empty UID'
        );
      }

      return {
        api,
        zaloUid: zaloUid.trim(),
        credentials: capturedCredentials,
      };
    })();
    executionPromise.catch(() => {});

    try {
      return await Promise.race([executionPromise, terminalPromise]);
    } catch (err) {
      if (epoch !== this.loginEpoch) {
        throw new Error('QR login was superseded by a newer login attempt');
      }
      throw err;
    } finally {
      if (this.activeLoginAbort && epoch === this.loginEpoch) {
        this.activeLoginAbort = null;
      }
    }
  }
}
