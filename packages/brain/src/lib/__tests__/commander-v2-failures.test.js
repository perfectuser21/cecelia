import { it, expect, vi } from 'vitest';
import { recordCommanderFailure } from '../commander-v2-failures.js';
function state(threshold){return {envelope:{run_id:'run',workflow_key:'report',definition:{release_id:'release',snapshot_sha256:'frozen',runtime_snapshot_sha256:'runtime'},recovery:{improvement_after_failures:threshold}},verification:{assertions:[{name:'readback',pass:false}],evidence:['independent:source']}};}
it('同版本失败达阈值自动创建只读诊断而不是现场改实现',async()=>{
 const db={query:vi.fn(async sql=>({rows:sql.includes('count(DISTINCT')?[{n:'5'}]:[]}))};
 const createDiagnosis=vi.fn(async(_db,spec)=>({task:{id:'diagnostic',payload:spec.metadata}}));
 const result=await recordCommanderFailure(db,{id:'task'},state(5),'verification_failed',{createDiagnosis,loadSources:async()=>[]});
 expect(result).toMatchObject({occurrences:5,implementation_version:{runtime_snapshot_sha256:'runtime'},improvement_suggestion:{kind:'decision',threshold:5},improvement:{status:'queued',task_id:'diagnostic'}});
 expect(createDiagnosis).toHaveBeenCalledOnce();
 const spec=createDiagnosis.mock.calls[0][1];
 expect(spec).toMatchObject({requested_task_type:'research',mutation_intent:'read_only',declared_domain:'research'});
 expect(spec.metadata.commander_improvement).toMatchObject({phase:'diagnosis',max_repairs:1});
 expect(spec.description).toContain('未知副作用');
 expect(db.query.mock.calls.some(([sql])=>/INSERT INTO tasks|UPDATE/.test(sql))).toBe(false);
});
it('同一run补读不再追加失败事实，未配阈值仅累计',async()=>{
 const db={query:vi.fn(async sql=>({rows:sql.includes('count(DISTINCT')?[{n:'10'}]:[{payload:{run_id:'run'}}]}))};
 const result=await recordCommanderFailure(db,{id:'task'},state(undefined),'verification_failed');
 expect(result.improvement_suggestion).toBeUndefined();expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);
});
