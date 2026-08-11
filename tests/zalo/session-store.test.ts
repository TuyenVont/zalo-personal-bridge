import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  EncryptedFileZaloSessionStore,
  PersistedZaloSession,
} from '../../src/zalo/index.js';

describe('EncryptedFileZaloSessionStore', () => {
  const testKey = crypto.randomBytes(32);

  const createTempSessionDir = (): string => {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-session-test-'));
  };

  const createDummySession = (
    accountId = 'account-1',
    zaloUid = 'uid-100'
  ): PersistedZaloSession => ({
    version: 1,
    accountId,
    zaloUid,
    credentials: {
      cookie: { zpw_sek: 'secret_cookie_token_abc123' },
      imei: 'device-imei-secret-999',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestBrowser',
    },
    savedAt: new Date().toISOString(),
  });

  it('1. valid session save/load round trip', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      const session = createDummySession('acc-1', 'uid-1');

      await store.save('acc-1', session);
      const loaded = await store.load('acc-1');

      assert.notStrictEqual(loaded, null);
      assert.strictEqual(loaded?.version, 1);
      assert.strictEqual(loaded?.accountId, 'acc-1');
      assert.strictEqual(loaded?.zaloUid, 'uid-1');
      assert.deepStrictEqual(loaded?.credentials, session.credentials);
      assert.strictEqual(loaded?.savedAt, session.savedAt);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('2. load missing account returns null', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      const loaded = await store.load('non-existent-account');
      assert.strictEqual(loaded, null);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('3. overwrite existing session returns latest saved session', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      const session1 = createDummySession('acc-1', 'uid-v1');
      const session2 = createDummySession('acc-1', 'uid-v2');

      await store.save('acc-1', session1);
      await store.save('acc-1', session2);

      const loaded = await store.load('acc-1');
      assert.strictEqual(loaded?.zaloUid, 'uid-v2');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('4. different accountIds are stored independently', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      const sessionA = createDummySession('acc-A', 'uid-A');
      const sessionB = createDummySession('acc-B', 'uid-B');

      await store.save('acc-A', sessionA);
      await store.save('acc-B', sessionB);

      const loadedA = await store.load('acc-A');
      const loadedB = await store.load('acc-B');

      assert.strictEqual(loadedA?.zaloUid, 'uid-A');
      assert.strictEqual(loadedB?.zaloUid, 'uid-B');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('5. remove existing session returns true and load becomes null', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      await store.save('acc-1', createDummySession('acc-1'));

      const removed = await store.remove('acc-1');
      assert.strictEqual(removed, true);

      const loaded = await store.load('acc-1');
      assert.strictEqual(loaded, null);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('6. remove missing session returns false', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      const removed = await store.remove('missing-acc');
      assert.strictEqual(removed, false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('7. encryption key shorter/longer than 32 bytes is rejected', () => {
    const tempDir = createTempSessionDir();
    try {
      const shortKey = crypto.randomBytes(31);
      const longKey = crypto.randomBytes(33);

      assert.throws(
        () => new EncryptedFileZaloSessionStore(tempDir, shortKey),
        { message: 'Encryption key must be exactly 32 bytes' }
      );

      assert.throws(
        () => new EncryptedFileZaloSessionStore(tempDir, longKey),
        { message: 'Encryption key must be exactly 32 bytes' }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('8. saved file does NOT contain plaintext (accountId, zaloUid, cookie, imei, userAgent)', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      const session = createDummySession('acc-secret', 'uid-secret-999');

      await store.save('acc-secret', session);

      const files = fs.readdirSync(tempDir);
      assert.strictEqual(files.length, 1);

      const rawContent = fs.readFileSync(
        path.join(tempDir, files[0]),
        'utf8'
      );

      assert.strictEqual(rawContent.includes('acc-secret'), false);
      assert.strictEqual(rawContent.includes('uid-secret-999'), false);
      assert.strictEqual(
        rawContent.includes('secret_cookie_token_abc123'),
        false
      );
      assert.strictEqual(
        rawContent.includes('device-imei-secret-999'),
        false
      );
      assert.strictEqual(rawContent.includes('TestBrowser'), false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('9. session filename is SHA-256 based and contains no raw accountId', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      const accountId = 'user@example.com';
      await store.save(accountId, createDummySession(accountId));

      const expectedHash = crypto
        .createHash('sha256')
        .update(accountId)
        .digest('hex');
      const expectedFilename = `${expectedHash}.json`;

      const files = fs.readdirSync(tempDir);
      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0], expectedFilename);
      assert.strictEqual(files[0].includes('user@example.com'), false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('10. accountId with path traversal content cannot escape sessionDir', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      const dangerousAccountId = '../../outside-path';

      await store.save(
        dangerousAccountId,
        createDummySession(dangerousAccountId)
      );

      const files = fs.readdirSync(tempDir);
      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0].includes('..'), false);

      const loaded = await store.load(dangerousAccountId);
      assert.strictEqual(loaded?.accountId, dangerousAccountId);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('11. tampering with ciphertext causes load to reject', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      await store.save('acc-1', createDummySession('acc-1'));

      const files = fs.readdirSync(tempDir);
      const filePath = path.join(tempDir, files[0]);
      const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // Tamper ciphertext
      const ciphertextBuf = Buffer.from(envelope.ciphertext, 'base64');
      ciphertextBuf[0] ^= 0xff;
      envelope.ciphertext = ciphertextBuf.toString('base64');
      fs.writeFileSync(filePath, JSON.stringify(envelope));

      await assert.rejects(
        async () => {
          await store.load('acc-1');
        },
        {
          message:
            'Failed to decrypt session file: authentication tag mismatch or corrupted data',
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('12. tampering with authTag causes load to reject', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      await store.save('acc-1', createDummySession('acc-1'));

      const files = fs.readdirSync(tempDir);
      const filePath = path.join(tempDir, files[0]);
      const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // Tamper authTag
      const authTagBuf = Buffer.from(envelope.authTag, 'base64');
      authTagBuf[0] ^= 0xff;
      envelope.authTag = authTagBuf.toString('base64');
      fs.writeFileSync(filePath, JSON.stringify(envelope));

      await assert.rejects(
        async () => {
          await store.load('acc-1');
        },
        {
          message:
            'Failed to decrypt session file: authentication tag mismatch or corrupted data',
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('13. encrypted file copied/reused for another accountId cannot decrypt because of AAD/account binding', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      await store.save('acc-1', createDummySession('acc-1'));

      const acc1Hash = crypto
        .createHash('sha256')
        .update('acc-1')
        .digest('hex');
      const acc2Hash = crypto
        .createHash('sha256')
        .update('acc-2')
        .digest('hex');

      const file1 = path.join(tempDir, `${acc1Hash}.json`);
      const file2 = path.join(tempDir, `${acc2Hash}.json`);

      // Copy acc-1 file to acc-2 filename
      fs.copyFileSync(file1, file2);

      await assert.rejects(
        async () => {
          await store.load('acc-2');
        },
        {
          message:
            'Failed to decrypt session file: authentication tag mismatch or corrupted data',
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('14. session.accountId mismatch is rejected before save', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      const session = createDummySession('acc-1');

      await assert.rejects(
        async () => {
          await store.save('acc-2', session);
        },
        {
          message: 'session.accountId does not match requested accountId',
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('15. invalid/empty zaloUid, imei or userAgent is rejected', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);

      const emptyUid = createDummySession('acc-1', '');
      await assert.rejects(
        async () => {
          await store.save('acc-1', emptyUid);
        },
        { message: 'session.zaloUid must be a non-empty string' }
      );

      const emptyImei = createDummySession('acc-1');
      emptyImei.credentials.imei = '   ';
      await assert.rejects(
        async () => {
          await store.save('acc-1', emptyImei);
        },
        { message: 'session.credentials.imei must be a non-empty string' }
      );

      const emptyUa = createDummySession('acc-1');
      emptyUa.credentials.userAgent = '';
      await assert.rejects(
        async () => {
          await store.save('acc-1', emptyUa);
        },
        {
          message:
            'session.credentials.userAgent must be a non-empty string',
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('16. saving the same session twice uses fresh encryption randomness so encrypted file contents are not identical', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      const session = createDummySession('acc-1');

      await store.save('acc-1', session);
      const fileHash = crypto
        .createHash('sha256')
        .update('acc-1')
        .digest('hex');
      const filePath = path.join(tempDir, `${fileHash}.json`);
      const content1 = fs.readFileSync(filePath, 'utf8');

      await store.save('acc-1', session);
      const content2 = fs.readFileSync(filePath, 'utf8');

      assert.notStrictEqual(content1, content2);
      const env1 = JSON.parse(content1);
      const env2 = JSON.parse(content2);
      assert.notStrictEqual(env1.iv, env2.iv);
      assert.notStrictEqual(env1.ciphertext, env2.ciphertext);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('17. SECURITY TEST: Inspect complete session directory contents and ensure no plaintext credential values appear anywhere', async () => {
    const tempDir = createTempSessionDir();
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);

      const s1 = createDummySession('user-1', 'uid-100');
      s1.credentials.cookie = 'super_secret_cookie_1';
      s1.credentials.imei = 'super_secret_imei_1';

      const s2 = createDummySession('user-2', 'uid-200');
      s2.credentials.cookie = 'super_secret_cookie_2';
      s2.credentials.imei = 'super_secret_imei_2';

      await store.save('user-1', s1);
      await store.save('user-2', s2);

      const files = fs.readdirSync(tempDir);
      assert.strictEqual(files.length, 2);

      for (const file of files) {
        const fullPath = path.join(tempDir, file);
        const text = fs.readFileSync(fullPath, 'utf8');

        assert.strictEqual(text.includes('super_secret_cookie_1'), false);
        assert.strictEqual(text.includes('super_secret_imei_1'), false);
        assert.strictEqual(text.includes('super_secret_cookie_2'), false);
        assert.strictEqual(text.includes('super_secret_imei_2'), false);
        assert.strictEqual(text.includes('uid-100'), false);
        assert.strictEqual(text.includes('uid-200'), false);
        assert.strictEqual(text.includes('user-1'), false);
        assert.strictEqual(text.includes('user-2'), false);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('18. unexpected remove failure throws sanitized Error', async () => {
    const tempDir = createTempSessionDir();
    const originalUnlink = fs.promises.unlink;
    try {
      const store = new EncryptedFileZaloSessionStore(tempDir, testKey);
      await store.save('acc-1', createDummySession('acc-1'));

      // Mock unlink to simulate unexpected EACCES filesystem failure
      fs.promises.unlink = async () => {
        const err = new Error('Permission denied') as any;
        err.code = 'EACCES';
        throw err;
      };

      await assert.rejects(
        async () => {
          await store.remove('acc-1');
        },
        {
          message: 'Failed to remove Zalo session file',
        }
      );
    } finally {
      fs.promises.unlink = originalUnlink;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

