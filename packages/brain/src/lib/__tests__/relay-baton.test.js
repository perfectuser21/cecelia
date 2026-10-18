/**
 * 接力棒 PR2 接棒 — 失败复现
 *  1. normalizeNextSteps：字符串→note；对象保留 kind/title/detail；非法丢弃；未知 kind→note；旧值 task 规范为 dispatch_headless（10-11）
 *  2. materializeNextSteps：task→createRoutedTask（source child、source_id 幂等、挂根）；decision→decisions pending（去重）；note→skipped
 *  3. ensureHandoffOnComplete：有 handoff 原样返回；没有→合成 synthesized 并 saveHandoff
 *  4. relayOnComplete：非 completed 不动；异常吞成 null；handoff.brief_delta → applyHandoffBriefDelta（棒2）
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn(async () => null) }));

const applyHandoffBriefDeltaMock = vi.fn(async () => null);
vi.mock('../project-brief-apply.js', () => ({ applyHandoffBriefDelta: (...args) => applyHandoffBriefDeltaMock(...args) }));

import { normalizeNextSteps, materializeNextSteps, ensureHandoffOnComplete, relayOnComplete } from '../relay-baton.js';

const ROOT = '11111111-1111-4111-8111-111111111111';
const SELF = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '66666666-6666-4666-8666-666666666666';

describe('normalizeNextSteps', () => {
  it('字符串→note，对象保留字段，非法丢弃，未知 kind→note', () => {
    const out = normalizeNextSteps([
      '先补文档',
      { kind: 'task', title: '做 B', detail: 'x', task_type: 'data' },
      { kind: 'decision', title: '要不要删列' },
      { kind: 'weird', title: 'z' },
      { kind: 'task' },
      42, null, '   ',
    ]);
    expect(out).toEqual([
      { kind: 'note', title: '先补文档' },
      { kind: 'dispatch_headless', title: '做 B', detail: 'x', task_type: 'data' },
      { kind: 'decision', title: '要不要删列' },
      { kind: 'note', title: 'z' },
    ]);
  });
});

describe('materializeNextSteps', () => {
  const task = { id: SELF, title: '第二棒', priority: 'P1', task_type: 'dev', parent_task_id: ROOT, payload: { repo: 'cecelia', map_scope: ['database_foundation'] } };
  it('task→createRoutedTask：source=child、source_id 幂等、parent=根、lane=AI；decision→pending 决策；note→skipped', async () => {
    const created = [];
    const create = vi.fn(async (_pool, req) => { created.push(req); return { task: { id: `t-${created.length}`, title: req.title } }; });
    const inserted = [];
    const pool = { query: vi.fn(async (sql, params) => {
      if (/SELECT id FROM decisions/.test(sql)) return { rows: [] };
      if (/INSERT INTO decisions/.test(sql)) { inserted.push(params); return { rows: [{ id: 'd-1', topic: params[0] }] }; }
      return { rows: [] };
    }) };
    const out = await materializeNextSteps(pool, task, { next_steps: [
      { kind: 'task', title: '做 B', detail: '细节' },
      { kind: 'task', title: '改代码 C', change_kind: 'bug_fix' },
      { kind: 'decision', title: '要不要删列', detail: '四张表' },
      '只是备注',
    ] }, { createRoutedTask: create });
    expect(out.tasks.map((t) => t.title)).toEqual(['做 B', '改代码 C']);
    expect(created[0]).toMatchObject({ source: 'child', source_id: `handoff:${SELF}:0`, parent_task_id: ROOT, requested_task_type: 'data', mutation_intent: 'none' });
    expect(created[0].metadata).toMatchObject({ lane: 'AI', from_handoff: SELF });
    expect(created[1]).toMatchObject({ requested_task_type: 'coding_workflow', mutation_intent: 'write', declared_change_kind: 'bug_fix', repo_hint: 'cecelia', map_scope_hint: ['database_foundation'] });
    expect(out.decisions).toEqual([{ id: 'd-1', topic: '要不要删列', reused: false }]);
    expect(inserted[0][0]).toBe('要不要删列');
    expect(JSON.parse(inserted[0][3])).toMatchObject({ kind: 'relay_pending', task_id: SELF, root_task_id: ROOT });
    expect(inserted[0][5]).toBe(SELF);
    expect(out.skipped).toEqual([{ index: 3, kind: 'note', title: '只是备注', error: null }]);
  });
  it('decision 去重：同 source_ref+topic 已存在 → reused，不再插', async () => {
    const pool = { query: vi.fn(async (sql) => (/SELECT id FROM decisions/.test(sql) ? { rows: [{ id: 'd-old' }] } : { rows: [] })) };
    const out = await materializeNextSteps(pool, task, { next_steps: [{ kind: 'decision', title: '重复' }] });
    expect(out.decisions).toEqual([{ id: 'd-old', topic: '重复', reused: true }]);
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO decisions/.test(sql))).toBe(false);
  });
  it('无父任务时子任务挂在自己下面（自己即根）', async () => {
    const create = vi.fn(async (_p, req) => ({ task: { id: 't', title: req.title } }));
    await materializeNextSteps({ query: vi.fn() }, { ...task, parent_task_id: null }, { next_steps: [{ kind: 'task', title: 'x' }] }, { createRoutedTask: create });
    expect(create.mock.calls[0][1].parent_task_id).toBe(SELF);
  });
  it('task.project_id 存在 → 子任务继承 project_id，sequence_no=project 下 max+1 递增（棒1，决策 ee4842a6/3feeae3e）', async () => {
    const created = [];
    const create = vi.fn(async (_pool, req) => { created.push(req); return { task: { id: `t-${created.length}`, title: req.title } }; });
    const pool = { query: vi.fn(async (sql) => {
      if (/COALESCE\(MAX\(sequence_no\), 0\) \+ 1/.test(sql)) return { rows: [{ n: 5 }] };
      return { rows: [] };
    }) };
    const projTask = { ...task, project_id: PROJECT_ID };
    await materializeNextSteps(pool, projTask, { next_steps: [
      { kind: 'task', title: '做 B' },
      { kind: 'task', title: '做 C' },
    ] }, { createRoutedTask: create });
    expect(created[0].task).toMatchObject({ project_id: PROJECT_ID, sequence_no: 5 });
    expect(created[1].task).toMatchObject({ project_id: PROJECT_ID, sequence_no: 6 });
  });

  it('task.project_id 不存在（旧链）→ createRoutedTask 请求里不带 project_id/sequence_no（行为不变）', async () => {
    const created = [];
    const create = vi.fn(async (_pool, req) => { created.push(req); return { task: { id: 't', title: req.title } }; });
    await materializeNextSteps({ query: vi.fn() }, task, { next_steps: [{ kind: 'task', title: 'x' }] }, { createRoutedTask: create });
    expect(created[0].task.project_id).toBeUndefined();
    expect(created[0].task.sequence_no).toBeUndefined();
  });

  it('decision 分支：context 带 project_id（有 project_id 时非空，否则 null）', async () => {
    const inserted = [];
    const pool = { query: vi.fn(async (sql, params) => {
      if (/SELECT id FROM decisions/.test(sql)) return { rows: [] };
      if (/INSERT INTO decisions/.test(sql)) { inserted.push(params); return { rows: [{ id: 'd-1', topic: params[0] }] }; }
      return { rows: [] };
    }) };
    await materializeNextSteps(pool, { ...task, project_id: PROJECT_ID }, { next_steps: [{ kind: 'decision', title: '要不要' }] });
    expect(JSON.parse(inserted[0][3])).toMatchObject({ project_id: PROJECT_ID });
  });

  it('createRoutedTask 抛错 → 进 skipped，不中断其余步骤', async () => {
    const create = vi.fn(async (_p, req) => { if (req.title === 'bad') { const e = new Error('x'); e.code = 'routing_map_scope_unresolved'; throw e; } return { task: { id: 'ok', title: req.title } }; });
    const out = await materializeNextSteps({ query: vi.fn() }, task, { next_steps: [{ kind: 'task', title: 'bad' }, { kind: 'task', title: 'good' }] }, { createRoutedTask: create });
    expect(out.skipped[0]).toMatchObject({ kind: 'dispatch_headless', title: 'bad', error: 'routing_map_scope_unresolved' });
    expect(out.tasks.map((t) => t.title)).toEqual(['good']);
  });
});

describe('ensureHandoffOnComplete', () => {
  it('已有 handoff → 原样返回，不写库', async () => {
    const pool = { query: vi.fn() };
    const r = await ensureHandoffOnComplete(pool, { id: SELF, result: { handoff: { schema_version: 1, done: ['a'] } } });
    expect(r.synthesized).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('没有 → 合成 synthesized=true，done 取 result.summary，落 saveHandoff', async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 1, rows: [] })) };
    const r = await ensureHandoffOnComplete(pool, { id: SELF, title: '退役旧网关', result: { summary: '容器删了' } }, { sessionId: 's9' });
    expect(r.synthesized).toBe(true);
    expect(r.handoff.done).toEqual(['容器删了']);
    expect(r.handoff.synthesized).toBe(true);
    expect(r.handoff.session_id).toBe('s9');
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE tasks/.test(sql) && /handoff_log/.test(sql))).toBe(true);
  });
});

describe('relayOnComplete', () => {
  it('任务非 completed → null 且不合成', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: SELF, status: 'in_progress', result: null }] })) };
    expect(await relayOnComplete(pool, SELF)).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
  it('completed_no_pr（openclaw / 设备任务收割态）也接棒：合成 handoff 并落 next_steps', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (/SELECT id, title, status/.test(sql)) return { rows: [{ id: SELF, title: '秋米任务', status: 'completed_no_pr', priority: 'P2', task_type: 'qiumi_task', payload: {}, parent_task_id: ROOT, result: { summary: '发完了' }, summary: null }] };
      return { rowCount: 1, rows: [] };
    }) };
    const out = await relayOnComplete(pool, SELF, { sessionId: 'oc' });
    expect(out).toMatchObject({ synthesized: true, tasks: [], decisions: [], skipped: [] });
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE tasks/.test(sql) && /handoff_log/.test(sql))).toBe(true);
  });
  it('failed 不接棒', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: SELF, status: 'failed', result: null }] })) };
    expect(await relayOnComplete(pool, SELF)).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
  it('查库抛错 → null（不阻塞 PATCH）', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('boom'); }) };
    expect(await relayOnComplete(pool, SELF)).toBeNull();
  });

  it('task 挂 project_id 且 handoff 带 brief_delta → 调用 applyHandoffBriefDelta(pool, task, handoff)，结果挂进返回值.brief（棒2，决策 ee4842a6/3feeae3e）', async () => {
    applyHandoffBriefDeltaMock.mockClear();
    applyHandoffBriefDeltaMock.mockResolvedValueOnce({ applied: true, brief: { goal: 'new goal' } });
    const handoff = { schema_version: 1, done: ['a'], brief_delta: { status: '新现状' } };
    const pool = { query: vi.fn(async (sql) => {
      if (/SELECT id, title, status/.test(sql)) {
        return { rows: [{ id: SELF, title: '第二棒', status: 'completed', priority: 'P1', task_type: 'dev', payload: {}, parent_task_id: ROOT, project_id: PROJECT_ID, result: { handoff }, summary: null }] };
      }
      return { rowCount: 1, rows: [] };
    }) };
    const out = await relayOnComplete(pool, SELF);
    expect(applyHandoffBriefDeltaMock).toHaveBeenCalledTimes(1);
    const [calledPool, calledTask, calledHandoff] = applyHandoffBriefDeltaMock.mock.calls[0];
    expect(calledPool).toBe(pool);
    expect(calledTask).toMatchObject({ id: SELF, project_id: PROJECT_ID });
    expect(calledHandoff).toMatchObject({ brief_delta: { status: '新现状' } });
    expect(out.brief).toEqual({ applied: true, brief: { goal: 'new goal' } });
  });

  it('applyHandoffBriefDelta 抛错 → 吞掉，接棒主流程不受影响', async () => {
    applyHandoffBriefDeltaMock.mockClear();
    applyHandoffBriefDeltaMock.mockRejectedValueOnce(new Error('brief boom'));
    const pool = { query: vi.fn(async (sql) => {
      if (/SELECT id, title, status/.test(sql)) {
        return { rows: [{ id: SELF, title: '第二棒', status: 'completed', priority: 'P1', task_type: 'dev', payload: {}, parent_task_id: ROOT, project_id: PROJECT_ID, result: { handoff: { schema_version: 1, done: ['a'], brief_delta: { status: 'x' } } }, summary: null }] };
      }
      return { rowCount: 1, rows: [] };
    }) };
    const out = await relayOnComplete(pool, SELF);
    expect(out).not.toBeNull();
    expect(out.brief).toBeNull();
  });
});


describe('自动改进诊断接棒',()=>{
 const origin='11111111-1111-4111-8111-111111111111',self='33333333-3333-4333-8333-333333333333';
 const repo='perfectuser21/cecelia',revision='a'.repeat(40);
 const chain={protocol:'commander-improvement-v1',phase:'diagnosis',chain_key:'b'.repeat(64),deadline_at:new Date(Date.now()+3600000).toISOString(),max_repairs:1,effects_safe:true,frozen_sources:[{repo,revision}]};
 const task={id:self,parent_task_id:origin,title:'诊断',status:'completed',task_type:'research',payload:{commander_improvement:chain}};
 const step={kind:'dispatch_headless',title:'修补',change_kind:'bugfix',repo_hint:repo,map_scope_hint:['F1'],base_sha:revision,
  diagnosis:{category:'source_defect',fixed_source:{repo,revision,path:'packages/brain/src/helper.js'},evidence:['readback:fixture'],reproduction:'固定输入复现错误',acceptance:['错误被修复且正常场景无退步'],effects_status:'none'}};
 const pool={query:vi.fn(async()=>({rows:[]}))};
 it('研究任务显式保留仓库范围与固定SHA，跨仓不猜父任务repo',async()=>{
  const create=vi.fn(async(_db,spec)=>({task:{id:'repair',title:spec.title}}));
  const result=await materializeNextSteps(pool,task,{next_steps:[step]},{createRoutedTask:create});
  expect(result.tasks).toHaveLength(1);
  expect(create.mock.calls[0][1]).toMatchObject({requested_task_type:'coding_workflow',repo_hint:repo,map_scope_hint:['F1'],base_sha:revision,
   source_id:'commander-repair:'+chain.chain_key,metadata:{commander_improvement:{phase:'repair',max_repairs:1}}});
 });
 it.each(['external_environment','platform_risk_permission','verifier_defect','insufficient_evidence'])('非源码缺陷不得自动编码：%s',async category=>{
  const create=vi.fn();const result=await materializeNextSteps(pool,task,{next_steps:[{...step,diagnosis:{...step.diagnosis,category}}]},{createRoutedTask:create});
  expect(create).not.toHaveBeenCalled();expect(result.skipped).toHaveLength(1);
 });
 it.each(['missing-source','unknown-effects','expired','repair-budget','missing-scope'])('来源/副作用/预算不足拒绝编码：%s',async reason=>{
  const current=structuredClone(task),next=structuredClone(step);
  if(reason==='missing-source')next.diagnosis.fixed_source.revision='c'.repeat(40);
  if(reason==='unknown-effects')current.payload.commander_improvement.effects_safe=false;
  if(reason==='expired')current.payload.commander_improvement.deadline_at='2000-01-01T00:00:00.000Z';
  if(reason==='repair-budget')current.payload.commander_improvement.phase='repair';
  if(reason==='missing-scope')delete next.map_scope_hint;
  const create=vi.fn();const result=await materializeNextSteps(pool,current,{next_steps:[next]},{createRoutedTask:create});
  expect(create).not.toHaveBeenCalled();expect(result.skipped).toHaveLength(1);
 });
 it('普通结构化编码handoff保留显式目标且无效显式字段不回退到父仓',async()=>{
  const create=vi.fn(async(_db,spec)=>({task:{id:'repair',title:spec.title}}));
  const ordinary={...task,payload:{repo:'other',map_scope:['wrong']}};
  await materializeNextSteps(pool,ordinary,{next_steps:[step]},{createRoutedTask:create});
  expect(create.mock.calls[0][1]).toMatchObject({repo_hint:repo,map_scope_hint:['F1'],base_sha:revision});
  create.mockClear();await materializeNextSteps(pool,ordinary,{next_steps:[{...step,map_scope_hint:'F1'}]},{createRoutedTask:create});
  expect(create).not.toHaveBeenCalled();
 });
});


it('readonly诊断文本回执由终态接棒解析，拒绝串链身份而不要求AI写库',async()=>{
 const {readCommanderDiagnosis}=await import('../commander-improvement.js');
 const chain={protocol:'commander-improvement-v1',phase:'diagnosis',chain_key:'a'.repeat(64),origin_task_id:ROOT};
 const message={chain_key:chain.chain_key,origin_task_id:ROOT,next_steps:[{kind:'note',title:'外部网络，无需编码'}]};
 const task={payload:{commander_improvement:chain,last_run_result:{result_summary:'报告\nCOMMANDER_DIAGNOSIS '+JSON.stringify(message)}}};
 expect(readCommanderDiagnosis(task)).toEqual(message);
 task.payload.last_run_result.result_summary='COMMANDER_DIAGNOSIS '+JSON.stringify({...message,origin_task_id:SELF});
 expect(readCommanderDiagnosis(task)).toBeNull();
});
