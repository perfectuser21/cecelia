import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  evaluateRepositoryPolicy,
  findForbiddenBehaviorLedgerTables,
  findSecondaryBehaviorEquivalenceContracts,
} from '../kernel-equivalence-repository-policy.js';

const fixtures = [];

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'kernel-repository-policy-'));
  fixtures.push(root);
  write(root, 'regression-contract.yaml', 'behavior_equivalence: {}\n');
  return root;
}

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

describe('kernel equivalence repository policy', () => {
  it('finds every secondary runtime contract escape and sorts paths', () => {
    const root = fixtureRoot();
    write(
      root,
      'packages/z/foo.regression-contract.yaml',
      'behavior_equivalence:\n  schema_version: "1.1"\n',
    );
    write(
      root,
      'packages/a/regression-contract.template.yaml',
      'behavior_equivalence: null\n',
    );
    write(
      root,
      'packages/b/REGRESSION-CONTRACT.yml',
      'behavior_equivalence: false\n',
    );
    write(
      root,
      'packages/c/regression-contract.yaml',
      'unrelated: true\n',
    );
    write(
      root,
      'packages/d/legacy.regression-contract.yaml',
      '- id: legacy-contract\n',
    );
    write(
      root,
      'docs/regression-contract.yaml',
      'behavior_equivalence: {}\n',
    );
    write(
      root,
      'other/regression-contract.yaml',
      'behavior_equivalence: {}\n',
    );

    expect(findSecondaryBehaviorEquivalenceContracts(root)).toEqual([
      'packages/a/regression-contract.template.yaml',
      'packages/b/REGRESSION-CONTRACT.yml',
      'packages/z/foo.regression-contract.yaml',
    ]);
  });

  it('reports a missing or invalid root behavior contract without throwing', () => {
    const missingRoot = fixtureRoot();
    write(missingRoot, 'regression-contract.yaml', 'something_else: true\n');

    const missing = evaluateRepositoryPolicy(missingRoot);
    expect(missing.repository_policy_valid).toBe(false);
    expect(missing.duplicate_behavior_equivalence_contracts).toContain(
      'regression-contract.yaml:missing_top_level_behavior_equivalence',
    );

    const invalidRoot = fixtureRoot();
    write(invalidRoot, 'regression-contract.yaml', 'behavior_equivalence: [\n');

    expect(() => evaluateRepositoryPolicy(invalidRoot)).not.toThrow();
    expect(evaluateRepositoryPolicy(invalidRoot)).toEqual({
      repository_policy_valid: false,
      duplicate_behavior_equivalence_contracts: [
        'regression-contract.yaml:unreadable_or_invalid',
      ],
      forbidden_behavior_ledger_tables: [],
    });

    const absentRepository = join(tmpdir(), `absent-policy-${Date.now()}`);
    expect(() => evaluateRepositoryPolicy(absentRepository)).not.toThrow();
    expect(evaluateRepositoryPolicy(absentRepository)).toEqual({
      repository_policy_valid: false,
      duplicate_behavior_equivalence_contracts: [
        'packages/:unreadable_or_invalid',
        'regression-contract.yaml:unreadable_or_invalid',
      ],
      forbidden_behavior_ledger_tables: [
        'packages/brain/migrations/:unreadable_or_invalid',
        'packages/brain/src/db/migrations/:unreadable_or_invalid',
        'packages/brain/src/migrations/:unreadable_or_invalid',
      ],
    });
  });

  it.each([
    ['plain', 'CREATE TABLE behavior_ledger (id uuid);'],
    [
      'if not exists',
      'create table if not exists behavior_ledger (id uuid);',
    ],
    [
      'unlogged and schema qualified',
      'CREATE UNLOGGED TABLE audit.behavior_ledger (id uuid);',
    ],
    [
      'temporary and quoted',
      'CrEaTe TeMpOrArY TaBlE "audit"."behavior_ledger" (id uuid);',
    ],
    [
      'temp and quoted case',
      'CREATE TEMP TABLE IF NOT EXISTS "Behavior_Ledger" (id uuid);',
    ],
    [
      'comments between tokens',
      'CREATE /* never persist this */ TABLE audit./* x */behavior_ledger(id uuid);',
    ],
    [
      'DDL after a Unicode string',
      `SELECT '${'😀'.repeat(16)}'; CREATE TABLE behavior_ledger(id uuid);`,
    ],
    [
      'comment markers inside quoted schema identifiers',
      'CREATE TABLE "audit--/*archive*/"."behavior_ledger"(id uuid);',
    ],
  ])('rejects %s production behavior ledger DDL', (_label, sql) => {
    const root = fixtureRoot();
    write(root, 'packages/brain/migrations/900_policy.sql', sql);

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([
      'packages/brain/migrations/900_policy.sql',
    ]);
  });

  it('scans every production migration root and returns stable unique paths', () => {
    const root = fixtureRoot();
    write(
      root,
      'packages/brain/src/migrations/z.sql',
      'CREATE TABLE behavior_ledger(id uuid); CREATE TABLE behavior_ledger(id uuid);',
    );
    write(
      root,
      'packages/brain/src/db/migrations/a.sql',
      'CREATE UNLOGGED TABLE public.behavior_ledger(id uuid);',
    );
    write(
      root,
      'packages/brain/migrations/m.sql',
      'CREATE TEMP TABLE "behavior_ledger"(id uuid);',
    );

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([
      'packages/brain/migrations/m.sql',
      'packages/brain/src/db/migrations/a.sql',
      'packages/brain/src/migrations/z.sql',
    ]);
  });

  it('ignores comments, string literals, dollar strings, docs, and fixtures', () => {
    const root = fixtureRoot();
    write(
      root,
      'packages/brain/migrations/901_safe.sql',
      [
        '-- CREATE TABLE behavior_ledger(id uuid);',
        '/* CREATE TEMP TABLE public.behavior_ledger(id uuid); */',
        "SELECT 'CREATE TABLE behavior_ledger(id uuid);';",
        `SELECT '${'😀'.repeat(16)} CREATE TABLE behavior_ledger(id uuid);';`,
        "SELECT E'CREATE TABLE behavior_ledger(id uuid);';",
        'SELECT $$CREATE TABLE behavior_ledger(id uuid);$$;',
        'SELECT $tag$CREATE TABLE behavior_ledger(id uuid);$tag$;',
        'SELECT "CREATE TABLE behavior_ledger";',
        'CREATE TABLE behavior_ledger_archive(id uuid);',
      ].join('\n'),
    );
    write(
      root,
      'docs/ledger.md',
      'CREATE TABLE behavior_ledger(id uuid);\n',
    );
    write(
      root,
      'packages/brain/src/lib/__tests__/fixtures/ledger.sql',
      'CREATE TABLE behavior_ledger(id uuid);\n',
    );
    write(
      root,
      'packages/brain/migrations/fixtures/ledger.sql',
      'CREATE TABLE behavior_ledger(id uuid);\n',
    );

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([]);
  });

  it('does not follow symlink escapes during bounded traversal', () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    write(
      outside,
      'escape.regression-contract.yaml',
      'behavior_equivalence: {}\n',
    );
    mkdirSync(join(root, 'packages'), { recursive: true });
    symlinkSync(outside, join(root, 'packages/linked'));

    expect(findSecondaryBehaviorEquivalenceContracts(root)).toEqual([]);
  });

  it('fails closed with a stable finding at the traversal depth bound', () => {
    const root = fixtureRoot();
    let directory = 'packages';
    for (let depth = 0; depth < 34; depth += 1) {
      directory = join(directory, `level-${depth}`);
    }
    write(
      root,
      join(directory, 'escape.regression-contract.yaml'),
      'behavior_equivalence: {}\n',
    );

    expect(findSecondaryBehaviorEquivalenceContracts(root)).toEqual([
      'packages/:traversal_limit_exceeded',
    ]);
  });

  it('fails closed and deterministically for oversized policy inputs', () => {
    const root = fixtureRoot();
    write(
      root,
      'packages/a/regression-contract.huge.yaml',
      `behavior_equivalence: {}\npadding: ${'x'.repeat(1_100_000)}\n`,
    );
    write(
      root,
      'packages/brain/migrations/902_huge.sql',
      `SELECT '${'x'.repeat(4_100_000)}';\n`,
    );

    const first = evaluateRepositoryPolicy(root);
    const second = evaluateRepositoryPolicy(root);

    expect(first).toEqual(second);
    expect(first.repository_policy_valid).toBe(false);
    expect(first.duplicate_behavior_equivalence_contracts).toEqual([
      'packages/a/regression-contract.huge.yaml:oversized',
    ]);
    expect(first.forbidden_behavior_ledger_tables).toEqual([
      'packages/brain/migrations/902_huge.sql:oversized',
    ]);
  });

  it('returns the exact valid policy shape for a clean repository', () => {
    const root = fixtureRoot();

    expect(evaluateRepositoryPolicy(root)).toEqual({
      repository_policy_valid: true,
      duplicate_behavior_equivalence_contracts: [],
      forbidden_behavior_ledger_tables: [],
    });
  });
});
