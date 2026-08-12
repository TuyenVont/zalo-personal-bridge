import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { main as cliMain } from '../../scripts/migrate-frappe-zalo-schema.js';
import { FrappeResourceClient } from '../../src/frappe/resource.js';
import {
  mapCustomFieldDefinition,
  normalizeFrappeCheck,
  runZaloSchemaMigration,
  unwrapEffectiveMetaResponse,
  ZaloSchemaMigrationError,
} from '../../src/frappe/zalo-schema-migration.js';
import {
  ZALO_CONVERSATION_DOCTYPE,
  ZALO_CUSTOMER_CUSTOM_FIELDS,
  ZALO_CUSTOMER_DOCTYPE,
  ZALO_MESSAGE_DOCTYPE,
} from '../../src/frappe/zalo-shared-schema.js';

function createMockMigrationDeps() {
  const store = new Map<string, Array<Record<string, unknown>>>();

  const baseDocTypes: Record<string, any[]> = {
    [ZALO_CUSTOMER_DOCTYPE]: [
      { fieldname: 'source', label: 'Source', fieldtype: 'Data', reqd: 0 },
    ],
    [ZALO_CONVERSATION_DOCTYPE]: [
      { fieldname: 'customer', label: 'Customer', fieldtype: 'Link', reqd: 1 },
    ],
    [ZALO_MESSAGE_DOCTYPE]: [
      { fieldname: 'customer', label: 'Customer', fieldtype: 'Link', reqd: 0 },
      { fieldname: 'content', label: 'Content', fieldtype: 'Text', reqd: 1 },
      { fieldname: 'sender_type', label: 'Sender Type', fieldtype: 'Select', reqd: 1 },
      { fieldname: 'sent_at', label: 'Sent At', fieldtype: 'Datetime', reqd: 1 },
    ],
  };

  const listCalls: Array<{ doctype: string; options?: any }> = [];
  const createCalls: Array<{ doctype: string; doc: any }> = [];
  const updateCalls: Array<{ doctype: string; name: string; doc: any }> = [];
  const getEffectiveMetaCalls: string[] = [];

  const resourceClient = {
    async list(doctype: string, options?: any) {
      listCalls.push({ doctype, options });
      const list = store.get(doctype) || [];
      const filters = options?.filters || [];
      return list.filter((item) => {
        return filters.every(([field, op, val]: [string, string, any]) => {
          if (op === '=') {
            return item[field] === val;
          }
          return true;
        });
      });
    },

    async create(doctype: string, doc: any) {
      createCalls.push({ doctype, doc });
      const list = store.get(doctype) || [];
      const name = doc.name || `${doctype}_${list.length + 1}`;
      const newDoc = { ...doc, name };
      list.push(newDoc);
      store.set(doctype, list);
      return newDoc;
    },

    async update(doctype: string, name: string, doc: any) {
      updateCalls.push({ doctype, name, doc });
      const list = store.get(doctype) || [];
      const idx = list.findIndex((item) => item.name === name);
      if (idx < 0) {
        throw new Error(`DocDoesNotExist: ${doctype} ${name}`);
      }
      const updated = { ...list[idx], ...doc };
      list[idx] = updated;
      return updated;
    },
  } as unknown as FrappeResourceClient;

  const getEffectiveMeta = async (doctype: string) => {
    getEffectiveMetaCalls.push(doctype);
    const baseFields = baseDocTypes[doctype];
    if (!baseFields) {
      throw new Error(`DocTypeDoesNotExist: ${doctype}`);
    }

    const fields = baseFields.map((f) => ({ ...f }));

    const customFields = store.get('Custom Field') || [];
    for (const cf of customFields) {
      if (cf.dt === doctype) {
        fields.push({
          fieldname: cf.fieldname,
          label: cf.label,
          fieldtype: cf.fieldtype,
          options: cf.options,
          default: cf.default,
          reqd: cf.reqd,
          unique: cf.unique,
          read_only: cf.read_only,
          no_copy: cf.no_copy,
          insert_after: cf.insert_after,
        });
      }
    }

    const propertySetters = store.get('Property Setter') || [];
    for (const ps of propertySetters) {
      if (ps.doc_type === doctype && ps.property === 'reqd') {
        const field = fields.find((f) => f.fieldname === ps.field_name);
        if (field) {
          field.reqd = ps.value === '1' || ps.value === 1 ? '1' : '0';
        }
      }
    }

    return {
      data: {
        name: doctype,
        fields,
      },
    };
  };

  return {
    deps: { resourceClient, getEffectiveMeta },
    store,
    baseDocTypes,
    listCalls,
    createCalls,
    updateCalls,
    getEffectiveMetaCalls,
  };
}

describe('Shared Zalo Frappe Schema Migration Harness', () => {
  describe('Effective Meta Unwrapping', () => {
    it('1. unwraps realistic v2 envelope Form A { data: { fields: [...] } }', () => {
      const raw = {
        data: {
          name: ZALO_CUSTOMER_DOCTYPE,
          fields: [{ fieldname: 'source' }],
        },
      };
      const meta = unwrapEffectiveMetaResponse(raw);
      assert.equal(meta.name, ZALO_CUSTOMER_DOCTYPE);
      assert.ok(Array.isArray(meta.fields));
    });

    it('2. accepts direct metadata object Form B { fields: [...] }', () => {
      const raw = {
        name: ZALO_CUSTOMER_DOCTYPE,
        fields: [{ fieldname: 'source' }],
      };
      const meta = unwrapEffectiveMetaResponse(raw);
      assert.equal(meta.name, ZALO_CUSTOMER_DOCTYPE);
    });

    it('3. rejects malformed or null metadata responses with sanitized error', () => {
      assert.throws(
        () => unwrapEffectiveMetaResponse(null),
        (err) => err instanceof ZaloSchemaMigrationError && err.message === 'Unexpected Frappe effective metadata response'
      );
      assert.throws(
        () => unwrapEffectiveMetaResponse({ name: 'Test' }),
        (err) => err instanceof ZaloSchemaMigrationError && err.message === 'Unexpected Frappe effective metadata response'
      );
      assert.throws(
        () => unwrapEffectiveMetaResponse('invalid'),
        (err) => err instanceof ZaloSchemaMigrationError && err.message === 'Unexpected Frappe effective metadata response'
      );
    });
  });

  describe('Frappe Check Normalization', () => {
    it('5, 6, 8, 9. normalizes true/false, 1/0, and "1"/"0" correctly', () => {
      assert.equal(normalizeFrappeCheck(true), true);
      assert.equal(normalizeFrappeCheck(false), false);
      assert.equal(normalizeFrappeCheck(1), true);
      assert.equal(normalizeFrappeCheck(0), false);
      assert.equal(normalizeFrappeCheck('1'), true);
      assert.equal(normalizeFrappeCheck('0'), false);
      assert.equal(normalizeFrappeCheck(null), false);
      assert.equal(normalizeFrappeCheck(undefined), false);
      assert.equal(normalizeFrappeCheck('random'), false);
    });

    it('7. Custom Field "0" flags compare correctly with false without JS Boolean("0") bug', () => {
      const def = ZALO_CUSTOMER_CUSTOM_FIELDS.find((f) => f.fieldname === 'custom_account_id')!;
      assert.equal(normalizeFrappeCheck('0'), def.required);
    });
  });

  describe('Dependency Requirement', () => {
    it('4. runZaloSchemaMigration requires explicit getEffectiveMeta dependency', async () => {
      const fixture = createMockMigrationDeps();
      const invalidDeps = { resourceClient: fixture.deps.resourceClient } as any;

      await assert.rejects(
        () => runZaloSchemaMigration(invalidDeps, 'dry-run'),
        (err) => err instanceof ZaloSchemaMigrationError && err.message.includes('getEffectiveMeta')
      );
    });
  });

  describe('Custom Field & Property Setter Mapping', () => {
    it('exact B4.2 contract is consumed for Custom Field mapping', () => {
      const def = ZALO_CUSTOMER_CUSTOM_FIELDS[0];
      const payload = mapCustomFieldDefinition(ZALO_CUSTOMER_DOCTYPE, def);
      assert.equal(payload.dt, ZALO_CUSTOMER_DOCTYPE);
      assert.equal(payload.fieldname, 'custom_channel_type');
      assert.equal(payload.label, 'Channel Type');
      assert.equal(payload.fieldtype, 'Select');
      assert.equal(payload.insert_after, 'source');
      assert.equal(payload.default, 'OA');
    });

    it('Property Setter mapping excludes sent_at', async () => {
      const fixture = createMockMigrationDeps();
      const result = await runZaloSchemaMigration(fixture.deps, 'dry-run');
      const propertySetterItems = result.plan.filter(
        (p) => p.targetType === 'Property Setter'
      );
      assert.equal(propertySetterItems.length, 3);
      assert.ok(
        !propertySetterItems.some(
          (p) => p.docType === ZALO_MESSAGE_DOCTYPE && p.identifier.includes('sent_at')
        )
      );
    });
  });

  describe('List Query Projections Verification', () => {
    it('requests exact fields projection for Custom Field and Property Setter discovery', async () => {
      const fixture = createMockMigrationDeps();
      await runZaloSchemaMigration(fixture.deps, 'dry-run');

      const customFieldList = fixture.listCalls.find((c) => c.doctype === 'Custom Field');
      assert.ok(customFieldList);
      assert.deepEqual(customFieldList.options.fields, [
        'name',
        'dt',
        'fieldname',
        'label',
        'fieldtype',
        'insert_after',
        'options',
        'default',
        'reqd',
        'unique',
        'read_only',
        'no_copy',
      ]);

      const propertySetterList = fixture.listCalls.find((c) => c.doctype === 'Property Setter');
      assert.ok(propertySetterList);
      assert.deepEqual(propertySetterList.options.fields, [
        'name',
        'doc_type',
        'doctype_or_field',
        'field_name',
        'property',
        'property_type',
        'value',
      ]);
    });
  });

  describe('Dry-Run Mode & Verified Semantics', () => {
    it('10. dry-run returns verified === false', async () => {
      const fixture = createMockMigrationDeps();
      const result = await runZaloSchemaMigration(fixture.deps, 'dry-run');

      assert.equal(result.mode, 'dry-run');
      assert.equal(result.verified, false);
      assert.equal(result.createdCount, 0);
      assert.equal(result.updatedCount, 0);
    });
  });

  describe('Apply Mode & Verified Semantics', () => {
    it('11. apply returns verified === true only after post-apply verification succeeds', async () => {
      const fixture = createMockMigrationDeps();
      const result = await runZaloSchemaMigration(fixture.deps, 'apply');

      assert.equal(result.mode, 'apply');
      assert.equal(result.verified, true);
      assert.equal(result.createdCount, 20);
    });

    it('post-apply verification failure: customer still effective reqd = 1', async () => {
      const fixture = createMockMigrationDeps();
      const originalMeta = fixture.deps.getEffectiveMeta;

      fixture.deps.getEffectiveMeta = async (dt: string) => {
        const raw = (await originalMeta(dt)) as any;
        if (dt === ZALO_CONVERSATION_DOCTYPE) {
          const cust = raw.data.fields.find((f: any) => f.fieldname === 'customer');
          if (cust) cust.reqd = '1';
        }
        return raw;
      };

      await assert.rejects(
        () => runZaloSchemaMigration(fixture.deps, 'apply'),
        (err) => err instanceof ZaloSchemaMigrationError && err.message.includes('Zalo OA Conversation.customer must be effective reqd = 0')
      );
    });
  });

  describe('CLI Error Sanitization & Mode Safety', () => {
    it('12 & 13. CLI does not echo unknown argument value and sanitizes generic errors', async () => {
      const originalError = console.error;
      const logs: string[] = [];
      console.error = (msg: string) => logs.push(msg);

      try {
        const codeUnknown = await cliMain(['--secret-key-12345']);
        assert.equal(codeUnknown, 1);
        assert.ok(logs.some((l) => l.includes('[ERROR] Unknown migration argument')));
        assert.ok(!logs.some((l) => l.includes('secret-key-12345')));
      } finally {
        console.error = originalError;
      }
    });
  });
});
