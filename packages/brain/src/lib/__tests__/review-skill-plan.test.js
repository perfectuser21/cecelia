import { beforeEach, describe, expect, it, vi } from 'vitest';
const io=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../../db.js',()=>({default:{query:io.query}}));
import {prepareReviewSkillDispatch,transferReviewSkillPlan} from '../review-skill-plan.js';

beforeEach(()=>{io.query.mockReset();});
describe('手动审查技能快照',()=>{
  it('安全计划不能转交给同 ID 和 payload 但标题被修改的任务',async()=>{
    io.query.mockResolvedValue({rows:[{name:'architect',status:'active',task_types:['architecture_scan'],dispatch_command:'/architect scan'}]});
    const task={id:'t',task_type:'architecture_scan',status:'queued',title:'真实任务',payload:{}};
    const plan=await prepareReviewSkillDispatch(task);
    expect(transferReviewSkillPlan(plan.task,{...task,status:'in_progress',title:'伪造任务'})).toBeNull();
  });
});
