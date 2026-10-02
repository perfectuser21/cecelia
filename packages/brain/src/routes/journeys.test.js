import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const query=vi.hoisted(()=>vi.fn());
vi.mock('../db.js',()=>({default:{query}}));
import router from './journeys.js';
const journey='0c1f70f1-b061-4118-b741-8a31c1791c68',area='bdf1f5c1-77bd-4c4c-9f6e-e7c1fc46f358';
let server;
beforeEach(async()=>{query.mockReset();const app=express();app.use(express.json());app.use('/api/brain',router);server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});});
afterEach(async()=>{await new Promise(resolve=>server.close(resolve));});
it('已有area可更新原旅程并使同步时间失效',async()=>{
 query.mockResolvedValueOnce({rows:[{id:area}]}).mockResolvedValueOnce({rows:[{id:journey,area_id:area,notion_synced_at:null}]});
 const res=await request(server).patch('/api/brain/journeys/'+journey).send({area_id:area});
 expect(res.status).toBe(200);expect(res.body).toMatchObject({id:journey,area_id:area,notion_synced_at:null});
 expect(query.mock.calls[1][0]).toContain('notion_synced_at=NULL');
});
it.each([null,'',123,{},'not-a-uuid'])('非法area %j和其它字段一起提交也零写',async area_id=>{
 const res=await request(server).patch('/api/brain/journeys/'+journey).send({area_id,description:'must not persist'});
 expect(res.status).toBe(400);expect(query).not.toHaveBeenCalled();
});
it('不存在area拒绝且不更新其它字段',async()=>{
 query.mockResolvedValue({rows:[]});
 const res=await request(server).patch('/api/brain/journeys/'+journey).send({area_id:area,description:'must not persist'});
 expect(res.status).toBe(400);expect(query).toHaveBeenCalledTimes(1);
});
it('已验证area在UPDATE前消失时返回400，外键保证零写',async()=>{
 query.mockResolvedValueOnce({rows:[{id:area}]}).mockRejectedValueOnce(Object.assign(Error('foreign key'),{code:'23503'}));
 const res=await request(server).patch('/api/brain/journeys/'+journey).send({area_id:area});
 expect(res.status).toBe(400);expect(query).toHaveBeenCalledTimes(2);
});
it('合法area但旅程不存在保持404',async()=>{
 query.mockResolvedValueOnce({rows:[{id:area}]}).mockResolvedValueOnce({rows:[]});
 expect((await request(server).patch('/api/brain/journeys/'+journey).send({area_id:area})).status).toBe(404);
});
