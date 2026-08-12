import {
  FrappeApiClient,
  FrappeHttpError,
  FrappeResourceClient,
  FrappeTransportError,
  runZaloSchemaMigration,
  unwrapEffectiveMetaResponse,
  ZaloSchemaMigrationError,
} from '../src/frappe/index.js';

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const hasDryRun = args.includes('--dry-run');
  const hasApply = args.includes('--apply');

  const extraArgs = args.filter((arg) => arg !== '--dry-run' && arg !== '--apply');

  if (extraArgs.length > 0) {
    console.error('[ERROR] Unknown migration argument');
    console.error('Usage: npm run migrate:frappe-zalo-schema -- --dry-run | --apply');
    return 1;
  }

  if (!hasDryRun && !hasApply) {
    console.error('[ERROR] Migration mode flag required: specify --dry-run or --apply');
    console.error('Usage: npm run migrate:frappe-zalo-schema -- --dry-run | --apply');
    return 1;
  }

  if (hasDryRun && hasApply) {
    console.error('[ERROR] Conflicting migration mode flags: cannot combine --dry-run and --apply');
    console.error('Usage: npm run migrate:frappe-zalo-schema -- --dry-run | --apply');
    return 1;
  }

  const mode = hasDryRun ? 'dry-run' : 'apply';

  const baseUrl = process.env.FRAPPE_BASE_URL?.trim();
  const apiKey = process.env.FRAPPE_API_KEY?.trim();
  const apiSecret = process.env.FRAPPE_API_SECRET?.trim();

  if (!baseUrl || !apiKey || !apiSecret) {
    console.error(
      '[ERROR] Missing required environment variables: FRAPPE_BASE_URL, FRAPPE_API_KEY, FRAPPE_API_SECRET'
    );
    return 1;
  }

  try {
    const apiClient = new FrappeApiClient({
      baseUrl,
      apiKey,
      apiSecret,
    });
    const resourceClient = new FrappeResourceClient(apiClient);

    const getEffectiveMeta = async (doctype: string) => {
      const raw = await apiClient.get<unknown>(
        `/api/v2/doctype/${encodeURIComponent(doctype)}/meta`
      );
      return unwrapEffectiveMetaResponse(raw);
    };

    const result = await runZaloSchemaMigration(
      {
        resourceClient,
        getEffectiveMeta,
      },
      mode
    );

    let currentDocType = '';
    for (const item of result.plan) {
      if (item.docType !== currentDocType) {
        currentDocType = item.docType;
        console.log(`\n[DOCTYPE] ${currentDocType}`);
      }
      const prefix = mode === 'dry-run' ? '[PLAN]' : '[APPLY]';
      console.log(`${prefix} ${item.action} ${item.targetType} ${item.identifier}`);
    }

    if (mode === 'dry-run') {
      console.log('\n[PASS] Schema migration dry-run completed');
      console.log('[INFO] No changes were applied');
    } else {
      console.log('\n[PASS] Schema migration applied successfully');
      console.log(
        `[INFO] Created: ${result.createdCount}, Updated: ${result.updatedCount}, Noop: ${result.noopCount}`
      );
    }

    return 0;
  } catch (err) {
    if (err instanceof ZaloSchemaMigrationError) {
      console.error(`[ERROR] ${err.message}`);
    } else if (err instanceof FrappeHttpError) {
      console.error('[ERROR] Frappe schema operation failed');
      console.error(`[ERROR] status: ${err.status}`);
    } else if (err instanceof FrappeTransportError) {
      console.error('[ERROR] Could not reach Frappe');
    } else {
      console.error('[ERROR] Schema migration failed');
    }
    return 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate-frappe-zalo-schema.ts')) {
  main().then((code) => {
    process.exitCode = code;
  });
}
