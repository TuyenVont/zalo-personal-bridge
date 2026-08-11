import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZaloAccountPool } from '../src/zalo/pool.js';
import type { ZaloQrEvent } from '../src/zalo/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const accountId = process.argv[2] || 'manual-smoke';

const projectRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(projectRoot, 'tmp');
const qrFilePath = path.join(tmpDir, 'zalo-login-qr.png');

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
 * Main smoke test runner for QR login flow.
 */
async function main(): Promise<void> {
  const pool = new ZaloAccountPool();

  try {
    const instance = await pool.startQrLogin(accountId, handleQrEvent);

    if (instance.status !== 'connected') {
      throw new Error(`Instance status is '${instance.status}', expected 'connected'`);
    }

    if (!instance.zaloUid || instance.zaloUid.trim() === '') {
      throw new Error('zaloUid is empty or missing');
    }

    if (!instance.api) {
      throw new Error('api handle is missing');
    }

    console.log('[OK] QR login succeeded');
    console.log(`[OK] accountId: ${instance.accountId}`);
    console.log(`[OK] status: ${instance.status}`);
    console.log(`[OK] zaloUid: ${instance.zaloUid}`);
    console.log('[OK] api available: true');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ERROR] QR login failed: ${message}`);
    process.exitCode = 1;
  }
}

main();
