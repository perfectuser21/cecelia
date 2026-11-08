import './helpers/tasks-review-effects.js';
import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from '../tasks.js';
import { getReviewEffects } from './helpers/tasks-review-effects.js';

const effects=getReviewEffects();
const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
let app, task, updates;
beforeEach(() => {
  task={id,status:'in_progress',claimed_by:'synthetic-owner',executor_kind:'headed-session',task_type:'dev',
    orchestrator:null,review_required_raw:'true',review_status:'approved',pr_url:null,pr_merged_at:null,payload:{},result:{}};
  updates=[];
  effects.query.mockImplementation(async (sql,params) => {
    if (/^SELECT/i.test(sql.trim()) && /FROM tasks WHERE id = \$1/.test(sql)) {
      return {rows:/okr_initiative_id/.test(sql)?[]:[{...task}]};
    }
    if (/^UPDATE tasks SET/.test(sql.trim())) {
      updates.push({sql,params});
      if (/status = \$1/.test(sql)) task.status=params[0];
      return {rows:[{status:task.status,updated_at:'synthetic-time',started_at:'synthetic-time',completed_at:'synthetic-time'}]};
    }
    throw Error('unexpected_SQL: '+sql);
  });
  app=express(); app.use(express.json()); app.use('/api/brain',router);
});
const patch=body=>request(app).patch('/api/brain/tasks/'+id).send(body);

describe('真实PATCH完成审查门只允许明确approved', () => {
  it.each(['rejected','unknown','pending',null,'',' ','APPROVED','approved '])('required=true review=%s 必须422，不写completed或触发终态副作用',async review => {
    task.review_status=review;
    const res=await patch({status:'completed',result:{synthetic_fact:'must_not_complete'}});
    expect(res.status).toBe(422); expect(res.body.code).toBe('REVIEW_NOT_APPROVED');
    expect(res.body.current_review_status).toBe(review||null);
    expect(effects.block).toHaveBeenCalledWith(id,expect.objectContaining({reason:'review_not_approved'}));
    expect(updates).toEqual([]); expect(task.status).toBe('in_progress');
    expect(effects.emit).not.toHaveBeenCalled(); expect(effects.terminal).not.toHaveBeenCalled(); expect(effects.promote).not.toHaveBeenCalled();
  });
  it('请求自称approved不能覆盖数据库的rejected',async () => {
    task.review_status='rejected';const res=await patch({status:'completed',review_status:'approved'});
    expect(res.status).toBe(422);expect(res.body.current_review_status).toBe('rejected');expect(updates).toEqual([]);
  });
  it('blocked委托失败返回500且仍不得写completed',async () => {
    task.review_status='rejected';effects.block.mockRejectedValueOnce(Error('synthetic_block_failure'));
    const res=await patch({status:'completed'});
    expect(res.status).toBe(500);expect(updates).toEqual([]);
    expect(effects.emit).not.toHaveBeenCalled();expect(effects.terminal).not.toHaveBeenCalled();
  });
  it('approved从in_progress完成，保真实写入/事件/终态钩子',async () => {
    const res=await patch({status:'completed'});
    expect(res.status).toBe(200); expect(res.body.success).toBe(true); expect(res.body.status).toBe('completed');
    expect(updates).toHaveLength(1);expect(updates[0].params[0]).toBe('completed');
    expect(effects.block).not.toHaveBeenCalled(); expect(effects.emit).toHaveBeenCalledWith('task_status_changed',expect.objectContaining({task_id:id,from:'in_progress',to:'completed'}));
    expect(effects.terminal).toHaveBeenCalledTimes(1); expect(effects.promote).toHaveBeenCalledTimes(1);
  });
  it('blocked审核通过仍可重试完成',async () => {
    task.status='blocked'; const res=await patch({status:'completed'});
    expect(res.status).toBe(200);expect(res.body.status).toBe('completed');expect(updates).toHaveLength(1);
  });
  it.each(['false',null])('不要求审核%s时保普通完成路径',async required => {
    task.review_required_raw=required;task.review_status='rejected';const res=await patch({status:'completed'});
    expect(res.status).toBe(200);expect(res.body.status).toBe('completed');expect(updates).toHaveLength(1);
  });
  it('completed同态补result不重审/不重发终态副作用',async () => {
    task.status='completed';task.review_status='rejected';const res=await patch({status:'completed',result:{synthetic_fact:'readback'}});
    expect(res.status).toBe(200);expect(updates).toHaveLength(1);expect(updates[0].sql).not.toMatch(/status = \$/);
    expect(effects.block).not.toHaveBeenCalled();expect(effects.emit).not.toHaveBeenCalled();expect(effects.terminal).not.toHaveBeenCalled();
  });
  it('未终态纯result补写不擅加审核门',async () => {
    task.review_status='rejected';const res=await patch({result:{synthetic_fact:'progress'}});
    expect(res.status).toBe(200);expect(res.body.status).toBe('in_progress');expect(effects.block).not.toHaveBeenCalled();
  });
  it('approved仍不能绕过未合PR门',async () => {
    task.pr_url='https://github.com/synthetic/owned/pull/1';const res=await patch({status:'completed'});
    expect(res.status).toBe(422);expect(res.body.code).toBe('PR_NOT_MERGED');expect(updates).toEqual([]);
  });
  it('skill-relay保原独立finalize权威且不因rejected越权',async () => {
    task.task_type='harness_initiative';task.orchestrator='skill-relay';task.review_status='rejected';
    const res=await patch({status:'completed'});
    expect(res.status).toBe(200);expect(res.body.accepted).toBe(false);expect(res.body.success).toBe(false);
    expect(effects.finalize).toHaveBeenCalledTimes(1);expect(effects.block).not.toHaveBeenCalled();expect(updates[0].sql).not.toMatch(/status = \$/);
  });
});
