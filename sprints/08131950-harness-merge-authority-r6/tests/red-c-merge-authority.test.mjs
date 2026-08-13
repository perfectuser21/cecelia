/**
 * RED-C 永久回归 — Harness merge handler 合并权威 fail-closed。
 *
 * 法源 decision=e4e37f10：Harness PR 只有在「同一 PR head_sha 上独立 AI Evaluator
 *   PASS/FIXED receipt + 独立 Judge PASS receipt」齐备时，才由 Harness merge handler
 *   授权合并。缺角色 / 旧 SHA / 被拒 callback / Brain 查询错误 → 一律拒绝（不 fail-open）。
 *
 * 现有 gates.mergeGate 覆盖「缺 receipt / 旧 SHA / not-pass / review」，但无法表达
 *   「Brain 查询本身出错」这一 fail-closed 输入。本刀在 validation-identity-policy.js
 *   新增纯函数 evaluateMergeAuthority({ evaluateReceipt, judgeReceipt, prHeadSha,
 *   brainQueryOk })，把「Brain 查询错误 → 拒绝」并入唯一权威判据。
 *
 * 禁 mock 边：evaluateMergeAuthority 是纯函数（无 DB/网络边），本测试直接真调，不 mock。
 *
 * 永久落位（Generator 实现时迁入）：
 *   packages/brain/src/orchestrator/__tests__/validation-identity-policy.test.js
 */
import { describe, it, expect } from 'vitest';
import { evaluateMergeAuthority } from '../../../packages/brain/src/orchestrator/validation-identity-policy.js';

const HEAD = 'head-sha-abc';
const pass = (sha = HEAD) => ({ verdict: 'PASS', pr_head_sha: sha });

describe('RED-C: evaluateMergeAuthority 合并权威 fail-closed', () => {
  it('同 head Evaluator PASS + Judge PASS + brainQueryOk → allow', () => {
    const r = evaluateMergeAuthority({
      evaluateReceipt: pass(), judgeReceipt: pass(), prHeadSha: HEAD, brainQueryOk: true,
    });
    expect(r.allow).toBe(true);
    expect(r.reason).toBe('all_roles_pass');
  });

  it('Evaluator FIXED 同 head + Judge PASS → allow', () => {
    const r = evaluateMergeAuthority({
      evaluateReceipt: { verdict: 'FIXED', pr_head_sha: HEAD }, judgeReceipt: pass(),
      prHeadSha: HEAD, brainQueryOk: true,
    });
    expect(r.allow).toBe(true);
  });

  it('Brain 查询错误（brainQueryOk=false）→ 拒绝，绝不 fail-open', () => {
    const r = evaluateMergeAuthority({
      evaluateReceipt: pass(), judgeReceipt: pass(), prHeadSha: HEAD, brainQueryOk: false,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('brain_query_error');
  });

  it('缺 Evaluator receipt → 拒绝', () => {
    const r = evaluateMergeAuthority({
      evaluateReceipt: null, judgeReceipt: pass(), prHeadSha: HEAD, brainQueryOk: true,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('evaluate_receipt_missing');
  });

  it('缺 Judge receipt → 拒绝', () => {
    const r = evaluateMergeAuthority({
      evaluateReceipt: pass(), judgeReceipt: null, prHeadSha: HEAD, brainQueryOk: true,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('judge_receipt_missing');
  });

  it('Evaluator receipt 锚定旧 SHA → 拒绝 stale_evaluate_sha', () => {
    const r = evaluateMergeAuthority({
      evaluateReceipt: pass('old-sha'), judgeReceipt: pass(), prHeadSha: HEAD, brainQueryOk: true,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('stale_evaluate_sha');
  });

  it('Judge receipt 锚定旧 SHA → 拒绝 stale_judge_sha', () => {
    const r = evaluateMergeAuthority({
      evaluateReceipt: pass(), judgeReceipt: pass('old-sha'), prHeadSha: HEAD, brainQueryOk: true,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('stale_judge_sha');
  });

  it('被拒 callback（Evaluator 非 PASS/FIXED，如 BLOCKED）→ 拒绝 evaluate_not_pass', () => {
    const r = evaluateMergeAuthority({
      evaluateReceipt: { verdict: 'BLOCKED', pr_head_sha: HEAD }, judgeReceipt: pass(),
      prHeadSha: HEAD, brainQueryOk: true,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('evaluate_not_pass');
  });

  it('Judge 非 PASS（FAIL）→ 拒绝 judge_not_pass', () => {
    const r = evaluateMergeAuthority({
      evaluateReceipt: pass(), judgeReceipt: { verdict: 'FAIL', pr_head_sha: HEAD },
      prHeadSha: HEAD, brainQueryOk: true,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('judge_not_pass');
  });
});
