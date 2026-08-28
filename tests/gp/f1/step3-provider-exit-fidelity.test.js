// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：runner 回执归一化 ↔ kernel 失败归因分流
//
// 永久回归（PRD r79 要求 5：RED 先行修复后永久保留在 CI）。与 sprint 冻结合同测试
// sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js
// 同族，落在 F1 套件长期防线里，避让 main 既有 step3-* 文件名。
//
// 病根：执行体产出结构化终态（success 结果 JSON / 结构化 BLOCKED + CONTRACT_*），
// 回执链路却降级成 provider_exit，语义被埋没 → kernel 误进 failed_targets 黑名单 /
// 按 infrastructure 重试，合同故障重开 GAN 的正确路径永远走不到。
//
// 禁 mock 被改的边：真 import derive.js、真 import ground-truth.js、真 bash + 真 jq
// 跑 entrypoint.sh 抽取的 normalize_provider_failure（被改接缝一律真跑）。
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import * as groundTruth from '../../../packages/brain/src/orchestrator/ground-truth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT_PATH = path.join(HERE, '../../../docker/cecelia-runner/entrypoint.sh');

function extractBashFn(name) {
  const text = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
  const match = text.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
  expect(match, `entrypoint.sh 必须定义 ${name}()`).not.toBeNull();
  return match[0];
}

function runNormalize({ providerExit, stdout, result }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r79-f1-'));
  try {
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

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
  summary: 'contract self-contradiction',
  artifacts: [],
  checks: [],
  decision: null,
  error: { code: 'CONTRACT_TEST_UNSATISFIABLE', message: 'RED 桩无法在合同约束下变绿' },
});

describe('F1 step3 — r79 结构化上报保真透传，根除 provider_exit 语义埋没', () => {
  it('runner 保真透传：结构化 BLOCKED 的 CONTRACT_* 码不被埋没为 provider_exit', () => {
    const norm = runNormalize({ providerExit: 1, stdout: blockedContractResult, result: blockedContractResult });
    expect(norm.error.code).toBe('CONTRACT_TEST_UNSATISFIABLE');
    expect(norm.error.code).not.toBe('provider_exit');
  });

  it('负向不动：真崩溃无结构化产出 → 仍归一 provider_exit', () => {
    const norm = runNormalize({ providerExit: 1, stdout: 'segfault: core dumped\n', result: 'not-json' });
    expect(norm.error.code).toBe('provider_exit');
  });

  it('kernel 分流：CONTRACT_* 家族 → 合同故障重开 GAN，不进 failed_targets', () => {
    const r = derive(baseObserved({
      decisionLog: [cb(29, { status: 'blocked', role: 'generator', error_code: 'CONTRACT_TEST_UNSATISFIABLE' })],
    }));
    expect(r.action).toBe('arbitrate:contract_fault');
    expect(r.action).not.toBe('mark:failed');
  });

  it('负向不动：provider_exit → infrastructure 有界重派，不误判合同故障', () => {
    const r = derive(baseObserved({
      decisionLog: [cb(29, { status: 'failed', role: 'generator', failure_class: 'infrastructure_blocked', error_code: 'provider_exit' })],
    }));
    expect(r.reason).toBe('callback_infrastructure_blocked');
    expect(r.action).not.toBe('arbitrate:contract_fault');
  });

  it('归因口径：CONTRACT_* 不落 GENERATOR_RUNTIME_ERROR_CODES', () => {
    const codes = groundTruth.GENERATOR_RUNTIME_ERROR_CODES;
    expect(codes).toBeInstanceOf(Set);
    expect(codes.has('provider_exit')).toBe(true);
    expect(codes.has('CONTRACT_TEST_UNSATISFIABLE')).toBe(false);
  });
});
