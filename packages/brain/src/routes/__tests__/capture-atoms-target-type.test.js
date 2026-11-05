import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const pool=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(()=>{throw Error('GET_must_not_connect');})}));
vi.mock('../../db.js',()=>({default:pool}));
vi.mock('../../work-routing-store.js',()=>({createRoutedTask:()=>{throw Error('GET_must_not_route');}}));
let app;
beforeAll(async()=>{app=express();app.use('/api/brain/capture-atoms',(await import('../capture-atoms.js')).default);});
beforeEach(()=>{vi.clearAllMocks();pool.query.mockResolvedValue({rows:[]});});
const get=query=>request(app).get('/api/brain/capture-atoms').query(query);

describe('现役AtomReview target_type真实Brain GET参数合同',()=>{
  it.each(['task','knowledge','note','notes','handoff','legacy_custom'])('类型%s按原VARCHAR值绑定，不擅增枚举或改写类型',async type=>{
    const res=await get({target_type:type});expect(res.status).toBe(200);
    const [sql,values]=pool.query.mock.calls[0];expect(sql).toMatch(/ca\.target_type = \$1/);expect(values).toEqual([type,50,0]);
    expect(pool.query).toHaveBeenCalledTimes(1);expect(pool.connect).not.toHaveBeenCalled();
  });
  it('与原status/capture_id/分页组合仍保占位顺序',async()=>{
    const res=await get({status:'pending_review',target_type:'knowledge',capture_id:'owned-capture',limit:'7',offset:'2'});
    expect(res.status).toBe(200);const [sql,values]=pool.query.mock.calls[0];
    expect(sql).toMatch(/ca.status = \$1 AND ca.target_type = \$2 AND ca.capture_id = \$3/);
    expect(sql).toMatch(/LIMIT \$4 OFFSET \$5/);expect(values).toEqual(['pending_review','knowledge','owned-capture',7,2]);
  });
  it('引号和SQL片段只作为值，不进入SQL正文',async()=>{
    const type="task' OR 1=1 --";expect((await get({target_type:type})).status).toBe(200);
    const [sql,values]=pool.query.mock.calls[0];expect(values).toEqual([type,50,0]);expect(sql).not.toContain(type);expect(sql).toMatch(/ca.target_type = \$1/);
  });
  it.each([{}, {target_type:''}])('未筛类型%j保持原status/capture_id和默认分页',async extra=>{
    expect((await get({status:'pending_review',capture_id:'owned-capture',...extra})).status).toBe(200);
    const [sql,values]=pool.query.mock.calls[0];expect(sql).not.toMatch(/ca.target_type =/);expect(sql).toMatch(/ca.status = \$1 AND ca.capture_id = \$2/);
    expect(values).toEqual(['pending_review','owned-capture',50,0]);
  });
  it('新筛选下真实DB拒绝仍500，不伪装空列表',async()=>{
    pool.query.mockRejectedValueOnce(Error('owned_db_failure'));const res=await get({target_type:'knowledge'});
    expect(res.status).toBe(500);expect(res.body).toMatchObject({error:'Failed to list capture_atoms',details:'owned_db_failure'});
  });
});
