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
it('只读诊断携带有界失败事实及冻结路径，不复制秘密和业务素材',async()=>{
 const db={query:vi.fn(async sql=>({rows:sql.includes('count(DISTINCT')?[{n:'5'}]:[]}))};
 const c=state(5),sha='a'.repeat(40);
 c.delivery={status:'failed',failure:{code:'MEDIA_NOT_INDEXED',message:'MediaStore mismatch token=secret-token Authorization: Bearer hidden-bearer',stack:'Error at verifyMedia (publish.py:42)',token:'private-token',payload:{caption:'private-caption'}},effects:[{key:'publish',status:'none',evidence:['readback:no-post'],token:'effect-secret'}],cleanup:{completed:true,evidence:['lock:released'],credentials:'cleanup-secret'}};
 c.verification={verdict:'FAIL',assertions:[{name:'readback',pass:false,status:'missing',detail:'expected MediaStore row; got 0',evidence:[{ref:'controller:row-0',url:'https://evidence.invalid/read?token=private-query',caption:'private-material',token:'private-key'}]}],evidence:['controller:row-0']};
 c.envelope.workflow_input={caption:'private-input'};
 const createDiagnosis=vi.fn(async()=>({task:{id:'diagnostic'}}));
 const sources=[{repo:'perfectuser21/zenithjoy-skills',revision:sha,path:'android-publish/SKILL.md'}];
 await recordCommanderFailure(db,{id:'task'},c,'verification_failed',{createDiagnosis,loadSources:async()=>sources});
 const spec=createDiagnosis.mock.calls[0][1],context=JSON.parse(spec.description.split('\n')[1]);
 expect(context).toMatchObject({delivery:{failure:{code:'MEDIA_NOT_INDEXED',stack:'Error at verifyMedia (publish.py:42)'},effects:[{key:'publish',status:'none'}],cleanup:{completed:true}},verification:{verdict:'FAIL',assertions:[{name:'readback',pass:false,detail:'expected MediaStore row; got 0',evidence:[{ref:'controller:row-0'}]}]},frozen_sources:sources});
 for(const secret of ['secret-token','hidden-bearer','private-token','private-caption','private-material','private-query','private-key','private-input','effect-secret','cleanup-secret'])expect(spec.description).not.toContain(secret);
 c.delivery.failure.message='故'.repeat(100000);c.delivery.failure.stack='x'.repeat(100000);
 c.verification.assertions=Array.from({length:1000},()=>({name:'断言'.repeat(1000),detail:'内容'.repeat(1000),pass:false,evidence:['e'.repeat(10000)]}));
 await recordCommanderFailure(db,{id:'task'},c,'verification_failed',{createDiagnosis,loadSources:async()=>sources});
 const bounded=JSON.parse(createDiagnosis.mock.calls[1][1].description.split('\n')[1]);
 expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(24000);expect(bounded.truncated).toBe(true);
 const noEvidence=state(5);noEvidence.verification.evidence=[];
 await recordCommanderFailure(db,{id:'task'},noEvidence,'verification_failed',{createDiagnosis,loadSources:async()=>[]});
 const missing=createDiagnosis.mock.calls[2][1];expect(JSON.parse(missing.description.split('\n')[1]).evidence_status).toBe('insufficient_evidence');
 expect(missing.description).toContain('无固定对象、引用不可读或证据不足时只写note');
});
