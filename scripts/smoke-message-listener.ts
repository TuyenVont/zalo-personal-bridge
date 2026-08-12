import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EncryptedFileZaloSessionStore } from '../src/zalo/session-store.js';
import { ZaloAccountPool } from '../src/zalo/pool.js';
import { ZaloMessageListenerManager } from '../src/message/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const accountId = process.argv[2] || 'dev2-message-test';

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

async function main(): Promise<void> {
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

  if (restored.status === 'needs_qr') {
    console.error('[ERROR] No usable saved session');
    console.error('[ERROR] Run smoke:session for this account before smoke:message');
    process.exitCode = 1;
    return;
  }

  if (restored.status !== 'connected' || !restored.api) {
    console.error(`[ERROR] Session restore failed: status is '${restored.status}'`);
    process.exitCode = 1;
    return;
  }

  console.log('[SESSION] Restored saved session');
  console.log(`[OK] accountId: ${restored.accountId}`);
  console.log('[OK] status: connected');
  console.log('[OK] api available: true');

  const manager = new ZaloMessageListenerManager(pool);
  let messageCount = 0;

  const handler = (_accId: string, _rawMessage: unknown) => {
    messageCount++;
    console.log(`[MESSAGE] Received event #${messageCount}`);
    console.log(`[MESSAGE] accountId: ${accountId}`);
    console.log(`[MESSAGE] receivedAt: ${new Date().toISOString()}`);

    if (messageCount === 1) {
      console.log('[PASS] Real Zalo message event reached Developer B listener');
    }
  };

  try {
    await manager.start(accountId, handler);
  } catch (startErr: unknown) {
    const message =
      startErr instanceof Error ? startErr.message : String(startErr);
    console.error(`[ERROR] Listener start failed: ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log('[LISTENER] Started');
  console.log('[WAIT] Send a Zalo message to this account from another account');
  console.log('[WAIT] Press Ctrl+C to stop');

  let isStopping = false;

  const cleanup = async () => {
    if (isStopping) return;
    isStopping = true;

    try {
      await manager.stop(accountId);
      console.log('[LISTENER] Stopped');
      console.log('[OK] Smoke test finished');
    } catch (stopErr: unknown) {
      const message =
        stopErr instanceof Error ? stopErr.message : String(stopErr);
      console.error(`[ERROR] Error stopping listener: ${message}`);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main();
