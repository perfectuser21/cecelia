import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import contractPaths from '../../../../scripts/lib/test-contract-paths.cjs';

const { parseCanonicalE2EScript } = contractPaths;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CONTRACT_PATH = resolve(
  REPO_ROOT,
  'sprints/08132021-controller-lease-renewal-r2/contract-draft.md',
);

describe('Controller lease 合同 E2E 领域 oracle', () => {
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
    expect(oracle).toMatch(
      /controller_lease_expires_at\s*>\s*:'before_lease'::timestamptz/i,
    );
    expect(oracle).toMatch(/phase\s*=\s*'planning'/i);

    expect(e2e).toContain('randomUUID');
    expect(e2e).toContain('createKernelRun');
    expect(e2e).toContain('writeHeartbeat');
    expect(e2e).toContain('trap cleanup_e2e EXIT');
    expect(e2e).toContain('DELETE FROM initiative_runs');
  });
});
