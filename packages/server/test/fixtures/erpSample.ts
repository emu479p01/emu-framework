import type { AnyMeta, Kernel } from '@emu/core';

const ERP_MODEL = 'MiniERPApplication';
const SYS = 'SYS' as const;
const P = 'ERP' as const;

const erp = { app: 'erp', model: ERP_MODEL, layer: SYS };

/** Mini ERP sample metadata — for tests only, not seeded in production. */
export const erpSampleArtifacts: (AnyMeta & { app?: string })[] = [
  {
    kind: 'app',
    name: 'erp',
    label: 'Mini ERP',
    models: [
      { name: ERP_MODEL, label: 'Mini ERP Application', layer: 'SYS' },
      { name: 'ClientCustom', label: 'Client Custom', layer: 'CUS' },
    ],
  } as any,
  { kind: 'enum', name: 'ERP_DirPartyType', label: 'Party type', ...erp, values: [
    { name: 'Organization', value: 0, label: 'Organization' },
    { name: 'Person', value: 1, label: 'Person' },
  ] } as any,
  { kind: 'table', name: `${P}_DirPartyTable`, label: 'Parties', titleField: 'name', ...erp, fields: [
    { name: 'name', type: 'string', label: 'Name', mandatory: true },
    { name: 'partyType', type: 'enum', label: 'Type', enumName: 'ERP_DirPartyType', default: 0 },
  ] } as any,
  { kind: 'form', name: `${P}_DirPartyTableForm`, label: 'All parties', table: `${P}_DirPartyTable`, ...erp,
    listFields: ['name', 'partyType'], groups: [{ label: 'General', fields: ['name', 'partyType'] }] } as any,
  { kind: 'enum', name: 'ERP_SalesStatus', label: 'Sales status', ...erp, values: [
    { name: 'Open', value: 0, label: 'Open' },
    { name: 'Posted', value: 1, label: 'Posted' },
    { name: 'Cancelled', value: 2, label: 'Cancelled' },
  ] } as any,
  { kind: 'table', name: `${P}_SalesTable`, label: 'Sales orders', titleField: 'salesId', ...erp, fields: [
    { name: 'salesId', type: 'string', label: 'Sales order', mandatory: true, maxLength: 20 },
    { name: 'custId', type: 'reference', label: 'Customer', mandatory: true, reference: { table: `${P}_CustTable` } },
    { name: 'status', type: 'enum', label: 'Status', enumName: 'ERP_SalesStatus', default: 0, readOnly: true },
    { name: 'orderDate', type: 'date', label: 'Order date' },
    { name: 'totalAmount', type: 'real', label: 'Total', default: 0, readOnly: true },
  ], indexes: [{ name: 'SalesIdx', fields: ['salesId'], unique: true }] } as any,
  { kind: 'table', name: `${P}_SalesLine`, label: 'Sales lines', ...erp, fields: [
    { name: 'salesId', type: 'reference', label: 'Sales order', mandatory: true, reference: { table: `${P}_SalesTable` } },
    { name: 'itemId', type: 'reference', label: 'Item', mandatory: true, reference: { table: `${P}_InventItem` } },
    { name: 'qty', type: 'real', label: 'Quantity', default: 1 },
    { name: 'salesPrice', type: 'real', label: 'Price', default: 0 },
    { name: 'lineAmount', type: 'real', label: 'Line amount', default: 0, readOnly: true },
  ], indexes: [{ name: 'SalesIdx', fields: ['salesId'] }] } as any,
  { kind: 'form', name: `${P}_SalesTableForm`, label: 'Sales orders', table: `${P}_SalesTable`, ...erp,
    actions: [{ label: 'Post', action: 'ERP_SalesOrderPost' }],
    listFields: ['salesId', 'custId', 'status', 'orderDate', 'totalAmount'],
    groups: [{ label: 'Header', fields: ['salesId', 'custId', 'status'] }, { label: 'Details', fields: ['orderDate', 'totalAmount'] }],
    lines: [{ table: `${P}_SalesLine`, refField: 'salesId', fields: ['itemId', 'qty', 'salesPrice', 'lineAmount'] }] } as any,
  { kind: 'table', name: `${P}_InventItem`, label: 'Items', titleField: 'itemName', ...erp, fields: [
    { name: 'itemId', type: 'string', label: 'Item ID', mandatory: true, maxLength: 20 },
    { name: 'itemName', type: 'string', label: 'Item name', mandatory: true },
    { name: 'salesPrice', type: 'real', label: 'Sales price', default: 0 },
    { name: 'onHand', type: 'real', label: 'On hand', default: 0 },
  ], indexes: [{ name: 'ItemIdx', fields: ['itemId'], unique: true }] } as any,
  { kind: 'form', name: `${P}_InventItemForm`, label: 'Items', table: `${P}_InventItem`, ...erp,
    listFields: ['itemId', 'itemName', 'salesPrice', 'onHand'],
    groups: [{ label: 'General', fields: ['itemId', 'itemName'] }, { label: 'Pricing & stock', fields: ['salesPrice', 'onHand'] }] } as any,
  { kind: 'table', name: `${P}_CustTable`, label: 'Customers', titleField: 'name', ...erp, fields: [
    { name: 'accountNum', type: 'string', label: 'Account', mandatory: true, maxLength: 20 },
    { name: 'name', type: 'string', label: 'Name', mandatory: true },
    { name: 'partyId', type: 'reference', label: 'Party', readOnly: true, reference: { table: `${P}_DirPartyTable` } },
    { name: 'email', type: 'string', label: 'Email' },
    { name: 'phone', type: 'string', label: 'Phone' },
  ], indexes: [{ name: 'AccountIdx', fields: ['accountNum'], unique: true }] } as any,
  { kind: 'form', name: `${P}_CustTableForm`, label: 'Customers', table: `${P}_CustTable`, ...erp,
    listFields: ['accountNum', 'name', 'email', 'phone'],
    groups: [{ label: 'General', fields: ['accountNum', 'name', 'partyId'] }, { label: 'Contact', fields: ['email', 'phone'] }] } as any,
  { kind: 'table', name: `${P}_VendTable`, label: 'Vendors', titleField: 'name', ...erp, fields: [
    { name: 'accountNum', type: 'string', label: 'Account', mandatory: true, maxLength: 20 },
    { name: 'name', type: 'string', label: 'Name', mandatory: true },
    { name: 'partyId', type: 'reference', label: 'Party', readOnly: true, reference: { table: `${P}_DirPartyTable` } },
    { name: 'email', type: 'string', label: 'Email' },
    { name: 'phone', type: 'string', label: 'Phone' },
  ], indexes: [{ name: 'AccountIdx', fields: ['accountNum'], unique: true }] } as any,
  { kind: 'form', name: `${P}_VendTableForm`, label: 'Vendors', table: `${P}_VendTable`, ...erp,
    listFields: ['accountNum', 'name', 'email', 'phone'],
    groups: [{ label: 'General', fields: ['accountNum', 'name', 'partyId'] }, { label: 'Contact', fields: ['email', 'phone'] }] } as any,
  { kind: 'privilege', name: 'ERP_SalesOrderProcess', label: 'Process sales orders', ...erp, tablePermissions: [
    { table: `${P}_SalesTable`, read: true, create: true, update: true, delete: true },
    { table: `${P}_SalesLine`, read: true, create: true, update: true, delete: true },
    { table: `${P}_CustTable`, read: true },
    { table: `${P}_DirPartyTable`, read: true },
    { table: `${P}_InventItem`, read: true, update: true },
  ], forms: [`${P}_SalesTableForm`] } as any,
  { kind: 'privilege', name: 'ERP_MasterDataMaintain', label: 'Maintain customers, vendors and items', ...erp, tablePermissions: [
    { table: `${P}_CustTable`, read: true, create: true, update: true, delete: true },
    { table: `${P}_VendTable`, read: true, create: true, update: true, delete: true },
    { table: `${P}_InventItem`, read: true, create: true, update: true, delete: true },
    { table: `${P}_DirPartyTable`, read: true, create: true, update: true, delete: true },
  ], forms: [`${P}_CustTableForm`, `${P}_VendTableForm`, `${P}_InventItemForm`, `${P}_DirPartyTableForm`] } as any,
  { kind: 'privilege', name: 'ERP_UserRoleMaintain', label: 'Maintain app users', ...erp, tablePermissions: [
    { table: 'FW_User', read: true, update: true },
    { table: 'FW_UserRole', read: true, create: true, update: true, delete: true },
  ], forms: ['FW_UserForm'] } as any,
  { kind: 'duty', name: 'ERP_SalesOrderProcessing', label: 'Sales order processing', ...erp, privileges: ['ERP_SalesOrderProcess'] } as any,
  { kind: 'duty', name: 'ERP_MasterDataMaintenance', label: 'Master data maintenance', ...erp, privileges: ['ERP_MasterDataMaintain'] } as any,
  { kind: 'duty', name: 'ERP_AppAdministration', label: 'App administration', ...erp, privileges: ['ERP_UserRoleMaintain'] } as any,
  { kind: 'role', name: 'ERP_SalesManager', label: 'Sales manager', ...erp, duties: ['ERP_SalesOrderProcessing', 'ERP_MasterDataMaintenance', 'ERP_AppAdministration'] } as any,
  { kind: 'role', name: 'ERP_SalesClerk', label: 'Sales clerk', ...erp, duties: ['ERP_SalesOrderProcessing'] } as any,
  { kind: 'role', name: 'ERP_Admin', label: 'Administrator', ...erp, duties: ['ERP_SalesOrderProcessing', 'ERP_MasterDataMaintenance', 'ERP_AppAdministration'] } as any,
  { kind: 'menu', name: 'ERP_MainMenu', label: 'Mini ERP', ...erp, items: [
    { label: 'Sales', items: [{ label: 'Sales orders', form: `${P}_SalesTableForm` }] },
    { label: 'Inventory', items: [{ label: 'Items', form: `${P}_InventItemForm` }] },
    { label: 'Customers', items: [{ label: 'Customers', form: `${P}_CustTableForm` }, { label: 'All parties', form: `${P}_DirPartyTableForm` }] },
    { label: 'Vendors', items: [{ label: 'Vendors', form: `${P}_VendTableForm` }] },
    { label: 'Administration', items: [{ label: 'Users', form: 'FW_UserForm' }] },
  ] } as any,
];

function loadStoredArtifacts(kernel: Kernel): AnyMeta[] {
  const artifacts: AnyMeta[] = [];
  for (const row of kernel.designerContext().select('FW_WebArtifact').toArray()) {
    artifacts.push(JSON.parse(row.f.json as string) as AnyMeta);
  }
  return artifacts;
}

/** Merge framework artifacts with the ERP sample and apply to the kernel (test helper). */
export function applyErpSample(kernel: Kernel): void {
  const erpNames = new Set(erpSampleArtifacts.map((a) => a.name));
  const framework = loadStoredArtifacts(kernel).filter((a) => !erpNames.has(a.name));
  const merged = [...framework, ...erpSampleArtifacts];
  const errors = kernel.applyWebArtifacts(merged);
  if (errors.length > 0) {
    throw new Error(`ERP sample apply failed: ${errors.map((e) => `${e.name}: ${e.error}`).join('; ')}`);
  }

  const dctx = kernel.designerContext();
  for (const art of erpSampleArtifacts) {
    const existing = dctx.select('FW_WebArtifact').whereEq({ name: art.name }).firstOnly();
    const payload = { kind: art.kind, json: JSON.stringify(art) };
    if (existing) {
      existing.setMany(payload);
      existing.update();
    } else {
      dctx.newRecord('FW_WebArtifact').setMany({ ...payload, name: art.name }).insert();
    }
  }

  const ctx = kernel.context();
  const admin = ctx.select('FW_User').whereEq({ username: 'admin' }).firstOnly();
  if (!admin?.f.id) return;
  if (!kernel.registry.getRole('ERP_Admin')) return;
  const exists = ctx
    .select('FW_UserRole')
    .whereEq({ userId: admin.f.id as number })
    .where('role', '=', 'ERP_Admin')
    .firstOnly();
  if (!exists) {
    ctx.newRecord('FW_UserRole').setMany({ userId: admin.f.id as number, username: 'admin', role: 'ERP_Admin' }).insert();
  }
}