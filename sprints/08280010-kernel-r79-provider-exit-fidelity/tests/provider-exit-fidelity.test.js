// Sprint r79 冻结合同测试 — 结构化上报保真透传，根除 provider_exit 语义埋没
//
// 覆盖父路：独立小路（无父路）—— 修复 harness kernel 自驱 GAN 循环内部
// 「执行体产出结构化终态 → 回执链路降级成 provider_exit」的失败归因埋没病。
//
// 病根三实证（PRD 背景）：
//   ① r69 generator 合同死锁分析（结构化 BLOCKED + CONTRACT_*）被包装成 provider_exit（attempt 56a09164）
//   ② r76 同类
//   ③ r77 commander 的 claude 返回 success 结果 JSON 却被判 provider_exit failed（attempt e022a331）
//
// 禁 mock 被改的边：真 import derive.js（不 stub attemptCallbackRoute）、
// 真 import ground-truth.js 归因口径、真 bash + 真 jq 跑 entrypoint.sh 抽取的两个函数
// （normalize_provider_failure / validate_claude_terminal_receipt）——被改的接缝一律真跑。
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
// 命名空间导入：GENERATOR_RUNTIME_ERROR_CODES 在 baseline 未导出时取到 undefined，
// 不会让整个测试文件在模块加载期 SyntaxError（保证其余用例仍能独立跑）。
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
  // jq 是被改函数的真实依赖，缺则整套接缝测试无意义 —— 显式前置断言。
  execFileSync('bash', ['-c', 'command -v jq >/dev/null']);
});
afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});
function mkTmp() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r79-fidelity-'));
  return tmp;
}

// 真跑 normalize_provider_failure(normalized attempt provider session cred credMut exit stdout result)
// 第 9 位 result_file 是本合同新增契约参数：结构化终态提取产物。
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

// 真跑 validate_claude_terminal_receipt(stdout result expected_session) → exit 0 = valid。
function runValidateClaude({ stdout, result, session }) {
  const dir = mkTmp();
  const stdoutFile = path.join(dir, 'stdout.txt');
  const resultFile = path.join(dir, 'result.json');
  fs.writeFileSync(stdoutFile, stdout);
  fs.writeFileSync(resultFile, result);
  const script = [
    'set -uo pipefail',
    extractBashFn('validate_claude_terminal_receipt'),
    'if validate_claude_terminal_receipt "$1" "$2" "$3"; then echo 0; else echo 1; fi',
  ].join('\n');
  const out = execFileSync('bash', ['-c', script, 'bash', stdoutFile, resultFile, session], {
    encoding: 'utf8',
  });
  return out.trim();
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

// 合法结构化 BLOCKED 信封（r69 复刻输入）
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

// commander 指令成功信封（r77 复刻输入）
const commanderDirective = JSON.stringify({ schema: 'commander-directive/v1', directives: [{ action: 'spawn_generator' }] });
const EXPECTED_SESSION = '11111111-2222-3111-8111-444444444444';
function claudeSuccessEnvelope(structured) {
  return `${JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    terminal_reason: 'completed',
    session_id: EXPECTED_SESSION,
    structured_output: JSON.parse(structured),
  })}\n`;
}

describe('r79 [BEHAVIOR] runner 回执保真透传（真 bash + 真 jq）', () => {
  it('normalize_provider_failure 保真透传结构化 BLOCKED 的 CONTRACT_* 错误码，不埋没为 provider_exit', () => {
    // r69：provider CLI 以非零码退出，但执行体已产出结构化 BLOCKED + CONTRACT_*。
    const norm = runNormalize({ providerExit: 1, stdout: blockedContractResult, result: blockedContractResult });
    expect(norm.error.code).toBe('CONTRACT_SELF_CONTRADICTION');
    expect(norm.status).toBe('blocked');
    // 反向：绝不能被降级成 provider_exit 家族。
    expect(norm.error.code).not.toBe('provider_exit');
  });

  it('validate_claude_terminal_receipt 认可 commander-directive/v1 成功信封（success 保真透传前置）', () => {
    // r77：claude 返回 commander 指令 success JSON，但 CLI 残留非零退出。
    const verdict = runValidateClaude({
      stdout: claudeSuccessEnvelope(commanderDirective),
      result: commanderDirective,
      session: EXPECTED_SESSION,
    });
    expect(verdict).toBe('0'); // exit 0 = valid → 上游恢复 provider_exit=0 → 成功透传，非 provider_exit failed
  });

  it('负向不动：无结构化产出的真崩溃仍归一 provider_exit（铁律 [负向不动]）', () => {
    // stdout 空/非 JSON、result 非合法终态信封 → 不得误判为结构化，落 provider_exit。
    const norm = runNormalize({ providerExit: 1, stdout: 'segfault core dumped\n', result: 'not-json' });
    expect(norm.error.code).toBe('provider_exit');
    expect(norm.status).toBe('failed');
  });

  it('负向不动：provider 超时（exit 124）仍归一 provider_timeout，语义不变', () => {
    const norm = runNormalize({ providerExit: 124, stdout: '', result: '' });
    expect(norm.error.code).toBe('provider_timeout');
  });
});

describe('r79 [BEHAVIOR] kernel 失败归因分流（真 import derive / ground-truth）', () => {
  it('CONTRACT_* 家族（generator 结构化 BLOCKED）→ 合同故障重开 GAN 路径，不进 failed_targets / infrastructure', () => {
    const r = derive(baseObserved({
      decisionLog: [cb(29, { status: 'blocked', role: 'generator', error_code: 'CONTRACT_SELF_CONTRADICTION' })],
    }));
    expect(r.phase).toBe('gan');
    expect(r.action).toBe('arbitrate:contract_fault');
    expect(r.action).not.toBe('mark:failed');
  });

  it('负向不动：provider_exit 真崩溃仍走 infrastructure 有界重派，不误判合同故障（铁律 [负向不动]）', () => {
    const r = derive(baseObserved({
      decisionLog: [cb(29, { status: 'failed', role: 'generator', failure_class: 'infrastructure_blocked', error_code: 'provider_exit' })],
    }));
    expect(r.reason).toBe('callback_infrastructure_blocked');
    expect(r.action).not.toBe('arbitrate:contract_fault');
    expect(r.phase).not.toBe('failed');
  });

  it('归因口径：GENERATOR_RUNTIME_ERROR_CODES 含 provider_*、排除 CONTRACT_* 家族', () => {
    const codes = groundTruth.GENERATOR_RUNTIME_ERROR_CODES;
    expect(codes, 'ground-truth.js 必须导出 GENERATOR_RUNTIME_ERROR_CODES').toBeInstanceOf(Set);
    expect(codes.has('provider_exit')).toBe(true);
    expect(codes.has('provider_timeout')).toBe(true);
    for (const c of ['CONTRACT_SELF_CONTRADICTION', 'CONTRACT_TEST_UNSATISFIABLE', 'CONTRACT_CI_SCOPE_CONFLICT']) {
      expect(codes.has(c), `${c} 不得落 runtime error 归因`).toBe(false);
    }
  });
});
