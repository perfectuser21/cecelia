import { describe, test, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {reconcileRunEvidence} from '../../lib/run-reconciliation.js';
import { createWorkflowRecorder } from '../workflow-recorder.js';

const dirs = [];
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { workflow_id: id(1), run_binding_id: id(2), reference_id: id(3),
  workflow_definition_version_id: id(4), activity_definition_version_id: id(5), attempt_key: 'a1', enabler_call_id: null };
const questions = Object.fromEntries(['A1','A2','A3','A4','A5','A6','B1','C1','C2','C3']
  .map(k => [k, { ref: `contract:${k}`, version: 'v1', declared: { rule: k } }]));
function options(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-record-')); dirs.push(root);
  return { root, runId: 'run-1', taskId: id(7), machineId: 'machine-1', profileDigest: 'a'.repeat(64),
    mode: 'formal', metadata: { collect: { activity_id: id(6), executor_kind: 'code', questions, identity } }, ...extra };
}
const event = (cursor, event_type, extra = {}) => ({ cursor, event_type, activity: 'collect', item: 'video-1', attempt: 1, ...extra });
const receipt = (attempts = [{ attempt: 1, status: 'completed', outputs: { count: 2 }, metrics: {}, evidence: [] }]) =>
  ({ status: 'completed', activities: [{ key: 'collect', item: 'video-1', attempts }] });
afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })));

describe('公共工作流持久证据Recorder', () => {
  test('Commander交流和逐活动判定落盘并可中央补发，重启不丢失也不伪造业务通过', async () => {
    const o=options();let r=createWorkflowRecorder(o);
    await r.onEvent(event(1,'COMMANDER_EXCHANGE',{action:{action:'steer',text:'补采集原生身份'}}),receipt([]));
    await r.onEvent(event(2,'ACTIVITY_CHECKED',{verdict:{verdict:'fail',evidence:['缺少读回']}}),receipt([]));
    const first=r.inspect();
    expect(first.spans).toHaveLength(2);expect(first.pending).toBe(2);
    expect(first.spans.every(s=>s.outcome==='unknown')).toBe(true);
    r=createWorkflowRecorder(o);expect(r.inspect()).toEqual(first);
    expect(r.inspect().spans[0].evidence.event.action.text).toBe('补采集原生身份');
  });
  test('代码失败后的固定Skill救援按真实执行者与固定Skill来源记账', async () => {
    const o=options();o.metadata.collect.recovery_implementation={kind:'agent',entry:'rescue.mjs',sha256:'b'.repeat(64),skill:{entry:'repair.md',version:'1.0.0',sha256:'c'.repeat(64)}};
    const r=createWorkflowRecorder(o);
    await r.onEvent(event(1,'ACTIVITY_STARTED',{recovery:true}),receipt([]));
    await r.onEvent(event(2,'ACTIVITY_FINISHED'),receipt());
    const span=r.inspect().spans[0];expect(span.executor_kind).toBe('agent');
    expect(span.evidence.questions.B1.actual.entry).toBe('rescue.mjs');expect(span.evidence.questions.B1.actual.skill.version).toBe('1.0.0');
  });
  test('正式身份必须齐全；探索只能unknown；声明不是观察、一次成功不是成熟度', async () => {
    const o = options(); delete o.metadata.collect.identity;
    expect(() => createWorkflowRecorder(o)).toThrow();
    const r = createWorkflowRecorder(options({ mode: 'exploration' }));
    await r.onEvent(event(1, 'ACTIVITY_STARTED'), receipt([]));
    await r.onEvent(event(2, 'ACTIVITY_FINISHED'), receipt());
    const s = r.inspect().spans[0];
    expect(s.outcome).toBe('unknown');
    expect(s.evidence.questions.A1.actual).toBeNull();
    expect(s.evidence.questions.C1.status).toBe('unknown');
    expect(s.evidence.questions.A4.status).toBe('unknown');
    expect(s.evidence.steps).toEqual({ status: 'unknown', reported: [] });
  });
  test('retry/item独立发生位置，开始心跳完成落盘；不推算起始时间', async () => {
    const r = createWorkflowRecorder(options());
    const a = { attempt: 1, status: 'failed', failure_class: 'retryable', outputs: {}, evidence: [] };
    await r.onEvent(event(1, 'ACTIVITY_STARTED'), receipt([]));
    await r.onEvent(event(2, 'ACTIVITY_HEARTBEAT'), receipt([]));
    await r.onEvent(event(3, 'ACTIVITY_FINISHED'), receipt([a]));
    await r.onEvent(event(4, 'ACTIVITY_STARTED', { attempt: 2 }), receipt([a]));
    await r.onEvent(event(5, 'ACTIVITY_FINISHED', { attempt: 2 }), receipt([a, { attempt: 2, status: 'completed', outputs: { steps: [{ id: 's1', status: 'completed' }] }, evidence: [] }]));
    const state = r.inspect(); expect(state.events).toHaveLength(5); expect(state.spans).toHaveLength(2);
    expect(new Set(state.spans.map(s => s.occurrence_key)).size).toBe(2);
    expect(state.spans[1].evidence.steps.reported[0].self_reported).toBe(true);
    expect(state.spans[0].started_at).toBe(state.events[0].observed_at);
    expect(state.spans[0].ended_at).toBe(state.events[2].observed_at);
    await expect(r.onEvent(event(6, 'ACTIVITY_FINISHED', { item: 'missing' }), receipt())).rejects.toThrow('activity_attempt_missing');
  });
  test('独立验证单独记录，不覆写执行事实；A4引用不匹配不能pass', async () => {
    const r = createWorkflowRecorder(options());
    await r.onEvent(event(1, 'ACTIVITY_STARTED'), receipt([])); await r.onEvent(event(2, 'ACTIVITY_FINISHED'), receipt());
    const first = structuredClone(r.inspect().spans[0]);
    await r.recordValidation({ workflow: { verdict: 'pass', acceptance_ref: 'whole', evidence: ['readback'] },
      activities: { collect: { verdict: 'pass', acceptance_ref: 'wrong', evidence: ['readback'] } } });
    const state = r.inspect(); expect(state.spans[0]).toEqual(first);
    expect(state.spans[1].evidence.kind).toBe('validation');
    expect(state.spans[1].outcome).toBe('unknown');
    expect(state.spans[1].evidence.questions.A4.status).toBe('unknown');
  });
  test('POST响应丢失、重启重发、GET读回相同内容才ACK；409保留blocked', async () => {
    const o = options({ brainUrl: 'http://brain' }); let lose = true; let conflict = false; let wrong = false;
    const central = new Map(); const fetchImpl = async (url, req = {}) => {
      if (req.method === 'POST') {
        const s = JSON.parse(req.body);
        if (conflict) return { ok: false, status: 409 };
        central.set(s.occurrence_key, s);
        if (lose) { lose = false; throw Error('response lost'); }
        return { ok: true, status: 200, json: async () => ({ inserted: 0 }) };
      }
      return { ok: true, status: 200, json: async () => ({ spans: [...central.values()].map(s => wrong ? { ...s, outcome: 'fail' } : s) }) };
    };
    let r = createWorkflowRecorder({ ...o, fetchImpl });
    await r.onEvent(event(1, 'ACTIVITY_STARTED'), receipt([])); await r.onEvent(event(2, 'ACTIVITY_FINISHED'), receipt());
    await r.flush(); expect(r.inspect().pending).toBe(1);
    r = createWorkflowRecorder({ ...o, fetchImpl });
    wrong = true; await r.flush(); expect(r.inspect().pending).toBe(1);
    wrong = false; await r.flush(); expect(r.inspect().pending).toBe(0);
    await r.recordValidation({ workflow: { verdict: 'pass' }, activities: { collect: { verdict: 'pass', acceptance_ref: 'contract:A4', evidence: ['independent'] } } });
    conflict = true; await r.flush(); expect(r.inspect().blocked).toHaveLength(1); expect(r.inspect().pending).toBe(1);
  });
  test('重复事件不变；异内容拒绝；落盘错误抛出；原始结果脱敏', async () => {
    const o = options(); const r = createWorkflowRecorder(o);
    await r.onEvent(event(1, 'ACTIVITY_STARTED'), receipt([]));
    await r.onEvent(event(1, 'ACTIVITY_STARTED'), receipt([])); expect(r.inspect().events).toHaveLength(1);
    await expect(r.onEvent(event(1, 'ACTIVITY_STARTED', { attempt: 2 }), receipt([]))).rejects.toThrow('event_occurrence_conflict');
    const raw = receipt([{ attempt: 1, status: 'completed', outputs: { password: 'hidden', text: 'Bearer ABC' }, transport: { stdout: 'secret', stderr: 'secret' } }]);
    await r.onEvent(event(2, 'ACTIVITY_FINISHED'), raw);
    await expect(r.onEvent(event(3, 'ACTIVITY_FINISHED'), raw)).rejects.toThrow('span_occurrence_conflict');
    expect(JSON.stringify(r.inspect())).not.toContain('hidden'); expect(JSON.stringify(r.inspect())).not.toContain('Bearer ABC');
    fs.rmSync(o.root, { recursive: true }); fs.writeFileSync(o.root, 'blocked');
    await expect(r.finalize(raw, { workflow: { verdict: 'unknown' }, activities: {} })).rejects.toThrow();
  });
  test('独立验收pass独立落账；探索仍unknown；重启保留记录及正式身份', async () => {
    const o = options(); let r = createWorkflowRecorder(o);
    await r.onEvent(event(1, 'ACTIVITY_STARTED'), receipt([])); await r.onEvent(event(2, 'ACTIVITY_FINISHED'), receipt());
    const verdict = { workflow: { verdict: 'pass', acceptance_ref: 'whole', evidence: ['workflow-readback'] },
      activities: { collect: { verdict: 'pass', acceptance_ref: 'contract:A4', evidence: ['independent-readback'] } } };
    await r.recordValidation(verdict); await r.finalize(receipt(), verdict);
    const saved = r.inspect(); expect(saved.spans).toHaveLength(2); expect(saved.spans[0].outcome).toBe('unknown');
    expect(saved.spans[1].outcome).toBe('pass'); expect(saved.spans[1].identity_protocol).toBe(2);
    expect(saved.records.at(-1).kind).toBe('terminal');
    r = createWorkflowRecorder(o); expect(r.inspect()).toEqual(saved);
    expect(() => createWorkflowRecorder({ ...o, machineId: 'other' })).toThrow('recorder_identity_conflict');
    const e = createWorkflowRecorder(options({ mode: 'exploration' }));
    await e.onEvent(event(1, 'ACTIVITY_STARTED'), receipt([])); await e.onEvent(event(2, 'ACTIVITY_FINISHED'), receipt());
    await e.recordValidation(verdict); await e.finalize(receipt(), verdict);
    expect(e.inspect().spans.every(s => s.outcome === 'unknown')).toBe(true);
    expect(e.inspect().records.at(-1).outcome).toBe('unknown');
  });
  test('同实例flush串行；先加载的另实例会补读新outbox，响应丢失不丢记录', async () => {
    const o = options({ brainUrl: 'http://brain' }); const central = new Map();
    let posting = 0, maximum = 0;
    const fetchImpl = async (_url, req = {}) => {
      if (req.method === 'POST') {
        posting++; maximum = Math.max(maximum, posting); const s = JSON.parse(req.body); central.set(s.occurrence_key, s);
        await new Promise(resolve => setTimeout(resolve, 5)); posting--;
        return { ok: true, status: 200 };
      }
      return { ok: true, json: async () => ({ spans: [...central.values()] }) };
    };
    const first = createWorkflowRecorder({ ...o, fetchImpl }), second = createWorkflowRecorder({ ...o, fetchImpl });
    await first.onEvent(event(1, 'ACTIVITY_STARTED'), receipt([])); await first.onEvent(event(2, 'ACTIVITY_FINISHED'), receipt());
    await Promise.all([second.flush(), second.flush()]); expect(maximum).toBe(1);
    expect(second.inspect().pending).toBe(0); expect(second.inspect().spans).toHaveLength(1);
    expect((await first.flush()).pending).toBe(0);
    expect(createWorkflowRecorder({ ...o, fetchImpl }).inspect().pending).toBe(0);
  });
  test('自动采运行事实，部分覆盖不冒充整题完成；成熟度不接受执行器自封', async () => {
    const o = options(); o.metadata.collect.implementation = { entry: 'collect.mjs', sha256: 'b'.repeat(64), kind: 'code' };
    const r = createWorkflowRecorder(o);
    await r.onEvent(event(1, 'ACTIVITY_STARTED', { input: { query: 'actual' }, budget: { max_duration_s: 5 } }), receipt([]));
    const a = { attempt: 1, status: 'completed', outputs: { count: 2, steps: [{ id: 'step-1', action: 'read' }] }, evidence: ['native'],
      observations: { C1: { actual: { maturity: 'confirmed' }, evidence: ['one-success'] } } };
    await r.onEvent(event(2, 'ACTIVITY_FINISHED'), receipt([a]));
    const s = r.inspect().spans[0], q = s.evidence.questions;
    expect(q.A2.actual.input).toEqual({ query: 'actual' }); expect(q.A3.actual.outputs.count).toBe(2);
    expect(q.A5.actual.budget.max_duration_s).toBe(5); expect(q.A5.actual.duration_ms).toBeGreaterThanOrEqual(0);
    expect(q.A6.actual.retries_observed).toBe(0); expect(q.B1.actual.entry).toBe('collect.mjs');
    expect(q.C3.actual.run_id).toBe('run-1'); expect(q.C1.status).toBe('unknown'); expect(q.C1.candidate.actual.maturity).toBe('confirmed');
    expect(q.A2.completeness).toBe('partial'); expect(s.evidence.steps.reported[0].fields.side_effect).toEqual({ status: 'unknown', actual: null });
    const v = { workflow: { verdict: 'pass', evidence: ['whole'] }, activities: { collect: { verdict: 'pass', acceptance_ref: 'contract:A4',
      evidence: ['native-readback'], executor: { entry: 'check.mjs', sha256: 'c'.repeat(64), kind: 'code' } } } };
    await r.recordValidation(v); expect(r.inspect().spans[1].evidence.questions.C2.actual.executor.entry).toBe('check.mjs');
    const result = await r.flush(); expect(result).toMatchObject({ total: 2, pending: 2, acked: 0, blocked: 0 });
    expect(result.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  test('没有start仅允许明确未调用的预检失败；完成或未知metadata仍拒绝', async () => {
    const r = createWorkflowRecorder(options());
    await expect(r.onEvent(event(1, 'ACTIVITY_FINISHED'), receipt())).rejects.toThrow('activity_start_missing');
    const a = { attempt: 1, status: 'failed', transport: null, reason_code: 'activity_input_path_missing', outputs: {}, evidence: [] };
    await expect(r.onEvent(event(1, 'ACTIVITY_FINISHED', { activity: 'unregistered' }), receipt([a]))).rejects.toThrow('activity_metadata_missing');
    await r.onEvent(event(1, 'ACTIVITY_FINISHED'), receipt([a]));
    const s = r.inspect().spans[0];
    expect(s.evidence).toMatchObject({ timing_semantics: 'preflight_failure_observed', execution_invoked: false, start_known: false });
    expect(s.started_at).toBe(s.ended_at); expect(s.evidence.questions.A2.status).toBe('unknown');
  });
});
function stepFixture(at='collect'){
 const o=options(),step={step_id:id(20),locator:{activity_id:id(6),step_key:'read_actual'},registration:{key:'flow.collect.read_actual',source_sha256:'d'.repeat(64)},contract:{key:'read_actual',dod:{at}}};
 o.metadata.collect.questions=structuredClone(questions);o.metadata.collect.questions.B1.declared.steps=[step];o.metadata.collect.runtime_snapshot_sha256='e'.repeat(64);
 if(at!=='collect')o.metadata[at]={...structuredClone(o.metadata.collect),activity_id:id(16),identity:{...identity,reference_id:id(13),activity_definition_version_id:id(15)},questions:structuredClone(questions)};
 const observation={key:'flow.collect.read_actual',activity:'collect',at,mode:'hard',type:'metric',pass:true,observed:1};
 const file=path.join(o.root,'independent-step-proof.json');fs.writeFileSync(file,JSON.stringify({verified:true,step_dod:[{steps:[observation]}]}));
 const proof={path:file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
 const row={step_id:step.step_id,activity_key:'collect',activity_id:id(6),reference_id:id(3),activity_definition_version_id:id(5),verdict:'pass',acceptance_ref:`step:${step.step_id}@${step.registration.source_sha256}`,evidence:[{...proof,observation}]};
 const v={verdict:'pass',acceptance_ref:'contract:A4',evidence:[proof],executor:{kind:'code',entry:'check.mjs',sha256:'f'.repeat(64)},step_checks:[row]};
 return {o,row,v,at,step,proof};
}
async function recordStepFixture(f,{selfReported=false,omitCheckEvent=false}={}){
 const r=createWorkflowRecorder(f.o),keys=Object.keys(f.o.metadata),activities=keys.map(key=>({key,item:'video-1',attempts:[{attempt:1,status:'completed',outputs:selfReported?{steps:[f.step]}:{},evidence:[]}]}));let cursor=0;
 const validations={};
 for(const key of keys){const v=key===f.at?f.v:{verdict:'pass',acceptance_ref:'contract:A4',evidence:['independent-activity']};validations[key]=v;
  await r.onEvent(event(++cursor,'ACTIVITY_STARTED',{activity:key}),{activities});
  if(!omitCheckEvent)await r.onEvent(event(++cursor,'ACTIVITY_CHECKED',{activity:key,phase:'end',verdict:v}),{activities});
  await r.onEvent(event(++cursor,'ACTIVITY_FINISHED',{activity:key}),{activities});
 }
 return {r,validation:{workflow:{verdict:'pass',acceptance_ref:'whole',evidence:['whole-readback']},activities:validations}};
}
test('独立Step真实读回经可信recordValidation写原step_id，满足完整expected_path且重启幂等',async()=>{
 const f=stepFixture('cleanup'),{r,validation}=await recordStepFixture(f);await r.recordValidation(validation);await r.recordValidation(validation);
 const spans=r.inspect().spans,stepSpans=spans.filter(s=>s.step_id===f.step.step_id);expect(stepSpans).toHaveLength(1);
 expect(stepSpans[0]).toMatchObject({activity_id:id(6),reference_id:id(3),activity_definition_version_id:id(5),outcome:'pass',evidence:{kind:'validation',execution_activity:'cleanup',runtime_snapshot_sha256:'e'.repeat(64),profile_digest:f.o.profileDigest,task_id:f.o.taskId,machine_id:f.o.machineId}});
 const expected=Object.values(f.o.metadata).map(m=>({reference_id:m.identity.reference_id,activity_id:m.activity_id,activity_definition_version_id:m.identity.activity_definition_version_id}));expected.push({...expected[0],step_id:f.step.step_id});
 expect(reconcileRunEvidence({run_id:f.o.runId,context:{binding:{id:identity.run_binding_id,expected_path:expected}},spans}).evidence_status).toBe('verified');expect(createWorkflowRecorder(f.o).inspect().spans).toEqual(spans);
});
test('原B1声明和执行器steps自述不能生成Step通过事实',async()=>{
 const f=stepFixture();delete f.v.step_checks;const {r,validation}=await recordStepFixture(f,{selfReported:true});await r.recordValidation(validation);expect(r.inspect().spans.some(s=>s.step_id)).toBe(false);
});
test.each(['foreign-step','foreign-av','foreign-ref','wrong-source-hash','wrong-evidence-hash','self-reported','early-stage','no-observed'])('Step事实拒绝错误固定身份、来源或实际证据：%s',async kind=>{
 const f=stepFixture();if(kind==='foreign-step')f.row.step_id=id(99);if(kind==='foreign-av')f.row.activity_definition_version_id=id(99);if(kind==='foreign-ref')f.row.reference_id=id(99);if(kind==='wrong-source-hash')f.row.acceptance_ref=`step:${f.step.step_id}@${'0'.repeat(64)}`;
 if(kind==='wrong-evidence-hash')f.row.evidence[0].sha256='0'.repeat(64);if(kind==='self-reported')f.row.evidence[0].observation.pass=false;if(kind==='early-stage')f.row.evidence[0].observation.at='cleanup';if(kind==='no-observed')delete f.row.evidence[0].observation.observed;
 const {r,validation}=await recordStepFixture(f);await expect(r.recordValidation(validation)).rejects.toThrow('recorder_step');expect(r.inspect().spans.some(s=>s.step_id)).toBe(false);
});
test('无本轮实际独立end检查事件不能用终态对象补造Step事实',async()=>{
 const f=stepFixture(),{r,validation}=await recordStepFixture(f,{omitCheckEvent:true});await expect(r.recordValidation(validation)).rejects.toThrow('recorder_step');expect(r.inspect().spans.some(s=>s.step_id)).toBe(false);
});
