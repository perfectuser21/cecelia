import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync,
} from 'node:fs';
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
  filename = 'contract-draft.md',
): void {
  const sprintDir = path.join(fixtureRoot, 'sprints', sprint);
  mkdirSync(sprintDir, { recursive: true });
  const rows = testFiles.map(
    (testFile, index) =>
      `| WS${index + 1} | \`${testFile}\` | B-${index + 1} | expected red |`,
  );
  writeFileSync(
    path.join(sprintDir, filename),
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

function prepareGuardFixture(fixture: string): void {
  mkdirSync(path.join(fixture, 'scripts/smoke'), { recursive: true });
  mkdirSync(path.join(fixture, 'perm/unit'), { recursive: true });
  writeFileSync(path.join(fixture, 'perm/unit/x.test.js'), '');
}

function writeE2EContract(
  fixtureRoot: string,
  sprint: string,
  section: string,
  filename = 'contract-draft.md',
): void {
  const sprintDir = path.join(fixtureRoot, 'sprints', sprint);
  mkdirSync(sprintDir, { recursive: true });
  writeFileSync(
    path.join(sprintDir, filename),
    ['# Contract', '', section, '', '## Test Contract', ''].join('\n'),
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

  it('does not let a stale secondary contract override the canonical draft', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-contract-precedence-'));
    mkdirSync(path.join(fixture, 'sprints/s1/tests'), { recursive: true });
    writeFileSync(path.join(fixture, 'sprints/s1/tests/stale.test.ts'), '');
    writeContract(fixture, 's1', []);
    writeContract(
      fixture,
      's1',
      ['tests/stale.test.ts'],
      'sprint-contract.md',
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { total: 1 },
      registered: { total: 0 },
      unregistered: { total: 1 },
    });
    mkdirSync(path.join(fixture, 'scripts/smoke'), { recursive: true });
    mkdirSync(path.join(fixture, 'perm/unit'), { recursive: true });
    writeFileSync(path.join(fixture, 'perm/unit/x.test.js'), '');
    const guard = runGuard(fixture, {
      orphans: 0,
      permanent: 1,
      permanent_roots: [{ path: 'perm/unit', layer: 'unit' }],
      smoke_dir: 'scripts/smoke',
    }, { ci: true });
    expect(guard.pass).toBe(false);
    expect(guard.failures.some((failure: string) => failure.startsWith('A1')))
      .toBe(true);

    rmSync(fixture, { recursive: true, force: true });
  });

  it('uses sprint-contract when no contract draft exists', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-contract-fallback-'));
    mkdirSync(path.join(fixture, 'sprints/s1/tests'), { recursive: true });
    writeFileSync(path.join(fixture, 'sprints/s1/tests/fallback.test.ts'), '');
    writeContract(
      fixture,
      's1',
      ['tests/fallback.test.ts'],
      'sprint-contract.md',
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { total: 1 },
      registered: { total: 1 },
      unregistered: { total: 0 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('normalizes a cwd-relative root for classification and A1', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-relative-root-'));
    mkdirSync(path.join(fixture, 'sprints/s1/tests'), { recursive: true });
    writeFileSync(path.join(fixture, 'sprints/s1/tests/registered.test.ts'), '');
    writeContract(fixture, 's1', ['tests/registered.test.ts']);
    mkdirSync(path.join(fixture, 'scripts/smoke'), { recursive: true });
    mkdirSync(path.join(fixture, 'perm/unit'), { recursive: true });
    writeFileSync(path.join(fixture, 'perm/unit/x.test.js'), '');
    const relativeRoot = path.relative(process.cwd(), fixture);

    expect(classifySprintArtifacts(relativeRoot)).toMatchObject({
      raw: { total: 1 },
      registered: { total: 1 },
      unregistered: { total: 0 },
    });
    const guard = runGuard(relativeRoot, {
      orphans: 0,
      permanent: 1,
      permanent_roots: [{ path: 'perm/unit', layer: 'unit' }],
      smoke_dir: 'scripts/smoke',
    }, { ci: true });
    expect(guard.pass).toBe(true);
    expect(guard.registered_transitional).toMatchObject({ total: 1 });
    expect(guard.unregistered_orphans).toMatchObject({ total: 0 });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('registers the #4342-shaped e2e script from the canonical E2E bash block', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-live-shape-'));
    const sprintDir = path.join(fixture, 'sprints/fixture-kernel');
    mkdirSync(sprintDir, { recursive: true });
    cpSync(
      path.resolve('tests/fixtures/harness-e2e-registration/contract-draft.md'),
      path.join(sprintDir, 'contract-draft.md'),
    );
    cpSync(
      path.resolve('tests/fixtures/harness-e2e-registration/e2e-verify.sh'),
      path.join(sprintDir, 'e2e-verify.sh'),
    );
    prepareGuardFixture(fixture);

    const result = runGuard(fixture, {
      orphans: 0,
      permanent: 1,
      permanent_roots: [{ path: 'perm/unit', layer: 'unit' }],
      smoke_dir: 'scripts/smoke',
    }, { ci: true });

    expect(result.pass).toBe(true);
    expect(result.registered_transitional).toMatchObject({
      tests: 0, e2e: 1, total: 1,
    });
    expect(result.unregistered_orphans).toMatchObject({ total: 0 });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('fails closed when an earlier H3 E2E occurrence precedes an exact H2', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-ambiguous-heading-'));
    const sprintDir = path.join(fixture, 'sprints/s1');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(path.join(sprintDir, 'e2e-verify.sh'), 'echo later\n');
    writeFileSync(
      path.join(sprintDir, 'contract-draft.md'),
      [
        '# Contract',
        '',
        '### E2E 验收',
        '',
        '```bash',
        'echo earlier',
        '```',
        '',
        '## E2E 验收',
        '',
        '```bash',
        'echo later',
        '```',
        '',
      ].join('\n'),
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { e2e: 1, total: 1 },
      registered: { total: 0 },
      unregistered: { e2e: 1, total: 1 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('registers the evaluator-supported broad single-heading family', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-broad-heading-'));
    const sprintDir = path.join(fixture, 'sprints/s1');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(path.join(sprintDir, 'e2e-verify.sh'), 'echo broad\n');
    writeFileSync(
      path.join(sprintDir, 'contract-draft.md'),
      [
        '# Contract',
        '',
        '### E2E 验收 smoke suffix',
        '',
        '```bash',
        'echo broad',
        '```',
        '',
      ].join('\n'),
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { e2e: 1, total: 1 },
      registered: { e2e: 1, total: 1 },
      unregistered: { total: 0 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('registers matching concatenated bash fences from one E2E section', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-multi-block-'));
    const sprintDir = path.join(fixture, 'sprints/s1');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(
      path.join(sprintDir, 'e2e-verify.sh'),
      'echo first\necho second\n',
    );
    writeFileSync(
      path.join(sprintDir, 'contract-draft.md'),
      [
        '# Contract',
        '',
        '## E2E 验收',
        '',
        '```bash',
        'echo first',
        '```',
        '',
        '```bash',
        'echo second',
        '```',
        '',
      ].join('\n'),
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      registered: { e2e: 1, total: 1 },
      unregistered: { total: 0 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('does not recognize an inline E2E pseudo-heading', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-inline-heading-'));
    const sprintDir = path.join(fixture, 'sprints/s1');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(path.join(sprintDir, 'e2e-verify.sh'), 'echo inline\n');
    writeFileSync(
      path.join(sprintDir, 'contract-draft.md'),
      'paragraph ## E2E 验收\n```bash\necho inline\n```\n',
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      registered: { total: 0 },
      unregistered: { e2e: 1, total: 1 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('normalizes CRLF, line-end horizontal whitespace, and final newlines only', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-whitespace-'));
    const sprintDir = path.join(fixture, 'sprints/s1');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(
      path.join(sprintDir, 'e2e-verify.sh'),
      '#!/bin/bash\r\nset -euo pipefail\t\r\necho ok  \r\n\r\n',
    );
    writeE2EContract(
      fixture,
      's1',
      '## E2E 验收\n\n```bash\n#!/bin/bash\nset -euo pipefail\necho ok\n```',
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      registered: { e2e: 1, total: 1 },
      unregistered: { total: 0 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it.each([
    ['non-breaking space', '\u00a0'],
    ['vertical tab', '\u000b'],
    ['form feed', '\u000c'],
    ['semantic character', '#'],
  ])('preserves a trailing %s as meaningful e2e content', (_label, suffix) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-semantic-tail-'));
    const sprintDir = path.join(fixture, 'sprints/s1');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(path.join(sprintDir, 'e2e-verify.sh'), `echo ok${suffix}\n`);
    writeE2EContract(
      fixture,
      's1',
      '## E2E 验收\n\n```bash\necho ok\n```',
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { e2e: 1, total: 1 },
      registered: { total: 0 },
      unregistered: { e2e: 1, total: 1 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('rejects empty e2e evidence after permitted normalization', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-empty-'));
    const sprintDir = path.join(fixture, 'sprints/s1');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(path.join(sprintDir, 'e2e-verify.sh'), ' \t\r\n\t\r\n');
    writeE2EContract(
      fixture,
      's1',
      '## E2E 验收\n\n```bash\n \t\n\t\n```',
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { e2e: 1, total: 1 },
      registered: { total: 0 },
      unregistered: { e2e: 1, total: 1 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it.each([
    ['has no E2E section', '# Not E2E\n\n```bash\necho ok\n```', 'echo ok\n'],
    ['has no bash block', '## E2E 验收\n\nNo executable evidence.', 'echo ok\n'],
    [
      'changes a command',
      '## E2E 验收\n\n```bash\necho different\n```',
      'echo ok\n',
    ],
    [
      'changes command order',
      '## E2E 验收\n\n```bash\necho second\necho first\n```',
      'echo first\necho second\n',
    ],
  ])('keeps canonical e2e unregistered when it %s', (_label, section, script) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-invalid-'));
    const sprintDir = path.join(fixture, 'sprints/s1');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(path.join(sprintDir, 'e2e-verify.sh'), script);
    writeE2EContract(fixture, 's1', section);

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { e2e: 1, total: 1 },
      registered: { total: 0 },
      unregistered: { e2e: 1, total: 1 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('does not let a stale secondary contract register canonical e2e evidence', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-precedence-'));
    const sprintDir = path.join(fixture, 'sprints/s1');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(path.join(sprintDir, 'e2e-verify.sh'), 'echo ok\n');
    writeE2EContract(fixture, 's1', '## E2E 验收\n\nNo bash evidence.');
    writeE2EContract(
      fixture,
      's1',
      '## E2E 验收\n\n```bash\necho ok\n```',
      'sprint-contract.md',
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      registered: { total: 0 },
      unregistered: { e2e: 1, total: 1 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('fails closed on canonical read errors instead of using a stale secondary', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-contract-read-error-'));
    const sprintDir = path.join(fixture, 'sprints/s1');
    mkdirSync(path.join(sprintDir, 'tests'), { recursive: true });
    mkdirSync(path.join(sprintDir, 'contract-draft.md'));
    writeFileSync(path.join(sprintDir, 'tests/stale.test.ts'), '');
    writeFileSync(path.join(sprintDir, 'e2e-verify.sh'), 'echo stale\n');
    writeContract(
      fixture,
      's1',
      ['tests/stale.test.ts', 'e2e-verify.sh'],
      'sprint-contract.md',
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { tests: 1, e2e: 1, total: 2 },
      registered: { total: 0 },
      unregistered: { tests: 1, e2e: 1, total: 2 },
    });

    rmSync(fixture, { recursive: true, force: true });
  });

  it('does not invent a registration when the canonical e2e file is missing', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'pyramid-e2e-missing-'));
    writeE2EContract(
      fixture,
      's1',
      '## E2E 验收\n\n```bash\necho ok\n```',
    );

    expect(classifySprintArtifacts(fixture)).toMatchObject({
      raw: { total: 0 },
      registered: { total: 0 },
      unregistered: { total: 0 },
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
