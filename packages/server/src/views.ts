import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { stringify } from 'csv-stringify/sync';
import { SecurityError, ValidationError, type DataContext, type FieldMeta, type Kernel, type ViewMeta } from '@emu/core';

interface ViewRouteDeps {
  userCtx(req: FastifyRequest): DataContext;
  requireAdmin(req: FastifyRequest): string;
  csvMaxRows: number;
}

type QueryValue = string | number | boolean | null;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function viewTables(view: ViewMeta): string[] {
  return [view.source.table, ...(view.joins ?? []).map((join) => join.table)];
}

function fieldMap(kernel: Kernel, view: ViewMeta): Map<string, FieldMeta | { name: string; type: 'int' }> {
  const output = new Map<string, FieldMeta | { name: string; type: 'int' }>();
  const sources = [view.source, ...(view.joins ?? []).map((join) => ({ table: join.table, alias: join.alias }))];
  for (const source of sources) {
    output.set(`${source.alias}.id`, { name: 'id', type: 'int' });
    for (const field of kernel.registry.getTable(source.table).fields) output.set(`${source.alias}.${field.name}`, field);
  }
  return output;
}

function convertParameter(type: string, value: string): QueryValue {
  if (!value.trim()) throw new ValidationError('View parameter cannot be blank');
  switch (type) {
    case 'int': {
      const converted = Number(value);
      if (!Number.isInteger(converted)) throw new ValidationError(`Expected an integer parameter, received '${value}'`);
      return converted;
    }
    case 'real': {
      const converted = Number(value);
      if (!Number.isFinite(converted)) throw new ValidationError(`Expected a numeric parameter, received '${value}'`);
      return converted;
    }
    case 'boolean':
      if (!['true', 'false', '1', '0'].includes(value.toLowerCase())) throw new ValidationError(`Expected a boolean parameter, received '${value}'`);
      return value === '1' || value.toLowerCase() === 'true' ? 1 : 0;
    case 'date': {
      const parsed = Date.parse(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
        throw new ValidationError(`Expected an ISO date parameter, received '${value}'`);
      }
      return value;
    }
    case 'datetime':
      if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new ValidationError(`Expected an ISO datetime parameter, received '${value}'`);
      return new Date(value).toISOString();
    default:
      return value;
  }
}

function compile(
  kernel: Kernel,
  view: ViewMeta,
  query: Record<string, string | undefined>,
  rowScope?: (table: string) => { field: string; value: string } | undefined,
  requireParameters = true,
): { sql: string; parameters: QueryValue[]; schema: Array<{ name: string; label: string; type: string }>; supplied: Map<string, QueryValue> } {
  const fields = fieldMap(kernel, view);
  const supplied = new Map<string, QueryValue>();
  for (const parameter of view.parameters ?? []) {
    const raw = query[`param.${parameter.name}`];
    if (raw === undefined || raw === '') {
      if (parameter.required && requireParameters) throw new ValidationError(`Required View parameter '${parameter.name}' is missing`);
      continue;
    }
    supplied.set(parameter.name, convertParameter(parameter.type, raw));
  }
  const ref = (name: string) => {
    if (!fields.has(name)) throw new ValidationError(`Unknown View field '${name}'`);
    const [alias, field] = name.split('.');
    return `${quote(alias!)}.${quote(field!)}`;
  };
  const schema = view.columns.map((column) => {
    const expression = column.expression;
    let type = 'string';
    if (expression.type === 'field') type = fields.get(expression.ref)?.type ?? 'string';
    else if (expression.fn === 'count') type = 'int';
    else if (expression.fn === 'avg') type = 'real';
    else if (expression.ref) type = fields.get(expression.ref)?.type ?? 'real';
    return { name: column.name, label: column.label ?? column.name, type };
  });
  const select = view.columns.map((column) => {
    const expression = column.expression;
    const sql = expression.type === 'field'
      ? ref(expression.ref)
      : `${expression.fn.toUpperCase()}(${expression.ref ? ref(expression.ref) : '*'})`;
    return `${sql} AS ${quote(column.name)}`;
  }).join(', ');
  let sql = `SELECT ${select} FROM ${quote(view.source.table)} AS ${quote(view.source.alias)}`;
  for (const join of view.joins ?? []) {
    sql += ` ${join.type.toUpperCase()} JOIN ${quote(join.table)} AS ${quote(join.alias)} ON `;
    sql += join.on.map((condition) => `${ref(condition.left)} = ${ref(condition.right)}`).join(' AND ');
  }
  const parameters: QueryValue[] = [];
  const where: string[] = [];
  const operators: Record<string, string> = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
  for (const filter of view.filters ?? []) {
    let value: QueryValue | QueryValue[] | undefined;
    if (typeof filter.value === 'object' && filter.value !== null && !Array.isArray(filter.value) && 'parameter' in filter.value) {
      const parameterName = filter.value.parameter;
      const parameter = (view.parameters ?? []).find((entry) => entry.name === parameterName)!;
      const raw = query[`param.${parameter.name}`];
      if (raw === undefined || raw === '') continue;
      value = filter.operator === 'in' ? raw.split(',').map((entry) => convertParameter(parameter.type, entry.trim())) : supplied.get(parameter.name);
    } else value = filter.value;
    if (filter.operator === 'in') {
      const values = Array.isArray(value) ? value : [];
      if (values.length === 0) where.push('0=1');
      else { where.push(`${ref(filter.ref)} IN (${values.map(() => '?').join(',')})`); parameters.push(...values); }
    } else if (filter.operator === 'contains') {
      where.push(`${ref(filter.ref)} LIKE ? ESCAPE '\\'`);
      parameters.push(`%${String(value ?? '').replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);
    } else if (value === null && filter.operator === 'eq') where.push(`${ref(filter.ref)} IS NULL`);
    else if (value === null && filter.operator === 'ne') where.push(`${ref(filter.ref)} IS NOT NULL`);
    else { where.push(`${ref(filter.ref)} ${operators[filter.operator]} ?`); parameters.push(value as QueryValue); }
  }
  if (rowScope) {
    for (const source of [view.source, ...(view.joins ?? []).map((join) => ({ table: join.table, alias: join.alias }))]) {
      const scope = rowScope(source.table);
      if (!scope) continue;
      const scopedRef = `${source.alias}.${scope.field}`;
      if (!fields.has(scopedRef)) throw new SecurityError(`Invalid row scope for '${source.table}'`);
      where.push(`${ref(scopedRef)} = ?`);
      parameters.push(scope.value);
    }
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  if (view.groupBy?.length) sql += ` GROUP BY ${view.groupBy.map(ref).join(', ')}`;
  if (view.orderBy?.length) sql += ` ORDER BY ${view.orderBy.map((order) => `${quote(order.column)} ${(order.direction ?? 'asc').toUpperCase()}`).join(', ')}`;
  return { sql, parameters, schema, supplied };
}

export function registerViewRoutes(app: FastifyInstance, kernel: Kernel, deps: ViewRouteDeps): void {
  const tokenAuthorization = (req: FastifyRequest, viewName: string): boolean => {
    const auth = req.headers.authorization;
    if (!auth) return false;
    if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('Bearer token required'), { statusCode: 401 });
    const presented = auth.slice(7).trim();
    const token = kernel.db.prepare(`SELECT id,enabled,expiresAt,revokedAt FROM "FW_ViewToken" WHERE tokenHash=?`).get(hashToken(presented)) as { id: number; enabled: number; expiresAt?: string; revokedAt?: string } | undefined;
    if (!token || !token.enabled || token.revokedAt || (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now())) {
      throw Object.assign(new Error('Invalid or expired View token'), { statusCode: 401 });
    }
    if (!kernel.db.prepare('SELECT 1 FROM "FW_ViewTokenScope" WHERE tokenId=? AND viewName=?').get(token.id, viewName)) {
      throw new SecurityError(`View token is not scoped for '${viewName}'`);
    }
    kernel.db.prepare('UPDATE "FW_ViewToken" SET lastUsedAt=CURRENT_TIMESTAMP,modifiedAt=CURRENT_TIMESTAMP,modifiedBy=? WHERE id=?').run('service-token', token.id);
    return true;
  };
  const authorize = (req: FastifyRequest, view: ViewMeta) => {
    const external = tokenAuthorization(req, view.name);
    if (external) return { external, ctx: undefined as DataContext | undefined };
    const ctx = deps.userCtx(req);
    if (!ctx.policy.canView(view.name)) throw new SecurityError(`Access denied: view '${view.name}'`);
    for (const table of viewTables(view)) if (!ctx.policy.can(table, 'read')) throw new SecurityError(`Access denied: table '${table}'`);
    return { external, ctx };
  };
  const viewFor = (name: string) => {
    if (!kernel.registry.hasView(name)) throw Object.assign(new Error(`Unknown view '${name}'`), { statusCode: 404 });
    return kernel.registry.getView(name);
  };
  const queryOf = (req: FastifyRequest) => {
    const raw = req.query as Record<string, unknown>;
    const query: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value !== undefined && typeof value !== 'string') throw new ValidationError(`Query parameter '${key}' must be supplied once`);
      query[key] = value;
    }
    return query;
  };
  const boundedInteger = (value: string | undefined, fallback: number, minimum: number, maximum: number) => {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(Math.trunc(parsed), maximum));
  };

  app.get<{ Params: { name: string } }>('/api/views/:name/schema', (req) => {
    const view = viewFor(req.params.name);
    const auth = authorize(req, view);
    const compiled = compile(kernel, view, queryOf(req), auth.ctx?.policy.rowScope, false);
    return { name: view.name, label: view.label ?? view.name, columns: compiled.schema, parameters: view.parameters ?? [] };
  });

  app.get<{ Params: { name: string } }>('/api/views/:name/data', (req) => {
    const view = viewFor(req.params.name);
    const auth = authorize(req, view);
    const query = queryOf(req);
    const compiled = compile(kernel, view, query, auth.ctx?.policy.rowScope);
    const limit = boundedInteger(query.limit, 1000, 1, 10_000);
    const offset = boundedInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const data = kernel.db.prepare(`${compiled.sql} LIMIT ? OFFSET ?`).all(...compiled.parameters, limit, offset);
    return { schema: compiled.schema, data, limit, offset, hasMore: data.length === limit };
  });

  app.get<{ Params: { name: string } }>('/api/views/:name/export', (req, reply) => {
    const view = viewFor(req.params.name);
    const auth = authorize(req, view);
    const query = queryOf(req);
    if ((query.format ?? 'csv').toLowerCase() !== 'csv') throw new ValidationError('Only CSV export is supported');
    const compiled = compile(kernel, view, query, auth.ctx?.policy.rowScope);
    const data = kernel.db.prepare(`${compiled.sql} LIMIT ?`).all(...compiled.parameters, deps.csvMaxRows);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${view.name}.csv"`);
    return '\uFEFF' + stringify(data, { header: true, columns: compiled.schema.map((column) => ({ key: column.name, header: column.label })) });
  });

  app.get<{ Params: { name: string } }>('/api/charts/:name', (req) => {
    const chart = kernel.registry.getChart(req.params.name);
    const view = viewFor(chart.view);
    // Service tokens are deliberately limited to /api/views/* endpoints.
    const ctx = deps.userCtx(req);
    if (!ctx.policy.canChart(chart.name) || !ctx.policy.canView(view.name)) throw new SecurityError(`Access denied: chart '${chart.name}'`);
    for (const table of viewTables(view)) if (!ctx.policy.can(table, 'read')) throw new SecurityError(`Access denied: table '${table}'`);
    return chart;
  });

  app.get('/api/system/view-tokens', (req) => {
    deps.requireAdmin(req);
    const tokens = kernel.db.prepare('SELECT id,name,enabled,expiresAt,lastUsedAt,revokedAt,createdAt,createdBy FROM "FW_ViewToken" ORDER BY id DESC').all() as Array<Record<string, unknown> & { id: number }>;
    return { data: tokens.map((token) => ({ ...token, enabled: Boolean(token.enabled), views: (kernel.db.prepare('SELECT viewName FROM "FW_ViewTokenScope" WHERE tokenId=? ORDER BY viewName').all(token.id) as { viewName: string }[]).map((scope) => scope.viewName) })) };
  });

  app.post<{ Body: { name?: string; views?: string[]; expiresAt?: string | null } }>('/api/system/view-tokens', (req, reply) => {
    const actor = deps.requireAdmin(req);
    const name = String(req.body?.name ?? '').trim();
    const views = [...new Set((req.body?.views ?? []).map(String))];
    if (!name) throw new ValidationError('Token name is required');
    if (!views.length) throw new ValidationError('At least one View scope is required');
    for (const view of views) if (!kernel.registry.hasView(view)) throw new ValidationError(`Unknown view '${view}'`);
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) throw new ValidationError('Token expiry must be a valid future date');
    const secret = `emu_view_${randomBytes(32).toString('base64url')}`;
    const id = kernel.db.transaction(() => {
      const result = kernel.db.prepare(`INSERT INTO "FW_ViewToken" (createdAt,createdBy,modifiedAt,modifiedBy,name,tokenHash,enabled,expiresAt) VALUES (CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,?,?,?,1,?)`)
        .run(actor, actor, name, hashToken(secret), expiresAt?.toISOString() ?? null);
      const tokenId = Number(result.lastInsertRowid);
      const insertScope = kernel.db.prepare(`INSERT INTO "FW_ViewTokenScope" (createdAt,createdBy,modifiedAt,modifiedBy,tokenId,viewName) VALUES (CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,?,?,?)`);
      for (const view of views) insertScope.run(actor, actor, tokenId, view);
      return tokenId;
    })();
    reply.status(201);
    return { id, name, views, expiresAt: expiresAt?.toISOString() ?? null, token: secret };
  });

  app.post<{ Params: { id: string } }>('/api/system/view-tokens/:id/revoke', (req) => {
    const actor = deps.requireAdmin(req);
    const result = kernel.db.prepare(`UPDATE "FW_ViewToken" SET enabled=0,revokedAt=CURRENT_TIMESTAMP,modifiedAt=CURRENT_TIMESTAMP,modifiedBy=? WHERE id=? AND revokedAt IS NULL`).run(actor, Number(req.params.id));
    if (!result.changes) throw Object.assign(new Error('View token not found or already revoked'), { statusCode: 404 });
    return { ok: true };
  });
}
