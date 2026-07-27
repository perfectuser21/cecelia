import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'packages/engine/scripts/legacy-equivalence-gate.mjs');
const FIXTURE_REF = '4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13';
const tempDirs: string[] = [];

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  report: Record<string, any> | null;
};

async function runCli(args: string[]): Promise<CliResult> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legacy-equivalence-contract-'));
  tempDirs.push(dir);
  const output = path.join(dir, 'report.json');
  const result = spawnSync(process.execPath, [CLI, '--repo-root', REPO_ROOT, ...args, '--output', output], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 600_000,
    env: { ...process.env, TARGET_ENVIRONMENT: 'local_api' },
  });
  let report: Record<string, any> | null = null;
  try {
    report = JSON.parse(await readFile(output, 'utf8'));
  } catch {
    report = null;
  }
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    report,
  };
}

function expectMutationFailure(result: CliResult, mutation: string): void {
  expect(result.status, `${mutation} 必须非零退出`).not.toBe(0);
  expect(result.report, `${mutation} 必须仍产出结构化失败报告`).not.toBeNull();
  expect(result.report?.result).toBe('fail');
  expect(result.report?.violations).toEqual(
    expect.arrayContaining([expect.objectContaining({ mutation })]),
  );
}

beforeAll(async () => {
  await access(CLI);
  let ref = spawnSync('git', ['rev-parse', '--verify', `${FIXTURE_REF}^{commit}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (ref.status !== 0) {
    const fetch = spawnSync('git', ['fetch', 'origin', FIXTURE_REF], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(fetch.status, `fixture fetch 失败: ${fetch.stderr ?? ''}`).toBe(0);
    ref = spawnSync('git', ['rev-parse', '--verify', `${FIXTURE_REF}^{commit}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  }
  expect(ref.status, 'PR #4372 固定 fixture commit 必须可读取').toBe(0);
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Legacy P0/P1 equivalence contract', () => {
  it('129 条 P0/P1 inventory 精确映射且 F01/F06 非空、F08 无 catch-all', async () => {
    const { status, report } = await runCli(['--inventory-only']);
    expect(status).toBe(0);
    expect(report?.inventory_counts).toEqual({ total: 129, P0: 66, P1: 63 });
    const behaviors = report?.behaviors as Array<Record<string, any>>;
    expect(behaviors).toHaveLength(129);
    expect(new Set(behaviors.map((row) => row.behavior_id)).size).toBe(129);
    expect(behaviors.filter((row) => row.family_id === 'F01').length).toBeGreaterThan(0);
    expect(behaviors.filter((row) => row.family_id === 'F06').length).toBeGreaterThan(0);
    expect(
      behaviors.filter(
        (row) =>
          row.family_id === 'F08' &&
          !/(staging|promote|rollback)/i.test(String(row.unified_construct)),
      ),
    ).toHaveLength(0);
    for (const row of behaviors) {
      expect(row).toEqual(
        expect.objectContaining({
          behavior_id: expect.any(String),
          severity: expect.stringMatching(/^P[01]$/),
          legacy_source: expect.any(String),
          unified_owner: expect.any(String),
          unified_construct: expect.any(String),
          assertion_ref: expect.any(String),
          fail_semantics: expect.any(String),
        }),
      );
    }
  });

  it('#4372 反例精确报告 100 unknown、5 drifted、129 missing refs、0 green', async () => {
    const result = await runCli(['--counterexample-ref', FIXTURE_REF]);
    expect(result.status).not.toBe(0);
    expect(result.report?.artifact_sha).toBe(FIXTURE_REF);
    expect(result.report?.result).toBe('fail');
    expect(result.report?.status_counts).toEqual(
      expect.objectContaining({ unknown: 100, drifted: 5, missing_assertion: 129 }),
    );
    expect(result.report?.matrix.green).toBe(0);
    expect(result.report?.proven_status_count).toBe(result.report?.status_counts.proven_active);
    expect(result.report?.proven_status_count).not.toBe(
      result.report?.status_counts.proven_active + result.report?.status_counts.drifted,
    );
  });

  it('credential guard 缺失 mutation 必须 FAIL 并定位真实 construct', async () => {
    const result = await runCli(['--mutation', 'remove-credential-guard']);
    expectMutationFailure(result, 'remove-credential-guard');
    expect(result.report?.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ construct: expect.stringMatching(/credential-guard/) }),
      ]),
    );
  });

  it('stop hook 缺失 mutation 必须 FAIL 且不能只检查文件存在', async () => {
    const result = await runCli(['--mutation', 'remove-stop-hook']);
    expectMutationFailure(result, 'remove-stop-hook');
    expect(result.report?.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: expect.stringMatching(/missing_construct|oracle_not_fired/),
        }),
      ]),
    );
  });

  it('branch guard 缺失 mutation 必须 FAIL 并覆盖 positive violation recovery', async () => {
    const result = await runCli(['--mutation', 'remove-branch-guard']);
    expectMutationFailure(result, 'remove-branch-guard');
    expect(result.report?.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: expect.stringMatching(/missing_construct|oracle_not_fired/),
        }),
      ]),
    );
  });

  it('manual oracle 填入 auto 行必须 FAIL', async () => {
    const result = await runCli(['--mutation', 'manual-as-auto']);
    expectMutationFailure(result, 'manual-as-auto');
    expect(result.report?.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: 'manual_auto_mismatch' }),
      ]),
    );
  });

  it('hardcoded mismatch zero 必须 FAIL 且计数由逐行重算', async () => {
    const result = await runCli(['--mutation', 'hardcoded-mismatch-zero']);
    expectMutationFailure(result, 'hardcoded-mismatch-zero');
    expect(result.report?.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: 'derived_count_mismatch' }),
      ]),
    );
  });

  it('伪造 match_count 必须 FAIL 且不能把 gray cell 标 green', async () => {
    const result = await runCli(['--mutation', 'forged-match-count']);
    expectMutationFailure(result, 'forged-match-count');
    expect(result.report?.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: 'forged_aggregate' }),
      ]),
    );
  });

  it('current SHA 与证据时效及 assertion_ref 任一异常均 fail-closed', async () => {
    for (const mutation of ['wrong-current-sha', 'expired-evidence', 'empty-assertion-ref']) {
      const result = await runCli(['--mutation', mutation]);
      expectMutationFailure(result, mutation);
    }
  });

  it('proven_status_count 只数真实 proven active，禁止 active 加 drifted', async () => {
    const { status, report } = await runCli(['--run-oracles']);
    expect(status).toBe(0);
    const behaviors = report?.behaviors as Array<Record<string, any>>;
    const derived = behaviors.filter((row) => row.proven_status === 'active').length;
    expect(report?.proven_status_count).toBe(derived);
  });

  it('provider unsupported 必须 approved retirement 或 supersession decision', async () => {
    const { status, report } = await runCli(['--run-providers']);
    expect(status).toBe(0);
    const matrix = report?.provider_matrix as Array<Record<string, any>>;
    expect(new Set(matrix.map((row) => row.provider))).toEqual(
      new Set(['claude', 'codex', 'grok']),
    );
    for (const row of matrix) {
      if (row.support === 'supported') {
        for (const phase of ['positive', 'violation', 'recovery']) {
          expect(row[phase]).toEqual(
            expect.objectContaining({
              started: true,
              passed: true,
              exit_code: expect.any(Number),
              assertion_ref: expect.any(String),
            }),
          );
        }
      } else {
        expect(row.decision).toEqual(
          expect.objectContaining({
            status: 'approved',
            kind: expect.stringMatching(/^(retirement|supersession)$/),
          }),
        );
      }
    }
  });

  it('13×11 cell 仅由 current-SHA proven active 行聚合为 green', async () => {
    const { status, report } = await runCli(['--run-oracles']);
    expect(status).toBe(0);
    expect(report?.matrix).toEqual(
      expect.objectContaining({
        stage_count: 13,
        element_count: 11,
        cell_count: 143,
      }),
    );
    for (const cell of report?.matrix.cells as Array<Record<string, any>>) {
      if (cell.status === 'green') {
        expect(cell.behavior_ids.length).toBeGreaterThan(0);
        expect(cell.all_behaviors_proven).toBe(true);
        expect(cell.artifact_sha).toBe(report?.artifact_sha);
      }
    }
  });
});
