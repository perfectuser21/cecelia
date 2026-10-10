import {describe,it,expect,vi} from 'vitest';
vi.mock('../db.js',()=>({default:{query:vi.fn(),connect:vi.fn()}}));
import {deterministicScriptSql} from '../lib/code-script-policy.js';
import {buildPauseLowPriorityQuery,buildCancelPendingQuery} from '../alertness/escalation.js';
describe('代码调度合同',()=>{
 it('只有明确 JSON false 且正式 active Workflow 能独立调度',()=>{const sql=deterministicScriptSql('t');expect(sql).toContain("t.task_type = 'script_run'");expect(sql).toContain("t.payload->'runtime_requires_llm' = 'false'::jsonb");expect(sql).toContain("workflow.status = 'active'");expect(sql).toContain("requires_cortex");expect(sql).toContain("workflow.id::text = t.payload->>'workflow_id'");});
 it('AI 优雅降级仅豁免正规代码而不能豁免任意 script',()=>{expect(buildPauseLowPriorityQuery()).toContain(deterministicScriptSql('tasks'));});
 it('紧急 cancel_pending 仍保持暂停包括代码任务',()=>{expect(buildCancelPendingQuery(false)).not.toContain("runtime_requires_llm");});
});
