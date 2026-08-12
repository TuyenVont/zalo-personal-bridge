import { FrappeResourceClient } from './resource.js';
import { FrappeError } from './types.js';
import {
  CustomFieldDefinition,
  ZALO_CONVERSATION_CUSTOM_FIELDS,
  ZALO_CONVERSATION_DOCTYPE,
  ZALO_CUSTOMER_CUSTOM_FIELDS,
  ZALO_CUSTOMER_DOCTYPE,
  ZALO_MESSAGE_CUSTOM_FIELDS,
  ZALO_MESSAGE_DOCTYPE,
} from './zalo-shared-schema.js';

export class ZaloSchemaMigrationError extends FrappeError {
  constructor(message: string) {
    super(message);
    this.name = 'ZaloSchemaMigrationError';
  }
}

export interface ZaloSchemaMigrationDependencies {
  readonly resourceClient: FrappeResourceClient;
  readonly getEffectiveMeta: (doctype: string) => Promise<unknown>;
}

export interface FrappeCustomFieldPayload {
  readonly dt: string;
  readonly fieldname: string;
  readonly label: string;
  readonly fieldtype: string;
  readonly insert_after?: string;
  readonly options?: string;
  readonly default?: string;
  readonly reqd: 0 | 1;
  readonly unique: 0 | 1;
  readonly read_only: 0 | 1;
  readonly no_copy: 0 | 1;
}

export interface FrappePropertySetterPayload {
  readonly doctype_or_field: 'DocField';
  readonly doc_type: string;
  readonly field_name: string;
  readonly property: 'reqd';
  readonly property_type: 'Check';
  readonly value: '0';
}

export type MigrationActionType = 'CREATE' | 'UPDATE' | 'NOOP';

export interface MigrationPlanItem {
  readonly targetType: 'Custom Field' | 'Property Setter';
  readonly docType: string;
  readonly identifier: string;
  readonly action: MigrationActionType;
  readonly existingName?: string;
  readonly payload: Record<string, unknown>;
}

export interface MigrationResult {
  readonly mode: 'dry-run' | 'apply';
  readonly plan: readonly MigrationPlanItem[];
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly noopCount: number;
  readonly verified: boolean;
}

export function unwrapEffectiveMetaResponse(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ZaloSchemaMigrationError('Unexpected Frappe effective metadata response');
  }

  const obj = raw as Record<string, unknown>;

  if (
    obj.data &&
    typeof obj.data === 'object' &&
    !Array.isArray(obj.data) &&
    Array.isArray((obj.data as Record<string, unknown>).fields)
  ) {
    return obj.data as Record<string, unknown>;
  }

  if (Array.isArray(obj.fields)) {
    return obj;
  }

  throw new ZaloSchemaMigrationError('Unexpected Frappe effective metadata response');
}

export function normalizeFrappeCheck(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 0 || value === '0' || value === null || value === undefined) {
    return false;
  }
  return false;
}

export function mapCustomFieldDefinition(
  docType: string,
  def: CustomFieldDefinition
): FrappeCustomFieldPayload {
  return {
    dt: docType,
    fieldname: def.fieldname,
    label: def.label,
    fieldtype: def.fieldtype,
    ...(def.insertAfter ? { insert_after: def.insertAfter } : {}),
    ...(def.options ? { options: def.options.join('\n') } : {}),
    ...(def.default !== undefined ? { default: def.default } : {}),
    reqd: def.required ? 1 : 0,
    unique: def.unique ? 1 : 0,
    read_only: def.readOnly ? 1 : 0,
    no_copy: def.noCopy ? 1 : 0,
  };
}

function isCustomFieldEqual(
  existing: Record<string, unknown>,
  desired: FrappeCustomFieldPayload
): boolean {
  if (String(existing.label ?? '') !== desired.label) return false;
  if (String(existing.fieldtype ?? '') !== desired.fieldtype) return false;
  if (String(existing.insert_after ?? '') !== (desired.insert_after ?? '')) return false;
  if (String(existing.options ?? '') !== (desired.options ?? '')) return false;
  if (String(existing.default ?? '') !== (desired.default ?? '')) return false;
  if (normalizeFrappeCheck(existing.reqd) !== normalizeFrappeCheck(desired.reqd)) return false;
  if (normalizeFrappeCheck(existing.unique) !== normalizeFrappeCheck(desired.unique)) return false;
  if (normalizeFrappeCheck(existing.read_only) !== normalizeFrappeCheck(desired.read_only)) return false;
  if (normalizeFrappeCheck(existing.no_copy) !== normalizeFrappeCheck(desired.no_copy)) return false;
  return true;
}

function isPropertySetterEqual(
  existing: Record<string, unknown>,
  desired: FrappePropertySetterPayload
): boolean {
  if (String(existing.value ?? '') !== desired.value) return false;
  if (String(existing.property_type ?? '') !== desired.property_type) return false;
  return true;
}

async function runPreflightChecks(deps: ZaloSchemaMigrationDependencies): Promise<void> {
  const docTypesToVerify = [
    {
      name: ZALO_CUSTOMER_DOCTYPE,
      requiredBaseFields: ['source'],
    },
    {
      name: ZALO_CONVERSATION_DOCTYPE,
      requiredBaseFields: ['customer'],
    },
    {
      name: ZALO_MESSAGE_DOCTYPE,
      requiredBaseFields: ['customer', 'content', 'sender_type', 'sent_at'],
    },
  ];

  for (const item of docTypesToVerify) {
    let raw: unknown;
    try {
      raw = await deps.getEffectiveMeta(item.name);
    } catch (err) {
      throw new ZaloSchemaMigrationError(
        `Preflight check failed: DocType '${item.name}' could not be fetched`
      );
    }

    const doc = unwrapEffectiveMetaResponse(raw);

    const fields = Array.isArray(doc.fields) ? (doc.fields as Array<Record<string, unknown>>) : [];
    const existingFieldnames = new Set(fields.map((f) => String(f.fieldname ?? '')));

    for (const baseField of item.requiredBaseFields) {
      if (!existingFieldnames.has(baseField)) {
        throw new ZaloSchemaMigrationError(
          `Preflight check failed: Base field '${baseField}' missing on DocType '${item.name}'`
        );
      }
    }
  }
}

async function inspectCustomFieldPlan(
  resourceClient: FrappeResourceClient,
  docType: string,
  def: CustomFieldDefinition
): Promise<MigrationPlanItem> {
  const payload = mapCustomFieldDefinition(docType, def);

  let matches: ReadonlyArray<Record<string, unknown>>;
  try {
    matches = await resourceClient.list('Custom Field', {
      filters: [
        ['dt', '=', docType],
        ['fieldname', '=', def.fieldname],
      ],
      fields: [
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
      ],
    });
  } catch (err) {
    throw new ZaloSchemaMigrationError(
      `Failed to list Custom Field metadata for ${docType}.${def.fieldname}`
    );
  }

  if (matches.length === 0) {
    return {
      targetType: 'Custom Field',
      docType,
      identifier: def.fieldname,
      action: 'CREATE',
      payload: payload as unknown as Record<string, unknown>,
    };
  }

  if (matches.length > 1) {
    throw new ZaloSchemaMigrationError(
      `Duplicate Custom Field records found for ${docType}.${def.fieldname}`
    );
  }

  const existing = matches[0];
  const existingName = String(existing.name ?? '');

  if (isCustomFieldEqual(existing, payload)) {
    return {
      targetType: 'Custom Field',
      docType,
      identifier: def.fieldname,
      action: 'NOOP',
      existingName,
      payload: payload as unknown as Record<string, unknown>,
    };
  }

  return {
    targetType: 'Custom Field',
    docType,
    identifier: def.fieldname,
    action: 'UPDATE',
    existingName,
    payload: payload as unknown as Record<string, unknown>,
  };
}

async function inspectPropertySetterPlan(
  resourceClient: FrappeResourceClient,
  docType: string,
  fieldName: string
): Promise<MigrationPlanItem> {
  const payload: FrappePropertySetterPayload = {
    doctype_or_field: 'DocField',
    doc_type: docType,
    field_name: fieldName,
    property: 'reqd',
    property_type: 'Check',
    value: '0',
  };

  let matches: ReadonlyArray<Record<string, unknown>>;
  try {
    matches = await resourceClient.list('Property Setter', {
      filters: [
        ['doc_type', '=', docType],
        ['doctype_or_field', '=', 'DocField'],
        ['field_name', '=', fieldName],
        ['property', '=', 'reqd'],
      ],
      fields: [
        'name',
        'doc_type',
        'doctype_or_field',
        'field_name',
        'property',
        'property_type',
        'value',
      ],
    });
  } catch (err) {
    throw new ZaloSchemaMigrationError(
      `Failed to list Property Setter metadata for ${docType}.${fieldName}`
    );
  }

  if (matches.length === 0) {
    return {
      targetType: 'Property Setter',
      docType,
      identifier: `${fieldName}.reqd`,
      action: 'CREATE',
      payload: payload as unknown as Record<string, unknown>,
    };
  }

  if (matches.length > 1) {
    throw new ZaloSchemaMigrationError(
      `Duplicate Property Setter records found for ${docType}.${fieldName}.reqd`
    );
  }

  const existing = matches[0];
  const existingName = String(existing.name ?? '');

  if (isPropertySetterEqual(existing, payload)) {
    return {
      targetType: 'Property Setter',
      docType,
      identifier: `${fieldName}.reqd`,
      action: 'NOOP',
      existingName,
      payload: payload as unknown as Record<string, unknown>,
    };
  }

  return {
    targetType: 'Property Setter',
    docType,
    identifier: `${fieldName}.reqd`,
    action: 'UPDATE',
    existingName,
    payload: payload as unknown as Record<string, unknown>,
  };
}

async function verifyPostApplyState(deps: ZaloSchemaMigrationDependencies): Promise<void> {
  const contractDocTypes = [
    { docType: ZALO_CUSTOMER_DOCTYPE, fields: ZALO_CUSTOMER_CUSTOM_FIELDS },
    { docType: ZALO_CONVERSATION_DOCTYPE, fields: ZALO_CONVERSATION_CUSTOM_FIELDS },
    { docType: ZALO_MESSAGE_DOCTYPE, fields: ZALO_MESSAGE_CUSTOM_FIELDS },
  ];

  for (const contract of contractDocTypes) {
    let raw: unknown;
    try {
      raw = await deps.getEffectiveMeta(contract.docType);
    } catch {
      throw new ZaloSchemaMigrationError(
        `Post-apply verification failed: Effective metadata for ${contract.docType} could not be fetched`
      );
    }

    const meta = unwrapEffectiveMetaResponse(raw);
    const effectiveFields = Array.isArray(meta.fields)
      ? (meta.fields as Array<Record<string, unknown>>)
      : [];
    const fieldMap = new Map(effectiveFields.map((f) => [String(f.fieldname ?? ''), f]));

    for (const def of contract.fields) {
      const field = fieldMap.get(def.fieldname);
      if (!field) {
        throw new ZaloSchemaMigrationError(
          `Post-apply verification failed: Custom field '${contract.docType}.${def.fieldname}' missing in effective metadata`
        );
      }

      if (String(field.label ?? '') !== def.label) {
        throw new ZaloSchemaMigrationError(
          `Post-apply verification failed: Custom field '${contract.docType}.${def.fieldname}' label mismatch`
        );
      }

      if (String(field.fieldtype ?? '') !== def.fieldtype) {
        throw new ZaloSchemaMigrationError(
          `Post-apply verification failed: Custom field '${contract.docType}.${def.fieldname}' fieldtype mismatch`
        );
      }

      if (def.options !== undefined) {
        const expectedOptions = def.options.join('\n');
        const actualOptions = Array.isArray(field.options)
          ? field.options.join('\n')
          : String(field.options ?? '');
        if (actualOptions !== expectedOptions) {
          throw new ZaloSchemaMigrationError(
            `Post-apply verification failed: Custom field '${contract.docType}.${def.fieldname}' options mismatch`
          );
        }
      }

      if (def.default !== undefined && field.default !== undefined) {
        if (String(field.default) !== def.default) {
          throw new ZaloSchemaMigrationError(
            `Post-apply verification failed: Custom field '${contract.docType}.${def.fieldname}' default mismatch`
          );
        }
      }

      if (normalizeFrappeCheck(field.reqd) !== def.required) {
        throw new ZaloSchemaMigrationError(
          `Post-apply verification failed: Custom field '${contract.docType}.${def.fieldname}' reqd mismatch`
        );
      }

      if (normalizeFrappeCheck(field.unique) !== def.unique) {
        throw new ZaloSchemaMigrationError(
          `Post-apply verification failed: Custom field '${contract.docType}.${def.fieldname}' unique mismatch`
        );
      }

      if (normalizeFrappeCheck(field.read_only) !== def.readOnly) {
        throw new ZaloSchemaMigrationError(
          `Post-apply verification failed: Custom field '${contract.docType}.${def.fieldname}' read_only mismatch`
        );
      }

      if (def.noCopy !== undefined && field.no_copy !== undefined) {
        if (normalizeFrappeCheck(field.no_copy) !== def.noCopy) {
          throw new ZaloSchemaMigrationError(
            `Post-apply verification failed: Custom field '${contract.docType}.${def.fieldname}' no_copy mismatch`
          );
        }
      }
    }
  }

  const conversationRaw = await deps.getEffectiveMeta(ZALO_CONVERSATION_DOCTYPE);
  const conversationMeta = unwrapEffectiveMetaResponse(conversationRaw);
  const conversationFields = Array.isArray(conversationMeta.fields)
    ? (conversationMeta.fields as Array<Record<string, unknown>>)
    : [];
  const convCustomer = conversationFields.find((f) => f.fieldname === 'customer');
  if (!convCustomer || normalizeFrappeCheck(convCustomer.reqd) !== false) {
    throw new ZaloSchemaMigrationError(
      `Post-apply verification failed: ${ZALO_CONVERSATION_DOCTYPE}.customer must be effective reqd = 0`
    );
  }

  const messageRaw = await deps.getEffectiveMeta(ZALO_MESSAGE_DOCTYPE);
  const messageMeta = unwrapEffectiveMetaResponse(messageRaw);
  const messageFields = Array.isArray(messageMeta.fields)
    ? (messageMeta.fields as Array<Record<string, unknown>>)
    : [];

  const msgContent = messageFields.find((f) => f.fieldname === 'content');
  if (!msgContent || normalizeFrappeCheck(msgContent.reqd) !== false) {
    throw new ZaloSchemaMigrationError(
      `Post-apply verification failed: ${ZALO_MESSAGE_DOCTYPE}.content must be effective reqd = 0`
    );
  }

  const msgSenderType = messageFields.find((f) => f.fieldname === 'sender_type');
  if (!msgSenderType || normalizeFrappeCheck(msgSenderType.reqd) !== false) {
    throw new ZaloSchemaMigrationError(
      `Post-apply verification failed: ${ZALO_MESSAGE_DOCTYPE}.sender_type must be effective reqd = 0`
    );
  }

  const msgSentAt = messageFields.find((f) => f.fieldname === 'sent_at');
  if (!msgSentAt || normalizeFrappeCheck(msgSentAt.reqd) !== true) {
    throw new ZaloSchemaMigrationError(
      `Post-apply verification failed: ${ZALO_MESSAGE_DOCTYPE}.sent_at must remain effective reqd = 1`
    );
  }
}

export async function runZaloSchemaMigration(
  deps: ZaloSchemaMigrationDependencies,
  mode: 'dry-run' | 'apply'
): Promise<MigrationResult> {
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new ZaloSchemaMigrationError(`Invalid migration mode: '${String(mode)}'`);
  }

  if (!deps || typeof deps !== 'object' || !deps.resourceClient || typeof deps.getEffectiveMeta !== 'function') {
    throw new ZaloSchemaMigrationError(
      'runZaloSchemaMigration requires ZaloSchemaMigrationDependencies containing resourceClient and getEffectiveMeta'
    );
  }

  await runPreflightChecks(deps);

  const plan: MigrationPlanItem[] = [];

  const docTypeFieldGroups = [
    { docType: ZALO_CUSTOMER_DOCTYPE, fields: ZALO_CUSTOMER_CUSTOM_FIELDS },
    { docType: ZALO_CONVERSATION_DOCTYPE, fields: ZALO_CONVERSATION_CUSTOM_FIELDS },
    { docType: ZALO_MESSAGE_DOCTYPE, fields: ZALO_MESSAGE_CUSTOM_FIELDS },
  ];

  for (const group of docTypeFieldGroups) {
    for (const def of group.fields) {
      const itemPlan = await inspectCustomFieldPlan(deps.resourceClient, group.docType, def);
      plan.push(itemPlan);
    }
  }

  const conversationCustomerPlan = await inspectPropertySetterPlan(
    deps.resourceClient,
    ZALO_CONVERSATION_DOCTYPE,
    'customer'
  );
  plan.push(conversationCustomerPlan);

  const messageContentPlan = await inspectPropertySetterPlan(
    deps.resourceClient,
    ZALO_MESSAGE_DOCTYPE,
    'content'
  );
  plan.push(messageContentPlan);

  const messageSenderTypePlan = await inspectPropertySetterPlan(
    deps.resourceClient,
    ZALO_MESSAGE_DOCTYPE,
    'sender_type'
  );
  plan.push(messageSenderTypePlan);

  if (mode === 'dry-run') {
    let noopCount = 0;
    for (const item of plan) {
      if (item.action === 'NOOP') {
        noopCount++;
      }
    }
    return {
      mode: 'dry-run',
      plan,
      createdCount: 0,
      updatedCount: 0,
      noopCount,
      verified: false,
    };
  }

  let createdCount = 0;
  let updatedCount = 0;
  let noopCount = 0;

  for (const item of plan) {
    if (item.action === 'CREATE') {
      try {
        await deps.resourceClient.create(item.targetType, item.payload);
        createdCount++;
      } catch (err) {
        throw new ZaloSchemaMigrationError(
          `Failed to create ${item.targetType} '${item.docType}.${item.identifier}'`
        );
      }
    } else if (item.action === 'UPDATE') {
      try {
        await deps.resourceClient.update(item.targetType, item.existingName!, item.payload);
        updatedCount++;
      } catch (err) {
        throw new ZaloSchemaMigrationError(
          `Failed to update ${item.targetType} '${item.docType}.${item.identifier}'`
        );
      }
    } else {
      noopCount++;
    }
  }

  await verifyPostApplyState(deps);

  return {
    mode: 'apply',
    plan,
    createdCount,
    updatedCount,
    noopCount,
    verified: true,
  };
}
