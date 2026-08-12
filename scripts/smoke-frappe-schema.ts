import {
  FrappeApiClient,
  FrappeHttpError,
  FrappeTransportError,
} from '../src/frappe/index.js';

const ALLOWED_FIELD_TYPES = new Set([
  'Data',
  'Small Text',
  'Text',
  'Long Text',
  'Int',
  'Float',
  'Currency',
  'Check',
  'Date',
  'Datetime',
  'Link',
  'Dynamic Link',
  'Select',
  'Table',
  'JSON',
]);

/**
 * Manual, read-only schema discovery harness for Frappe DocTypes.
 * Inspects configured DocType metadata using GET /api/v2/doctype/{doctype}/meta.
 * Requires FRAPPE_BASE_URL, FRAPPE_API_KEY, FRAPPE_API_SECRET in environment.
 * CLI arguments supply DocType names (e.g. npm run smoke:frappe-schema -- "Contact" "CRM Conversation").
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
    console.error('[ERROR] Missing required Frappe environment');
    process.exitCode = 1;
    return;
  }

  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    console.error('[ERROR] No DocType arguments provided');
    process.exitCode = 1;
    return;
  }

  const doctypes: string[] = [];
  for (const arg of rawArgs) {
    if (typeof arg !== 'string' || arg.trim().length === 0) {
      console.error('[ERROR] Invalid empty or whitespace-only DocType argument');
      process.exitCode = 1;
      return;
    }
    if (arg === '.' || arg === '..') {
      console.error('[ERROR] Invalid DocType argument');
      process.exitCode = 1;
      return;
    }
    doctypes.push(arg);
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

  let hasFailures = false;

  for (const doctype of doctypes) {
    try {
      const path = `/api/v2/doctype/${encodeURIComponent(doctype)}/meta`;
      const res = await client.get<unknown>(path);

      let docMeta: Record<string, unknown> | null = null;
      if (res && typeof res === 'object' && !Array.isArray(res)) {
        if (
          'data' in res &&
          res.data &&
          typeof res.data === 'object' &&
          !Array.isArray(res.data)
        ) {
          docMeta = res.data as Record<string, unknown>;
        } else if ('fields' in res && Array.isArray(res.fields)) {
          docMeta = res as Record<string, unknown>;
        }
      }

      if (!docMeta || !Array.isArray(docMeta.fields)) {
        console.error(
          `[ERROR] Unexpected metadata response for DocType: ${doctype}`
        );
        hasFailures = true;
        continue;
      }

      console.log(`[DOCTYPE] ${doctype}`);
      console.log('[OK] metadata loaded');

      if (typeof docMeta.name === 'string' && docMeta.name.trim().length > 0) {
        console.log(`[META] name: ${docMeta.name.trim()}`);
      }
      if (
        typeof docMeta.module === 'string' &&
        docMeta.module.trim().length > 0
      ) {
        console.log(`[META] module: ${docMeta.module.trim()}`);
      }
      if (
        typeof docMeta.autoname === 'string' &&
        docMeta.autoname.trim().length > 0
      ) {
        console.log(`[META] autoname: ${docMeta.autoname.trim()}`);
      }

      const fields = docMeta.fields as Array<Record<string, unknown>>;
      for (const f of fields) {
        if (!f || typeof f !== 'object' || Array.isArray(f)) {
          continue;
        }

        const fieldname =
          typeof f.fieldname === 'string' ? f.fieldname.trim() : '';
        const fieldtype =
          typeof f.fieldtype === 'string' ? f.fieldtype.trim() : '';

        if (!fieldname) {
          continue;
        }

        const isStandardField = [
          'name',
          'creation',
          'modified',
          'owner',
        ].includes(fieldname);
        if (!ALLOWED_FIELD_TYPES.has(fieldtype) && !isStandardField) {
          continue;
        }

        const reqd = Boolean(f.reqd === 1 || f.reqd === true || f.reqd === '1');
        const unique = Boolean(
          f.unique === 1 || f.unique === true || f.unique === '1'
        );

        let line = `[FIELD] ${fieldname} | ${fieldtype || 'Data'} | required=${reqd} | unique=${unique}`;

        if (
          fieldtype === 'Link' &&
          typeof f.options === 'string' &&
          f.options.trim().length > 0
        ) {
          line += ` | link_to=${f.options.trim()}`;
        } else if (
          fieldtype === 'Table' &&
          typeof f.options === 'string' &&
          f.options.trim().length > 0
        ) {
          line += ` | child_doctype=${f.options.trim()}`;
        }

        console.log(line);
      }
    } catch (err: unknown) {
      hasFailures = true;
      if (err instanceof FrappeHttpError) {
        console.error(`[ERROR] Could not inspect DocType: ${doctype}`);
        console.error(`[ERROR] status: ${err.status}`);
      } else if (err instanceof FrappeTransportError) {
        console.error('[ERROR] Could not reach Frappe');
      } else {
        console.error('[ERROR] Could not reach Frappe');
      }
    }
  }

  if (hasFailures) {
    console.log('[WARN] Frappe schema discovery completed with failures');
    process.exitCode = 1;
  } else {
    console.log('[PASS] Frappe schema discovery completed');
  }
}

main();
