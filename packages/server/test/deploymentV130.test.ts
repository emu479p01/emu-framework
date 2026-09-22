import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateKeyPairSync, sign } from 'node:crypto';
import { licenseBytes, type Kernel, type AnyMeta, type MetadataArtifact } from '@emu/core';
import { buildServer } from '../src/server.js';
import { loadStoredArtifacts, persistStoredArtifacts } from '../src/designer.js';
import { createMetadataPackage, modelPackageOperations, type MetadataPackage } from '../src/metadataPackage.js';
import { completeTestSetup, TEST_SETUP_CODE, TEST_ADMIN_PASSWORD } from './setupHelper.js';

const manifest: MetadataArtifact = { kind:'app',name:'sample',label:'Production label',models:[{name:'Base',layer:'SYS'},{name:'Custom',layer:'CUS'},{name:'Dev',layer:'DEV'}] };
const artifacts: MetadataArtifact[] = [manifest,
  {kind:'table',name:'SAMPLE_Row',app:'sample',model:'Base',layer:'SYS',fields:[{name:'code',type:'string'}]},
  {kind:'form',name:'SAMPLE_RowForm',app:'sample',model:'Base',layer:'SYS',table:'SAMPLE_Row',listFields:['code']},
  {kind:'tableExtension',name:'SAMPLE_Custom_SAMPLE_Row_Extension',app:'sample',model:'Custom',layer:'CUS',table:'SAMPLE_Row',fields:[{name:'extra',type:'string'}]},
  {kind:'enum',name:'SAMPLE_DevEnum',app:'sample',model:'Dev',layer:'DEV',values:[{name:'Old',value:0}]},
];
function upload(pkg: MetadataPackage) {
  const boundary='----deploy130';
  return { headers:{'content-type':`multipart/form-data; boundary=${boundary}`}, payload:Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="app.json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(pkg)}\r\n--${boundary}--\r\n`) };
}
describe('v1.3 selected-model deployments and licensing administration', () => {
  let app: FastifyInstance, kernel: Kernel, auth: { cookie: string };
  beforeEach(async () => {
    app=buildServer({setupCode:TEST_SETUP_CODE}); await app.ready(); await completeTestSetup(app);
    kernel=(app as any).kernel;
    const all=[...loadStoredArtifacts(kernel),...structuredClone(artifacts)];
    expect(kernel.applyWebArtifacts(all as AnyMeta[])).toEqual([]); persistStoredArtifacts(kernel,all);
    kernel.context().newRecord('SAMPLE_Row').set('code','production').set('extra','customer').insert();
    const login=await app.inject({method:'POST',url:'/api/login',payload:{username:'admin',password:TEST_ADMIN_PASSWORD}});
    auth={cookie:(login.headers['set-cookie'] as string).split(';')[0]};
  });
  afterEach(async () => { await app.close(); });
  const preview = async (pkg: MetadataPackage) => { const input=upload(pkg); return app.inject({method:'POST',url:'/api/designer/packages/import/preview',...input,headers:{...auth,...input.headers}}); };
  const apply = (previewId: string) => app.inject({method:'POST',url:'/api/designer/change-sets/apply',headers:auth,payload:{previewId,confirmation:true,confirmHighRisk:true}});
  async function exported(mode='vendor',models=['Base']) { const result=await app.inject({method:'POST',url:'/api/designer/packages/models/sample/export',headers:auth,payload:{mode,models}}); expect(result.statusCode,result.body).toBe(200); return result.json() as MetadataPackage; }

  it('updates vendor models without changing customer models, app settings or rows',async () => {
    const pkg=await exported();
    const updated=createMetadataPackage('1.3.0',pkg.scope,pkg.artifacts.map(a => a.kind==='app'?{...a,label:'Vendor label'}:a.name==='SAMPLE_Row'?{...a,label:'Updated'}:a));
    const result=await preview(updated); expect(result.statusCode,result.body).toBe(200);
    expect(result.json().preservedModels.map((m:any)=>m.name)).toEqual(['Custom','Dev']);
    expect((await apply(result.json().previewId)).statusCode).toBe(200);
    expect(kernel.registry.getTable('SAMPLE_Row').label).toBe('Updated');
    expect(kernel.registry.loadedApps().find(a=>a.name==='sample')!.label).toBe('Production label');
    expect(loadStoredArtifacts(kernel).find(a=>a.name==='SAMPLE_Custom_SAMPLE_Row_Extension')).toEqual(artifacts[3]);
    const row = kernel.context().select('SAMPLE_Row').firstOnly()!;
    expect(row.get('code')).toBe('production'); expect(row.get('extra')).toBe('customer');
  });
  it('promotes all layers, deleting omitted metadata but keeping physical data',async () => {
    const pkg=await exported('promotion',['Base','Custom','Dev']);
    const updated=createMetadataPackage('1.3.0',pkg.scope,pkg.artifacts.filter(a=>a.name!=='SAMPLE_DevEnum').map(a=>a.name==='SAMPLE_Custom_SAMPLE_Row_Extension'?{...a,label:'Promoted customization'}:a));
    const result=await preview(updated); expect(result.statusCode,result.body).toBe(200);
    expect(result.json().diff).toContainEqual(expect.objectContaining({name:'SAMPLE_DevEnum',op:'delete'}));
    expect((await apply(result.json().previewId)).statusCode).toBe(200);
    expect(loadStoredArtifacts(kernel).some(a=>a.name==='SAMPLE_DevEnum')).toBe(false);
    expect(kernel.context().select('SAMPLE_Row').firstOnly()!.f.extra).toBe('customer');
  });
  it('rejects incompatible base removal, cross-model ownership and vendor CUS selection',async () => {
    expect((await app.inject({method:'POST',url:'/api/designer/packages/models/sample/export',headers:auth,payload:{mode:'vendor',models:['Custom']}})).statusCode).toBe(422);
    const pkg=await exported();
    const missing=createMetadataPackage('1.3.0',pkg.scope,pkg.artifacts.filter(a=>a.name!=='SAMPLE_Row'));
    expect((await preview(missing)).statusCode).toBe(422);
    const stolen=createMetadataPackage('1.3.0',pkg.scope,[...pkg.artifacts,{...artifacts[3],model:'Base',layer:'SYS'} as MetadataArtifact]);
    expect(()=>modelPackageOperations(stolen,artifacts)).toThrow(/Ownership/);
    expect((await preview(stolen)).statusCode).toBe(422);
    expect(kernel.context().select('SAMPLE_Row').toArray()).toHaveLength(1);
  });
  it('rejects stale previews and restores runtime and storage when persistence fails',async () => {
    const pkg=await exported(); const result=await preview(pkg);
    const all=loadStoredArtifacts(kernel); const row=all.find(a=>a.name==='SAMPLE_Row')!; if (row.kind === 'table') row.label='Concurrent'; persistStoredArtifacts(kernel,all);
    expect((await apply(result.json().previewId)).statusCode).toBe(409);
    const fresh=await preview(pkg); expect(fresh.statusCode,fresh.body).toBe(200);
    const beforeRegistry=kernel.registry; const before=loadStoredArtifacts(kernel);
    kernel.designerDb.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON FW_ChangeSetAudit BEGIN SELECT RAISE(ABORT,'injected failure'); END`);
    expect((await apply(fresh.json().previewId)).statusCode).toBeGreaterThanOrEqual(400);
    expect(kernel.registry).toBe(beforeRegistry); expect(loadStoredArtifacts(kernel)).toEqual(before);
    expect(kernel.context().select('SAMPLE_Row').toArray()).toHaveLength(1);
  });
  it('exposes admin inventory and renews licenses without transferring them in packages',async () => {
    expect((await app.inject({method:'GET',url:'/api/system/apps-models'})).statusCode).toBe(401);
    const licensed=loadStoredArtifacts(kernel).map(a=>a.kind==='app'&&a.name==='sample'?{...a,models:[...(a.models??[]),{name:'ISV',layer:'ISV' as const,license:{vendor:'seller'}}]}:a);
    expect(kernel.applyWebArtifacts(licensed as AnyMeta[])).toEqual([]); persistStoredArtifacts(kernel,licensed);
    const blocked=await app.inject({method:'POST',url:'/api/data/SAMPLE_Row',headers:auth,payload:{code:'blocked'}});
    expect(blocked.statusCode,blocked.body).toBe(403);
    expect((await app.inject({method:'GET',url:'/api/data/SAMPLE_Row',headers:auth})).statusCode).toBe(200);
    const pair=generateKeyPairSync('ed25519');
    expect((await app.inject({method:'PUT',url:'/api/system/licenses/customer',headers:auth,payload:{customer:'buyer'}})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/system/licenses/vendors',headers:auth,payload:{vendor:'seller',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString()}})).statusCode).toBe(200);
    const payload={version:1 as const,vendor:'seller',customer:'buyer',installationId:kernel.licenses.identity().installationId,app:'sample',model:'ISV',sequence:1,notBefore:'2020-01-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z'};
    const signed={payload,signature:sign(null,licenseBytes(payload),pair.privateKey).toString('base64')};
    expect((await app.inject({method:'POST',url:'/api/system/licenses/import',headers:auth,payload:signed})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/data/SAMPLE_Row',headers:auth,payload:{code:'renewed'}})).statusCode).toBe(201);
    const overview=(await app.inject({method:'GET',url:'/api/system/apps-models',headers:auth})).json();
    expect(overview.apps.find((a:any)=>a.name==='sample').readOnlyReasons).toEqual([]);
    const pkg=await exported('promotion',['Base','Custom','Dev','ISV']);
    expect(JSON.stringify(pkg)).not.toContain(payload.installationId); expect(JSON.stringify(pkg)).not.toContain(signed.signature);
  });
});
