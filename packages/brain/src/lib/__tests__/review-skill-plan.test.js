import { beforeEach, describe, expect, it, vi } from 'vitest';
const io=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../../db.js',()=>({default:{query:io.query}}));
import {prepareReviewSkillDispatch,transferReviewSkillPlan} from '../review-skill-plan.js';

beforeEach(()=>{io.query.mockReset();});
describe('手动审查技能快照',()=>{
  it('调用方不能注入伪解析器，为旧账本绑定签发安全计划',async()=>{
    io.query.mockResolvedValue({rows:[{name:'decomp',status:'deprecated',task_types:['architecture_scan'],dispatch_command:null}]});
    const plan=await prepareReviewSkillDispatch({id:'t',task_type:'architecture_scan',payload:{}},{resolver:()=>'/safe'});
    expect(plan).toMatchObject({blocked:true,reason:'retired_decomposition'});
  });
  it('安全计划不能转交给同 ID 和 payload 但标题被修改的任务',async()=>{
    io.query.mockResolvedValue({rows:[{name:'architect',status:'active',task_types:['architecture_scan'],dispatch_command:'/architect scan'}]});
    const task={id:'t',task_type:'architecture_scan',status:'queued',title:'真实任务',payload:{}};
    const plan=await prepareReviewSkillDispatch(task);
    expect(transferReviewSkillPlan(plan.task,{...task,status:'in_progress',title:'伪造任务'})).toBeNull();
  });
  it.each(['/decomp','/decomp-check','  /decomp-check --resume'])( '旧审核命令 %s 禁止签发',async command=>{
    io.query.mockResolvedValue({rows:[{name:'old',status:'deprecated',task_types:['architecture_scan'],dispatch_command:command}]});
    expect(await prepareReviewSkillDispatch({id:'t',task_type:'architecture_scan',payload:{}})).toMatchObject({blocked:true});
  });
  it('近似名称 /decomp-checker 保留',async()=>{
    const plan=await prepareReviewSkillDispatch({id:'t',task_type:'architecture_scan',payload:{skill_override:'/decomp-checker'}});
    expect(plan.blocked).toBe(false);
  });
});
