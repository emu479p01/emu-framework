import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { AnyMeta, Kernel } from '@emu/core';
import { buildServer } from '../src/server.js';
import { applyErpSample } from './fixtures/erpSample.js';
import { completeTestSetup, TEST_ADMIN_PASSWORD, TEST_SETUP_CODE } from './setupHelper.js';

function upload(filename:string,mime:string,bytes:Buffer){const boundary=`----EmuEntity${Date.now()}`;return{headers:{'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)])};}

describe('document Data Entities and archive',()=>{
  let app:FastifyInstance;let kernel:Kernel;let auth:{cookie:string};let root:string;
  beforeAll(async()=>{
    root=await mkdtemp(join(tmpdir(),'emu-entity-'));process.env.EMU_FILE_STORAGE_PATH=join(root,'files');process.env.EMU_ARCHIVE_STORAGE_PATH=join(root,'archive');process.env.EMU_DATA_JOB_PATH=join(root,'data-jobs');
    app=buildServer({setupCode:TEST_SETUP_CODE});await app.ready();await completeTestSetup(app);kernel=(app as FastifyInstance&{kernel:Kernel}).kernel;applyErpSample(kernel);
    const stored=kernel.designerContext().select('FW_WebArtifact').toArray().map((row)=>JSON.parse(String(row.f.json)) as AnyMeta);const entity:AnyMeta={kind:'dataEntity',name:'ERP_SalesOrderEntity',app:'erp',model:'MiniERPApplication',layer:'SYS',label:'Sales order entity',rootTable:'ERP_SalesTable',businessKey:['salesId'],fields:['salesId','custId','status','orderDate','totalAmount'],archiveEligible:true,businessDateField:'orderDate',lines:[{name:'Lines',table:'ERP_SalesLine',parentReference:'salesId',fields:['itemId','qty','salesPrice','lineAmount'],lineKeys:['itemId']}]};
    const errors=kernel.applyWebArtifacts([...stored,entity]);expect(errors).toEqual([]);
    const login=await app.inject({method:'POST',url:'/api/login',payload:{username:'admin',password:TEST_ADMIN_PASSWORD}});auth={cookie:(login.headers['set-cookie'] as string).split(';')[0]};
    const ctx=kernel.context();const customer=ctx.newRecord('ERP_CustTable').setMany({accountNum:'ENT-C',name:'Entity customer'});customer.insert();const item=ctx.newRecord('ERP_InventItem').setMany({itemId:'ENT-I',itemName:'Entity item'});item.insert();const sale=ctx.newRecord('ERP_SalesTable').setMany({salesId:'ENT-SO',custId:customer.id,orderDate:'2020-01-01'});sale.insert();ctx.newRecord('ERP_SalesLine').setMany({salesId:sale.id,itemId:item.id,qty:2,salesPrice:5}).insert();
  });
  afterAll(async()=>{await app.close();delete process.env.EMU_FILE_STORAGE_PATH;delete process.env.EMU_ARCHIVE_STORAGE_PATH;delete process.env.EMU_DATA_JOB_PATH;await rm(root,{recursive:true,force:true});});

  it('exports Header/Line XLSX, stages it, and commits atomically per document',async()=>{
    const exported=await app.inject({method:'GET',url:'/api/data-entities/ERP_SalesOrderEntity/export?format=xlsx',headers:auth});expect(exported.statusCode).toBe(200);expect(exported.rawPayload.subarray(0,2).toString()).toBe('PK');
    const multipart=upload('sales.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',exported.rawPayload);const preview=await app.inject({method:'POST',url:'/api/data-entities/ERP_SalesOrderEntity/import/preview',headers:{...auth,...multipart.headers},payload:multipart.payload});expect(preview.statusCode).toBe(200);expect(preview.json()).toMatchObject({documents:1,sources:[{name:'Header',rows:1},{name:'Lines',rows:1}]});
    const ctx=kernel.context();for(const line of ctx.select('ERP_SalesLine').toArray())line.delete();for(const sale of ctx.select('ERP_SalesTable').toArray())sale.delete();
    const committed=await app.inject({method:'POST',url:'/api/data-entities/ERP_SalesOrderEntity/import/commit',headers:auth,payload:{previewId:preview.json().previewId}});expect(committed.statusCode).toBe(200);expect(committed.json()).toMatchObject({inserted:1,linesInserted:1,failed:0});
  });

  it('archives only an explicitly eligible entity and restores without overwrite',async()=>{
    const saved=await app.inject({method:'PUT',url:'/api/system/archive/policies/ERP_SalesOrderEntity',headers:auth,payload:{businessDateField:'orderDate',ageDays:1,batchSize:10,includeAttachments:true,schedule:'daily',timezone:'Asia/Bangkok'}});expect(saved.statusCode).toBe(200);
    const preview=await app.inject({method:'GET',url:'/api/system/archive/ERP_SalesOrderEntity/preview',headers:auth});expect(preview.json().eligible).toBe(1);
    const run=await app.inject({method:'POST',url:'/api/system/archive/ERP_SalesOrderEntity/run',headers:auth});expect(run.json()).toMatchObject({archived:1,failed:0});expect(kernel.context().select('ERP_SalesTable').toArray()).toHaveLength(0);
    const docs=await app.inject({method:'GET',url:'/api/system/archive/documents?entity=ERP_SalesOrderEntity',headers:auth});const archiveId=docs.json().items[0].archiveId;
    const restored=await app.inject({method:'POST',url:`/api/system/archive/documents/${archiveId}/restore`,headers:auth});expect(restored.json()).toMatchObject({restored:true,inserted:1,linesInserted:1});
    const collision=await app.inject({method:'POST',url:`/api/system/archive/documents/${archiveId}/restore`,headers:auth});expect(collision.statusCode).toBe(409);expect(collision.json().skipped).toBe(true);
  });
});
