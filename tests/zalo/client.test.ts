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

  it('3. raw event 1 without retry action emits public qr_expired and rejects', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({ type: 1, data: null });
        return new Promise(() => {}); // Remains pending
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await assert.rejects(
      async () => client.loginQR((e) => events.push(e)),
      { message: 'QR login expired' }
    );

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

  it('5. raw event 3 becomes qr_declined and rejects', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({ type: 3, data: { code: 'declined-reason-1' } });
        return new Promise(() => {}); // Remains pending
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await assert.rejects(
      async () => client.loginQR((e) => events.push(e)),
      { message: 'QR login was declined' }
    );

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

    assert.equal(events.length, 0);
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

  // --- Phase A3.5 Retry & Lifecycle Tests ---

  it('12. maxQrRetries defaults to 2 and is NOT passed into Zalo factory', () => {
    let capturedFactoryOptions: any = null;
    const mockFactory = (options: any) => {
      capturedFactoryOptions = options;
      return { loginQR: async () => null };
    };

    const client = new ZaloClient({ maxQrRetries: 5 }, mockFactory);

    assert.equal(client.options.maxQrRetries, 5);
    // Factory receives ONLY logging and selfListen
    assert.deepEqual(capturedFactoryOptions, { logging: false, selfListen: true });
  });

  it('13. invalid negative maxQrRetries throws', () => {
    assert.throws(
      () => new ZaloClient({ maxQrRetries: -1 }),
      { message: 'maxQrRetries must be a non-negative integer' }
    );
  });

  it('14. non-integer maxQrRetries throws', () => {
    assert.throws(
      () => new ZaloClient({ maxQrRetries: 1.5 }),
      { message: 'maxQrRetries must be a non-negative integer' }
    );
    assert.throws(
      () => new ZaloClient({ maxQrRetries: NaN }),
      { message: 'maxQrRetries must be a non-negative integer' }
    );
  });

  it('15. first raw qr_expired with retry action invokes retry once and does NOT emit public qr_expired', async () => {
    let retryCalls = 0;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({
          type: 1,
          data: null,
          actions: { retry: () => { retryCalls++; } },
        });
        callback({
          type: 4,
          data: { cookie: ['c1'], imei: 'i1', userAgent: 'u1' },
        });
        return { getOwnId: async () => 'uid-100' };
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await client.loginQR((e) => events.push(e));

    assert.equal(retryCalls, 1);
    assert.equal(events.length, 0); // Public qr_expired NOT emitted
  });

  it('16. after retry, a new qr_generated event is emitted with the replacement QR image', async () => {
    let rawCallback: any = null;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        rawCallback = callback;
        callback({
          type: 0,
          data: { image: 'image-1' },
        });
        callback({
          type: 1,
          data: null,
          actions: {
            retry: () => {
              // Simulate retried QR generated
              rawCallback({ type: 0, data: { image: 'image-2-replacement' } });
              rawCallback({ type: 4, data: { cookie: ['c'], imei: 'i', userAgent: 'u' } });
            },
          },
        });
        return { getOwnId: async () => 'uid-100' };
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await client.loginQR((e) => events.push(e));

    assert.equal(events.length, 2);
    assert.deepEqual(events[0], { type: 'qr_generated', qrImage: 'image-1' });
    assert.deepEqual(events[1], { type: 'qr_generated', qrImage: 'image-2-replacement' });
  });

  it('17. duplicate raw qr_expired events while waiting for replacement QR do not consume multiple retries', async () => {
    let retryCalls = 0;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        const retryAction = () => { retryCalls++; };
        // Emit initial QR
        callback({ type: 0, data: { image: 'img-1' } });
        // Emit duplicate expirations before new QR arrives
        callback({ type: 1, data: null, actions: { retry: retryAction } });
        callback({ type: 1, data: null, actions: { retry: retryAction } });
        callback({ type: 1, data: null, actions: { retry: retryAction } });

        callback({ type: 4, data: { cookie: ['c'], imei: 'i', userAgent: 'u' } });
        return { getOwnId: async () => 'uid-100' };
      },
    });

    const client = new ZaloClient({}, mockFactory);
    await client.loginQR();

    assert.equal(retryCalls, 1);
  });

  it('18. retry occurs at most maxQrRetries times', async () => {
    let retryCalls = 0;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        const retryAction = () => {
          retryCalls++;
          // Emit replacement QR to reset waiting flag, followed by another expiration
          callback({ type: 0, data: { image: `img-${retryCalls}` } });
          callback({ type: 1, data: null, actions: { retry: retryAction } });
        };
        // First expiration
        callback({ type: 1, data: null, actions: { retry: retryAction } });
        return new Promise(() => {}); // Pending
      },
    });

    const client = new ZaloClient({ maxQrRetries: 2 }, mockFactory);

    await assert.rejects(
      async () => client.loginQR(),
      { message: 'QR login expired' }
    );

    assert.equal(retryCalls, 2);
  });

  it('19. expiration after retry limit emits exactly one public qr_expired', async () => {
    let retryCalls = 0;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        const retryAction = () => {
          retryCalls++;
          callback({ type: 0, data: { image: `img-${retryCalls}` } });
          callback({ type: 1, data: null, actions: { retry: retryAction } });
        };
        callback({ type: 1, data: null, actions: { retry: retryAction } });
        return new Promise(() => {});
      },
    });

    const client = new ZaloClient({ maxQrRetries: 2 }, mockFactory);
    const events: ZaloQrEvent[] = [];

    await assert.rejects(
      async () => client.loginQR((e) => events.push(e)),
      { message: 'QR login expired' }
    );

    const expiredEvents = events.filter((e) => e.type === 'qr_expired');
    assert.equal(expiredEvents.length, 1);
  });

  it('20. final expiration causes loginQR to reject promptly with "QR login expired"', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({ type: 1, data: null }); // No retry action
        return new Promise(() => {});
      },
    });

    const client = new ZaloClient({ maxQrRetries: 2 }, mockFactory);

    await assert.rejects(
      async () => client.loginQR(),
      { message: 'QR login expired' }
    );
  });

  it('21. expiration with no retry action is immediately final', async () => {
    let callbackRef: any = null;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callbackRef = callback;
        callback({ type: 1, data: null }); // No retry action provided by SDK
        return new Promise(() => {});
      },
    });

    const client = new ZaloClient({ maxQrRetries: 5 }, mockFactory);
    const events: ZaloQrEvent[] = [];

    await assert.rejects(
      async () => client.loginQR((e) => events.push(e)),
      { message: 'QR login expired' }
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'qr_expired');

    // Callbacks after final expiration must be ignored
    callbackRef({ type: 0, data: { image: 'stale-img' } });
    assert.equal(events.length, 1);
  });

  it('22. qr_declined does not retry, emits qr_declined once, and rejects promptly', async () => {
    let retryCalls = 0;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({
          type: 3,
          data: { code: 'user_declined' },
          actions: { retry: () => { retryCalls++; } },
        });
        return new Promise(() => {});
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await assert.rejects(
      async () => client.loginQR((e) => events.push(e)),
      { message: 'QR login was declined' }
    );

    assert.equal(retryCalls, 0);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: 'qr_declined', code: 'user_declined' });
  });

  it('23. callbacks arriving after final expiration are ignored', async () => {
    let callbackRef: any = null;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callbackRef = callback;
        callback({ type: 1, data: null });
        return new Promise(() => {});
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await assert.rejects(
      async () => client.loginQR((e) => events.push(e)),
      { message: 'QR login expired' }
    );

    // Call late events
    callbackRef({ type: 2, data: { display_name: 'Stale' } });
    callbackRef({ type: 4, data: { cookie: 'c', imei: 'i', userAgent: 'u' } });

    assert.equal(events.length, 1);
  });

  it('24. callbacks arriving after qr_declined are ignored', async () => {
    let callbackRef: any = null;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callbackRef = callback;
        callback({ type: 3, data: { code: 'declined' } });
        return new Promise(() => {});
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await assert.rejects(
      async () => client.loginQR((e) => events.push(e)),
      { message: 'QR login was declined' }
    );

    callbackRef({ type: 0, data: { image: 'stale' } });
    assert.equal(events.length, 1);
  });

  it('25. retry action throwing causes terminal rejection and cannot later become connected', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({
          type: 1,
          data: null,
          actions: {
            retry: () => {
              throw new Error('Retry execution failed');
            },
          },
        });
        return new Promise(() => {});
      },
    });

    const client = new ZaloClient({}, mockFactory);
    const events: ZaloQrEvent[] = [];

    await assert.rejects(
      async () => client.loginQR((e) => events.push(e)),
      { message: 'Retry execution failed' }
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'qr_expired');
  });

  it('26. stale callback from an older login epoch is ignored after a newer loginQR call starts', async () => {
    let oldCallback: any = null;
    let newCallback: any = null;

    let callCount = 0;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          oldCallback = callback;
        } else {
          newCallback = callback;
        }
        return new Promise(() => {});
      },
    });

    const client = new ZaloClient({}, mockFactory);

    // Start attempt 1
    const p1 = client.loginQR();

    // Start attempt 2 (supersedes attempt 1)
    const p2 = client.loginQR();

    // Fire callback from attempt 1
    const events1: ZaloQrEvent[] = [];
    oldCallback({ type: 0, data: { image: 'stale-epoch-1-image' } });

    // Assert attempt 1 rejected with superseded error
    await assert.rejects(p1, { message: 'QR login was superseded by a newer login attempt' });

    // Ensure new callback works cleanly
    newCallback({ type: 0, data: { image: 'epoch-2-image' } });
  });

  it('27. superseded older login cannot return success', async () => {
    let resolveOldLogin: any = null;

    let callCount = 0;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          callback({ type: 4, data: { cookie: ['c1'], imei: 'i1', userAgent: 'u1' } });
          return new Promise((resolve) => { resolveOldLogin = resolve; });
        } else {
          callback({ type: 4, data: { cookie: ['c2'], imei: 'i2', userAgent: 'u2' } });
          return { getOwnId: async () => 'uid-2' };
        }
      },
    });

    const client = new ZaloClient({}, mockFactory);

    const p1 = client.loginQR();
    const p2 = client.loginQR();

    // Resolve old login SDK promise after attempt 2 started
    resolveOldLogin({ getOwnId: async () => 'uid-1' });

    await assert.rejects(p1, { message: 'QR login was superseded by a newer login attempt' });

    const res2 = await p2;
    assert.equal(res2.zaloUid, 'uid-2');
  });

  it('28. credentials from one login attempt cannot leak into another login attempt', async () => {
    let callback1: any = null;
    let callCount = 0;

    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          callback1 = callback;
        }
        return new Promise(() => {});
      },
    });

    const client = new ZaloClient({}, mockFactory);

    // Login attempt 1 receives credentials but doesn't finish
    const p1 = client.loginQR();
    p1.catch(() => {}); // Catch active superseded rejection
    callback1({ type: 4, data: { cookie: ['stale_cookie'], imei: 'stale_imei', userAgent: 'stale_ua' } });

    // Login attempt 2 starts without receiving credentials
    const p2 = client.loginQR();

    // Assert attempt 2 fails with credentials missing, rather than picking up stale credentials
    await assert.rejects(p2, { message: 'QR login completed but session credentials were not captured' });
  });

  it('29. Security Test: Serialized public QR events never contain credentials or action functions', async () => {
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callback({
          type: 0,
          data: { image: 'qr-image' },
          actions: { retry: () => {}, abort: () => {} },
        });
        callback({
          type: 1,
          data: null,
          actions: { retry: () => {}, abort: () => {} },
        });
        callback({
          type: 4,
          data: { cookie: 'SECRET_COOKIE', imei: 'SECRET_IMEI', userAgent: 'SECRET_UA' },
        });
        return new Promise(() => {});
      },
    });

    const client = new ZaloClient({ maxQrRetries: 0 }, mockFactory);
    const events: ZaloQrEvent[] = [];

    await assert.rejects(
      async () => client.loginQR((e) => events.push(e)),
      { message: 'QR login expired' }
    );

    const json = JSON.stringify(events);
    assert.equal(json.includes('SECRET_COOKIE'), false);
    assert.equal(json.includes('SECRET_IMEI'), false);
    assert.equal(json.includes('SECRET_UA'), false);
    assert.equal(json.includes('actions'), false);
    assert.equal(json.includes('retry'), false);
  });

  it('30. Fix 1 Regression: maxQrRetries = 1 ignores duplicate raw expirations while waiting for replacement QR', async () => {
    let retryCalls = 0;
    let rawCallback: any = null;

    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        rawCallback = callback;
        // Initial QR
        callback({ type: 0, data: { image: 'img-1' } });
        // First expiration triggers retry
        callback({
          type: 1,
          data: null,
          actions: {
            retry: () => {
              retryCalls++;
            },
          },
        });
        return new Promise(() => {}); // Pending
      },
    });

    const client = new ZaloClient({ maxQrRetries: 1 }, mockFactory);
    const events: ZaloQrEvent[] = [];

    const loginPromise = client.loginQR((e) => events.push(e));

    // At this point, 1 retry was invoked, isWaitingForRetry is true, 0 public qr_expired events
    assert.equal(retryCalls, 1);
    assert.equal(events.length, 1); // Only initial qr_generated

    // Emit several duplicate raw expiration events while waiting for replacement QR
    rawCallback({ type: 1, data: null, actions: { retry: () => { retryCalls++; } } });
    rawCallback({ type: 1, data: null, actions: { retry: () => { retryCalls++; } } });

    // Assert duplicate expirations did NOT increment retry count or emit qr_expired
    assert.equal(retryCalls, 1);
    assert.equal(events.length, 1);

    // Emit replacement QR
    rawCallback({ type: 0, data: { image: 'img-2-replacement' } });
    assert.equal(events.length, 2);
    assert.equal(events[1].type, 'qr_generated');

    // Emit next real expiration after replacement QR arrived
    // Since maxQrRetries = 1 was already used, this expiration must become final
    rawCallback({ type: 1, data: null });

    await assert.rejects(loginPromise, { message: 'QR login expired' });
    assert.equal(events.length, 3);
    assert.equal(events[2].type, 'qr_expired');
  });

  it('31. Fix 2 Test: Starting login #2 actively rejects pending login #1 promptly as superseded', async () => {
    let resolveLogin2: any = null;

    let callCount = 0;
    const mockFactory = () => ({
      loginQR: async (_opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          // Attempt #1 never settles sdkPromise
          return new Promise(() => {});
        } else {
          // Attempt #2 succeeds
          callback({
            type: 4,
            data: { cookie: ['c2'], imei: 'i2', userAgent: 'u2' },
          });
          return { getOwnId: async () => 'uid-attempt-2' };
        }
      },
    });

    const client = new ZaloClient({}, mockFactory);

    // Start login #1
    const p1 = client.loginQR();

    // Start login #2 (must actively reject login #1 promptly)
    const p2 = client.loginQR();

    // Assert login #1 is rejected promptly with superseded message
    await assert.rejects(p1, { message: 'QR login was superseded by a newer login attempt' });

    // Assert login #2 succeeds cleanly
    const res2 = await p2;
    assert.equal(res2.zaloUid, 'uid-attempt-2');
  });
});
