import { createRequire } from 'module';
import {
  CapturedCredentials,
  ZaloLoginResult,
  ZaloQrEvent,
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
};

const defaultZaloFactory: ZaloFactory = (options) => {
  const { Zalo } = require('zca-js');
  return new Zalo(options);
};

export interface IZaloClientOptions {
  logging?: boolean;
  selfListen?: boolean;
}

/**
 * Zalo SDK adapter wrapping zca-js login flows.
 */
export class ZaloClient {
  private zaloInstance: any;
  private capturedCredentials: CapturedCredentials | null = null;
  public readonly options: Required<IZaloClientOptions>;

  constructor(
    options: IZaloClientOptions = {},
    zaloFactory: ZaloFactory = defaultZaloFactory
  ) {
    this.options = {
      logging: options.logging ?? false,
      selfListen: options.selfListen ?? true,
    };
    this.zaloInstance = zaloFactory(this.options);
  }

  /**
   * Initiates QR code login flow.
   * Converts raw zca-js events into clean ZaloQrEvents (never exposing credentials via callbacks).
   * Captures credentials internally and resolves ZaloLoginResult.
   */
  public async loginQR(
    onQrEvent?: (event: ZaloQrEvent) => void
  ): Promise<ZaloLoginResult> {
    this.capturedCredentials = null;

    const api = await this.zaloInstance.loginQR({}, (event: any) => {
      if (!event) return;

      switch (event.type) {
        case 0: { // QRCodeGenerated
          if (onQrEvent && event.data?.image) {
            onQrEvent({
              type: 'qr_generated',
              qrImage: event.data.image,
            });
          }
          break;
        }
        case 1: { // QRCodeExpired
          if (onQrEvent) {
            onQrEvent({
              type: 'qr_expired',
            });
          }
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
          break;
        }
        case 4: { // GotLoginInfo
          if (event.data?.cookie && event.data?.imei && event.data?.userAgent) {
            this.capturedCredentials = {
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

    if (!this.capturedCredentials) {
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
      credentials: this.capturedCredentials,
    };
  }
}
