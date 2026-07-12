/** Thin fetch wrapper for the framework REST API. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const payload = (await res.json()) as { error?: string; diagnostics?: { path?: string; message?: string }[]; errors?: { name?: string; error?: string }[] };
      message = payload.error ?? message;
      const details = payload.diagnostics?.map((d) => `${d.path ?? '/'}: ${d.message ?? 'Invalid value'}`) ?? payload.errors?.map((d) => `${d.name ?? 'artifact'}: ${d.error ?? 'Invalid'}`);
      if (details?.length) message += `\n${details.join('\n')}`;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export type Row = { id: number; [field: string]: unknown };

export async function requestForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: form, credentials: 'same-origin' });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export interface ImportPreview {
  columns: string[];
  suggestedMapping: { column: string; field: string | null }[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
}

export interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  failed: { row: number; error: string }[];
}

export interface MetadataPackagePreview {
  previewId: string;
  expiresAt: string;
  valid: boolean;
  destructive: boolean;
  diff: { op: 'create' | 'update' | 'delete'; kind: string; name: string; highRisk?: boolean }[];
  diagnostics: { path: string; code: string; message: string }[];
  warnings?: { path: string; code: string; message: string }[];
  package: {
    scope: { type: 'app'; app: string } | { type: 'model'; app: string; model: string };
    frameworkVersion: string;
    exportedAt: string;
    artifactCount: number;
  };
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),

  list: (table: string, params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    ).toString();
    return request<{ data: Row[]; total: number }>('GET', `/api/data/${table}${qs ? `?${qs}` : ''}`);
  },

  /** Triggers a browser download of the table's data (current sort/filter can be passed via params). */
  exportUrl: (table: string, format: 'csv' | 'xlsx', params: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ format, ...params }).toString();
    return `/api/data/${table}/export?${qs}`;
  },

  importPreview: (table: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return requestForm<ImportPreview>(`/api/data/${table}/import/preview`, form);
  },

  importCommit: (table: string, file: File, mapping: Record<string, string>, mode: 'insert' | 'upsert', keyField?: string) => {
    const form = new FormData();
    form.append('mapping', JSON.stringify(mapping));
    form.append('mode', mode);
    if (keyField) form.append('keyField', keyField);
    form.append('file', file);
    return requestForm<ImportResult>(`/api/data/${table}/import/commit`, form);
  },

  metadataPackagePreview: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return requestForm<MetadataPackagePreview>('/api/designer/packages/import/preview', form);
  },

  validateSystemBackup: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return requestForm<{ ok: boolean; manifest: { frameworkVersion: string; createdAt: string; files: { name: string; bytes: number }[] } }>(
      '/api/system/backup/validate', form,
    );
  },
};
