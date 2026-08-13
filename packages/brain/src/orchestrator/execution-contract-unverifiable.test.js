/**
 * execution-contract-unverifiable.test.js — Evaluator 出口守卫：合同必验项 unverifiable 禁 PASS（B-05）。
 *
 * 禁 mock 被改的边：直调真实 enforceVerifiableEvaluatorVerdict，不 stub。
 */
import { describe, it, expect } from 'vitest';
import { enforceVerifiableEvaluatorVerdict } from './execution-contract.js';

describe('必验项 unverifiable → verdict 非 PASS', () => {
  it('必验项 unverifiable 时 verdict 不为 PASS', () => {
    // 合同要求 postgres，但执行位 runtime_resources.postgres != true → 无法真验
    const guarded = enforceVerifiableEvaluatorVerdict({
      verdict: 'PASS',
      requirements: { postgres: true },
      runtimeResources: { postgres: false, node_deps: true },
      behaviorTests: [],
    });
    expect(guarded.verdict).not.toBe('PASS');
    expect(guarded.downgraded).toBe(true);
    expect(guarded.failure_class).toBe('evidence_insufficient');
  });

  it('runtime 有 PG 但 behavior_tests 缺 PG 真跑证据 → 仍非 PASS', () => {
    const guarded = enforceVerifiableEvaluatorVerdict({
      verdict: 'PASS',
      requirements: { postgres: true },
      runtimeResources: { postgres: true, node_deps: true },
      behaviorTests: [{ command: 'curl -sf localhost:5221/health', exit_code: 0, log_tail: 'ok' }],
    });
    expect(guarded.verdict).not.toBe('PASS');
  });

  it('runtime 有 PG 且 behavior_tests 含 psql 真跑证据（exit 0） → 保留 PASS', () => {
    const guarded = enforceVerifiableEvaluatorVerdict({
      verdict: 'PASS',
      requirements: { postgres: true },
      runtimeResources: { postgres: true, node_deps: true },
      behaviorTests: [
        { command: 'psql "$DB_URL" -c "SELECT count(*) FROM harness_pg_probe"', exit_code: 0, log_tail: ' count \n-------\n     1' },
      ],
    });
    expect(guarded.verdict).toBe('PASS');
    expect(guarded.downgraded).toBe(false);
  });

  it('合同不要求 postgres → 守卫不改动 verdict（边界不变）', () => {
    const guarded = enforceVerifiableEvaluatorVerdict({
      verdict: 'PASS',
      requirements: { postgres: false },
      runtimeResources: { postgres: false, node_deps: true },
      behaviorTests: [],
    });
    expect(guarded.verdict).toBe('PASS');
    expect(guarded.downgraded).toBe(false);
  });
});
