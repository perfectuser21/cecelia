/** 技能工厂台账纯规则（迁移 548）：阶段转换规则、滑窗计数、入参校验。 */
import { describe, it, expect, vi } from 'vitest';
import {
  STAGE_NAMES, RULE_RETREATS, checkTransition, applyRunOutcome, decideEvidenceWindow, validateCreate, validatePatch, validateTransition, validateRun, createLedger,
} from '../factory-ledger.js';

describe('阶段转换规则 checkTransition', () => {
  it('7 个阶段都有中文名', () => {
    expect(Object.keys(STAGE_NAMES).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(STAGE_NAMES[4]).toBe('沉淀');
  });
  it('rule / agent 只允许相邻推进', () => {
    for (const actor of ['rule', 'agent']) {
      expect(checkTransition({ from: 1, to: 2, actor })).toEqual({ ok: true, kind: 'advance' });
      expect(checkTransition({ from: 6, to: 7, actor })).toEqual({ ok: true, kind: 'advance' });
      expect(checkTransition({ from: 1, to: 3, actor })).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    }
  });
  it('rule 只允许登记过的退回（守护劣化 7→6 等），其他退回非法', () => {
    expect(RULE_RETREATS[7]).toContain(6);
    for (const [from, tos] of Object.entries(RULE_RETREATS))
      for (const to of tos) expect(checkTransition({ from: Number(from), to, actor: 'rule' })).toEqual({ ok: true, kind: 'retreat' });
    expect(checkTransition({ from: 7, to: 1, actor: 'rule' })).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(checkTransition({ from: 2, to: 1, actor: 'rule' })).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
  });
  it('human 任意跳、任意退', () => {
    expect(checkTransition({ from: 1, to: 7, actor: 'human' })).toEqual({ ok: true, kind: 'jump' });
    expect(checkTransition({ from: 7, to: 1, actor: 'human' })).toEqual({ ok: true, kind: 'retreat' });
    expect(checkTransition({ from: 2, to: 3, actor: 'human' })).toEqual({ ok: true, kind: 'advance' });
  });
  it('原地不动、越界阶段一律非法', () => {
    expect(checkTransition({ from: 3, to: 3, actor: 'human' })).toMatchObject({ ok: false, code: 'SAME_STAGE' });
    expect(checkTransition({ from: 7, to: 8, actor: 'human' })).toMatchObject({ ok: false, code: 'INVALID_STAGE' });
    expect(checkTransition({ from: 1, to: 0, actor: 'rule' })).toMatchObject({ ok: false, code: 'INVALID_STAGE' });
  });
  it('人工关口 / 安全红线卡住时，rule 与 agent 不能动，human 可以', () => {
    for (const blockedKind of ['human_gate', 'safety']) {
      expect(checkTransition({ from: 4, to: 5, actor: 'rule', blockedKind })).toMatchObject({ ok: false, code: 'BLOCKED_NEEDS_HUMAN' });
      expect(checkTransition({ from: 4, to: 5, actor: 'agent', blockedKind })).toMatchObject({ ok: false, code: 'BLOCKED_NEEDS_HUMAN' });
      expect(checkTransition({ from: 4, to: 5, actor: 'human', blockedKind })).toMatchObject({ ok: true });
    }
    expect(checkTransition({ from: 4, to: 5, actor: 'rule', blockedKind: 'resource' })).toMatchObject({ ok: true });
  });
});

describe('滑窗计数 applyRunOutcome', () => {
  const at = '2026-10-11T00:00:00.000Z';
  it('追加并按 window_k 截尾，重算通过数', () => {
    let runs = [];
    for (const [i, pass] of [true, false, true, true].entries()) ({ runs } = applyRunOutcome(runs, { runId: `r${i}`, pass, at }, 3));
    const out = applyRunOutcome(runs, { runId: 'r9', pass: false, at }, 3);
    expect(out.runs.map(r => r.run_id)).toEqual(['r2', 'r3', 'r9']);
    expect(out).toMatchObject({ recentPass: 2, recentTotal: 3, duplicate: false });
  });
  it('同一 run_id 在窗内重复上报不重复计数', () => {
    const first = applyRunOutcome([], { runId: 'r1', pass: true, at }, 5);
    const again = applyRunOutcome(first.runs, { runId: 'r1', pass: false, at }, 5);
    expect(again).toMatchObject({ duplicate: true, recentPass: 1, recentTotal: 1 });
    expect(again.runs).toEqual(first.runs);
  });
  it('窗口缩小时只保留最近 k 次', () => {
    const runs = [1, 2, 3, 4].map(i => ({ run_id: `r${i}`, pass: i % 2 === 0, at }));
    const out = applyRunOutcome(runs, null, 2);
    expect(out.runs.map(r => r.run_id)).toEqual(['r3', 'r4']);
    expect(out).toMatchObject({ recentPass: 1, recentTotal: 2 });
  });
});

describe('入参校验', () => {
  const W = 'c1000000-0000-4000-8000-000000000001';
  it('建行：workflow_id 必须 uuid；默认 stage=1、边用边验、window_k=10', () => {
    expect(() => validateCreate({})).toThrow(/workflow_id/);
    expect(validateCreate({ workflow_id: W })).toMatchObject({ workflowId: W, stage: 1, validationMode: 'use_while_validate', windowK: 10, actor: 'human' });
    expect(() => validateCreate({ workflow_id: W, stage: 9 })).toThrow(/stage/);
    expect(() => validateCreate({ workflow_id: W, validation_mode: 'yolo' })).toThrow(/validation_mode/);
  });
  it('改行：不许改阶段；blocked_kind / window_k 校验；空改动 400', () => {
    expect(() => validatePatch({ stage: 3 })).toThrow(/transition/);
    expect(() => validatePatch({ blocked_kind: 'other' })).toThrow(/blocked_kind/);
    expect(() => validatePatch({ window_k: 0 })).toThrow(/window_k/);
    expect(() => validatePatch({})).toThrow(/没有可改字段/);
    expect(validatePatch({ next_action: '跑第 3 次', blocked_kind: 'none' })).toEqual({ next_action: '跑第 3 次', blocked_kind: 'none' });
  });
  it('转换：to_stage / actor / reason 必填；证据须字符串数组', () => {
    expect(() => validateTransition({ actor: 'human', reason: 'x' })).toThrow(/to_stage/);
    expect(() => validateTransition({ to_stage: 2, actor: 'boss', reason: 'x' })).toThrow(/actor/);
    expect(() => validateTransition({ to_stage: 2, actor: 'human' })).toThrow(/reason/);
    expect(() => validateTransition({ to_stage: 2, actor: 'rule', reason: 'x', evidence_run_ids: 'r1' })).toThrow(/evidence_run_ids/);
    expect(validateTransition({ to_stage: 2, actor: 'rule', reason: 'x', evidence_run_ids: ['r1'], expected_from_stage: 1 }))
      .toMatchObject({ toStage: 2, actor: 'rule', evidenceRunIds: ['r1'], expectedFromStage: 1, resetWindow: true });
  });
  it('记运行：run_id 与布尔 pass 必填', () => {
    expect(() => validateRun({ pass: true })).toThrow(/run_id/);
    expect(() => validateRun({ run_id: 'r1', pass: 'yes' })).toThrow(/pass/);
    expect(validateRun({ run_id: 'r1', pass: false, degraded: true })).toEqual({ runId: 'r1', pass: false, degraded: true });
  });
});

describe('连接池事务（生产路径）', () => {
  const W = 'c1000000-0000-4000-8000-000000000001';
  const fakePool = (answers) => {
    const sql = [];
    const client = {
      release: vi.fn(),
      query: vi.fn(async (q) => { sql.push(q.trim().split(/\s+/)[0]); return answers(q); }),
    };
    return { pool: { totalCount: 0, connect: vi.fn(async () => client) }, client, sql };
  };
  it('成功：BEGIN → 写 → COMMIT，连接归还', async () => {
    const { pool, client, sql } = fakePool((q) => {
      if (/FROM workflows WHERE id/.test(q)) return { rows: [{ '?column?': 1 }] };
      if (/INSERT INTO factory_ledger/.test(q)) return { rows: [{ id: 'L1' }] };
      if (/INSERT INTO factory_stage_events/.test(q)) return { rows: [{ id: 1, to_stage: 1 }] };
      if (/FROM factory_ledger l JOIN workflows/.test(q)) return { rows: [{ id: 'L1', stage: 1 }] };
      return { rows: [] };
    });
    const out = await createLedger(pool, { workflow_id: W });
    expect(out.ledger).toMatchObject({ id: 'L1', stage_name: '试跑' });
    expect(sql[0]).toBe('BEGIN'); expect(sql.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('失败：ROLLBACK 并抛 404，连接归还', async () => {
    const { pool, client, sql } = fakePool(() => ({ rows: [] }));
    await expect(createLedger(pool, { workflow_id: W })).rejects.toMatchObject({ status: 404, code: 'WORKFLOW_NOT_FOUND' });
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe('裁判结果入窗（任务 2231ecc0）', () => {
  it('safe_stop / source_task_id 随运行写进滑窗，同 run_id 只计一次', () => {
    const a = applyRunOutcome([], { runId: 'r1', pass: false, safeStop: true, sourceTaskId: 't1', at: 'x' }, 3);
    expect(a.runs[0]).toMatchObject({ run_id: 'r1', pass: false, safe_stop: true, source_task_id: 't1' });
    const b = applyRunOutcome(a.runs, { runId: 'r1', pass: true, at: 'y' }, 3);
    expect(b.duplicate).toBe(true);
    expect(b.recentTotal).toBe(1);
  });
  it('validateRun 接受 safe_stop 布尔与 source_task_id uuid，类型错 400', () => {
    expect(validateRun({ run_id: 'r', pass: false, safe_stop: true, source_task_id: '1b5a0be0-f0b2-4960-af44-f09790a039c1' }))
      .toMatchObject({ safeStop: true, sourceTaskId: '1b5a0be0-f0b2-4960-af44-f09790a039c1' });
    expect(() => validateRun({ run_id: 'r', pass: false, safe_stop: 'yes' })).toThrow(/safe_stop/);
    expect(() => validateRun({ run_id: 'r', pass: false, source_task_id: 'nope' })).toThrow(/source_task_id/);
  });
});


describe('运行归属保留（D 回归）', () => {
  it('保留冻结证据scope与独立成功结论，不把救场计成代码独立成功', () => {
    const scope={activity_definition_version_id:'av2',implementation:{kind:'skill',id:'publish',version:'2',digest:'s2'},environment:{id:'phone',fingerprint:'p1'}};
    const r=applyRunOutcome([], {runId:'r1',pass:true,degraded:true,executionRole:'rescue',evidenceScope:scope,independentVerified:true},10);
    expect(r.runs[0]).toMatchObject({execution_role:'rescue',evidence_scope:scope,independent_verified:true,code_independent_pass:false});
  });
});


describe('Activity晋级证据窗口（D 回归）',()=>{
  const scope={activity_definition_version_id:'av2',implementation:{kind:'code',id:'publish',version:'2',digest:'c2'},environment:{id:'phone',fingerprint:'p1'}};
  const fact=(over={})=>({pass:true,independent_verified:true,execution_role:'primary',readback_verified:true,evidence_scope:scope,...over});
  it('目标Activity独立绿可保留，另一Activity救场不清它的证据',()=>{
    const runs=[{run_id:'r1',degraded:true,activity_evidence:[fact(),fact({execution_role:'rescue',evidence_scope:{...scope,activity_definition_version_id:'other'}})]}];
    expect(decideEvidenceWindow(runs,{evidenceScope:scope,requiredGreen:1}).eligible).toBe(true);
  });
  it('救场、缺观测、未独立核验、混实现都不能凑晋级次数',()=>{
    for(const over of [{execution_role:'rescue'},{readback_verified:false},{independent_verified:false},{evidence_scope:{...scope,implementation:{...scope.implementation,digest:'c1'}}}])
      expect(decideEvidenceWindow([{run_id:'r1',activity_evidence:[fact(over)]}],{evidenceScope:scope,requiredGreen:1}).eligible).toBe(false);
  });
});
