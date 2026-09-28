// Run from the repository root with Node 24 after installing workspace dependencies.
// Creates isolated fixtures under ignored .tools; never opens an operator's database.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = resolve('.');
const run = join(root, '.tools', `upgrade140-${Date.now()}`);
const baseline = join(run, 'baseline'); mkdirSync(baseline, { recursive: true });
execFileSync('git', ['archive', '1.3.0', '--format=tar', `--output=${join(run, 'baseline.tar')}`], { cwd: root });
execFileSync('tar', ['-xf', join(run, 'baseline.tar'), '-C', baseline]);
const require = createRequire(join(root, 'package.json'));
const { build } = createRequire(require.resolve('tsx'))('esbuild');
async function bundle(source, name) {
  const outfile = join(run, `${name}.mjs`);
  await build({ stdin: { contents: `export { buildServer } from ${JSON.stringify(join(source, 'packages/server/src/server.ts'))}; export { CORE_VERSION } from ${JSON.stringify(join(source, 'packages/core/src/index.ts'))};`, resolveDir: root, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'workspace-dependencies', setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, args => {
      if (/^[A-Za-z]:/.test(args.path)) return;
      if (args.path === '@emu/core') return { path: join(source, 'packages/core/src/index.ts') };
      if (args.path.startsWith('node:')) return { path: args.path, external: true };
      for (const workspace of ['server', 'core']) {
        try { return { path: pathToFileURL(createRequire(join(root, `packages/${workspace}/package.json`)).resolve(args.path)).href, external: true }; } catch { /* Try the other workspace. */ }
      }
    });
  } }] });
  return import(pathToFileURL(outfile).href);
}
const previous = await bundle(baseline, 'previous'); assert.equal(previous.CORE_VERSION, '1.3.0');
const setupCode = 'ABCDEF123456', password = 'Upgrade-fixture-123';
const fixtureOptions = { dbPath: join(run, 'before.db'), designerDbPath: join(run, 'before-designer.db'), setupCode };
const before = previous.buildServer(fixtureOptions); await before.ready();
const setup = await before.inject({ method: 'POST', url: '/api/setup/complete', payload: { code: setupCode, username: 'upgradeadmin', displayName: 'Upgrade fixture', password } });
assert.equal(setup.statusCode, 200, setup.body);
let auth = { cookie: setup.headers['set-cookie'].split(';')[0] };
const place = { app: 'upgrade', model: 'Base', layer: 'SYS' };
const artifacts = [
  { kind: 'app', name: 'upgrade', label: 'Existing app', models: [{ name: 'Base', layer: 'SYS' }, { name: 'Custom', layer: 'CUS' }] },
  { kind: 'table', name: 'UPGRADE_Row', ...place, fields: [{ name: 'number', type: 'string', readOnly: true }, { name: 'name', type: 'string', mandatory: true }, { name: 'when', type: 'datetime' }] },
  { kind: 'tableExtension', name: 'UPGRADE_Custom_UPGRADE_Row_Extension', ...place, model: 'Custom', layer: 'CUS', table: 'UPGRADE_Row', fields: [{ name: 'local', type: 'string' }] },
  { kind: 'script', name: 'UPGRADE_Defaults', ...place, code: "kernel.hooks.register('UPGRADE_Row', { initValue(rec) { rec.set('number', 'SO-DEFAULT'); } });" },
  { kind: 'form', name: 'UPGRADE_Form', ...place, table: 'UPGRADE_Row' },
  { kind: 'menu', name: 'UPGRADE_Menu', ...place, items: [{ id: 'rows', label: 'Rows', form: 'UPGRADE_Form' }] },
];
for (const artifact of artifacts) {
  const result = await before.inject({ method: 'PUT', url: `/api/designer/artifacts/${artifact.kind}/${artifact.name}`, headers: auth, payload: artifact }); assert.equal(result.statusCode, 200, result.body);
}
const created = await before.inject({ method: 'POST', url: '/api/data/UPGRADE_Row', headers: auth, payload: { name: 'retained', local: 'CUS value', when: '2026-08-15T15:52:39' } }); assert.equal(created.statusCode, 201, created.body);
await before.inject({ method: 'POST', url: '/api/navigation/recent', headers: auth, payload: { menuName: 'UPGRADE_Menu', itemId: 'rows' } });
await before.inject({ method: 'PUT', url: '/api/navigation/favorites/UPGRADE_Menu/rows', headers: auth, payload: { favorite: true } });
const legacyPackage = (await before.inject({ url: '/api/designer/packages/app/upgrade/export', headers: auth })).json();
assert.equal(legacyPackage.frameworkVersion, '1.3.0');
await before.close();
const options = { ...fixtureOptions, dbPath: join(run, 'after.db'), designerDbPath: join(run, 'after-designer.db') };
copyFileSync(fixtureOptions.dbPath, options.dbPath); copyFileSync(fixtureOptions.designerDbPath, options.designerDbPath);
const current = await bundle(root, 'current'); assert.equal(current.CORE_VERSION, '1.4.0');
const after = current.buildServer(options); await after.ready();
const login = await after.inject({ method: 'POST', url: '/api/login', payload: { username: 'upgradeadmin', password } }); assert.equal(login.statusCode, 200, login.body);
auth = { cookie: login.headers['set-cookie'].split(';')[0] };
const row = (await after.inject({ url: `/api/data/UPGRADE_Row/${created.json().id}`, headers: auth })).json();
assert.equal(row.name, 'retained'); assert.equal(row.local, 'CUS value'); assert.equal(row.when, '2026-08-15T15:52:39');
assert.equal(row.createdAt, created.json().createdAt); assert.equal(row.sys_createdBy, row.createdBy); assert.equal(row.sys_createdAt, row.createdAt);
const preferences = (await after.inject({ url: '/api/navigation/preferences', headers: auth })).json(); assert.equal(preferences.recent[0].app, 'upgrade'); assert.equal(preferences.favorites.length, 1);
const draftResponse = await after.inject({ method: 'POST', url: '/api/data/UPGRADE_Row/drafts', headers: auth, payload: {} }); assert.equal(draftResponse.statusCode, 200, draftResponse.body);
const draft = draftResponse.json(); assert.equal(draft.record.number, 'SO-DEFAULT');
await after.close();
const restarted = current.buildServer(options); await restarted.ready();
const saved = await restarted.inject({ method: 'POST', url: `/api/data/UPGRADE_Row/drafts/${draft.token}/save`, headers: auth, payload: { name: 'after restart', local: 'new CUS value' } }); assert.equal(saved.statusCode, 201, saved.body); assert.equal(saved.json().number, 'SO-DEFAULT');
const boundary = 'upgrade140';
const preview = await restarted.inject({ method: 'POST', url: '/api/designer/packages/import/preview', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="legacy.json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(legacyPackage)}\r\n--${boundary}--\r\n`) }); assert.equal(preview.statusCode, 200, preview.body);
await restarted.close();
assert.ok(existsSync(fixtureOptions.dbPath));
const result = { baseline: previous.CORE_VERSION, current: current.CORE_VERSION, passed: true, checks: ['login', 'original business/audit/datetime data', 'CUS extension', 'existing initValue script', 'recent/favorites', 'legacy package preview', 'encrypted draft survives restart'], fixtureDirectory: run };
writeFileSync(join(run, 'verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
