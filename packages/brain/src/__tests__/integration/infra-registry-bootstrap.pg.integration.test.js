import {afterEach,expect,it} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createImplementationCiRouter} from '../../routes/implementation-ci.js';
import {infraBootstrapDatabase} from '../fixtures/infra-bootstrap-db.js';
let f;afterEach(async()=>{await f?.close();f=null;});
function app(options){const a=express();a.use(express.json());a.use('/ci',createImplementationCiRouter({pool:f.createPool(4),bootstrapOptions:options}));return a;}
it('既有infra缺失Activity/ref可经真实HTTP受控初始化且不授执行权',async()=>{
 f=await infraBootstrapDatabase();const response=await request(app(f.options)).post('/ci/infra/bootstrap').send(await f.input());
 expect(response.status,response.body).toBe(201);expect(response.body.receipt).toMatchObject({metadata_only:true,executable:false,runtime_status:'not_evaluated'});
 expect((await f.db.query('SELECT * FROM workflow_activity_refs')).rows).toHaveLength(1);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(1);
 expect((await f.db.query('SELECT current_definition_version_id FROM workflows')).rows[0].current_definition_version_id).toBeNull();
 expect((await f.db.query('SELECT * FROM workflow_definition_versions')).rows).toHaveLength(0);
});
