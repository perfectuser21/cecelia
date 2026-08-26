// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：provider 进程退出兜底 ↔ runner 回执构造
// （永久回归，与 sprints/08270110-kernel-r77-contract-fault-code/tests/ 冻结测试同源）
//
// 覆盖父路 F1「工厂·开发闭环」第 3 步「造完真验」的 kernel 失败语义保真子路。
//
// r69 实证（attempt 56a09164）：generator 结构化 BLOCKED + error.code=CONTRACT_SELF_CONTRADICTION
// 但进程非零退出，runner child.once('close') 对 code!==0 一律覆盖为 provider_exit_${code}，
// 埋没真实合同故障语义 → kernel 当基础设施故障进 failed_targets 黑名单。
// 修法：runner 抽出纯函数 resolveProviderCloseResult，非零退出下保真透传结构化 CONTRACT_*
// 家族 error_code；只凭结构化 result.error.code 判定（禁 grep stdout）。
//
// 真 import 被改模块（不 vi.mock 被改的边），真 fs 临时文件。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseHarnessResult as classifyHarnessResult } from '../../../packages/brain/src/orchestrator/execution-contract.js';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const require = createRequire(import.meta.url);
const { resolveProviderCloseResult } = require(
  '../../../packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs',
);

// Validation identity is late-bound from the Runner-injected HARNESS_ATTEMPT_ID; this
// pure-function fixture only needs *a* well-formed UUID (parseHarnessResult UUID_PATTERN),
// never a hardcoded role attempt/capability literal
// (validation-identity-policy.js#premature_validation_identity_binding). Synthetic
// fallback applies only to local runs.
const ATTEMPT_ID = process.env.HARNESS_ATTEMPT_ID ?? '00000000-0000-4000-8000-000000000abc';

function structuredResult(overrides = {}) {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'blocked',
    summary: 'generator 合同死锁分析：无绿态可达',
    artifacts: [],
    checks: [],
    decision: null,
    error: { code: 'CONTRACT_SELF_CONTRADICTION', message: '合同自身矛盾，无权修改（CONTRACT IS LAW）' },
    provider_metadata: { provider: 'codex' },
    ...overrides,
  };
}

function writeResult(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r77-gp-'));
  const p = path.join(dir, 'result.json');
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

const CURRENT_CONTRACT_IDENTITY = Object.freeze({
  contract_id: '99999999-9999-4999-8999-999999999999',
  manifest_sha256: '9'.repeat(64),
  source_revision: '8'.repeat(64),
});

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: CURRENT_CONTRACT_IDENTITY },
    pr: { url: 'https://github.com/x/y/pull/1', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-new' },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 5, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

const cb = (hop, patch = {}) => ({
  hop,
  action: 'verdict:attempt_callback',
  detail: {
    run_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: `22222222-2222-4222-8222-${String(hop).padStart(12, '0')}`,
    lease_generation: 0,
    role: 'generator',
    hop: hop - 1,
    status: 'blocked',
    failure_class: 'semantic_refusal',
    error_code: 'CONTRACT_SELF_CONTRADICTION',
    artifacts: [],
    ...patch,
  },
});

describe('generator 合同故障码保真透传（r69 埋没根除）永久回归 [BEHAVIOR]', () => {
  it('保真透传 CONTRACT_SELF_CONTRADICTION：非零退出下结构化合同故障码不降级为 provider_exit', () => {
    const resultPath = writeResult(structuredResult());
    const r = resolveProviderCloseResult({ resultPath, attemptId: ATTEMPT_ID, exitCode: 1 });
    expect(r.error.code).toBe('CONTRACT_SELF_CONTRADICTION');
    expect(r.status).toBe('blocked');
    expect(String(r.error.code)).not.toMatch(/^provider_exit/);
  });

  it('全链复刻 r69：结构化 CONTRACT_* 非零退出 → 保真 → kernel 分类 → derive 路由重开 GAN', () => {
    const resultPath = writeResult(structuredResult());
    const runnerResult = resolveProviderCloseResult({ resultPath, attemptId: ATTEMPT_ID, exitCode: 1 });
    expect(runnerResult.error.code).toBe('CONTRACT_SELF_CONTRADICTION');
    const classified = classifyHarnessResult(runnerResult, 'generator');
    expect(classified.failure_class).not.toBe('infrastructure_blocked');
    const route = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator-fix', observed: {} },
        cb(3, {
          status: classified.status,
          failure_class: classified.failure_class,
          error_code: runnerResult.error.code,
        }),
      ],
    }));
    expect(route.action).toBe('arbitrate:contract_fault');
    expect(route.reason).toBe('contract_fault_appeal');
  });

  it('分类不落 infrastructure：保真后的 blocked 结果 failure_class 为 semantic_refusal', () => {
    const resultPath = writeResult(structuredResult());
    const runnerResult = resolveProviderCloseResult({ resultPath, attemptId: ATTEMPT_ID, exitCode: 1 });
    const classified = classifyHarnessResult(runnerResult, 'generator');
    expect(classified.failure_class).toBe('semantic_refusal');
    expect(classified.failure_class).not.toBe('infrastructure_blocked');
  });

  it('负向 真崩溃：无结构化 result 仍 provider_exit / failed，语义不变', () => {
    const missing = path.join(os.tmpdir(), 'r77-gp-nonexistent-dir', 'none.json');
    const r = resolveProviderCloseResult({ resultPath: missing, attemptId: ATTEMPT_ID, exitCode: 42 });
    expect(r.status).toBe('failed');
    expect(r.error.code).toBe('provider_exit_42');
    // complete() 在真实链路补 provider_metadata，此处镜像其后置形状再分类。
    const classified = classifyHarnessResult({ ...r, provider_metadata: { provider: 'codex' } }, 'generator');
    expect(classified.failure_class).toBe('runner_failure');
  });

  it('边界 非 CONTRACT_ 结构化 code：semantic_refusal 在非零退出下回落 provider_exit（只凭结构化 code，不 grep stdout）', () => {
    const resultPath = writeResult(structuredResult({ error: { code: 'semantic_refusal', message: 'm' } }));
    const r = resolveProviderCloseResult({ resultPath, attemptId: ATTEMPT_ID, exitCode: 1 });
    expect(r.error.code).toBe('provider_exit_1');
    const bare = writeResult(structuredResult({ error: { code: 'CONTRACT_', message: 'm' } }));
    const r2 = resolveProviderCloseResult({ resultPath: bare, attemptId: ATTEMPT_ID, exitCode: 3 });
    expect(r2.error.code).toBe('provider_exit_3');
  });

  it('纯函数可重放：同输入两次结果 deep-equal，且 exit 0 成功路径不受影响', () => {
    const resultPath = writeResult(structuredResult({ error: { code: 'CONTRACT_TEST_UNSATISFIABLE', message: 'm' } }));
    const a = resolveProviderCloseResult({ resultPath, attemptId: ATTEMPT_ID, exitCode: 1 });
    const b = resolveProviderCloseResult({ resultPath, attemptId: ATTEMPT_ID, exitCode: 1 });
    expect(a).toEqual(b);
    expect(a.error.code).toBe('CONTRACT_TEST_UNSATISFIABLE');
    const okPath = writeResult(structuredResult({ status: 'completed', error: null, decision: { outcome: 'done', reason: 'ok' } }));
    const ok = resolveProviderCloseResult({ resultPath: okPath, attemptId: ATTEMPT_ID, exitCode: 0 });
    expect(ok.status).toBe('completed');
  });
});
