/** 技能工厂自动裁判（任务 2231ecc0）：代码裁判、与 run-verify 合并、runs 去重、safe_stop。 */
import { describe, it, expect, vi } from 'vitest';
import {
  outwardCount, computeCodeVerdict, readVisualVerdict, mergeVerdicts, buildVerifySpec, judgeTask, runFactoryJudge,
} from '../factory-judge.js';
import { resolveWorkflowConfig } from '../factory-workflow-config.js';
import { parseFactoryContract } from '../../../scripts/factory-dispatcher/factory-dispatcher.js';

const LEDGER = '1b5a0be0-f0b2-4960-af44-f09790a039c1';
const cfg = resolveWorkflowConfig('douyin_video_publish.android');
const okDelivery = (over = {}) => ({
  run_id: 'sf3-aaaaaaaa-20261011-r1', claimed_result: 'success', lock_released: true, fail_reason: null,
  side_effects: [{ action: '私密发布一次', reversible: false }],
  readback: { publish_attempts: 1, lock_status: 'free', private_before: 5, private_after: 6 },
  final_evidence: ['x-outward-ledger', 'x-lock-acquire', 'x-lock-release'], acceptance: '私密作品 +1', ...over,
});
const execTask = (over = {}) => ({
  id: 'aaaaaaaa-1111-4222-8333-444444444444', title: '技能工厂 验证 抖音 第1轮', status: 'completed',
  payload: { factory_dispatch: true, factory_ledger_id: LEDGER, factory: { stage: '3', workflow_key: 'douyin_video_publish.android', skill: 'android-douyin-private-video@1.0.8', agent: 'skill-factory', device: { ...cfg.device } } },
  result: { delivery: okDelivery() }, ...over,
});

describe('代码裁判 computeCodeVerdict', () => {
  it('交付齐全、对外动作恰好 1 次、锁已放 → pass', () => {
    const v = computeCodeVerdict({ taskStatus: 'completed', delivery: okDelivery(), expectedOutward: 1, requireEvidence: true });
    expect(v.verdict).toBe('pass');
    expect(v.outward_count).toBe(1);
    expect(v.safe_stop).toBe(false);
  });
  it('对外动作 2 次（发了两次）→ fail，不是 safe_stop', () => {
    const v = computeCodeVerdict({ taskStatus: 'completed', delivery: okDelivery({ readback: { publish_attempts: 2, lock_status: 'free' } }), expectedOutward: 1 });
    expect(v.verdict).toBe('fail');
    expect(v.checks.find((c) => c.name === 'outward_count').pass).toBe(false);
    expect(v.safe_stop).toBe(false);
  });
  it('锁没放 / claimed_result 非 success / 读回锁非 free / 自带验收项不过 → fail', () => {
    expect(computeCodeVerdict({ taskStatus: 'completed', delivery: okDelivery({ lock_released: false }) }).verdict).toBe('fail');
    expect(computeCodeVerdict({ taskStatus: 'completed', delivery: okDelivery({ claimed_result: undefined }) }).verdict).toBe('fail');
    expect(computeCodeVerdict({ taskStatus: 'completed', delivery: okDelivery({ readback: { publish_attempts: 1, lock_status: 'held' } }) }).verdict).toBe('fail');
    expect(computeCodeVerdict({ taskStatus: 'completed', delivery: okDelivery({ acceptance_checks: [{ pass: true }, { result: 'fail' }] }) }).verdict).toBe('fail');
  });
  it('发布前安全停止、对外动作 0 次 → fail 且 safe_stop', () => {
    const v = computeCodeVerdict({ taskStatus: 'failed', delivery: okDelivery({ claimed_result: 'blocked', side_effects: [], readback: { publish_attempts: 0, lock_status: 'free' }, fail_reason: '不在发布时段' }), expectedOutward: 1 });
    expect(v.verdict).toBe('fail');
    expect(v.safe_stop).toBe(true);
  });
  it('outwardCount：无读回时数不可逆 side_effects', () => {
    expect(outwardCount({ side_effects: [{ reversible: false }, { reversible: true }, {}] })).toBe(2);
    expect(outwardCount({})).toBe(0);
  });
  it('要求看图时 final_evidence 为空 → fail', () => {
    expect(computeCodeVerdict({ taskStatus: 'completed', delivery: okDelivery({ final_evidence: [] }), requireEvidence: true }).verdict).toBe('fail');
  });
});

describe('与 run-verify 合并', () => {
  it('两者都 pass 才 pass', () => {
    expect(mergeVerdicts('pass', 'pass')).toBe('pass');
    expect(mergeVerdicts('pass', 'fail')).toBe('fail');
    expect(mergeVerdicts('fail', 'pass')).toBe('fail');
    expect(mergeVerdicts('pass', undefined)).toBe('pass');
  });
  it('readVisualVerdict：未终态等；result.verification 读 verdict；run_id 不符算 fail；无 verdict 为无结论', () => {
    expect(readVisualVerdict({ status: 'in_progress' }, 'r1')).toMatchObject({ verdict: null, terminal: false });
    expect(readVisualVerdict({ status: 'completed', result: { verification: { verdict: 'pass', run_id: 'r1' } } }, 'r1').verdict).toBe('pass');
    expect(readVisualVerdict({ status: 'completed', result: { delivery: { verdict: 'fail', run_id: 'r1' } } }, 'r1').verdict).toBe('fail');
    expect(readVisualVerdict({ status: 'completed', result: { verification: { verdict: 'pass', run_id: 'r2' } } }, 'r1').verdict).toBe('fail');
    expect(readVisualVerdict({ status: 'failed', result: {} }, 'r1')).toMatchObject({ verdict: null, terminal: true });
  });
  it('核验单契约能被派发器解析，正文指明被核验任务 id 与 run_id', () => {
    const t = execTask();
    const spec = buildVerifySpec({ execTask: t, delivery: t.result.delivery, ledgerId: LEDGER, cfg });
    const parsed = parseFactoryContract({ payload: spec.payload });
    expect(parsed.ok).toBe(true);
    expect(parsed.contract.stage).toBe('verify');
    expect(parsed.contract.skill).toBe('run-verify');
    expect(spec.description).toContain('阶段：核验');
    expect(spec.description).toContain('使用 skill：run-verify');
    expect(spec.description).toContain(t.id);
    expect(spec.description).toContain('sf3-aaaaaaaa-20261011-r1');
    // 派发总闸 F（任务 0a70684f）：核验单与执行单同为 skill_factory_run，tick 按类型排除
    expect(spec.task_type).toBe('skill_factory_run');
    expect(spec.payload.headed_manual).toBeUndefined();
    expect(spec.source_id).toBe(`factory-judge:verify:${t.id}`);
  });
});

function fakeStore({ verifyTask = null, ledger = { id: LEDGER, stage: 3, workflow_key: 'douyin_video_publish.android' } } = {}) {
  const writes = [];
  return {
    writes,
    listCandidates: vi.fn(async () => []),
    findLedger: vi.fn(async () => ledger),
    getTask: vi.fn(async () => verifyTask),
    writeJudge: vi.fn(async (id, j) => { writes.push({ id, j }); }),
  };
}
const depsWith = (store, over = {}) => ({
  store, resolveConfig: resolveWorkflowConfig, log: () => {},
  createTask: vi.fn(async () => ({ success: true, task: { id: 'bbbbbbbb-1111-4222-8333-444444444444' } })),
  recordRun: vi.fn(async () => ({ duplicate: false })), ...over,
});

describe('judgeTask 流程', () => {
  it('代码 pass → 建核验单、标 awaiting_verify，不记台账', async () => {
    const store = fakeStore();
    const deps = depsWith(store);
    const out = await judgeTask(execTask(), deps);
    expect(out.state).toBe('awaiting_verify');
    expect(deps.createTask).toHaveBeenCalledTimes(1);
    expect(deps.recordRun).not.toHaveBeenCalled();
    expect(store.writes[0].j).toMatchObject({ state: 'awaiting_verify', verify_task_id: 'bbbbbbbb-1111-4222-8333-444444444444' });
  });
  it('核验 pass → 合并 pass 记进台账（带 run_id）', async () => {
    const store = fakeStore({ verifyTask: { id: 'v', status: 'completed', result: { verification: { verdict: 'pass', run_id: 'sf3-aaaaaaaa-20261011-r1' } } } });
    const deps = depsWith(store);
    const t = execTask();
    t.result.factory_judge = { state: 'awaiting_verify', verify_task_id: 'v', code: computeCodeVerdict({ taskStatus: 'completed', delivery: t.result.delivery }) };
    const out = await judgeTask(t, deps);
    expect(out).toMatchObject({ state: 'final', verdict: 'pass', recorded: true });
    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.recordRun).toHaveBeenCalledWith(LEDGER, expect.objectContaining({ run_id: 'sf3-aaaaaaaa-20261011-r1', pass: true, safe_stop: false }));
  });
  it('核验 fail → 合并 fail', async () => {
    const store = fakeStore({ verifyTask: { id: 'v', status: 'completed', result: { verification: { verdict: 'fail', run_id: 'sf3-aaaaaaaa-20261011-r1' } } } });
    const deps = depsWith(store);
    const t = execTask();
    t.result.factory_judge = { state: 'awaiting_verify', verify_task_id: 'v', code: { verdict: 'pass', checks: [], outward_count: 1, safe_stop: false } };
    expect((await judgeTask(t, deps)).verdict).toBe('fail');
    expect(deps.recordRun).toHaveBeenCalledWith(LEDGER, expect.objectContaining({ pass: false }));
  });
  it('核验单仍在跑 → 保持 awaiting_verify，不写不记', async () => {
    const store = fakeStore({ verifyTask: { id: 'v', status: 'in_progress', result: {} } });
    const deps = depsWith(store);
    const t = execTask();
    t.result.factory_judge = { state: 'awaiting_verify', verify_task_id: 'v', code: { verdict: 'pass', checks: [], outward_count: 1, safe_stop: false } };
    expect((await judgeTask(t, deps)).state).toBe('awaiting_verify');
    expect(store.writeJudge).not.toHaveBeenCalled();
    expect(deps.recordRun).not.toHaveBeenCalled();
  });
  it('核验无结论 → final inconclusive，不计入台账', async () => {
    const store = fakeStore({ verifyTask: { id: 'v', status: 'failed', result: { fail_reason: 'lock_wait_timeout' } } });
    const deps = depsWith(store);
    const t = execTask();
    t.result.factory_judge = { state: 'awaiting_verify', verify_task_id: 'v', code: { verdict: 'pass', checks: [], outward_count: 1, safe_stop: false } };
    expect((await judgeTask(t, deps)).verdict).toBe('inconclusive');
    expect(deps.recordRun).not.toHaveBeenCalled();
  });
  it('安全停止的执行单 → 不建核验单，直接记 fail + safe_stop', async () => {
    const store = fakeStore();
    const deps = depsWith(store);
    const t = execTask({ status: 'failed', result: { delivery: okDelivery({ claimed_result: 'blocked', side_effects: [], readback: { publish_attempts: 0, lock_status: 'free' }, fail_reason: '时段外' }) } });
    const out = await judgeTask(t, deps);
    expect(out).toMatchObject({ state: 'final', verdict: 'fail', safe_stop: true });
    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.recordRun).toHaveBeenCalledWith(LEDGER, expect.objectContaining({ pass: false, safe_stop: true }));
  });
  it('runs 去重：台账回 duplicate 时如实记 duplicate，不重复计数', async () => {
    const store = fakeStore();
    const deps = depsWith(store, { recordRun: vi.fn(async () => ({ duplicate: true })) });
    const t = execTask({ status: 'failed', result: { delivery: okDelivery({ claimed_result: 'failed', fail_reason: 'x' }) } });
    const out = await judgeTask(t, deps);
    expect(out.duplicate).toBe(true);
    expect(store.writes.at(-1).j).toMatchObject({ state: 'final', duplicate: true });
  });
  it('runFactoryJudge：单张出错不影响其余', async () => {
    const store = fakeStore();
    store.listCandidates = vi.fn(async () => [execTask({ id: 'bad' }), execTask({ id: 'good', status: 'failed', result: { delivery: okDelivery({ claimed_result: 'failed', fail_reason: 'x' }) } })]);
    let n = 0;
    const deps = depsWith(store, { createTask: vi.fn(async () => { n += 1; throw new Error('boom'); }) });
    const out = await runFactoryJudge(deps);
    expect(out[0].error).toBe('boom');
    expect(out[1]).toMatchObject({ verdict: 'fail' });
    expect(n).toBe(1);
  });
});


describe('Commander v2 正式独立核验与归属（D 回归）', () => {
  const control = (over={}) => ({phase:'final',verdict:'PASS',verify_task_id:'verify-1',
    envelope:{task_id:'exec-1',run_id:'run-1',attempt:1,definition:{snapshot_sha256:'hash',expected_path:[{activity_id:'a1',activity_definition_version_id:'av2'}]}},
    verification:{task_id:'exec-1',run_id:'run-1',attempt:1,definition_sha256:'hash',verdict:'PASS',assertions:[{name:'cleanup',pass:true}],evidence:['actual-readback']}, ...over});
  const task = c => ({id:'exec-1',status:'completed',payload:{factory_dispatch:true,commander_protocol:'commander-v2'},result:{workflow_control:c}});
  it('控制器自报PASS但缺正式核验任务不能计成功', async () => {
    const store=fakeStore(); const deps=depsWith(store);
    const out=await judgeTask(task(control()),deps);
    expect(out.verdict).toBe('inconclusive'); expect(deps.recordRun).not.toHaveBeenCalled();
  });
  it('核验run不符不能给固定版本PASS', async () => {
    const store=fakeStore({verifyTask:{id:'verify-1',status:'completed',result:{}}});const deps=depsWith(store);
    const c=control();c.verification.run_id='other';
    expect((await judgeTask(task(c),deps)).verdict).toBe('inconclusive');
  });  it('正式核验成功保留Code失败和Skill救场，业务成功不晋级Code', async () => {
    const c=control(); c.envelope.contract={environment:{id:'phone',fingerprint:'p1'}};
    const store=fakeStore({verifyTask:{id:'verify-1',status:'completed',result:{workflow_verification:c.verification}}});
    const implementation={kind:'code',id:'publish',version:'2',digest:'c2'};
    const frozen={commander_implementations:{code:{implementation,path:'publish.js'}},implementation_bindings:[{...implementation,path:'publish.js'}],steps:[{step_id:'s1',locator:{step_key:'publish'},contract:{readback:{type:'metric',expect:{op:'==',value:1}}}}]};
    const evidence={implementation,execution_role:'primary',environment:c.envelope.contract.environment,observed:0};
    store.readActivityEvidence=vi.fn(async()=>[{run_id:'run-1',step_id:'s1',activity_id:'a1',activity_definition_version_id:'av2',outcome:'fail',started_at:'2026-10-14T08:00:00Z',identity_protocol:2,run_binding_id:'b1',binding_verified:true,frozen_payload:frozen,evidence},
      {run_id:'run-1',step_id:'s1',activity_id:'a1',activity_definition_version_id:'av2',outcome:'pass',started_at:'2026-10-14T08:00:01Z',evidence:{...evidence,observed:1,implementation:{...implementation,kind:'skill',digest:'s2'},execution_role:'rescue'}}]);
    const deps=depsWith(store),out=await judgeTask(task(c),deps);
    expect(out.verdict).toBe('pass');expect(out.degraded).toBe(true);
    expect(out.activity_evidence).toEqual(expect.arrayContaining([expect.objectContaining({execution_role:'primary',pass:false,readback_verified:false}),expect.objectContaining({execution_role:'rescue',pass:true,readback_verified:false})]));
    expect(deps.recordRun).toHaveBeenCalledWith(LEDGER,expect.objectContaining({pass:true,degraded:true,activity_evidence:out.activity_evidence}));
  });
  it('业务未知保留INCONCLUSIVE，不作已证明失败入窗', async () => {
    const c=control({verdict:'INCONCLUSIVE'}),store=fakeStore(),deps=depsWith(store);
    const out=await judgeTask(task(c),deps);
    expect(out.verdict).toBe('inconclusive');expect(out.business_verdict).toBe('INCONCLUSIVE');
    expect(deps.recordRun).not.toHaveBeenCalled();
  });

});
