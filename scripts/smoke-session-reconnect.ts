import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EncryptedFileZaloSessionStore } from '../src/zalo/session-store.js';
import { ZaloAccountPool } from '../src/zalo/pool.js';
import type { ZaloQrEvent } from '../src/zalo/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const accountId = process.argv[2] || 'acc-test-1';
const tmpDir = path.join(projectRoot, 'tmp');
const qrFilePath = path.join(tmpDir, 'zalo-login-qr.png');

const sessionDirConfig = process.env.SESSION_DIR || './sessions';
const resolvedSessionDir = path.resolve(projectRoot, sessionDirConfig);

const keyBase64 = process.env.ZALO_SESSION_KEY_BASE64;
if (!keyBase64 || typeof keyBase64 !== 'string' || keyBase64.trim() === '') {
  console.error('[ERROR] ZALO_SESSION_KEY_BASE64 is required');
  process.exitCode = 1;
  process.exit(1);
}

const trimmedKey = keyBase64.trim();
const base64Regex = /^[A-Za-z0-9+/=]+$/;
if (!base64Regex.test(trimmedKey)) {
  console.error('[ERROR] ZALO_SESSION_KEY_BASE64 is malformed base64');
  process.exitCode = 1;
  process.exit(1);
}

const encryptionKey = Buffer.from(trimmedKey, 'base64');
if (encryptionKey.length !== 32) {
  console.error('[ERROR] ZALO_SESSION_KEY_BASE64 must decode to exactly 32 bytes');
  process.exitCode = 1;
  process.exit(1);
}

/**
 * Safely saves a base64 encoded QR image to disk at tmp/zalo-login-qr.png.
 */
function saveQrImage(qrImage: string): void {
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  let base64Data = qrImage;
  if (qrImage.includes('base64,')) {
    base64Data = qrImage.split('base64,')[1];
  }

  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(qrFilePath, buffer);
}

/**
 * Callback handler for normalized public QR lifecycle events.
 * Logs only sanitized status strings without raw event objects or credentials.
 */
function handleQrEvent(event: ZaloQrEvent): void {
  switch (event.type) {
    case 'qr_generated': {
      saveQrImage(event.qrImage);
      console.log('[QR] New QR generated');
      console.log(`[QR] Open: ${qrFilePath}`);
      break;
    }

    case 'qr_scanned': {
      console.log('[QR] Scanned');
      break;
    }

    case 'qr_expired': {
      console.log('[QR] Expired - a new login attempt is required');
      break;
    }

    case 'qr_declined': {
      console.log('[QR] Declined');
      break;
    }
  }
}

/**
 * Main smoke test runner for encrypted session persistence and reconnect.
 */
async function main(): Promise<void> {
  console.log(`[SESSION] Encrypted session store: ${resolvedSessionDir}`);

  const store = new EncryptedFileZaloSessionStore(
    resolvedSessionDir,
    encryptionKey
  );

  const pool = new ZaloAccountPool({
    sessionStore: store,
  });

  let restored;
  try {
    restored = await pool.restoreSession(accountId);
  } catch (restoreErr: unknown) {
    const message =
      restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
    console.error(`[ERROR] Session restore failed: ${message}`);
    process.exitCode = 1;
    return;
  }

  if (restored.status === 'connected') {
    if (!restored.zaloUid || restored.zaloUid.trim() === '') {
      console.error('[ERROR] Session restore failed: returned empty zaloUid');
      process.exitCode = 1;
      return;
    }

    if (!restored.api) {
      console.error('[ERROR] Session restore failed: missing api handle');
      process.exitCode = 1;
      return;
    }

    console.log('[SESSION] Restored saved session');
    console.log(`[OK] accountId: ${restored.accountId}`);
    console.log(`[OK] status: ${restored.status}`);
    console.log(`[OK] zaloUid: ${restored.zaloUid}`);
    console.log('[OK] api available: true');
    console.log('[OK] No QR was required');
    return;
  }

  if (restored.status === 'needs_qr') {
    console.log('[SESSION] No usable saved session');
    console.log('[SESSION] Starting QR login');

    try {
      const qrInstance = await pool.startQrLogin(accountId, handleQrEvent);

      if (qrInstance.status !== 'connected') {
        throw new Error(
          `Instance status is '${qrInstance.status}', expected 'connected'`
        );
      }

      if (!qrInstance.zaloUid || qrInstance.zaloUid.trim() === '') {
        throw new Error('zaloUid is empty or missing');
      }

      if (!qrInstance.api) {
        throw new Error('api handle is missing');
      }

      console.log('[OK] QR login succeeded');
      console.log('[OK] Encrypted session saved');
      console.log(`[OK] accountId: ${qrInstance.accountId}`);
      console.log(`[OK] status: ${qrInstance.status}`);
      console.log(`[OK] zaloUid: ${qrInstance.zaloUid}`);
      console.log('[OK] api available: true');
      console.log(
        '[NEXT] Run the same command again to verify reconnect without QR'
      );
    } catch (qrErr: unknown) {
      const message = qrErr instanceof Error ? qrErr.message : String(qrErr);
      console.error(`[ERROR] QR login failed: ${message}`);
      process.exitCode = 1;
    }
    return;
  }

  console.error(
    `[ERROR] Session restore returned unexpected status: ${restored.status}`
  );
  process.exitCode = 1;
}

main();
