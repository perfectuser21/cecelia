/**
 * CL-2 invariant→契约桥（红线裸奔检测）单测
 *
 * 被测对象：scripts/ci/check-invariant-coverage.mjs（纯函数导出 + CLI 三态出口）
 *   - parseContractInvariantIds: 从 regression-contract.yaml 提取每条 golden_path 的 invariant_ids
 *   - computeCoverage: 快照 invariants × 契约条目 → covered / naked / unknownRefs
 *   - checkSnapshotFreshness: exported_at 超 30 天 → stale 告警
 *   - CLI: 有裸奔+告警模式 exit 0；有裸奔+INVARIANT_BRIDGE_STRICT=1 exit 1；全覆盖 exit 0
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');
const SCRIPT = join(REPO_ROOT, 'scripts/ci/check-invariant-coverage.mjs');

const { parseContractInvariantIds, computeCoverage, checkSnapshotFreshness } =
  await import(SCRIPT);

// ── fixtures ────────────────────────────────────────────────────────────────
const SNAPSHOT = {
  exported_at: new Date().toISOString(),
  source: 'test-fixture',
  invariants: [
    { id: 'aaaa1111-0000-0000-0000-000000000001', topic: '[系统]租户隔离', priority: 'P2' },
    { id: 'bbbb2222-0000-0000-0000-000000000002', topic: '[系统]真环境验证才算done', priority: 'P2' },
    { id: 'cccc3333-0000-0000-0000-000000000003', topic: '[系统]日志脱敏', priority: 'P2' },
  ],
};

const CONTRACT_PARTIAL = `
version: "1.0.0"
golden_paths:
  - id: CORE-001
    name: "冒烟"
    trigger: [PR, Release]
    test_command: "true"
  - id: CORE-INV-01
    name: "租户隔离守卫"
    trigger: [PR, Release]
    test_command: "true"
    invariant_ids: [aaaa1111-0000-0000-0000-000000000001]
  - id: CORE-INV-02
    name: "真环境守卫（block 列表格式）"
    trigger: [PR, Release]
    test_command: "true"
    invariant_ids:
      - bbbb2222-0000-0000-0000-000000000002
`;

const CONTRACT_FULL = `${CONTRACT_PARTIAL}
  - id: CORE-INV-03
    name: "日志脱敏守卫"
    trigger: [PR, Release]
    test_command: "true"
    invariant_ids: ["cccc3333-0000-0000-0000-000000000003"]
`;

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'inv-bridge-'));
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(SNAPSHOT));
  writeFileSync(join(dir, 'contract-partial.yaml'), CONTRACT_PARTIAL);
  writeFileSync(join(dir, 'contract-full.yaml'), CONTRACT_FULL);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function runCli(contract, env = {}) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT, '--snapshot', join(dir, 'snapshot.json'), '--contract', join(dir, contract)],
      { env: { ...process.env, INVARIANT_BRIDGE_SOURCE: 'snapshot', ...env }, encoding: 'utf8' }
    );
    return { code: 0, output: stdout };
  } catch (err) {
    return { code: err.status, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// ── 纯函数 ──────────────────────────────────────────────────────────────────
describe('parseContractInvariantIds', () => {
  it('提取 inline 与 block 两种 invariant_ids 格式', () => {
    const entries = parseContractInvariantIds(CONTRACT_FULL);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e.invariantIds]));
    expect(byId['CORE-INV-01']).toEqual(['aaaa1111-0000-0000-0000-000000000001']);
    expect(byId['CORE-INV-02']).toEqual(['bbbb2222-0000-0000-0000-000000000002']);
    expect(byId['CORE-INV-03']).toEqual(['cccc3333-0000-0000-0000-000000000003']);
    expect(byId['CORE-001']).toEqual([]); // 无字段 → 空数组，不报错（additive 兼容）
  });
});

describe('computeCoverage', () => {
  it('裸奔检测：快照里有 invariant 但契约无守卫 → naked', () => {
    const entries = parseContractInvariantIds(CONTRACT_PARTIAL);
    const { covered, naked } = computeCoverage(SNAPSHOT.invariants, entries);
    expect(naked.map((n) => n.id)).toEqual(['cccc3333-0000-0000-0000-000000000003']);
    expect(naked[0].topic).toContain('日志脱敏');
    expect(covered.map((c) => c.id).sort()).toEqual([
      'aaaa1111-0000-0000-0000-000000000001',
      'bbbb2222-0000-0000-0000-000000000002',
    ]);
    expect(covered.find((c) => c.id.startsWith('aaaa')).guardedBy).toEqual(['CORE-INV-01']);
  });

  it('全覆盖 → naked 为空', () => {
    const entries = parseContractInvariantIds(CONTRACT_FULL);
    const { naked } = computeCoverage(SNAPSHOT.invariants, entries);
    expect(naked).toEqual([]);
  });

  it('契约引用了快照不存在的 id → unknownRefs（防 typo 假覆盖）', () => {
    const entries = parseContractInvariantIds(
      `${CONTRACT_FULL}
  - id: CORE-INV-99
    name: "typo 守卫"
    trigger: [PR]
    test_command: "true"
    invariant_ids: [dead0000-0000-0000-0000-000000000099]
`
    );
    const { unknownRefs } = computeCoverage(SNAPSHOT.invariants, entries);
    expect(unknownRefs).toEqual([
      { entryId: 'CORE-INV-99', invariantId: 'dead0000-0000-0000-0000-000000000099' },
    ]);
  });
});

describe('checkSnapshotFreshness', () => {
  it('30 天内不 stale，超 30 天 stale', () => {
    const now = new Date('2026-07-04T00:00:00Z');
    expect(checkSnapshotFreshness('2026-06-20T00:00:00Z', now).stale).toBe(false);
    const old = checkSnapshotFreshness('2026-05-01T00:00:00Z', now);
    expect(old.stale).toBe(true);
    expect(old.ageDays).toBeGreaterThan(30);
  });
});

// ── CLI 三态出口 ────────────────────────────────────────────────────────────
describe('CLI exit codes', () => {
  it('有裸奔 + 告警模式 → exit 0 且输出裸奔清单', () => {
    const { code, output } = runCli('contract-partial.yaml');
    expect(code).toBe(0);
    expect(output).toContain('裸奔');
    expect(output).toContain('cccc3333');
    expect(output).toContain('日志脱敏');
  });

  it('有裸奔 + INVARIANT_BRIDGE_STRICT=1 → exit 1', () => {
    const { code, output } = runCli('contract-partial.yaml', { INVARIANT_BRIDGE_STRICT: '1' });
    expect(code).toBe(1);
    expect(output).toContain('裸奔');
  });

  it('全覆盖 → exit 0，无裸奔告警', () => {
    const { code, output } = runCli('contract-full.yaml');
    expect(code).toBe(0);
    expect(output).not.toContain('无守卫');
  });

  it('全覆盖 + STRICT=1 → 仍 exit 0', () => {
    const { code } = runCli('contract-full.yaml', { INVARIANT_BRIDGE_STRICT: '1' });
    expect(code).toBe(0);
  });
});
