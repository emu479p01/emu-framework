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
      value: Type.Union([
        Type.String(), Type.Number(), Type.Boolean(), Type.Null(),
        Type.Object({ source: Type.Literal('record'), field: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
        Type.Object({ source: Type.Literal('lookup'), field: Type.String({ minLength: 1 }), lookupField: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      ]),
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
  id: Type.Optional(Type.String({ minLength: 1 })),
  visible: Type.Optional(Type.Boolean()), hidden: Type.Optional(Type.Boolean()), order: Type.Optional(Type.Number()),
  parentId: Type.Optional(Type.String({ minLength: 1 })),
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
const groupSchema = Type.Object({ id: Type.Optional(Type.String({ minLength: 1 })), label: Type.Optional(Type.String()), hidden: Type.Optional(Type.Boolean()), order: Type.Optional(Type.Number()), fields: Type.Array(Type.String()) }, { additionalProperties: false });
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
  id: Type.Optional(Type.String({ minLength: 1 })),
  hidden: Type.Optional(Type.Boolean()), order: Type.Optional(Type.Number()),
  label: Type.String({ minLength: 1 }), action: Type.Optional(Type.String({ minLength: 1 })),
  type: Type.Optional(Type.Union(['function', 'report', 'picker'].map((v) => Type.Literal(v)))),
  target: Type.Optional(Type.String({ minLength: 1 })), privilege: Type.Optional(Type.String({ minLength: 1 })), disabled: Type.Optional(Type.Boolean()), showOnCreate: Type.Optional(Type.Boolean()), picker: Type.Optional(pickerSchema),
}, { additionalProperties: false });
const lineGridSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  label: Type.Optional(Type.String()), hidden: Type.Optional(Type.Boolean()), order: Type.Optional(Type.Number()),
  table: Type.String(), refField: Type.String(), fields: Type.Array(Type.String()),
  aggregates: Type.Optional(Type.Array(aggregateSchema)),
  actions: Type.Optional(Type.Array(formActionSchema)),
}, { additionalProperties: false });
const formChartSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  label: Type.Optional(Type.String()), hidden: Type.Optional(Type.Boolean()), order: Type.Optional(Type.Number()),
  chart: Type.String({ minLength: 1 }),
  width: Type.Optional(Type.Union([Type.Literal('half'), Type.Literal('full')])),
  parameterBindings: Type.Optional(Type.Array(Type.Object({
    parameter: Type.String({ minLength: 1 }),
    source: Type.Union([Type.Literal('record'), Type.Literal('literal')]),
    field: Type.Optional(Type.String({ minLength: 1 })),
    value: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])),
  }, { additionalProperties: false }))),
}, { additionalProperties: false });
const presentationOverrideSchema = Type.Object({
  targetId: Type.String({ minLength: 1 }), label: Type.Optional(Type.String()),
  hidden: Type.Optional(Type.Boolean()), order: Type.Optional(Type.Number()),
}, { additionalProperties: false });
const fieldOverrideSchema = Type.Object({
  field: Type.String({ minLength: 1 }), label: Type.Optional(Type.String()),
  readOnly: Type.Optional(Type.Boolean()), allowEdit: Type.Optional(Type.Boolean()),
  allowEditOnCreate: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const menuItemOverrideSchema = Type.Object({
  targetId: Type.String({ minLength: 1 }), label: Type.Optional(Type.String()), icon,
  visible: Type.Optional(Type.Boolean()), hidden: Type.Optional(Type.Boolean()), order: Type.Optional(Type.Number()),
  target: Type.Optional(Type.Union([
    Type.Object({ type: Type.Literal('group') }, { additionalProperties: false }),
    ...['form', 'function', 'report'].map((targetType) => Type.Object({ type: Type.Literal(targetType), name: Type.String({ minLength: 1 }) }, { additionalProperties: false })),
  ])),
}, { additionalProperties: false });
const viewParameterSchema = Type.Object({
  name, type: Type.Union(['string', 'int', 'real', 'boolean', 'date', 'datetime'].map((v) => Type.Literal(v))),
  required: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const viewColumnSchema = Type.Object({
  name, label: Type.Optional(Type.String()),
  expression: Type.Union([
    Type.Object({ type: Type.Literal('field'), ref: Type.String({ minLength: 3 }) }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal('aggregate'), fn: Type.Union(['count', 'sum', 'avg', 'min', 'max'].map((v) => Type.Literal(v))), ref: Type.Optional(Type.String({ minLength: 3 })) }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });
const viewLiteralSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);
const viewFilterSchema = Type.Object({
  ref: Type.String({ minLength: 3 }),
  operator: Type.Union(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'].map((v) => Type.Literal(v))),
  value: Type.Union([
    viewLiteralSchema,
    Type.Array(viewLiteralSchema),
    Type.Object({ parameter: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });
const viewJoinSchema = Type.Object({
  type: Type.Union([Type.Literal('inner'), Type.Literal('left')]), table: Type.String({ minLength: 1 }), alias: name,
  on: Type.Array(Type.Object({ left: Type.String({ minLength: 3 }), right: Type.String({ minLength: 3 }) }, { additionalProperties: false }), { minItems: 1 }),
}, { additionalProperties: false });
const viewOrderSchema = Type.Object({ column: Type.String({ minLength: 1 }), direction: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])) }, { additionalProperties: false });
const chartMeasureSchema = Type.Object({ field: Type.String({ minLength: 1 }), label: Type.Optional(Type.String()), color: Type.Optional(Type.String()) }, { additionalProperties: false });
const reportStyleSchema = Type.Object({
  fontSize: Type.Optional(Type.Number()), bold: Type.Optional(Type.Boolean()), italic: Type.Optional(Type.Boolean()),
  fontFamily: Type.Optional(Type.String({ minLength: 1 })),
  align: Type.Optional(Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')])),
  color: Type.Optional(Type.String()), borderWidth: Type.Optional(Type.Number()),
}, { additionalProperties: false });
const reportTablixCellStyleSchema = Type.Object({
  fontSize: Type.Optional(Type.Number({ minimum: 1 })), bold: Type.Optional(Type.Boolean()), italic: Type.Optional(Type.Boolean()),
  fontFamily: Type.Optional(Type.String({ minLength: 1 })),
  align: Type.Optional(Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')])),
  color: Type.Optional(Type.String()), backgroundColor: Type.Optional(Type.String()), padding: Type.Optional(Type.Number({ minimum: 0 })),
}, { additionalProperties: false });
const reportTablixSchema = Type.Object({
  columns: Type.Array(Type.Object({
    field: Type.String({ minLength: 1 }), label: Type.Optional(Type.String()), width: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    align: Type.Optional(Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')])),
    format: Type.Optional(Type.String()),
  }, { additionalProperties: false }), { minItems: 1 }),
  headerHeight: Type.Optional(Type.Number({ exclusiveMinimum: 0 })), rowHeight: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  headerStyle: Type.Optional(reportTablixCellStyleSchema), rowStyle: Type.Optional(reportTablixCellStyleSchema),
  border: Type.Optional(Type.Object({ width: Type.Optional(Type.Number({ minimum: 0 })), color: Type.Optional(Type.String()) }, { additionalProperties: false })),
}, { additionalProperties: false });
const reportElementSchema = Type.Object({
  id: Type.String(), type: Type.Union(['text', 'field', 'image', 'line', 'rect'].map((v) => Type.Literal(v))),
  x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number(),
  text: Type.Optional(Type.String()), field: Type.Optional(Type.String()), format: Type.Optional(Type.String()),
  style: Type.Optional(reportStyleSchema),
}, { additionalProperties: false });
const reportBandSchema = Type.Object({
  kind: Type.Union(['pageHeader', 'header', 'detail', 'footer', 'pageFooter'].map((v) => Type.Literal(v))),
  displayOn: Type.Optional(Type.Union(['firstPage', 'everyPage', 'lastPage'].map((v) => Type.Literal(v)))),
  layout: Type.Optional(Type.Union([Type.Literal('freeform'), Type.Literal('tablix')])),
  height: Type.Number({ minimum: 0 }), elements: Type.Array(reportElementSchema),
  tablix: Type.Optional(reportTablixSchema),
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
  Type.Object({ kind: Type.Literal('form'), ...common, table: Type.String(), actions: Type.Optional(Type.Array(formActionSchema)), listFields: Type.Optional(Type.Array(Type.String())), filterFields: Type.Optional(Type.Array(Type.String())), groups: Type.Optional(Type.Array(groupSchema)), charts: Type.Optional(Type.Array(formChartSchema)), lines: Type.Optional(Type.Array(lineGridSchema)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('menu'), ...common, items: Type.Array(menuItemSchema) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('privilege'), ...common, tablePermissions: Type.Optional(Type.Array(tablePermissionSchema)), forms: Type.Optional(Type.Array(Type.String())), functions: Type.Optional(Type.Array(Type.String())), reports: Type.Optional(Type.Array(Type.String())), views: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('duty'), ...common, privileges: Type.Array(Type.String()) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('role'), ...common, duties: Type.Optional(Type.Array(Type.String())), privileges: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('tableExtension'), ...common, table: Type.String(), fields: Type.Optional(Type.Array(fieldSchema)), indexes: Type.Optional(Type.Array(indexSchema)), fieldOverrides: Type.Optional(Type.Array(fieldOverrideSchema)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('formExtension'), ...common, form: Type.String(), listFields: Type.Optional(Type.Array(Type.String())), filterFields: Type.Optional(Type.Array(Type.String())), groups: Type.Optional(Type.Array(groupSchema)), charts: Type.Optional(Type.Array(formChartSchema)), actions: Type.Optional(Type.Array(formActionSchema)), lines: Type.Optional(Type.Array(lineGridSchema)), elementOverrides: Type.Optional(Type.Array(presentationOverrideSchema)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('menuExtension'), ...common, menu: Type.String(), items: Type.Optional(Type.Array(menuItemSchema)), insertions: Type.Optional(Type.Array(Type.Object({ path: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }), items: Type.Array(menuItemSchema, { minItems: 1 }) }, { additionalProperties: false }))), itemOverrides: Type.Optional(Type.Array(menuItemOverrideSchema)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('enumExtension'), ...common, enum: Type.String(), values: Type.Array(Type.Object({ name, value: Type.Integer(), label: Type.Optional(Type.String()) })), valueOverrides: Type.Optional(Type.Array(Type.Object({ name: Type.String({ minLength: 1 }), label: Type.String() }, { additionalProperties: false }))) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('privilegeExtension'), ...common, privilege: Type.String(), tablePermissions: Type.Optional(Type.Array(tablePermissionSchema)), forms: Type.Optional(Type.Array(Type.String())), functions: Type.Optional(Type.Array(Type.String())), reports: Type.Optional(Type.Array(Type.String())), views: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('dutyExtension'), ...common, duty: Type.String(), privileges: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('roleExtension'), ...common, role: Type.String(), duties: Type.Optional(Type.Array(Type.String())), privileges: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('script'), ...common, code: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('scriptExtension'), ...common, script: Type.String(), code: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('function'), ...common, code: Type.String(), executionMode: Type.Optional(Type.Union([Type.Literal('transactional'), Type.Literal('async')])), privileges: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('functionExtension'), ...common, function: Type.String(), code: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('report'), ...common, dataSource: Type.String(), defaultFont: Type.Optional(Type.String({ minLength: 1 })), privileges: Type.Optional(Type.Array(Type.String())), page: Type.Optional(Type.Object({ size: Type.Optional(Type.Union([Type.Literal('A4'), Type.Literal('Letter')])), orientation: Type.Optional(Type.Union([Type.Literal('portrait'), Type.Literal('landscape')])), margins: Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()])) }, { additionalProperties: false })), bands: Type.Array(reportBandSchema), lineSources: Type.Optional(Type.Array(Type.Object({ table: Type.String(), refField: Type.String(), bands: Type.Array(reportBandSchema) }, { additionalProperties: false }))), parameters: Type.Optional(Type.Array(reportParameterSchema)) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('view'), ...common,
    source: Type.Object({ table: Type.String({ minLength: 1 }), alias: name }, { additionalProperties: false }),
    joins: Type.Optional(Type.Array(viewJoinSchema)),
    columns: Type.Array(viewColumnSchema, { minItems: 1 }), parameters: Type.Optional(Type.Array(viewParameterSchema)),
    filters: Type.Optional(Type.Array(viewFilterSchema)), groupBy: Type.Optional(Type.Array(Type.String({ minLength: 3 }))),
    orderBy: Type.Optional(Type.Array(viewOrderSchema)),
  }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('viewExtension'), ...common, view: Type.String({ minLength: 1 }),
    joins: Type.Optional(Type.Array(viewJoinSchema)), columns: Type.Optional(Type.Array(viewColumnSchema)),
    filters: Type.Optional(Type.Array(viewFilterSchema)), orderBy: Type.Optional(Type.Array(viewOrderSchema)),
    columnOverrides: Type.Optional(Type.Array(Type.Object({ column: Type.String({ minLength: 1 }), label: Type.String() }, { additionalProperties: false }))),
  }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('chart'), ...common,
    type: Type.Union(['bar', 'line', 'pie', 'donut', 'kpi'].map((v) => Type.Literal(v))),
    view: Type.String({ minLength: 1 }), dimension: Type.Optional(Type.String({ minLength: 1 })),
    measures: Type.Array(chartMeasureSchema, { minItems: 1 }),
    legend: Type.Optional(Type.Boolean()), stacked: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('chartExtension'), ...common, chart: Type.String({ minLength: 1 }),
    measures: Type.Optional(Type.Array(chartMeasureSchema)), legend: Type.Optional(Type.Boolean()), stacked: Type.Optional(Type.Boolean()),
    measureOverrides: Type.Optional(Type.Array(Type.Object({ field: Type.String({ minLength: 1 }), label: Type.Optional(Type.String()), color: Type.Optional(Type.String()) }, { additionalProperties: false }))),
  }, { additionalProperties: false }),
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
  if (!artifactValidator(value)) return diagnostics(artifactValidator.errors);
  const artifact = value as { kind?: string; fields?: Array<{ name?: string; type?: string; mandatory?: boolean; readOnly?: boolean }> };
  if (artifact.kind === 'table' || artifact.kind === 'tableExtension') {
    const issues: SchemaDiagnostic[] = [];
    for (const [index, field] of (artifact.fields ?? []).entries()) {
      if (field.type === 'enum' && field.mandatory) {
        issues.push({ path: `/fields/${index}/mandatory`, code: 'enum_optional', message: `Enum field '${field.name ?? index}' must be optional` });
      }
      if (field.readOnly && field.mandatory) {
        issues.push({ path: `/fields/${index}/mandatory`, code: 'readonly_optional', message: `Read-only field '${field.name ?? index}' cannot be required` });
      }
    }
    return issues;
  }
  return [];
}
export function validateMetadataChangeSet(value: unknown): SchemaDiagnostic[] {
  return changeSetValidator(value) ? [] : diagnostics(changeSetValidator.errors);
}
