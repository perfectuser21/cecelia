import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import { runCheck } from '../../../../../scripts/ci/check-kernel-behavior-equivalence.mjs';
import { compileDrillPlan } from '../kernel-equivalence-drills.js';
import {
  createTrustFixture,
} from './kernel-equivalence-test-fixtures.js';

const scriptPath = fileURLToPath(new URL(
  '../../../../../scripts/ci/check-kernel-behavior-equivalence.mjs',
  import.meta.url,
));
const repositoryRoot = dirname(dirname(dirname(scriptPath)));
const fixtures = [];

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function fixtureRoot(contractSource = [
  'behavior_equivalence:',
  '  report_as_of: "2025-01-02T03:04:05.000Z"',
  '',
].join('\n')) {
  const root = mkdtempSync(join(tmpdir(), 'kernel-check-cli-'));
  fixtures.push(root);
  write(root, 'regression-contract.yaml', contractSource);
  mkdirSync(join(root, 'packages/a'), { recursive: true });
  for (const migrationRoot of [
    'packages/brain/migrations',
    'packages/brain/src/db/migrations',
    'packages/brain/src/migrations',
  ]) {
    mkdirSync(join(root, migrationRoot), { recursive: true });
  }
  return root;
}

function injectedDependencies({
  schemaValid = true,
  capture = {},
} = {}) {
  return {
    validateBehaviorEquivalence(contract, options) {
      capture.validationNow ??= [];
      capture.validationNow.push(options.now);
      return {
        valid: schemaValid,
        schema_valid: schemaValid,
        proof_complete: false,
        atomic_cutover_ready: false,
        contract_version: 'fixture-contract',
        findings: schemaValid ? [] : [{ code: 'fixture_invalid' }],
        behaviors: [],
      };
    },
    compileDrillPlan(contract, options) {
      capture.drillNow ??= [];
      capture.drillNow.push(options.now);
      return {
        behavior_count: 11,
        cells: [
          { blocked_by: null },
          { blocked_by: 'fixture_blocker' },
        ],
      };
    },
    buildEquivalenceReport(validation, options) {
      capture.evaluatedAt ??= [];
      capture.evaluatedAt.push(options.evaluatedAt);
      return {
        report_version: 'fixture/v1',
        contract_version: validation.contract_version,
        evaluated_at: options.evaluatedAt,
      };
    },
    formatEquivalenceMarkdown(report) {
      return `# Equivalence ${report.evaluated_at}\n`;
    },
  };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('kernel equivalence check CLI', () => {
  it('is import-safe and exports an injectable check runner', () => {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      [
        `const module = await import(${JSON.stringify(`file://${scriptPath}`)});`,
        'process.stdout.write(typeof module.runCheck);',
      ].join('\n'),
    ], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('function');
  });

  it('uses one historical report clock for validation, drills, and reporting', () => {
    const root = fixtureRoot();
    const capture = {};
    const dependencies = injectedDependencies({ capture });

    const first = runCheck({
      repositoryRoot: root,
      dependencies,
    });
    const second = runCheck({
      repositoryRoot: root,
      dependencies,
    });

    const expectedNow = Date.parse('2025-01-02T03:04:05.000Z');
    expect(capture.validationNow).toEqual([expectedNow, expectedNow]);
    expect(capture.drillNow).toEqual([expectedNow, expectedNow]);
    expect(capture.evaluatedAt).toEqual([
      '2025-01-02T03:04:05.000Z',
      '2025-01-02T03:04:05.000Z',
    ]);
    expect(second.stdout).toBe(first.stdout);
    expect(second.stderr).toBe(first.stderr);
    expect(second.exitCode).toBe(first.exitCode);
  });

  it('keeps real signer validation on the historical report clock', () => {
    const contract = load(readFileSync(
      join(repositoryRoot, 'regression-contract.yaml'),
      'utf8',
    ));
    const behaviors = contract.behavior_equivalence.behaviors;
    const keyFixtures = behaviors.map(
      (behavior) => createTrustFixture(behavior.drill.seam_id),
    );
    const historicalEffectKeys = keyFixtures.map((keys, index) => ({
      ...keys.effect.record,
      key_id: `historical-effect-${String(index).padStart(2, '0')}`,
      not_before: '2026-07-27T00:00:00.000Z',
      not_after: '2026-07-28T12:00:00.000Z',
    }));
    contract.behavior_equivalence.drill_trust_registry = {
      ...keyFixtures[0].registry,
      keys: [
        keyFixtures[0].authority.record,
        keyFixtures[0].collector.record,
        ...historicalEffectKeys,
      ],
    };
    for (const [index, behavior] of behaviors.entries()) {
      behavior.drill.effect_signer_status = 'available';
      behavior.drill.effect_key_id = historicalEffectKeys[index].key_id;
      behavior.drill.blocked_by = null;
    }
    const root = fixtureRoot(`${JSON.stringify(contract, null, 2)}\n`);

    const first = runCheck({ repositoryRoot: root });
    const second = runCheck({ repositoryRoot: root });

    expect(first).toMatchObject({
      exitCode: 0,
      stderr: '',
      result: {
        schema_valid: true,
        drill_behavior_count: 11,
        drill_cell_count: 99,
        drill_blocker_count: 0,
        drill_execution_ready: true,
      },
    });
    expect(second.stdout).toBe(first.stdout);
    expect(second.stderr).toBe(first.stderr);
    expect(() => compileDrillPlan(contract)).toThrow(
      'drill_effect_signer_key_inactive',
    );
  });

  it('fails independently on duplicate contracts and forbidden ledger DDL', () => {
    const root = fixtureRoot();
    write(
      root,
      'packages/a/foo.regression-contract.yaml',
      'behavior_equivalence: {}\n',
    );
    write(
      root,
      'packages/brain/migrations/999_behavior_ledger.sql',
      'CREATE TABLE IF NOT EXISTS audit.behavior_ledger (id uuid);\n',
    );

    const check = runCheck({
      repositoryRoot: root,
      dependencies: injectedDependencies(),
    });

    expect(check.exitCode).toBe(1);
    expect(check.result).toMatchObject({
      schema_valid: true,
      repository_policy_valid: false,
      duplicate_behavior_equivalence_contracts: [
        'packages/a/foo.regression-contract.yaml',
      ],
      forbidden_behavior_ledger_tables: [
        'packages/brain/migrations/999_behavior_ledger.sql',
      ],
    });
    expect(check.stderr).toContain('Repository equivalence policy failed');
  });

  it('fails closed and reports policy state when root behavior is missing', () => {
    const root = fixtureRoot('something_else: true\n');

    const check = runCheck({
      repositoryRoot: root,
      dependencies: injectedDependencies(),
    });

    expect(check.exitCode).toBe(1);
    expect(check.result).toMatchObject({
      schema_valid: false,
      repository_policy_valid: false,
      duplicate_behavior_equivalence_contracts: [
        'regression-contract.yaml:missing_top_level_behavior_equivalence',
      ],
      forbidden_behavior_ledger_tables: [],
    });
    expect(check.stderr).toContain(
      'behavior_equivalence.report_as_of must be a valid deterministic timestamp',
    );
  });

  it('keeps schema validity orthogonal to repository policy validity', () => {
    const root = fixtureRoot();

    const check = runCheck({
      repositoryRoot: root,
      dependencies: injectedDependencies({ schemaValid: false }),
    });

    expect(check.exitCode).toBe(1);
    expect(check.result).toMatchObject({
      schema_valid: false,
      repository_policy_valid: true,
      duplicate_behavior_equivalence_contracts: [],
      forbidden_behavior_ledger_tables: [],
    });
    expect(check.stderr).toContain(
      'Behavior equivalence contract has 1 validation finding(s).',
    );
  });

  it('preserves markdown, write-report, and requested drift behavior', () => {
    const root = fixtureRoot();
    const reportPath = join(root, 'report.md');
    const dependencies = injectedDependencies();

    const markdown = runCheck({
      argv: ['--format=markdown'],
      repositoryRoot: root,
      reportPath,
      dependencies,
    });
    expect(markdown).toMatchObject({
      exitCode: 0,
      stdout: '# Equivalence 2025-01-02T03:04:05.000Z\n',
    });

    const written = runCheck({
      argv: ['--write-report', '--format=json'],
      repositoryRoot: root,
      reportPath,
      dependencies,
    });
    expect(written.exitCode).toBe(0);
    expect(readFileSync(reportPath, 'utf8')).toBe(markdown.stdout);

    const current = runCheck({
      argv: ['--check-report', '--format=json'],
      repositoryRoot: root,
      reportPath,
      dependencies,
    });
    expect(current.exitCode).toBe(0);
    expect(current.result.report_drift).toBe(false);

    writeFileSync(reportPath, '# stale\n');
    const stale = runCheck({
      argv: ['--check-report', '--format=json'],
      repositoryRoot: root,
      reportPath,
      dependencies,
    });
    expect(stale.exitCode).toBe(1);
    expect(stale.result.report_drift).toBe(true);
    expect(stale.stderr).toContain('Behavior equivalence report is stale');
  });
});
