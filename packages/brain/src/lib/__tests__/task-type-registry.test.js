import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import * as R from '../task-type-registry.js';

const active=Object.keys(R.TASK_TYPE_REGISTRY);
const retired=R.RETIRED_DEVELOPMENT_TASK_TYPES;
const maps=['EXECUTOR_KIND_FOR_TASK_TYPE','EXECUTOR_SKILL_MAP','EXECUTOR_MODE_MAP','LOCATION_MAP','SKILL_WHITELIST','TASK_REQUIREMENTS'];
describe('现役任务类型注册表与历史枚举分离',()=>{
  it('声明字段完备、类型唯一且显式区分agent/workflow',()=>{
    expect(new Set(active).size).toBe(active.length);
    for(const [type,e] of Object.entries(R.TASK_TYPE_REGISTRY)){
      expect(type).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(['agent','workflow']).toContain(e.kind);
      for(const flag of ['coding','pr','push_to_notion','tick_dispatchable','db']) expect(typeof e[flag]).toBe('boolean');
      expect(Object.isFrozen(e)).toBe(true);expect(Object.isFrozen(e.tags)).toBe(true);
    }
  });
  it('退役类型不在任何现役执行/技能/位置映射中，但历史DB枚举可读且不会进tick',()=>{
    for(const type of retired){
      expect(R.getTaskType(type)).toBeNull();
      expect(R.VALID_TASK_TYPES).not.toContain(type);
      expect(R.TICK_DISPATCH_EXCLUDED).toContain(type);
      if(type!=='harness_controller')expect(R.DB_WHITELISTED_TASK_TYPES).toContain(type);
      else expect(R.DB_WHITELISTED_TASK_TYPES).not.toContain(type);
      for(const map of maps) expect(Object.hasOwn(R[map],type),map+':'+type).toBe(false);
    }
  });
  it('历史数据库CHECK枚举没有因物理清退实现而丢失',()=>{
    const sql=readFileSync(new URL('../../../migrations/471_script_executor_kind_and_task_type.sql',import.meta.url),'utf8');
    const part=sql.split('task_type IN (')[1].split(')')[0];
    const historical=[...part.matchAll(/'([^']+)'/g)].map(m=>m[1]);
    for(const type of historical) expect(R.DB_WHITELISTED_TASK_TYPES).toContain(type);
    expect(new Set(R.DB_WHITELISTED_TASK_TYPES).size).toBe(R.DB_WHITELISTED_TASK_TYPES.length);
  });
  it('有头开发记账dev，无头coding_workflow由专属Runner消费',()=>{
    expect(R.getTaskType('dev')).toMatchObject({coding:true,pr:true,executor:'headed-session',surface:'none',watchdog:'none'});
    expect(R.getTaskType('coding_workflow')).toMatchObject({coding:false,executor:'coding-workflow-runner',tick_dispatchable:false});
    expect(R.GP_IMPLEMENTATION_TASK_TYPES).toEqual(['dev','coding_workflow']);
    expect(R.TICK_DISPATCH_EXCLUDED).toContain('coding_workflow');
    expect(R.TICK_DISPATCH_EXCLUDED).toContain('project');
    expect(R.TICK_DISPATCH_EXCLUDED).not.toContain('qiumi_task');
    expect(R.TICK_DISPATCH_EXCLUDED).not.toContain('script_run');
  });
  it('退役判定仅识别显式枚举和旧harness_mode真值',()=>{
    for(const type of retired) expect(R.isRetiredDevelopmentTask({task_type:type})).toBe(true);
    for(const value of [true,'true','t']) expect(R.isRetiredDevelopmentTask({task_type:'dev',payload:{harness_mode:value}})).toBe(true);
    for(const value of [false,'false',undefined]) expect(R.isRetiredDevelopmentTask({task_type:'dev',payload:{harness_mode:value}})).toBe(false);
    expect(R.isRetiredDevelopmentTask({task_type:'harness_initiative_extra'})).toBe(false);
  });
  it('当前运营和接力消费者仍具备明确免锚/执行配置',()=>{
    expect(R.getTaskType('qiumi_task')).toMatchObject({surface:'openclaw-agent',executor:'openclaw-agent',tick_dispatchable:true,push_to_notion:false});
    expect(R.ANCHOR_EXEMPT_TASK_TYPES).toContain('qiumi_task');
    expect(R.CONTENT_PIPELINE_TYPES).toContain('content-pipeline');
    expect(R.getTaskType('project')).toMatchObject({kind:'workflow',tick_dispatchable:false});
    expect(R.getTaskType('script_run')).toMatchObject({surface:'script',executor:'script'});
  });
});
