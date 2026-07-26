import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  countOrphans, classifySprintArtifacts, checkSmokeWiring, countPermanent,
  checkPanelFreshness, runGuard,
} from '../scripts/test-pyramid-guard.mjs';

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'pyramid-'));
  // 孤儿：2 个测试 + 1 个 e2e；archive 里 1 个不算
  mkdirSync(path.join(root, 'sprints/s1/tests'), { recursive: true });
  writeFileSync(path.join(root, 'sprints/s1/tests/a.test.ts'), '');
  writeFileSync(path.join(root, 'sprints/s1/tests/b.spec.js'), '');
  writeFileSync(path.join(root, 'sprints/s1/e2e-verify.sh'), '');
  mkdirSync(path.join(root, 'sprints/archive/old'), { recursive: true });
  writeFileSync(path.join(root, 'sprints/archive/old/c.test.ts'), '');
  // smoke：wired-smoke.sh 被 glob 跑；naked.sh 无人引用
  mkdirSync(path.join(root, 'scripts/smoke'), { recursive: true });
  writeFileSync(path.join(root, 'scripts/smoke/wired-smoke.sh'), '');
  writeFileSync(path.join(root, 'scripts/smoke/naked.sh'), '');
  mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  writeFileSync(path.join(root, '.github/workflows/ci.yml'),
    'run: |\n  for s in scripts/smoke/*-smoke.sh; do bash "$s"; done\n');
  // 永久池：unit 根 2 个文件
  mkdirSync(path.join(root, 'perm/unit'), { recursive: true });
  writeFileSync(path.join(root, 'perm/unit/x.test.js'), '');
  writeFileSync(path.join(root, 'perm/unit/y.spec.ts'), '');
  // 面板：新鲜的 CURRENT_STATE
  mkdirSync(path.join(root, '.agent-knowledge'), { recursive: true });
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  writeFileSync(path.join(root, '.agent-knowledge/CURRENT_STATE.md'),
    `---\ngenerated: ${now} CST\nsource: write-current-state.sh\n---\n`);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('countOrphans', () => {
  it('数 sprints 下测试+e2e，排除 archive', () => {
    expect(countOrphans(root)).toEqual({ tests: 2, e2e: 1, total: 3 });
  });
  it('bash 测试 *.test.sh 也算孤儿（棘轮盲区修复）', () => {
    writeFileSync(path.join(root, 'sprints/s1/tests/d.test.sh'), '');
    expect(countOrphans(root).tests).toBe(3);
    rmSync(path.join(root, 'sprints/s1/tests/d.test.sh'));
  });
  it('sprints 不存在 → 0', () => {
    expect(countOrphans('/nonexistent-root')).toEqual({ tests: 0, e2e: 0, total: 0 });
  });
});

function writeContract(
  fixtureRoot: string,
  sprint: string,
  testFiles: string[],
): void {
  const sprintDir = path.join(fixtureRoot, 'sprints', sprint);
  mkdirSync(sprintDir, { recursive: true });
  const rows = testFiles.map(
    (testFile, index) =>
      `| WS${index + 1} | \`${testFile}\` | B-${index + 1} | expected red |`,
  );
  writeFileSync(
    path.join(sprintDir, 'contract-draft.md'),
    [
      '# Contract',
      '',
      '## Test Contract',
      '',
      '| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |',
      '|---|---|---|---|',
      ...rows,
      '',
    ].join('\n'),
  );
}

describe('classifySprintArtifacts', () => {
  it('registers existing tests and e2e only through their own sprint contract', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-registered-'));
    mkdirSync(path.join(fixture, 'sprints/s1/tests'), { recursive: true });
    writeFileSync(path.join(fixture, 'sprints/s1/tests/registered.test.ts'), '');
    writeFileSync(path.join(fixture, 'sprints/s1/tests/orphan.test.ts'), '');
    writeFileSync(path.join(fixture, 'sprints/s1/e2e-verify.sh'), '');
    writeContract(fixture, 's1', [
      'tests/registered.test.ts',
      'e2e-verify.sh',
    ]);

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { tests: 2, e2e: 1, total: 3 },
      registered: { tests: 1, e2e: 1, total: 2 },
      unregistered: { tests: 1, e2e: 0, total: 1 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('does not let one sprint register an artifact owned by another sprint', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-cross-sprint-'));
    mkdirSync(path.join(fixture, 'sprints/s2/tests'), { recursive: true });
    writeFileSync(path.join(fixture, 'sprints/s2/tests/cross.test.ts'), '');
    writeContract(fixture, 's1', [
      'sprints/s2/tests/cross.test.ts',
    ]);

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { total: 1 },
      registered: { total: 0 },
      unregistered: { total: 1 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it.each([
    ['a missing reference', 'tests/missing.test.ts'],
    ['an unsafe traversal reference', 'tests/../tests/orphan.test.ts'],
  ])('keeps an artifact unregistered for %s', (_label, declaredPath) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-invalid-contract-'));
    mkdirSync(path.join(fixture, 'sprints/s1/tests'), { recursive: true });
    writeFileSync(path.join(fixture, 'sprints/s1/tests/orphan.test.ts'), '');
    writeContract(fixture, 's1', [declaredPath]);

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { total: 1 },
      registered: { total: 0 },
      unregistered: { total: 1 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('keeps artifacts unregistered when the sprint has no parseable contract', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-no-contract-'));
    mkdirSync(path.join(fixture, 'sprints/s1/tests'), { recursive: true });
    writeFileSync(path.join(fixture, 'sprints/s1/tests/orphan.test.ts'), '');
    writeFileSync(path.join(fixture, 'sprints/s1/contract-draft.md'), '# no table\n');

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { total: 1 },
      registered: { total: 0 },
      unregistered: { total: 1 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });
});

describe('checkSmokeWiring', () => {
  it('glob 引用算 wired，无引用算 unwired', () => {
    const r = checkSmokeWiring(root, 'scripts/smoke');
    expect(r.total).toBe(2);
    expect(r.unwired).toEqual(['naked.sh']);
  });
});

describe('countPermanent', () => {
  it('按 roots 数测试文件并按 layer 聚合', () => {
    const r = countPermanent(root, [{ path: 'perm/unit', layer: 'unit' }]);
    expect(r.total).toBe(2);
    expect(r.layers.unit).toBe(2);
  });
});

describe('checkPanelFreshness', () => {
  it('48h 内 → fresh', () => {
    expect(checkPanelFreshness(root, 48).fresh).toBe(true);
  });
  it('文件缺失 → not fresh', () => {
    expect(checkPanelFreshness('/nonexistent-root', 48).fresh).toBe(false);
  });
  it('generated 为 49 小时前 → not fresh', () => {
    const staleRoot = mkdtempSync(path.join(tmpdir(), 'pyramid-stale-'));
    mkdirSync(path.join(staleRoot, '.agent-knowledge'), { recursive: true });
    // generated 按 +08:00 解析：取 49h 前的时刻换算成东八区墙钟字符串
    const stale = new Date(Date.now() - 49 * 3600e3 + 8 * 3600e3)
      .toISOString().replace('T', ' ').slice(0, 19);
    writeFileSync(path.join(staleRoot, '.agent-knowledge/CURRENT_STATE.md'),
      `---\ngenerated: ${stale} CST\nsource: write-current-state.sh\n---\n`);
    expect(checkPanelFreshness(staleRoot, 48).fresh).toBe(false);
    rmSync(staleRoot, { recursive: true, force: true });
  });
});

describe('runGuard', () => {
  it('基线匹配 → pass；孤儿超基线 → fail 且指出 A1', () => {
    const baseline = {
      orphans: 3, permanent: 2,
      permanent_roots: [{ path: 'perm/unit', layer: 'unit' }],
      smoke_dir: 'scripts/smoke',
    };
    writeFileSync(path.join(root, 'scripts/smoke/naked.sh.wired-marker'), '');
    // naked.sh 仍 unwired → A2 fail
    const r1 = runGuard(root, baseline, { ci: true });
    expect(r1.pass).toBe(false);
    expect(r1.failures.some((f: string) => f.startsWith('A2'))).toBe(true);
    // 移除 naked.sh 后全绿
    rmSync(path.join(root, 'scripts/smoke/naked.sh'));
    const r2 = runGuard(root, baseline, { ci: true });
    expect(r2.pass).toBe(true);
    // 孤儿基线调低 → A1 fail
    const r3 = runGuard(root, { ...baseline, orphans: 1 }, { ci: true });
    expect(r3.pass).toBe(false);
    expect(r3.failures.some((f: string) => f.startsWith('A1'))).toBe(true);
    // 永久池基线调高（模拟有人删测试）→ A3 fail
    const r4 = runGuard(root, { ...baseline, orphans: 1, permanent: 99 }, { ci: true });
    expect(r4.failures.some((f: string) => f.startsWith('A3'))).toBe(true);
  });

  it('applies A1 to unregistered artifacts while returning raw observability', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-run-guard-'));
    mkdirSync(path.join(fixture, 'sprints/s1/tests'), { recursive: true });
    writeFileSync(path.join(fixture, 'sprints/s1/tests/registered.test.ts'), '');
    writeContract(fixture, 's1', ['tests/registered.test.ts']);
    mkdirSync(path.join(fixture, 'scripts/smoke'), { recursive: true });
    mkdirSync(path.join(fixture, 'perm/unit'), { recursive: true });
    writeFileSync(path.join(fixture, 'perm/unit/x.test.js'), '');

    const result = runGuard(fixture, {
      orphans: 0,
      permanent: 1,
      permanent_roots: [{ path: 'perm/unit', layer: 'unit' }],
      smoke_dir: 'scripts/smoke',
    }, { ci: true });

    expect(result.pass).toBe(true);
    expect(result.orphans).toMatchObject({ total: 1 });
    expect(result.registered_transitional).toMatchObject({ total: 1 });
    expect(result.unregistered_orphans).toMatchObject({ total: 0 });

    rmSync(fixture, { recursive: true, force: true });
  });
});

describe('A5 裸奔 FR 棘轮', () => {
  const baselineWithBareFr = {
    orphans: 3, permanent: 2,
    permanent_roots: [{ path: 'perm/unit', layer: 'unit' }],
    smoke_dir: 'scripts/smoke',
    bare_fr: 2,
  };

  it('bareFrCount === null 时跳过 A5（Brain 不可达）', () => {
    const r = runGuard(root, baselineWithBareFr, { ci: true, bareFrCount: null });
    expect(r.bare_fr).toBeNull();
    expect(r.failures.some((f: string) => f.startsWith('A5'))).toBe(false);
  });

  it('bareFrCount <= 基线 → 不触发 A5', () => {
    const r = runGuard(root, baselineWithBareFr, { ci: true, bareFrCount: 2 });
    expect(r.bare_fr).toEqual({ count: 2, baseline: 2 });
    expect(r.failures.some((f: string) => f.startsWith('A5'))).toBe(false);
  });

  it('bareFrCount > 基线 → A5 fail（棘轮倒退）', () => {
    const r = runGuard(root, baselineWithBareFr, { ci: true, bareFrCount: 5 });
    expect(r.pass).toBe(false);
    expect(r.failures.some((f: string) => f.startsWith('A5'))).toBe(true);
    expect(r.bare_fr).toEqual({ count: 5, baseline: 2 });
  });

  it('baseline 无 bare_fr 字段时 bareFrCount 不触发 A5', () => {
    const baselineNoBare = { ...baselineWithBareFr };
    delete (baselineNoBare as any).bare_fr;
    const r = runGuard(root, baselineNoBare, { ci: true, bareFrCount: 99 });
    expect(r.failures.some((f: string) => f.startsWith('A5'))).toBe(false);
  });
});
