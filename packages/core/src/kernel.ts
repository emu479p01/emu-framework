import DatabaseCtor from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MetadataRegistry } from './metadata/registry.js';
import type { AnyMeta, AppManifest } from './metadata/types.js';
import { LAYER_ORDER } from './metadata/types.js';
import { syncSchema, type SyncResult } from './db/schemaSync.js';
import { ValidationError } from './data/hooks.js';
import { DataEventCancelled, EventBus } from './data/events.js';
import { HookRegistry } from './data/hooks.js';
import { DataContext, type SessionInfo } from './data/context.js';
import { allowAll, type SecurityPolicy } from './security/policy.js';

export type ActionHandler = (ctx: DataContext, args: { [key: string]: unknown }) => unknown;

type BootStep =
  | { kind: 'dir'; dir: string }
  | { kind: 'app'; manifest: AppManifest; artifacts: AnyMeta[] };

export interface WebArtifactError {
  kind: string;
  name: string;
  error: string;
}

const WEB_KIND_ORDER = [
  'app', 'enum', 'table', 'privilege', 'duty', 'role', 'script',
  'tableExtension', 'enumExtension', 'form', 'formExtension',
  'menu', 'menuExtension', 'privilegeExtension', 'dutyExtension',
  'roleExtension', 'scriptExtension',
];

/**
 * Boot-time container: holds data database, designer database, metadata registry,
 * and shared event/hook registries.
 */
export class Kernel {
  readonly db: Database;
  readonly designerDb: Database;
  readonly events = new EventBus();
  readonly hooks = new HookRegistry();
  readonly actions = new Map<string, ActionHandler>();

  private _registry = new MetadataRegistry();
  private bootSteps: BootStep[] = [];
  private _webArtifacts: AnyMeta[] = [];
  /** TS-registered logic (system hooks etc.) — re-applied after every web-script rebuild. */
  private nativeLogic: ((kernel: Kernel) => void)[] = [];

  constructor(dbPath = ':memory:', designerDbPath?: string) {
    this.db = new DatabaseCtor(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    const ddp = designerDbPath ?? (dbPath === ':memory:' ? ':memory:' : dbPath.replace(/\.sqlite$|\.db$/i, '.designer.sqlite'));
    this.designerDb = new DatabaseCtor(ddp);
    this.designerDb.pragma('journal_mode = WAL');
  }

  get registry(): MetadataRegistry { return this._registry; }
  get webArtifacts(): AnyMeta[] { return this._webArtifacts; }

  loadAppFromDir(appDir: string): void {
    if (this.bootSteps.some((s) => s.kind === 'dir' && s.dir === appDir)) return;
    this._registry.loadAppFromDir(appDir);
    this.bootSteps.push({ kind: 'dir', dir: appDir });
  }

  /** Force reload of any file-based apps recorded in bootSteps (idempotent). */
  reloadFileApps(): void {
    for (const step of this.bootSteps) {
      if (step.kind === 'dir') {
        try {
          this._registry.loadAppFromDir(step.dir);
        } catch {
          // will surface on next apply
        }
      }
    }
  }

  /** Discover apps/ folder relative to cwd and load any new ones. */
  discoverAndLoadApps(): void {
    try {
      const appsRoot = join(process.cwd(), 'apps');
      if (!existsSync(appsRoot)) return;
      for (const entry of readdirSync(appsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(appsRoot, entry.name);
        const manifest = join(dir, 'app.json');
        if (existsSync(manifest)) {
          try { this.loadAppFromDir(dir); } catch {}
        }
      }
    } catch {}
  }

  registerApp(manifest: AppManifest, artifacts: AnyMeta[]): void {
    this._registry.registerApp(manifest, artifacts);
    this.bootSteps.push({ kind: 'app', manifest, artifacts });
  }

  /** Register TS logic (hooks/events/actions) that survives web-artifact rebuilds. */
  registerNativeLogic(fn: (kernel: Kernel) => void): void {
    this.nativeLogic.push(fn);
    fn(this);
  }

  /** Sync data DB schema. */
  sync(): SyncResult {
    return syncSchema(this.db, this._registry);
  }

  /** Sync designer DB for FW_WebArtifact table. */
  syncDesigner(): SyncResult {
    return syncSchema(this.designerDb, this._registry, { onlyTable: 'FW_WebArtifact' });
  }

  /**
   * Drop business tables from the data DB — only tables that are no longer in
   * the registry (i.e. their metadata was deleted). Used when deleting an app
   * from the Designer so its data doesn't linger. System tables are refused.
   */
  dropTables(names: string[]): string[] {
    const dropped: string[] = [];
    for (const name of names) {
      if (name.startsWith('FW_')) continue; // never drop framework tables
      if (this._registry.hasTable(name)) continue; // still defined — keep
      this.db.exec(`DROP TABLE IF EXISTS "${name}"`);
      dropped.push(name);
    }
    return dropped;
  }

  appForArtifact(name: string): string | undefined {
    return this._registry.appForArtifact(name);
  }

  modulesForApp(appName: string): string[] {
    return this._registry.modulesForApp(appName);
  }

  /**
   * Replace the runtime web layer: rebuilds registry, syncs data DB (business tables
   * only - no FW_WebArtifact) and designer DB (FW_WebArtifact only).
   */
  applyWebArtifacts(artifacts: AnyMeta[]): WebArtifactError[] {
    const raw = artifacts as (AnyMeta & { app?: string })[];
    const sorted = [...raw].sort((a, b) => {
      const ak = WEB_KIND_ORDER.indexOf(a.kind);
      const bk = WEB_KIND_ORDER.indexOf(b.kind);
      if (ak !== bk) return ak - bk;
      // Within same kind, sort by layer (SYS first, CUS last — so higher layers override)
      const al = LAYER_ORDER.indexOf((a as any).layer ?? 'SYS');
      const bl = LAYER_ORDER.indexOf((b as any).layer ?? 'SYS');
      return al - bl;
    });

    const appManifests: AppManifest[] = [];
    const regular: (AnyMeta & { app?: string })[] = [];
    const appArtifacts = new Map<string, AnyMeta[]>();
    const appLabels = new Map<string, string>();
    const appManifestByName = new Map<string, AppManifest>();

    // file-app names from boot steps
    const fileAppNames = new Set<string>();
    for (const step of this.bootSteps) {
      if (step.kind === 'app') fileAppNames.add(step.manifest.name);
    }
    {
      const tmp = new MetadataRegistry();
      for (const step of this.bootSteps) {
        if (step.kind === 'dir') { try { tmp.loadAppFromDir(step.dir); } catch { /* skip */ } }
      }
      for (const app of tmp.loadedApps()) fileAppNames.add(app.name);
    }

    for (const art of sorted) {
      if ((art as any).kind === 'app') {
        const m = art as any as AppManifest;
        if (!(m as any).name) continue;
        appManifests.push(m as any);
        appManifestByName.set((m as any).name, m as any);
        if ((m as any).label) appLabels.set((m as any).name, (m as any).label);
      } else {
        regular.push(art);
      }
    }

    for (const art of regular) {
      const target = art.app ?? 'web';
      const group = appArtifacts.get(target) ?? [];
      group.push(art);
      appArtifacts.set(target, group);
    }
    for (const m of appManifests) {
      if (!appArtifacts.has(m.name)) appArtifacts.set(m.name, []);
    }

    const build = (acceptedAppArtifacts: Map<string, AnyMeta[]>): MetadataRegistry => {
      const fresh = new MetadataRegistry();
      for (const step of this.bootSteps) {
        if (step.kind === 'dir') fresh.loadAppFromDir(step.dir);
        else fresh.registerApp(step.manifest, step.artifacts);
      }
      const names = [...new Set([...appArtifacts.keys()])].sort((a, b) => {
        if (a === 'system') return -1;
        if (b === 'system') return 1;
        return a.localeCompare(b);
      });
      for (const appName of names) {
        const artifacts = (acceptedAppArtifacts.get(appName) ?? []).map((a) => ({ ...a } as AnyMeta));
        // an app with a declared manifest must register even while empty —
        // otherwise a freshly created app never reaches loadedApps()/the Designer
        const hasManifest = appManifestByName.has(appName);
        if (artifacts.length === 0 && (!hasManifest || fileAppNames.has(appName))) continue;
        if (fileAppNames.has(appName)) {
          fresh.registerWebArtifacts(appName, artifacts);
        } else {
          fresh.registerApp(appManifestByName.get(appName) ?? { name: appName, label: appLabels.get(appName) ?? appName }, artifacts);
        }
      }
      return fresh;
    };

    const accepted = new Map<string, AnyMeta[]>();
    const errors: WebArtifactError[] = [];
    const scriptsFor = (source: Map<string, AnyMeta[]>): (AnyMeta & { app?: string; code?: string; name: string })[] =>
      [...source.values()]
        .flat()
        .filter((a) => (a as any).kind === 'script' || (a as any).kind === 'scriptExtension') as any;
    let remaining = [...regular];
    // Retry loop — accept artifacts whose dependencies are already satisfied
    while (remaining.length > 0) {
      const next: (AnyMeta & { app?: string })[] = [];
      for (const art of remaining) {
        const target = art.app ?? 'web';
        const cur = [...(accepted.get(target) ?? []), art];
        const candidate = new Map(accepted);
        candidate.set(target, cur);
        try {
          build(candidate);
          accepted.set(target, cur);
        } catch (err) {
          next.push(art);
        }
      }
      if (next.length === remaining.length) {
        // No progress — report remaining as errors
        for (const art of next) {
          const target = art.app ?? 'web';
          const cur = [...(accepted.get(target) ?? []), art];
          const candidate = new Map(accepted);
          candidate.set(target, cur);
          try {
            build(candidate);
          } catch (err) {
            errors.push({ kind: art.kind, name: art.name, error: err instanceof Error ? err.message : String(err) });
          }
        }
        break;
      }
      remaining = next;
    }

    const final = build(accepted);
    // Sync data DB for all tables EXCEPT FW_WebArtifact
    {
      const result: SyncResult = { createdTables: [], addedColumns: [] };
      for (const table of final.allTables()) {
        if (table.name === 'FW_WebArtifact') continue;
        syncSchema(this.db, final, { onlyTable: table.name });
      }
    }
    // Sync designer DB for FW_WebArtifact only
    this.syncDesigner();
    this._registry = final;
    this._webArtifacts = regular.map((a) => ({ ...a } as AnyMeta));

    // Execute web scripts — clear and rebuild event/hook/action registrations
    this.events.clear();
    this.hooks.clear();
    this.actions.clear();
    // native (TypeScript) logic must survive web-script rebuilds — e.g. the
    // FW_User password-hashing hook; without this any Designer save wipes it
    for (const fn of this.nativeLogic) fn(this);
    this.executeWebScripts(scriptsFor(accepted), errors);

    return errors;
  }

  /** Run accepted `script` artifacts via new Function() sandbox. */
  private executeWebScripts(
    scripts: (AnyMeta & { name: string; code?: string })[],
    errors: WebArtifactError[],
  ): void {
    for (const a of scripts) {
      if (!a.code) continue;
      try {
        const fn = new Function('kernel', 'ValidationError', 'DataEventCancelled', a.code);
        fn(this, ValidationError, DataEventCancelled);
      } catch (err) {
        errors.push({
          kind: 'script',
          name: a.name ?? 'unnamed',
          error: `Script '${a.name}': ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  /** DataContext connected to the data database. */
  context(session: SessionInfo = { user: 'system' }, policy: SecurityPolicy = allowAll): DataContext {
    return new DataContext(this.db, this.registry, session, this.events, this.hooks, policy);
  }

  /** DataContext connected to the designer database. */
  designerContext(): DataContext {
    return new DataContext(this.designerDb, this.registry, { user: 'system' }, this.events, this.hooks, allowAll);
  }
}
