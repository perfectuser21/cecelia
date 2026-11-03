import {beforeEach,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const deps=vi.hoisted(()=>({query:vi.fn(),capacity:vi.fn()}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>deps.query(...args)}}));
vi.mock('../../llm-capacity.js',()=>({getLlmCapacitySnapshot:(...args)=>deps.capacity(...args)}));
import router from '../dispatch.js';
const app=express();app.use(router);
beforeEach(()=>{vi.clearAllMocks();});
it('recent返回完整事件并向SQL传递实际limit',async()=>{
 deps.query.mockResolvedValue({rows:[{id:'e1',task_id:'t1',event_type:'skip',reason:'busy',created_at:'2026-11-03T00:00:00Z'}]});
 const r=await request(app).get('/dispatch/recent?limit=5');expect(r.status).toBe(200);
 expect(r.body).toEqual({events:[{id:'e1',task_id:'t1',event_type:'skip',reason:'busy',created_at:'2026-11-03T00:00:00Z'}],limit:5,total:1});
 expect(deps.query).toHaveBeenCalledWith(expect.stringMatching(/ORDER BY created_at DESC\s+LIMIT \$1/),[5]);
});
it.each([['999',100],['0',20],['-1',20],['no',20],['',20]])('limit=%s实际采用%d',async(value,want)=>{
 deps.query.mockResolvedValue({rows:[]});const r=await request(app).get('/dispatch/recent?limit='+value);
 expect(r.status).toBe(200);expect(r.body).toEqual({events:[],limit:want,total:0});expect(deps.query.mock.calls[0][1]).toEqual([want]);
});
it('recent查询失败必须500，不能用空成功代替',async()=>{
 deps.query.mockRejectedValue(Error('fixture_db_down'));const r=await request(app).get('/dispatch/recent');expect(r.status).toBe(500);expect(r.body).toEqual({error:'Failed to query dispatch_events',details:'fixture_db_down'});
});
it('capacity完整快照原样读回',async()=>{
 deps.capacity.mockResolvedValue({vendors:{codex:{available_count:2}},blocked:false});const r=await request(app).get('/dispatch/llm-capacity');expect(r.status).toBe(200);expect(r.body).toEqual({vendors:{codex:{available_count:2}},blocked:false});
});
it('capacity失败必须500',async()=>{
 deps.capacity.mockRejectedValue(Error('capacity_down'));const r=await request(app).get('/dispatch/llm-capacity');expect(r.status).toBe(500);expect(r.body).toEqual({error:'Failed to query llm capacity',details:'capacity_down'});
});
