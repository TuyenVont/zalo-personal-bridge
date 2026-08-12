import {
  FrappeApiClient,
  FrappeHttpError,
  FrappeResourceClient,
  FrappeTransportError,
} from '../src/frappe/index.js';

const SEARCH_TERMS = ['Zalo', 'Conversation', 'Message', 'Chat'] as const;

const TARGET_FIELDS = [
  'subject',
  'content',
  'communication_medium',
  'communication_type',
  'status',
  'sent_or_received',
  'communication_date',
  'sender',
  'sender_full_name',
  'reference_doctype',
  'reference_name',
  'message_id',
  'in_reply_to',
  'has_attachment',
] as const;

const SELECT_OPTIONS_TARGETS = new Set([
  'communication_medium',
  'communication_type',
  'status',
  'sent_or_received',
]);

/**
 * Manual, read-only persistence discovery harness for Frappe DocTypes.
 * Part A: Searches existing DocTypes matching terms (Zalo, Conversation, Message, Chat).
 * Part B: Inspects fields and Select options of built-in Communication DocType.
 *
 * GET requests only. Never mutates state. Never logs credentials.
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
    console.error('[ERROR] Missing required Frappe environment');
    process.exitCode = 1;
    return;
  }

  let client: FrappeApiClient;
  let resourceClient: FrappeResourceClient;
  try {
    client = new FrappeApiClient({
      baseUrl,
      apiKey,
      apiSecret,
    });
    resourceClient = new FrappeResourceClient(client);
  } catch {
    console.error('[ERROR] Invalid Frappe client configuration');
    process.exitCode = 1;
    return;
  }

  let hasFailures = false;

  // PART A — SEARCH EXISTING DOCTYPES
  for (const term of SEARCH_TERMS) {
    console.log(`[SEARCH] ${term}`);
    try {
      const matches = await resourceClient.list<{
        name?: string;
        module?: string;
        istable?: number | boolean | string;
        issingle?: number | boolean | string;
      }>('DocType', {
        fields: ['name', 'module', 'istable', 'issingle'],
        filters: [['name', 'like', `%${term}%`]],
        limitPageLength: 100,
      });

      if (!matches || matches.length === 0) {
        console.log('[RESULT] no matching DocType');
      } else {
        for (const match of matches) {
          if (!match || typeof match !== 'object') {
            continue;
          }
          const name = typeof match.name === 'string' ? match.name.trim() : '';
          const module = typeof match.module === 'string' ? match.module.trim() : '';
          const child = Boolean(
            match.istable === 1 || match.istable === true || match.istable === '1'
          );
          const single = Boolean(
            match.issingle === 1 || match.issingle === true || match.issingle === '1'
          );
          if (name) {
            console.log(
              `[DOCTYPE] ${name} | module=${module} | child=${child} | single=${single}`
            );
          }
        }
      }
    } catch (err: unknown) {
      hasFailures = true;
      if (err instanceof FrappeHttpError) {
        console.error(`[ERROR] Search failed for ${term} (HTTP ${err.status})`);
      } else if (err instanceof FrappeTransportError) {
        console.error(`[ERROR] Search failed for ${term} (Transport error)`);
      } else {
        console.error(`[ERROR] Search failed for ${term}`);
      }
    }
  }

  // PART B — DEEP INSPECT COMMUNICATION
  try {
    const path = `/api/v2/doctype/Communication/meta`;
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
        '[ERROR] Unexpected metadata response for Communication DocType'
      );
      hasFailures = true;
    } else {
      const fields = docMeta.fields as Array<Record<string, unknown>>;
      const fieldMap = new Map<string, Record<string, unknown>>();
      for (const f of fields) {
        if (f && typeof f === 'object' && typeof f.fieldname === 'string') {
          fieldMap.set(f.fieldname.trim(), f);
        }
      }

      for (const targetName of TARGET_FIELDS) {
        const f = fieldMap.get(targetName);
        if (!f) {
          continue;
        }

        const fieldname = targetName;
        const fieldtype =
          typeof f.fieldtype === 'string' ? f.fieldtype.trim() : 'Data';
        const reqd = Boolean(f.reqd === 1 || f.reqd === true || f.reqd === '1');
        const unique = Boolean(
          f.unique === 1 || f.unique === true || f.unique === '1'
        );

        let line = `[FIELD] ${fieldname} | ${fieldtype} | required=${reqd} | unique=${unique}`;

        if (
          fieldtype === 'Link' &&
          typeof f.options === 'string' &&
          f.options.trim().length > 0
        ) {
          line += ` | link_to=${f.options.trim()}`;
        } else if (
          fieldtype === 'Dynamic Link' &&
          typeof f.options === 'string' &&
          f.options.trim().length > 0
        ) {
          line += ` | dynamic_link_field=${f.options.trim()}`;
        }

        console.log(line);

        if (
          SELECT_OPTIONS_TARGETS.has(fieldname) &&
          typeof f.options === 'string'
        ) {
          const options = f.options
            .split(/\r?\n/)
            .map((opt) => opt.trim())
            .filter((opt) => opt.length > 0);

          for (const optionValue of options) {
            console.log(`[OPTION] ${fieldname}: ${optionValue}`);
          }
        }
      }
    }
  } catch (err: unknown) {
    hasFailures = true;
    if (err instanceof FrappeHttpError) {
      console.error(
        `[ERROR] Could not inspect Communication DocType (HTTP ${err.status})`
      );
    } else if (err instanceof FrappeTransportError) {
      console.error('[ERROR] Could not reach Frappe for Communication metadata');
    } else {
      console.error('[ERROR] Could not inspect Communication DocType');
    }
  }

  if (hasFailures) {
    console.log('[WARN] Frappe persistence discovery completed with failures');
    process.exitCode = 1;
  } else {
    console.log('[PASS] Frappe persistence discovery completed');
  }
}

main();
