import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import contractPaths from '../../../../scripts/lib/test-contract-paths.cjs';

const { parseCanonicalE2EScript } = contractPaths;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SPRINT_DIR = resolve(REPO_ROOT, 'sprints/08132021-controller-lease-renewal-r2');
const CONTRACT_PATH = resolve(SPRINT_DIR, 'contract-draft.md');

describe('Controller lease 合同 E2E 领域 oracle', () => {
  it('原样交给 bash 执行 migration 416 ARTIFACT 合同', () => {
    const contract = readFileSync(resolve(SPRINT_DIR, 'contract-dod.md'), 'utf8');
    const testCommand = contract.match(
      /- \[x\] \[ARTIFACT\] migration 416 与 rollback 资产存在[\s\S]*?\n  Test: (.+)/,
    )?.[1];
    expect(testCommand).toBeTruthy();
    const result = spawnSync('/bin/bash', ['-c', testCommand], { cwd: REPO_ROOT });
    expect(result.status, result.stderr?.toString()).toBe(0);
  });

  it('用本轮唯一 run 的新鲜业务行断言 heartbeat、lease 与 phase', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');
    const e2e = parseCanonicalE2EScript(contract);
    expect(e2e).not.toBeNull();
    const oracleStart = e2e.indexOf('ROW_COUNT="$(psql');
    const oracleEnd = e2e.indexOf('\nSQL\n)"', oracleStart);
    expect(oracleStart).toBeGreaterThan(-1);
    expect(oracleEnd).toBeGreaterThan(oracleStart);
    const oracle = e2e.slice(oracleStart, oracleEnd);
    expect(oracle).toMatch(/SELECT\s+count\(\*\)/i);
    expect(oracle).toMatch(/FROM\s+initiative_runs/i);
    expect(oracle).toMatch(/created_at\s*>\s*NOW\(\)\s*-\s*interval/i);
    expect(oracle).toMatch(/WHERE\s+id\s*=\s*:'run_id'::uuid/i);
    expect(oracle).toMatch(/orchestrator_heartbeat_at\s*>\s*created_at/i);
    expect(oracle).toMatch(/controller_lease_expires_at\s*>\s*:'before_lease'::timestamptz/i);
    expect(oracle).toMatch(/phase\s*=\s*'planning'/i);
    expect(e2e).toContain('randomUUID');
    expect(e2e).toContain('createKernelRun');
    expect(e2e).toContain('writeHeartbeat');
    expect(e2e).toContain('trap cleanup_e2e EXIT');
    expect(e2e).toContain('DELETE FROM initiative_runs');
  });
});
