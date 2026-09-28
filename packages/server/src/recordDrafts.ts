import { createHash, randomUUID } from 'node:crypto';
import { Record as DataRecord, SecurityError, type DataContext, type FieldValue, type Kernel } from '@emu/core';

type Values = { [field: string]: FieldValue };
interface Draft { token: string; owner: string; tableName: string; revision: string; expiresAt: number; snapshot: string; recordId: number | null }
/** Encrypted snapshots live in the business DB so consuming a token and inserting are atomic. */
export function recordDrafts(kernel: Kernel) {
  kernel.db.exec(`CREATE TABLE IF NOT EXISTS FW_RecordDraft (
    token TEXT PRIMARY KEY, owner TEXT NOT NULL, tableName TEXT NOT NULL,
    revision TEXT NOT NULL, expiresAt INTEGER NOT NULL, snapshot TEXT NOT NULL, recordId INTEGER
  )`);
  const revision = () => createHash('sha256').update(JSON.stringify([
    kernel.registry.allTables(), kernel.registry.allScripts(), kernel.registry.allFunctions(),
    kernel.registry.loadedApps().flatMap(app => (app.models ?? []).flatMap(model => kernel.registry.modelArtifacts(app.name, model.name))),
  ])).digest('hex');
  const assertCreate = (ctx: DataContext, table: string) => {
    if (!ctx.policy.can(table, 'create')) throw new SecurityError(`Access denied: create on '${table}'`);
    kernel.assertArtifactWritable(table);
  };
  return {
    create(ctx: DataContext, table: string, initial: Values = {}) {
      assertCreate(ctx, table);
      return ctx.tts(() => {
        kernel.db.prepare('DELETE FROM FW_RecordDraft WHERE expiresAt < ?').run(Date.now());
        const rec = ctx.newRecord(table, initial);
        const token = randomUUID(), expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        kernel.db.prepare('INSERT INTO FW_RecordDraft VALUES (?,?,?,?,?,?,NULL)').run(token, ctx.session.user, table, revision(), expiresAt, kernel.fieldEncryption.encrypt(JSON.stringify(rec.toObject())));
        return { token, expiresAt: new Date(expiresAt).toISOString(), record: rec.toObject() };
      });
    },
    save(ctx: DataContext, table: string, token: string, values: Values) {
      assertCreate(ctx, table);
      return ctx.tts(() => {
        const draft = kernel.db.prepare('SELECT * FROM FW_RecordDraft WHERE token=? AND owner=? AND tableName=?').get(token, ctx.session.user, table) as Draft | undefined;
        if (!draft || draft.expiresAt < Date.now()) throw Object.assign(new Error('Draft expired or unavailable. Open a new draft; your entered values have not been saved.'), { statusCode: 409 });
        if (draft.recordId !== null) {
          const saved = ctx.find(table, draft.recordId);
          if (!saved) throw Object.assign(new Error('The saved draft record is no longer available.'), { statusCode: 409 });
          return saved.toObject();
        }
        if (draft.revision !== revision()) throw Object.assign(new Error('Metadata changed. Open a new draft before saving; keep your entered values.'), { statusCode: 409 });
        const rec = new DataRecord(ctx, kernel.registry.getTable(table)).setMany(JSON.parse(kernel.fieldEncryption.decrypt(draft.snapshot)) as Values).setMany(values);
        rec.insert();
        kernel.db.prepare("UPDATE FW_RecordDraft SET recordId=?,snapshot='' WHERE token=?").run(rec.id, token);
        return rec.toObject();
      });
    },
  };
}
