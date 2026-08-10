import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ZaloClient } from '../../src/zalo/client.js';
import { ZaloQrEvent } from '../../src/zalo/types.js';

describe('ZaloClient', () => {
  it('1. Constructor/factory receives logging: false and selfListen: true', () => {
    let capturedOptions: any = null;
    const mockFactory = (options: any) => {
      capturedOptions = options;
      return { loginQR: async () => null };
    };

    const client = new ZaloClient({}, mockFactory);
    assert.notEqual(client, null);
    assert.deepEqual(capturedOptions, { logging: false, selfListen: true });
  });

  it('2. raw event 0 becomes qr_generated with qrImage', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({
          type: 0,
          data: { image: 'data:image/png;base64,mockImage', code: 'qr-code-1' },
        });
        callback({
          type: 4,
          data: { cookie: ['c1'], imei: 'imei-1', userAgent: 'ua-1' },
        });
        return { getOwnId: async () => 'zalo-uid-100' };
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await client.loginQR((e) => events.push(e));

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'qr_generated',
      qrImage: 'data:image/png;base64,mockImage',
    });
  });

  it('3. raw event 1 becomes qr_expired', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({ type: 1, data: null });
        callback({
          type: 4,
          data: { cookie: ['c1'], imei: 'imei-1', userAgent: 'ua-1' },
        });
        return { getOwnId: async () => 'zalo-uid-100' };
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await client.loginQR((e) => events.push(e));

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: 'qr_expired' });
  });

  it('4. raw event 2 becomes qr_scanned with displayName/avatar', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({
          type: 2,
          data: { display_name: 'John Doe', avatar: 'https://example.com/avatar.jpg' },
        });
        callback({
          type: 4,
          data: { cookie: ['c1'], imei: 'imei-1', userAgent: 'ua-1' },
        });
        return { getOwnId: async () => 'zalo-uid-100' };
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await client.loginQR((e) => events.push(e));

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'qr_scanned',
      displayName: 'John Doe',
      avatar: 'https://example.com/avatar.jpg',
    });
  });

  it('5. raw event 3 becomes qr_declined', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({ type: 3, data: { code: 'declined-reason-1' } });
        callback({
          type: 4,
          data: { cookie: ['c1'], imei: 'imei-1', userAgent: 'ua-1' },
        });
        return { getOwnId: async () => 'zalo-uid-100' };
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await client.loginQR((e) => events.push(e));

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'qr_declined',
      code: 'declined-reason-1',
    });
  });

  it('6. raw event 4 captures credentials internally but does NOT emit a QR event containing credentials', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({
          type: 4,
          data: { cookie: ['secret_cookie'], imei: 'secret_imei', userAgent: 'secret_ua' },
        });
        return { getOwnId: async () => 'zalo-uid-100' };
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    const result = await client.loginQR((e) => events.push(e));

    // No QR events emitted for type 4
    assert.equal(events.length, 0);

    // Credentials captured internally and returned in result
    assert.deepEqual(result.credentials, {
      cookie: ['secret_cookie'],
      imei: 'secret_imei',
      userAgent: 'secret_ua',
    });
  });

  it('7. successful login returns api + zaloUid + credentials', async () => {
    const mockApi = {
      getOwnId: async () => 'zalo-uid-999',
    };
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({
          type: 4,
          data: { cookie: ['c1'], imei: 'i1', userAgent: 'u1' },
        });
        return mockApi;
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const result = await client.loginQR();

    assert.strictEqual(result.api, mockApi);
    assert.equal(result.zaloUid, 'zalo-uid-999');
    assert.deepEqual(result.credentials, {
      cookie: ['c1'],
      imei: 'i1',
      userAgent: 'u1',
    });
  });

  it('8. loginQR throws if credentials were not captured', async () => {
    const mockFactory = () => ({
      loginQR: async () => ({
        getOwnId: async () => 'zalo-uid-100',
      }),
    });

    const client = new ZaloClient({}, mockFactory);

    await assert.rejects(
      async () => client.loginQR(),
      { message: 'QR login completed but session credentials were not captured' }
    );
  });

  it('9. loginQR throws if getOwnId returns an invalid UID', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({
          type: 4,
          data: { cookie: ['c1'], imei: 'i1', userAgent: 'u1' },
        });
        return { getOwnId: async () => '' };
      },
    });

    const client = new ZaloClient({}, mockFactory);

    await assert.rejects(
      async () => client.loginQR(),
      { message: 'QR login failed: getOwnId returned an invalid or empty UID' }
    );
  });

  it('10. underlying loginQR error propagates', async () => {
    const mockFactory = () => ({
      loginQR: async () => {
        throw new Error('SDK network failure');
      },
    });

    const client = new ZaloClient({}, mockFactory);

    await assert.rejects(
      async () => client.loginQR(),
      { message: 'SDK network failure' }
    );
  });

  it('11. Security Test: QR callback event payload never contains credentials', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({
          type: 0,
          data: { image: 'qr-image-string' },
        });
        callback({
          type: 4,
          data: { cookie: 'SECRET_COOKIE_DATA', imei: 'SECRET_IMEI_123', userAgent: 'SECRET_UA_AGENT' },
        });
        return { getOwnId: async () => 'zalo-uid-123' };
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await client.loginQR((e) => events.push(e));

    const stringifiedEvents = JSON.stringify(events);
    assert.equal(stringifiedEvents.includes('SECRET_COOKIE_DATA'), false);
    assert.equal(stringifiedEvents.includes('SECRET_IMEI_123'), false);
    assert.equal(stringifiedEvents.includes('SECRET_UA_AGENT'), false);
  });
});
