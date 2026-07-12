import AjvModule, { type ErrorObject } from 'ajv';
import { Type, type TSchema } from '@sinclair/typebox';
import { ICON_NAMES, type AnyMeta, type AppManifest } from './types.js';

const name = Type.String({ minLength: 1, pattern: '^[A-Za-z_][A-Za-z0-9_.-]*$' });
const layer = Type.Union(['SYS', 'ISV', 'LOC', 'DEV', 'CUS'].map((value) => Type.Literal(value)));
const icon = Type.Optional(Type.Union(ICON_NAMES.map((value) => Type.Literal(value))));
const common = {
  name,
  app: Type.Optional(Type.String({ minLength: 1 })),
  model: Type.Optional(Type.String({ minLength: 1 })),
  layer: Type.Optional(layer),
  label: Type.Optional(Type.String()),
};
const fieldType = Type.Union(
  ['string', 'int', 'real', 'boolean', 'date', 'datetime', 'enum', 'reference'].map((value) => Type.Literal(value)),
);
export const fieldSchema = Type.Object({
  name,
  type: fieldType,
  label: Type.Optional(Type.String()),
  mandatory: Type.Optional(Type.Boolean()),
  readOnly: Type.Optional(Type.Boolean()),
  allowEdit: Type.Optional(Type.Boolean()),
  allowEditOnCreate: Type.Optional(Type.Boolean()),
  maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
  enumName: Type.Optional(Type.String({ minLength: 1 })),
  reference: Type.Optional(Type.Object({
    table: Type.String({ minLength: 1 }),
    displayField: Type.Optional(Type.String()),
    displayFields: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
    filters: Type.Optional(Type.Array(Type.Object({
      field: Type.String({ minLength: 1 }),
      operator: Type.Union(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].map((v) => Type.Literal(v))),
      value: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
    }, { additionalProperties: false }))),
    onDelete: Type.Optional(Type.Union(['restrict', 'cascade', 'setNull'].map((v) => Type.Literal(v)))),
    copyFields: Type.Optional(Type.Array(Type.Object({ from: Type.String(), to: Type.String() }))),
  })),
  default: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])),
}, { additionalProperties: false });

const indexSchema = Type.Object({
  name,
  fields: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  unique: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const menuItemSchema = Type.Object({
  label: Type.Optional(Type.String()),
  icon,
  form: Type.Optional(Type.String()),
  route: Type.Optional(Type.String()),
  action: Type.Optional(Type.String()),
  target: Type.Optional(Type.Union([
    Type.Object({ type: Type.Literal('group') }, { additionalProperties: false }),
    ...['form', 'function', 'report'].map((targetType) => Type.Object({ type: Type.Literal(targetType), name: Type.String({ minLength: 1 }) }, { additionalProperties: false })),
  ])),
  // Nested items use the same wire shape. Cross-reference and nested shape validation
  // is completed by MetadataRegistry, avoiding recursive $ref collisions in bundled schemas.
  items: Type.Optional(Type.Array(Type.Any())),
}, { additionalProperties: false });
const groupSchema = Type.Object({ label: Type.Optional(Type.String()), fields: Type.Array(Type.String()) }, { additionalProperties: false });
const tablePermissionSchema = Type.Object({
  table: Type.String({ minLength: 1 }),
  read: Type.Optional(Type.Boolean()), create: Type.Optional(Type.Boolean()),
  update: Type.Optional(Type.Boolean()), delete: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const aggregateSchema = Type.Object({
  fn: Type.Union([Type.Literal('count'), Type.Literal('sum'), Type.Literal('avg')]),
  field: Type.Optional(Type.String()), label: Type.Optional(Type.String()),
}, { additionalProperties: false });
const pickerValueSchema = Type.Union([
  Type.String(), Type.Number(), Type.Boolean(), Type.Null(),
  Type.Object({ source: Type.Union([Type.Literal('record'), Type.Literal('line')]), field: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
]);
const pickerSchema = Type.Object({
  table: Type.String({ minLength: 1 }), columns: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  searchFields: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  filters: Type.Optional(Type.Array(Type.Object({
    field: Type.String({ minLength: 1 }),
    operator: Type.Union(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].map((v) => Type.Literal(v))),
    value: pickerValueSchema,
  }, { additionalProperties: false }))),
  multiple: Type.Optional(Type.Boolean()),
  allocation: Type.Optional(Type.Object({ availableField: Type.String({ minLength: 1 }), quantityLabel: Type.Optional(Type.String()) }, { additionalProperties: false })),
}, { additionalProperties: false });
const formActionSchema = Type.Object({
  label: Type.String({ minLength: 1 }), action: Type.Optional(Type.String({ minLength: 1 })),
  type: Type.Optional(Type.Union(['function', 'report', 'picker'].map((v) => Type.Literal(v)))),
  target: Type.Optional(Type.String({ minLength: 1 })), privilege: Type.Optional(Type.String({ minLength: 1 })), disabled: Type.Optional(Type.Boolean()), picker: Type.Optional(pickerSchema),
}, { additionalProperties: false });
const lineGridSchema = Type.Object({
  table: Type.String(), refField: Type.String(), fields: Type.Array(Type.String()),
  aggregates: Type.Optional(Type.Array(aggregateSchema)),
  actions: Type.Optional(Type.Array(formActionSchema)),
}, { additionalProperties: false });
const reportStyleSchema = Type.Object({
  fontSize: Type.Optional(Type.Number()), bold: Type.Optional(Type.Boolean()), italic: Type.Optional(Type.Boolean()),
  align: Type.Optional(Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')])),
  color: Type.Optional(Type.String()), borderWidth: Type.Optional(Type.Number()),
}, { additionalProperties: false });
const reportElementSchema = Type.Object({
  id: Type.String(), type: Type.Union(['text', 'field', 'image', 'line', 'rect'].map((v) => Type.Literal(v))),
  x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number(),
  text: Type.Optional(Type.String()), field: Type.Optional(Type.String()), format: Type.Optional(Type.String()),
  style: Type.Optional(reportStyleSchema),
}, { additionalProperties: false });
const reportBandSchema = Type.Object({
  kind: Type.Union(['pageHeader', 'header', 'detail', 'footer', 'pageFooter'].map((v) => Type.Literal(v))),
  height: Type.Number({ minimum: 0 }), elements: Type.Array(reportElementSchema),
}, { additionalProperties: false });
const reportParameterSchema = Type.Object({
  field: Type.String({ minLength: 1 }),
  operator: Type.Optional(Type.Union(['eq', 'from', 'to'].map((v) => Type.Literal(v)))),
  label: Type.Optional(Type.String()), required: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const artifactSchemas = [
  Type.Object({ kind: Type.Literal('app'), name, label: Type.Optional(Type.String()), icon, dependsOn: Type.Optional(Type.Array(Type.String())), models: Type.Optional(Type.Array(Type.Object({ name, label: Type.Optional(Type.String()), layer }))) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('table'), ...common, fields: Type.Array(fieldSchema), titleField: Type.Optional(Type.String()), indexes: Type.Optional(Type.Array(indexSchema)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('enum'), ...common, values: Type.Array(Type.Object({ name, value: Type.Integer(), label: Type.Optional(Type.String()) }, { additionalProperties: false })) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('form'), ...common, table: Type.String(), actions: Type.Optional(Type.Array(formActionSchema)), listFields: Type.Optional(Type.Array(Type.String())), groups: Type.Optional(Type.Array(groupSchema)), lines: Type.Optional(Type.Array(lineGridSchema)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('menu'), ...common, items: Type.Array(menuItemSchema) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('privilege'), ...common, tablePermissions: Type.Optional(Type.Array(tablePermissionSchema)), forms: Type.Optional(Type.Array(Type.String())), functions: Type.Optional(Type.Array(Type.String())), reports: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('duty'), ...common, privileges: Type.Array(Type.String()) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('role'), ...common, duties: Type.Optional(Type.Array(Type.String())), privileges: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('tableExtension'), ...common, table: Type.String(), fields: Type.Optional(Type.Array(fieldSchema)), indexes: Type.Optional(Type.Array(indexSchema)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('formExtension'), ...common, form: Type.String(), listFields: Type.Optional(Type.Array(Type.String())), groups: Type.Optional(Type.Array(groupSchema)), actions: Type.Optional(Type.Array(formActionSchema)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('menuExtension'), ...common, menu: Type.String(), items: Type.Array(menuItemSchema) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('enumExtension'), ...common, enum: Type.String(), values: Type.Array(Type.Object({ name, value: Type.Integer(), label: Type.Optional(Type.String()) })) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('privilegeExtension'), ...common, privilege: Type.String(), tablePermissions: Type.Optional(Type.Array(tablePermissionSchema)), forms: Type.Optional(Type.Array(Type.String())), functions: Type.Optional(Type.Array(Type.String())), reports: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('dutyExtension'), ...common, duty: Type.String(), privileges: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('roleExtension'), ...common, role: Type.String(), duties: Type.Optional(Type.Array(Type.String())), privileges: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('script'), ...common, code: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('scriptExtension'), ...common, script: Type.String(), code: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('function'), ...common, code: Type.String(), privileges: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('report'), ...common, dataSource: Type.String(), privileges: Type.Optional(Type.Array(Type.String())), page: Type.Optional(Type.Object({ size: Type.Optional(Type.Union([Type.Literal('A4'), Type.Literal('Letter')])), orientation: Type.Optional(Type.Union([Type.Literal('portrait'), Type.Literal('landscape')])), margins: Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()])) }, { additionalProperties: false })), bands: Type.Array(reportBandSchema), lineSources: Type.Optional(Type.Array(Type.Object({ table: Type.String(), refField: Type.String(), bands: Type.Array(reportBandSchema) }, { additionalProperties: false }))), parameters: Type.Optional(Type.Array(reportParameterSchema)) }, { additionalProperties: false }),
] as TSchema[];

export const metadataArtifactSchema = Type.Union(artifactSchemas);
export type MetadataArtifact = AnyMeta | (AppManifest & { kind: 'app' });
export const metadataSchema = Type.Array(metadataArtifactSchema);

export const metadataChangeSetSchema = Type.Object({
  version: Type.Literal(1),
  baseRevision: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  source: Type.Optional(Type.Union([Type.Literal('designer'), Type.Literal('cli'), Type.Literal('ai')])),
  operations: Type.Array(Type.Union([
    Type.Object({ op: Type.Literal('upsert'), kind: Type.String(), name, artifact: metadataArtifactSchema }, { additionalProperties: false }),
    Type.Object({ op: Type.Literal('delete'), kind: Type.String(), name }, { additionalProperties: false }),
  ]), { minItems: 1 }),
}, { additionalProperties: false });
export interface MetadataChangeSet {
  version: 1;
  baseRevision: string;
  description?: string;
  source?: 'designer' | 'cli' | 'ai';
  operations: Array<
    | { op: 'upsert'; kind: string; name: string; artifact: MetadataArtifact }
    | { op: 'delete'; kind: string; name: string }
  >;
}

const Ajv = ((AjvModule as unknown as { default?: new (options?: object) => any }).default ?? AjvModule) as unknown as new (options?: object) => any;
const ajv = new Ajv({ allErrors: true, strict: false });
const artifactValidator = ajv.compile(metadataArtifactSchema);
const changeSetValidator = ajv.compile(metadataChangeSetSchema);

export interface SchemaDiagnostic { path: string; code: string; message: string }
function diagnostics(errors: ErrorObject[] | null | undefined): SchemaDiagnostic[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || '/',
    code: error.keyword,
    message: error.message ?? 'Invalid value',
  }));
}
export function validateMetadataArtifact(value: unknown): SchemaDiagnostic[] {
  return artifactValidator(value) ? [] : diagnostics(artifactValidator.errors);
}
export function validateMetadataChangeSet(value: unknown): SchemaDiagnostic[] {
  return changeSetValidator(value) ? [] : diagnostics(changeSetValidator.errors);
}
