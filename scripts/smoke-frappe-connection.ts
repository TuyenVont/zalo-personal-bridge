import {
  FrappeApiClient,
  FrappeHttpError,
  FrappeTransportError,
} from '../src/frappe/index.js';

/**
 * Manual smoke test harness for real authenticated Frappe RPC connection verification.
 * Uses read-only GET /api/method/frappe.auth.get_logged_user endpoint.
 * Requires FRAPPE_BASE_URL, FRAPPE_API_KEY, FRAPPE_API_SECRET in environment.
 */
async function main(): Promise<void> {
  const baseUrl = process.env.FRAPPE_BASE_URL;
  const apiKey = process.env.FRAPPE_API_KEY;
  const apiSecret = process.env.FRAPPE_API_SECRET;

  if (
    !baseUrl ||
    typeof baseUrl !== 'string' ||
    baseUrl.trim().length === 0 ||
    !apiKey ||
    typeof apiKey !== 'string' ||
    apiKey.trim().length === 0 ||
    !apiSecret ||
    typeof apiSecret !== 'string' ||
    apiSecret.trim().length === 0
  ) {
    console.error(
      '[ERROR] Missing required environment variables (FRAPPE_BASE_URL, FRAPPE_API_KEY, FRAPPE_API_SECRET)'
    );
    process.exitCode = 1;
    return;
  }

  let client: FrappeApiClient;
  try {
    client = new FrappeApiClient({
      baseUrl,
      apiKey,
      apiSecret,
    });
  } catch {
    console.error('[ERROR] Invalid Frappe client configuration');
    process.exitCode = 1;
    return;
  }

  try {
    const res = await client.get<unknown>(
      '/api/method/frappe.auth.get_logged_user'
    );

    if (
      !res ||
      typeof res !== 'object' ||
      Array.isArray(res) ||
      !('message' in res)
    ) {
      console.error('[ERROR] Unexpected Frappe authentication response');
      process.exitCode = 1;
      return;
    }

    const message = (res as Record<string, unknown>).message;
    if (typeof message !== 'string' || message.trim().length === 0) {
      console.error('[ERROR] Unexpected Frappe authentication response');
      process.exitCode = 1;
      return;
    }

    console.log('[FRAPPE] Connection established');
    console.log('[FRAPPE] Authentication succeeded');
    console.log(`[OK] authenticated user: ${message}`);
    console.log('[PASS] Real Frappe authenticated connection succeeded');
  } catch (err: unknown) {
    if (err instanceof FrappeHttpError) {
      console.error('[ERROR] Frappe HTTP request failed');
      console.error(`[ERROR] status: ${err.status}`);
    } else if (err instanceof FrappeTransportError) {
      console.error('[ERROR] Could not reach Frappe');
    } else {
      console.error('[ERROR] Could not reach Frappe');
    }
    process.exitCode = 1;
  }
}

main();
