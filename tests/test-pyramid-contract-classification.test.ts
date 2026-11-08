import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classifySprintArtifacts, runGuard } from '../scripts/test-pyramid-guard.mjs';
import { REPO_ROOT } from './helpers/repo-root.js';
import { writeContract, prepareGuardFixture, writeE2EContract } from './helpers/pyramid-contract-fixture.js';

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
      path.join(
        REPO_ROOT,
        'tests/fixtures/harness-e2e-registration/contract-draft.md',
      ),
      path.join(sprintDir, 'contract-draft.md'),
    );
    cpSync(
      path.join(
        REPO_ROOT,
        'tests/fixtures/harness-e2e-registration/e2e-verify.sh',
      ),
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
