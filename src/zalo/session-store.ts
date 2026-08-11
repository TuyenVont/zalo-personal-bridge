import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  IZaloSessionStore,
  PersistedZaloSession,
} from './types.js';

interface EncryptedSessionEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * File-based implementation of IZaloSessionStore using AES-256-GCM encryption.
 *
 * Security Features:
 * - AES-256-GCM authenticated encryption with 32-byte key
 * - Random 12-byte IV per encryption operation
 * - Additional Authenticated Data (AAD) bound to the account ID SHA-256 digest
 * - Filename derived via SHA-256 hash of accountId to prevent path traversal
 * - Atomic write operations using temporary file write + rename
 * - Zero plaintext credentials written to disk or logs
 */
export class EncryptedFileZaloSessionStore implements IZaloSessionStore {
  private readonly sessionDir: string;
  private readonly encryptionKey: Buffer;

  constructor(sessionDir: string, encryptionKey: Buffer) {
    if (typeof sessionDir !== 'string' || sessionDir.trim() === '') {
      throw new Error('sessionDir must be a non-empty string');
    }

    if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
      throw new Error('Encryption key must be exactly 32 bytes');
    }

    this.sessionDir = path.resolve(sessionDir);
    this.encryptionKey = Buffer.from(encryptionKey);
  }

  /**
   * Derive the safe, deterministic session file path for a given accountId.
   */
  private getSessionFilePath(accountId: string): string {
    if (typeof accountId !== 'string' || accountId.trim() === '') {
      throw new Error('accountId must be a non-empty string');
    }

    const hashedFilename =
      crypto.createHash('sha256').update(accountId).digest('hex') + '.json';
    const filePath = path.resolve(this.sessionDir, hashedFilename);

    // Verify path safety against directory escape
    if (
      !filePath.startsWith(this.sessionDir + path.sep) &&
      filePath !== this.sessionDir
    ) {
      throw new Error('Invalid accountId: path traversal detected');
    }

    return filePath;
  }

  /**
   * Derive the deterministic AAD Buffer bound to accountId.
   */
  private getAadBuffer(accountId: string): Buffer {
    const accountDigest = crypto
      .createHash('sha256')
      .update(accountId)
      .digest('hex');
    return Buffer.from(`zalo-session:v1:${accountDigest}`, 'utf8');
  }

  /**
   * Validate session payload structure before saving.
   */
  private validateSession(
    accountId: string,
    session: PersistedZaloSession
  ): void {
    if (typeof accountId !== 'string' || accountId.trim() === '') {
      throw new Error('accountId must be a non-empty string');
    }

    if (!session || typeof session !== 'object') {
      throw new Error('session must be a valid object');
    }

    if (session.accountId !== accountId) {
      throw new Error('session.accountId does not match requested accountId');
    }

    if (
      typeof session.zaloUid !== 'string' ||
      session.zaloUid.trim() === ''
    ) {
      throw new Error('session.zaloUid must be a non-empty string');
    }

    if (!session.credentials || typeof session.credentials !== 'object') {
      throw new Error('session.credentials must be provided');
    }

    if (session.credentials.cookie === undefined || session.credentials.cookie === null) {
      throw new Error('session.credentials.cookie must be present');
    }

    if (
      typeof session.credentials.imei !== 'string' ||
      session.credentials.imei.trim() === ''
    ) {
      throw new Error('session.credentials.imei must be a non-empty string');
    }

    if (
      typeof session.credentials.userAgent !== 'string' ||
      session.credentials.userAgent.trim() === ''
    ) {
      throw new Error(
        'session.credentials.userAgent must be a non-empty string'
      );
    }

    if (
      typeof session.savedAt !== 'string' ||
      session.savedAt.trim() === '' ||
      Number.isNaN(Date.parse(session.savedAt))
    ) {
      throw new Error('session.savedAt must be a valid ISO date string');
    }
  }

  /**
   * Save a session payload securely using AES-256-GCM and atomic file write.
   */
  public async save(
    accountId: string,
    session: PersistedZaloSession
  ): Promise<void> {
    this.validateSession(accountId, session);

    const filePath = this.getSessionFilePath(accountId);
    const iv = crypto.randomBytes(12);
    const aadBuffer = this.getAadBuffer(accountId);

    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      iv
    );
    cipher.setAAD(aadBuffer);

    const plaintext = JSON.stringify(session);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const envelope: EncryptedSessionEnvelope = {
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };

    await fs.promises.mkdir(this.sessionDir, { recursive: true, mode: 0o700 });

    const tmpFilename = `.tmp-${crypto.randomBytes(8).toString('hex')}`;
    const tmpPath = path.resolve(this.sessionDir, tmpFilename);

    try {
      await fs.promises.writeFile(
        tmpPath,
        JSON.stringify(envelope, null, 2),
        { mode: 0o600, encoding: 'utf8' }
      );

      await fs.promises.rename(tmpPath, filePath);
    } catch (err) {
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath).catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Load and decrypt a session payload for the specified accountId.
   * Returns null if no session file exists.
   */
  public async load(accountId: string): Promise<PersistedZaloSession | null> {
    const filePath = this.getSessionFilePath(accountId);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    let envelopeRaw: string;
    try {
      envelopeRaw = await fs.promises.readFile(filePath, 'utf8');
    } catch (err) {
      throw new Error('Failed to read session file');
    }

    let envelope: EncryptedSessionEnvelope;
    try {
      envelope = JSON.parse(envelopeRaw);
    } catch {
      throw new Error('Failed to load session: invalid JSON envelope');
    }

    if (
      !envelope ||
      envelope.version !== 1 ||
      envelope.algorithm !== 'aes-256-gcm' ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.authTag !== 'string' ||
      typeof envelope.ciphertext !== 'string'
    ) {
      throw new Error(
        'Failed to load session: invalid or unsupported session file envelope'
      );
    }

    const iv = Buffer.from(envelope.iv, 'base64');
    const authTag = Buffer.from(envelope.authTag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const aadBuffer = this.getAadBuffer(accountId);

    let decryptedText: string;
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        iv
      );
      decipher.setAAD(aadBuffer);
      decipher.setAuthTag(authTag);

      decryptedText =
        decipher.update(ciphertext, undefined, 'utf8') +
        decipher.final('utf8');
    } catch {
      throw new Error(
        'Failed to decrypt session file: authentication tag mismatch or corrupted data'
      );
    }

    let session: PersistedZaloSession;
    try {
      session = JSON.parse(decryptedText);
    } catch {
      throw new Error('Failed to parse decrypted session payload');
    }

    if (session.accountId !== accountId) {
      throw new Error('Session accountId mismatch');
    }

    return session;
  }

  /**
   * Delete an existing session file for the specified accountId.
   * Returns true if file was deleted, false if file did not exist.
   * Throws sanitized error on unexpected filesystem failures.
   */
  public async remove(accountId: string): Promise<boolean> {
    const filePath = this.getSessionFilePath(accountId);

    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'ENOENT'
      ) {
        return false;
      }
      throw new Error('Failed to remove Zalo session file', { cause: err });
    }
  }
}
