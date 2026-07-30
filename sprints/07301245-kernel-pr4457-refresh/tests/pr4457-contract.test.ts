import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const sprintDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(sprintDir, '../..');
const verifier = path.join(sprintDir, 'scripts', 'verify-pr4457-evidence.mjs');
const contractRunner = path.join(sprintDir, 'scripts', 'run-pr4457-contract-tests.mjs');
const oracleManifest = path.join(sprintDir, 'conflict-oracle-manifest.json');
const ORACLE_MANIFEST_SHA256 = 'ec6bf14d639a5ddf8a340185b5d285151075a6e3a3e3b9a252283a92ca477d43';
const ACTOR_STAGE = process.env.HARNESS_ACTOR_STAGE;
const STAGES = [
  'generator-pre-push',
  'ci-exact-head',
  'evaluator-receipt',
  'controller-review-gate',
] as const;

function stageAtLeast(stage: typeof STAGES[number]) {
  expect(STAGES, 'HARNESS_ACTOR_STAGE 必须来自当前 actor 的权威 task bundle/签名 receipt')
    .toContain(ACTOR_STAGE);
  return STAGES.indexOf(ACTOR_STAGE as typeof STAGES[number]) >= STAGES.indexOf(stage);
}

function reportOutcome(outcome: 'true-success' | 'expected-future-stage-refusal') {
  console.log(JSON.stringify({ actor_stage: ACTOR_STAGE, outcome }));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) =>
      [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

async function run(phase: string, stage: string, args: string[] = []) {
  return await Promise.resolve(spawnSync(process.execPath, [verifier, phase, '--stage', stage, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPECTED_PR: '4457',
      HARNESS_ACTOR_STAGE: ACTOR_STAGE ?? '',
    },
  }));
}

async function expectRejected(
  phase: string,
  stage: string,
  errorCode: string,
  args: string[] = [],
) {
  const result = await run(phase, stage, args);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  expect(result.status, `负向场景 ${errorCode} 必须非零退出`).not.toBe(0);
  expect(output, `负向场景必须返回稳定错误码 ${errorCode}`).toContain(errorCode);
}

async function expectRunnerReceiptRejected(fixture: string, errorCode: string) {
  const result = await Promise.resolve(spawnSync(process.execPath, [
    contractRunner,
    '--validate-receipt-fixture',
    fixture,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ACTOR_STAGE: ACTOR_STAGE ?? '' },
  }));
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  expect(result.status, `runner receipt 负向场景 ${fixture} 必须非零退出`).not.toBe(0);
  expect(output, `runner receipt 负向场景必须返回稳定错误码 ${errorCode}`)
    .toContain(errorCode);
}

async function expectPrematureRefusal(
  phase: string,
  errorCode: string,
  futureReceipt: string,
  args: string[] = [],
) {
  expect(fs.existsSync(futureReceipt), `未来阶段不得预先存在 receipt: ${futureReceipt}`).toBe(false);
  await expectRejected(phase, ACTOR_STAGE ?? 'missing-authoritative-stage', errorCode, args);
  expect(fs.existsSync(futureReceipt), `只读 verifier 不得创建未来 receipt: ${futureReceipt}`).toBe(false);
}

describe('PR #4457 contract [BEHAVIOR]', () => {
  it('33 路径 oracle manifest 的 schema 身份 argv 与语义哈希精确匹配', async () => {
    await expectRunnerReceiptRejected('non-hermetic-toolchain', 'ERR_NON_HERMETIC_TOOLCHAIN');
    await expectRejected('conflicts', 'ci-exact-head', 'ERR_STAGE_MISMATCH');
    // 静态 manifest 本身已在合同阶段冻结；它必须同时跨过由实现产出的
    // conflicts verifier/evidence 边界，避免实现尚不存在时仅靠静态 JSON 假绿。
    const boundary = await run('conflicts', 'generator-pre-push');
    expect(boundary.status, boundary.stderr || boundary.stdout).toBe(0);
    const manifest = JSON.parse(await fs.promises.readFile(oracleManifest, 'utf8'));
    manifest.subjects.sort((a: { path: string }, b: { path: string }) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const digest = crypto.createHash('sha256')
      .update(JSON.stringify(canonical(manifest))).digest('hex');
    expect(manifest.schema_version).toBe(1);
    expect(manifest.subjects).toHaveLength(33);
    expect(new Set(manifest.subjects.map((row: { path: string }) => row.path)).size).toBe(33);
    expect(new Set(manifest.subjects.map((row: { oracle_id: string }) => row.oracle_id)).size).toBe(33);
    expect(manifest.subjects.every((row: {
      stage: string; cwd: string; argv: string[]; expected_observation: string
    }) => row.stage === 'generator-pre-push' && row.cwd.length > 0 && row.argv.length > 0
      && row.expected_observation.includes('exit_code=0'))).toBe(true);
    expect(digest).toBe(ORACLE_MANIFEST_SHA256);
    reportOutcome('true-success');
  });

  it('冻结身份与全部 subject 精确匹配', async () => {
    await expectRunnerReceiptRejected('materialization-time', 'ERR_TEST_MATERIALIZATION_TIME');
    await expectRejected('freeze', 'generator-pre-push', 'ERR_ACTOR_ROLE', [
      '--actor-role', 'controller',
    ]);
    const result = await run('freeze', 'generator-pre-push');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    reportOutcome('true-success');
  });

  it('全部 33 个冲突路径完成行为验证', async () => {
    await expectRunnerReceiptRejected('head-drift', 'ERR_TEST_HEAD_DRIFT');
    await expectRejected('conflicts', 'generator-pre-push', 'ERR_DIGEST_MISMATCH', [
      '--manifest-sha256', '0'.repeat(64),
    ]);
    const result = await run('conflicts', 'generator-pre-push');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    reportOutcome('true-success');
  });

  it('全部 77 条 CodeQL annotation 收敛', async () => {
    await expectRunnerReceiptRejected('result-digest', 'ERR_TEST_RESULT_DIGEST');
    await expectRejected('codeql', 'generator-pre-push', 'ERR_EVIDENCE_FABRICATED', [
      '--fixture', 'fabricated-exit-zero-without-subject-logs',
    ]);
    const result = await run('codeql', 'generator-pre-push');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    reportOutcome('true-success');
  });

  it('累计 Kernel Harness 行为与 atomic truth 保持', async () => {
    await expectRejected('regressions', 'generator-pre-push', 'ERR_LINEAGE_REUSE', [
      '--fixture', 'cross-stage-lineage-reuse',
    ]);
    const result = await run('regressions', 'generator-pre-push');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    reportOutcome('true-success');
  });

  it('三个 required checks 绑定同一最终 SHA', async () => {
    const exactHeadReceipt = path.join(sprintDir, 'evidence', 'exact-head-receipt.json');
    if (!stageAtLeast('ci-exact-head')) {
      await expectPrematureRefusal('exact-head', 'ERR_STAGE_MISMATCH', exactHeadReceipt, [
        '--receipt', path.join(sprintDir, 'evidence', 'push-receipt.json'),
      ]);
      reportOutcome('expected-future-stage-refusal');
      return;
    }
    await expectRejected('exact-head', 'ci-exact-head', 'ERR_PREREQUISITE_RECEIPT', [
      '--receipt', path.join(sprintDir, 'evidence', 'missing-push-receipt.json'),
    ]);
    const result = await run('exact-head', 'ci-exact-head', [
      '--receipt', path.join(sprintDir, 'evidence', 'push-receipt.json'),
    ]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    reportOutcome('true-success');
  });

  it('evaluator 在同一最终 SHA 真跑', async () => {
    const evaluatorReceipt = path.join(sprintDir, 'evidence', 'evaluator-receipt.json');
    if (!stageAtLeast('evaluator-receipt')) {
      await expectPrematureRefusal('evaluator', 'ERR_STAGE_MISMATCH', evaluatorReceipt, [
        '--receipt', evaluatorReceipt,
      ]);
      reportOutcome('expected-future-stage-refusal');
      return;
    }
    await expectRejected('evaluator', 'generator-pre-push', 'ERR_STAGE_MISMATCH', [
      '--receipt', evaluatorReceipt,
    ]);
    const result = await run('evaluator', 'evaluator-receipt', [
      '--receipt', evaluatorReceipt,
    ]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    reportOutcome('true-success');
  });

  it('审计窗内无新 PR 无 merge 无 deploy', async () => {
    const evidenceDir = path.join(sprintDir, 'evidence');
    const reviewReceipt = path.join(evidenceDir, 'review-gate-receipt.json');
    if (!stageAtLeast('controller-review-gate')) {
      await expectPrematureRefusal(
        'review-gate',
        'ERR_STAGE_MISMATCH',
        reviewReceipt,
        [
          '--exact-head-receipt', path.join(evidenceDir, 'exact-head-receipt.json'),
          '--evaluator-receipt', path.join(evidenceDir, 'evaluator-receipt.json'),
          '--audit-end', path.join(evidenceDir, 'audit-end.json'),
        ],
      );
      reportOutcome('expected-future-stage-refusal');
      return;
    }
    await expectRejected('review-gate', 'controller-review-gate', 'ERR_CHRONOLOGY_REVERSED', [
      '--fixture', 'reversed-receipt-timestamps',
    ]);
    const result = await run('review-gate', 'controller-review-gate', [
      '--exact-head-receipt', path.join(evidenceDir, 'exact-head-receipt.json'),
      '--evaluator-receipt', path.join(evidenceDir, 'evaluator-receipt.json'),
      '--audit-end', path.join(evidenceDir, 'audit-end.json'),
    ]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    reportOutcome('true-success');
  });
});
