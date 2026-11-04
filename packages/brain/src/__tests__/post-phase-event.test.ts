import {describe,it,expect,vi,beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
const pool=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../db.js',()=>({default:pool}));
import router from '../routes/harness.js';
const app=express().use(express.json()).use('/api/brain/harness',router);
beforeEach(()=>vi.clearAllMocks());
describe('真实POST phase-event HTTP与写入边界',()=>{
  it('真实INSERT必达，DB返回id/model等原样进入201响应',async()=>{
    const row={id:73,initiative_id:'initiative-fixture',node:'generate',status:'running',model:'fixture-model',ts:1730000000};
    pool.query.mockResolvedValueOnce({rows:[row]});
    const response=await request(app).post('/api/brain/harness/phase-event').send({initiative_id:row.initiative_id,node:row.node,model:row.model});
    expect(response.status).toBe(201);expect(response.body).toEqual(row);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO initiative_run_events');
    expect(pool.query.mock.calls[0][0]).toContain('RETURNING id, initiative_id, node, status, model, ts');
    expect(pool.query.mock.calls[0][1]).toEqual([row.initiative_id,row.node,'running',expect.any(Number),row.model]);
    for(const field of ['event_id','created_at','model_id','cost'])expect(response.body).not.toHaveProperty(field);
  });
  it.each([{}, {initiative_id:'fixture'}, {node:'generate'}])('非法body %j为400且不写',async body=>{
    expect((await request(app).post('/api/brain/harness/phase-event').send(body)).status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('缺model传null且保留显式status',async()=>{
    pool.query.mockResolvedValueOnce({rows:[{id:1,model:null,status:'failed'}]});
    const response=await request(app).post('/api/brain/harness/phase-event').send({initiative_id:'fixture',node:'qa',status:'failed'});
    expect(response.status).toBe(201);expect(response.body.model).toBeNull();
    expect(pool.query.mock.calls[0][1]).toEqual(['fixture','qa','failed',expect.any(Number),null]);
  });
  it('真实写入边界失败返回500，不能静态字符串假绿',async()=>{
    pool.query.mockRejectedValueOnce(new Error('isolated fixture failure'));
    const response=await request(app).post('/api/brain/harness/phase-event').send({initiative_id:'fixture',node:'qa'});
    expect(response.status).toBe(500);expect(pool.query).toHaveBeenCalledTimes(1);
    expect(response.body.error).toBe('isolated fixture failure');
  });
});
