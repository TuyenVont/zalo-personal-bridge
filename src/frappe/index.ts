export { FrappeApiClient } from './client.js';
export { FrappeResourceClient } from './resource.js';
export {
  FrappeConfigError,
  FrappeError,
  FrappeHttpError,
  FrappeParseError,
  FrappePathError,
  FrappeRequestError,
  FrappeResourceError,
  FrappeResponseError,
  FrappeTransportError,
  type FetchImplementation,
  type FrappeApiClientOptions,
  type FrappeDocument,
  type FrappeFilter,
  type FrappeHttpMethod,
  type FrappeListOptions,
} from './types.js';
export {
  ZALO_CONVERSATION_CUSTOM_FIELDS,
  ZALO_CONVERSATION_DOCTYPE,
  ZALO_CONVERSATION_FIELD_OVERRIDES,
  ZALO_CUSTOMER_CUSTOM_FIELDS,
  ZALO_CUSTOMER_DOCTYPE,
  ZALO_MESSAGE_CUSTOM_FIELDS,
  ZALO_MESSAGE_DOCTYPE,
  ZALO_MESSAGE_FIELD_OVERRIDES,
  type CustomFieldDefinition,
  type FieldOverrideDefinition,
  type FrappeCustomFieldType,
} from './zalo-shared-schema.js';
export {
  buildZaloConversationKey,
  buildZaloCustomerKey,
  buildZaloMessageKey,
  ZaloFrappeSchemaContractError,
} from './zalo-identity.js';
export {
  mapCustomFieldDefinition,
  normalizeFrappeCheck,
  runZaloSchemaMigration,
  unwrapEffectiveMetaResponse,
  ZaloSchemaMigrationError,
  type FrappeCustomFieldPayload,
  type FrappePropertySetterPayload,
  type MigrationActionType,
  type MigrationPlanItem,
  type MigrationResult,
  type ZaloSchemaMigrationDependencies,
} from './zalo-schema-migration.js';





