import {randomUUID} from 'node:crypto';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
const state=vi.hoisted(()=>({pool:null}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>state.pool.query(...args)}}));
import router from '../../routes/journeys.js';
if(DB_DEFAULTS.database!=='cecelia_scratch'&&!(process.env.CI&&DB_DEFAULTS.database==='cecelia_test'))throw Error('isolated scratch required');
const schema='journey_area_'+randomUUID().replaceAll('-',''),admin=new pg.Client(DB_DEFAULTS);
const pool=new pg.Pool({...DB_DEFAULTS,options:`-c search_path=${schema}`});state.pool=pool;
const oldArea=randomUUID(),newArea=randomUUID(),journey=randomUUID(),parent=randomUUID();let server;
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE areas(id UUID PRIMARY KEY);CREATE TABLE journeys(id UUID PRIMARY KEY,name TEXT,kind TEXT,parent_journey_id UUID,area_id UUID REFERENCES areas(id),description TEXT,notion_synced_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT now());CREATE TABLE journey_features(id UUID PRIMARY KEY,journey_id UUID REFERENCES journeys(id));`);
 await pool.query('INSERT INTO areas VALUES($1),($2)',[oldArea,newArea]);
 await pool.query("INSERT INTO journeys(id,name,kind,parent_journey_id,area_id,description,notion_synced_at) VALUES($1,'机群','value_stream',$2,$3,'original',now())",[journey,parent,oldArea]);
 await pool.query('INSERT INTO journey_features VALUES($1,$2)',[randomUUID(),journey]);
 const app=express();app.use(express.json());app.use('/api/brain',router);server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
it('真实HTTP只改归属，UUID/名称/kind/父级/关联引用完整保留',async()=>{
 const before=(await pool.query('SELECT * FROM journeys WHERE id=$1',[journey])).rows[0];
 expect((await request(server).patch('/api/brain/journeys/'+journey).send({area_id:newArea})).status).toBe(200);
 const after=(await request(server).get('/api/brain/journeys/'+journey)).body;
 for(const field of ['id','name','kind','parent_journey_id','description'])expect(after[field]).toEqual(before[field]);
 expect(after.area_id).toBe(newArea);expect(after.notion_synced_at).toBeNull();
 expect((await pool.query('SELECT journey_id FROM journey_features')).rows).toEqual([{journey_id:journey}]);
});
it('缺失area与恶意非UUID皆拒绝，整行保持原样',async()=>{
 const before=(await pool.query('SELECT * FROM journeys WHERE id=$1',[journey])).rows[0];
 for(const area_id of [randomUUID(),"';UPDATE journeys SET name='x';--",null]){
  expect((await request(server).patch('/api/brain/journeys/'+journey).send({area_id,description:'changed'})).status).toBe(400);
  expect((await pool.query('SELECT * FROM journeys WHERE id=$1',[journey])).rows[0]).toEqual(before);
 }
});
