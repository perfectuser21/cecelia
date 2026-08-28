// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：runner 回执归一化(entrypoint.sh) ↔
// kernel 失败归因分流(derive.js / ground-truth.js)。
//
// r79 永久回归（PRD 要求 5：修 bug 的 failing test 修复后永久保留在 CI 作回归）。
// 病根三实证：
//   ① r69 generator 合同死锁分析（结构化 BLOCKED + CONTRACT_*）被包装成 provider_exit（attempt 56a09164）
//   ② r76 同类
//   ③ r77 commander 的 claude 返回 success 结果 JSON 却被判 provider_exit failed（attempt e022a331）
//
// 执行体产出了结构化终态，回执链路却降级成 provider_exit，语义被埋没——kernel 据此进
// failed_targets 黑名单 / 按 infrastructure 重试，合同故障重开 GAN 的正确路径永远走不到。
//
// 按产物闸规矩写在被改的边上（禁 mock）：真 import derive（不 stub attemptCallbackRoute）、
// 真 import ground-truth 的 GENERATOR_RUNTIME_ERROR_CODES、真 bash + 真 jq 跑 entrypoint.sh
// 原文抽取的 normalize_provider_failure。
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import * as groundTruth from '../../../packages/brain/src/orchestrator/ground-truth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT_PATH = path.join(HERE, '../../../docker/cecelia-runner/entrypoint.sh');

// —— 从 entrypoint.sh 原文抽取指定 bash 函数（真零件，随实现演进而变） ——
function extractBashFn(name) {
  const text = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
  const re = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm');
  const match = text.match(re);
  expect(match, `entrypoint.sh 必须定义 ${name}()`).not.toBeNull();
  return match[0];
}

let tmp;
beforeAll(() => {
  execFileSync('bash', ['-c', 'command -v jq >/dev/null']);
});
afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});
function mkTmp() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r79-f1-'));
  return tmp;
}

// 真跑 normalize_provider_failure(normalized attempt provider session cred credMut exit stdout result)
function runNormalize({ providerExit, stdout, result }) {
  const dir = mkTmp();
  const stdoutFile = path.join(dir, 'stdout.txt');
  const resultFile = path.join(dir, 'result.json');
  const normFile = path.join(dir, 'norm.json');
  fs.writeFileSync(stdoutFile, stdout);
  fs.writeFileSync(resultFile, result);
  const script = [
    'set -uo pipefail',
    extractBashFn('normalize_provider_failure'),
    `normalize_provider_failure "$1" a1 claude "" "" false ${providerExit} "$2" "$3"`,
  ].join('\n');
  execFileSync('bash', ['-c', script, 'bash', normFile, stdoutFile, resultFile]);
  return JSON.parse(fs.readFileSync(normFile, 'utf8'));
}

// —— derive 纯函数重放脚手架（对齐 tests/gp/f1 既有惯用法） ——
function baseObserved(overrides = {}) {
  return {
    run: { phase: 'gan' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 30, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}
const cb = (hop, detail) => ({ hop, action: 'verdict:attempt_callback', detail: { hop: hop - 1, ...detail } });

const blockedContractResult = JSON.stringify({
  contract_version: '1.0',
  attempt_id: 'a1',
  status: 'blocked',
  summary: 'contract self-contradiction: DoD requires X and not-X',
  artifacts: [],
  checks: [],
  decision: null,
  error: { code: 'CONTRACT_SELF_CONTRADICTION', message: 'DoD 自相矛盾，受 CONTRACT IS LAW 约束无权修' },
});

describe('r79 F1 永久回归 — 结构化上报保真透传，根除 provider_exit 语义埋没', () => {
  it('runner 保真透传：结构化 BLOCKED 的 CONTRACT_* 码不被埋没为 provider_exit', () => {
    // r69/r76：provider CLI 非零退出，但执行体已产出结构化 BLOCKED + CONTRACT_*。
    const norm = runNormalize({ providerExit: 1, stdout: blockedContractResult, result: blockedContractResult });
    expect(norm.error.code).toBe('CONTRACT_SELF_CONTRADICTION');
    expect(norm.status).toBe('blocked');
    expect(norm.error.code).not.toBe('provider_exit');
  });

  it('负向不动：无结构化产出的真崩溃仍归一 provider_exit（铁律 [负向不动]）', () => {
    const norm = runNormalize({ providerExit: 1, stdout: 'segfault core dumped\n', result: 'not-json' });
    expect(norm.error.code).toBe('provider_exit');
    expect(norm.status).toBe('failed');
  });

  it('kernel 分流：CONTRACT_* 家族 → 合同故障重开 GAN，不进 failed_targets', () => {
    const r = derive(baseObserved({
      decisionLog: [cb(29, { status: 'blocked', role: 'generator', error_code: 'CONTRACT_SELF_CONTRADICTION' })],
    }));
    expect(r.phase).toBe('gan');
    expect(r.action).toBe('arbitrate:contract_fault');
    expect(r.action).not.toBe('mark:failed');
  });

  it('负向不动：provider_exit 真崩溃仍走 infrastructure 有界重派，不误判合同故障', () => {
    const r = derive(baseObserved({
      decisionLog: [cb(29, { status: 'failed', role: 'generator', failure_class: 'infrastructure_blocked', error_code: 'provider_exit' })],
    }));
    expect(r.reason).toBe('callback_infrastructure_blocked');
    expect(r.action).not.toBe('arbitrate:contract_fault');
    expect(r.phase).not.toBe('failed');
  });

  it('归因口径：CONTRACT_* 不落 GENERATOR_RUNTIME_ERROR_CODES', () => {
    const codes = groundTruth.GENERATOR_RUNTIME_ERROR_CODES;
    expect(codes, 'ground-truth.js 必须导出 GENERATOR_RUNTIME_ERROR_CODES').toBeInstanceOf(Set);
    expect(codes.has('provider_exit')).toBe(true);
    expect(codes.has('provider_timeout')).toBe(true);
    for (const c of ['CONTRACT_SELF_CONTRADICTION', 'CONTRACT_TEST_UNSATISFIABLE', 'CONTRACT_CI_SCOPE_CONFLICT']) {
      expect(codes.has(c), `${c} 不得落 runtime error 归因`).toBe(false);
    }
  });
});
