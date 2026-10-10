import { describe, it, expect } from 'vitest';
import { codeTaskIdentitySql, compareCodeTaskIdentity } from '../code-task-identity.js';

const wf='7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70';
const plan='b1f98b63-989a-40c2-9deb-8880cd07459f';
const slot='2026-10-10T15:16:00.000Z';
const valid={canonical_code:true,multi_task:true,workflow_id:wf,source:'scheduler',source_id:`recurring:${plan}:${slot}`,recurring_task_id:plan,recurring_slot:slot,phone_serial:null};

describe('可信代码身份的输入边界',()=>{
  it.each(['x;DROP TABLE tasks','t.owner','t--','UPPER',''])('SQL别名 %s 被拒绝，不能注入任务或来源投影',alias=>{
    expect(()=>codeTaskIdentitySql(alias,'receipt')).toThrow('unsafe identity alias');
    expect(()=>codeTaskIdentitySql('tasks',alias)).toThrow('unsafe identity alias');
  });
  it('真实SQL投影沿用active Workflow和JSON false的唯一中央判据',()=>{
    const sql=codeTaskIdentitySql('tasks','receipt');
    expect(sql).toContain("tasks.payload->'runtime_requires_llm' = 'false'::jsonb");
    expect(sql).toContain("workflow.status = 'active'");
    expect(sql).toContain("'source_id', receipt.source_id");
    expect(sql).toContain("'parent_task_id', tasks.parent_task_id::text");
  });
  it.each([
    {canonical_code:false},{canonical_code:'true'},{multi_task:'true'},{multi_task:false},
    {source:'api'},{source_id:'unverified'},{workflow_id:'not-registered'},
    {recurring_slot:'2026-02-30T15:16:00.000Z'},{recurring_slot:'not-a-date'},
    {phone_serial:'../../phone'},
  ])('不完整或非规范持久身份保持unknown %#',patch=>{
    expect(compareCodeTaskIdentity({...valid,...patch},valid)).toBe('unknown');
  });
  it('ADB serial大小写不归并；相同slot的不同手机仍是不同资源',()=>{
    expect(compareCodeTaskIdentity({...valid,phone_serial:'ABC'}, {...valid,phone_serial:'abc',source_id:`recurring:0287be5a-5ed3-4f9c-83db-d68d70f8f03f:${slot}`,recurring_task_id:'0287be5a-5ed3-4f9c-83db-d68d70f8f03f'})).toBe('different');
  });
});
