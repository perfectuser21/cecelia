import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  evaluateRepositoryPolicy,
  findForbiddenBehaviorLedgerTables,
  findSecondaryBehaviorEquivalenceContracts,
} from '../kernel-equivalence-repository-policy.js';

const fixtures = [];
const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../',
);

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
    [
      'global temporary',
      'CREATE GLOBAL TEMPORARY TABLE behavior_ledger(id uuid);',
    ],
    [
      'global temp',
      'CREATE GLOBAL TEMP TABLE behavior_ledger(id uuid);',
    ],
    [
      'local temporary',
      'CREATE LOCAL TEMPORARY TABLE behavior_ledger(id uuid);',
    ],
    [
      'local temp',
      'CREATE LOCAL TEMP TABLE behavior_ledger(id uuid);',
    ],
    [
      'Unicode quoted identifier',
      'CREATE TABLE U&"behavior_ledger"(id uuid);',
    ],
    [
      'Unicode escaped underscore identifier',
      String.raw`CREATE TABLE U&"behavior\005fledger"(id uuid);`,
    ],
    [
      'schema-qualified Unicode escaped identifier',
      String.raw`CREATE TABLE U&"audit".U&"behavior\+00005fledger"(id uuid);`,
    ],
    [
      'custom Unicode escape',
      `CREATE TABLE U&"behavior!005fledger" UESCAPE '!' (id uuid);`,
    ],
    [
      'schema custom escape and escaped escape character',
      [
        `CREATE TABLE U&"audit!!prod" UESCAPE '!'`,
        `.U&"behavior!005fledger" UESCAPE '!' (id uuid);`,
      ].join(''),
    ],
  ])('rejects %s production behavior ledger DDL', (_label, sql) => {
    const root = fixtureRoot();
    write(root, 'packages/brain/migrations/900_policy.sql', sql);

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([
      'packages/brain/migrations/900_policy.sql',
    ]);
  });

  it.each([
    [
      'hexadecimal escape character',
      `CREATE TABLE U&"behavior0005fledger" UESCAPE '0' (id uuid);`,
    ],
    [
      'plus escape character',
      `CREATE TABLE U&"behavior+005fledger" UESCAPE '+' (id uuid);`,
    ],
    [
      'multi-character escape',
      `CREATE TABLE U&"behavior!!005fledger" UESCAPE '!!' (id uuid);`,
    ],
    [
      'missing escape literal',
      'CREATE TABLE U&"behavior!005fledger" UESCAPE (id uuid);',
    ],
    [
      'invalid Unicode digits',
      `CREATE TABLE U&"behavior!zzzzledger" UESCAPE '!' (id uuid);`,
    ],
    [
      'Unicode zero code point',
      String.raw`CREATE TABLE U&"behavior\0000ledger" (id uuid);`,
    ],
    [
      'unpaired Unicode surrogate',
      String.raw`CREATE TABLE U&"behavior\d800ledger" (id uuid);`,
    ],
  ])('fails closed for %s in Unicode DDL', (_label, sql) => {
    const root = fixtureRoot();
    write(root, 'packages/brain/migrations/900_invalid.sql', sql);

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([
      'packages/brain/migrations/900_invalid.sql:sql_parse_invalid',
    ]);
  });

  it.each([
    [
      'one backslash before a quote',
      [
        "SELECT 'a\\'b';",
        'CREATE TABLE behavior_ledger(id uuid);',
        "-- '",
      ].join('\n'),
    ],
    [
      'an odd backslash run before a quote',
      [
        String.raw`SELECT 'a\\\'b';`,
        'CREATE TABLE behavior_ledger(id uuid);',
        "-- '",
      ].join('\n'),
    ],
  ])('fails closed for standard_conforming_strings ambiguity: %s', (
    _label,
    sql,
  ) => {
    const root = fixtureRoot();
    write(root, 'packages/brain/migrations/900_ambiguous.sql', sql);

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([
      'packages/brain/migrations/900_ambiguous.sql:sql_parse_invalid',
    ]);
  });

  it.each([
    ['two backslashes', String.raw`SELECT 'a\\';`],
    ['four backslashes', String.raw`SELECT 'a\\\\';`],
  ])('accepts %s before a quote and detects following DDL', (_label, select) => {
    const root = fixtureRoot();
    write(
      root,
      'packages/brain/migrations/900_even_backslashes.sql',
      [
        select,
        'CREATE TABLE behavior_ledger(id uuid);',
      ].join('\n'),
    );

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([
      'packages/brain/migrations/900_even_backslashes.sql',
    ]);
  });

  it('accepts non-quote backslashes used by historical regex migrations', () => {
    const root = fixtureRoot();
    write(
      root,
      'packages/brain/migrations/900_regex.sql',
      String.raw`SELECT '(^\s+\.x[\\])';`,
    );

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([]);
  });

  it('keeps explicit E strings unambiguous and detects following DDL', () => {
    const root = fixtureRoot();
    write(
      root,
      'packages/brain/migrations/900_e_string.sql',
      [
        String.raw`SELECT E'a\'b CREATE TABLE behavior_ledger';`,
        'CREATE TABLE behavior_ledger(id uuid);',
      ].join('\n'),
    );

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([
      'packages/brain/migrations/900_e_string.sql',
    ]);
  });

  it('keeps doubled quotes unambiguous and detects following DDL', () => {
    const root = fixtureRoot();
    write(
      root,
      'packages/brain/migrations/900_doubled_quote.sql',
      [
        "SELECT 'a''b CREATE TABLE behavior_ledger';",
        'CREATE TABLE behavior_ledger(id uuid);',
      ].join('\n'),
    );

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([
      'packages/brain/migrations/900_doubled_quote.sql',
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

  it('does not scan archive or rollback subdirectories outside loader boundaries', () => {
    const root = fixtureRoot();
    write(
      root,
      'packages/brain/migrations/archive/rollback.sql',
      'CREATE TABLE behavior_ledger(id uuid);\n',
    );
    write(
      root,
      'packages/brain/src/db/migrations/archive/rollback.sql',
      'CREATE TABLE behavior_ledger(id uuid);\n',
    );
    write(
      root,
      'packages/brain/src/migrations/archive/rollback.sql',
      'CREATE TABLE behavior_ledger(id uuid);\n',
    );

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([]);
  });

  it('matches the loader lowercase SQL suffix boundary', () => {
    const root = fixtureRoot();
    write(
      root,
      'packages/brain/migrations/900_not_loaded.SQL',
      'CREATE TABLE behavior_ledger(id uuid);\n',
    );

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([]);
  });

  it('rejects matching contract symlinks without following either target', () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    const outsideTarget = write(
      outside,
      'outside.yaml',
      'behavior_equivalence: {}\n',
    );
    const insideTarget = write(
      root,
      'packages/inside/actual.yaml',
      'behavior_equivalence: {}\n',
    );
    mkdirSync(join(root, 'packages/escape'), { recursive: true });
    symlinkSync(
      outsideTarget,
      join(root, 'packages/escape/foo.regression-contract.yaml'),
    );
    symlinkSync(
      insideTarget,
      join(root, 'packages/inside/regression-contract.template.yml'),
    );

    expect(findSecondaryBehaviorEquivalenceContracts(root)).toEqual([
      'packages/escape/foo.regression-contract.yaml:symlink_not_allowed',
      'packages/inside/regression-contract.template.yml:symlink_not_allowed',
    ]);
  });

  it('rejects production SQL symlinks without following either target', () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    const outsideTarget = write(
      outside,
      'outside.sql',
      'CREATE TABLE behavior_ledger(id uuid);\n',
    );
    const insideTarget = write(
      root,
      'inside.sql',
      'CREATE TABLE behavior_ledger(id uuid);\n',
    );
    mkdirSync(join(root, 'packages/brain/migrations'), { recursive: true });
    symlinkSync(
      outsideTarget,
      join(root, 'packages/brain/migrations/900_outside.sql'),
    );
    symlinkSync(
      insideTarget,
      join(root, 'packages/brain/migrations/901_inside.sql'),
    );

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([
      'packages/brain/migrations/900_outside.sql:symlink_not_allowed',
      'packages/brain/migrations/901_inside.sql:symlink_not_allowed',
    ]);
  });

  it('rejects arbitrary package directory symlinks without following them', () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    const inside = join(root, 'packages/inside-directory');
    mkdirSync(inside, { recursive: true });
    write(
      outside,
      'escape.regression-contract.yaml',
      'behavior_equivalence: {}\n',
    );
    mkdirSync(join(root, 'packages'), { recursive: true });
    symlinkSync(outside, join(root, 'packages/linked'));
    symlinkSync(inside, join(root, 'packages/linked-inside'));

    expect(findSecondaryBehaviorEquivalenceContracts(root)).toEqual([
      'packages/linked-inside/:symlink_not_allowed',
      'packages/linked/:symlink_not_allowed',
    ]);
  });

  it('skips dependency node_modules trees but not vendor symlinks', () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    const toolTarget = write(root, 'packages/a/tool.js', '');
    write(
      root,
      'packages/a/node_modules/hidden.regression-contract.yaml',
      'behavior_equivalence: {}\n',
    );
    mkdirSync(join(root, 'packages/a/node_modules/.bin'), { recursive: true });
    symlinkSync(
      toolTarget,
      join(root, 'packages/a/node_modules/.bin/vitest'),
    );
    mkdirSync(join(root, 'packages/b'), { recursive: true });
    symlinkSync(outside, join(root, 'packages/b/node_modules'));
    mkdirSync(join(root, 'packages/a/vendor'), { recursive: true });
    symlinkSync(outside, join(root, 'packages/a/vendor/custom'));

    expect(findSecondaryBehaviorEquivalenceContracts(root)).toEqual([
      'packages/a/vendor/custom/:symlink_not_allowed',
    ]);
  });

  it('rejects direct migration directory symlinks at the loader boundary', () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    write(
      outside,
      'hidden.sql',
      'CREATE TABLE behavior_ledger(id uuid);\n',
    );
    mkdirSync(join(root, 'packages/brain/migrations'), { recursive: true });
    symlinkSync(outside, join(root, 'packages/brain/migrations/linked'));
    symlinkSync(outside, join(root, 'packages/brain/migrations/node_modules'));

    expect(findForbiddenBehaviorLedgerTables(root)).toEqual([
      'packages/brain/migrations/linked/:symlink_not_allowed',
      'packages/brain/migrations/node_modules/:symlink_not_allowed',
    ]);
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

  it('accepts the YAML byte limit and rejects limit plus one', () => {
    const root = fixtureRoot();
    const prefix = 'behavior_equivalence: {}\npadding: ';
    write(
      root,
      'regression-contract.yaml',
      prefix + 'x'.repeat(1_000_000 - Buffer.byteLength(prefix)),
    );

    expect(evaluateRepositoryPolicy(root).repository_policy_valid).toBe(true);

    write(
      root,
      'regression-contract.yaml',
      prefix + 'x'.repeat(1_000_001 - Buffer.byteLength(prefix)),
    );
    expect(evaluateRepositoryPolicy(root)).toEqual({
      repository_policy_valid: false,
      duplicate_behavior_equivalence_contracts: [
        'regression-contract.yaml:oversized',
      ],
      forbidden_behavior_ledger_tables: [],
    });
  });

  it('fails closed after the bounded traversal entry limit', () => {
    const root = fixtureRoot();
    const packageRoot = join(root, 'packages/many');
    mkdirSync(packageRoot, { recursive: true });
    for (let index = 0; index <= 20_000; index += 1) {
      writeFileSync(join(packageRoot, `entry-${index}`), '');
    }

    expect(findSecondaryBehaviorEquivalenceContracts(root)).toEqual([
      'packages/:traversal_limit_exceeded',
    ]);
  }, 20_000);

  it('returns the exact valid policy shape for a clean repository', () => {
    const root = fixtureRoot();

    expect(evaluateRepositoryPolicy(root)).toEqual({
      repository_policy_valid: true,
      duplicate_behavior_equivalence_contracts: [],
      forbidden_behavior_ledger_tables: [],
    });
  });

  it('returns the exact valid policy shape for the checked-in repository topology', () => {
    const rootVitestConfig = readFileSync(
      join(REPOSITORY_ROOT, 'vitest.config.js'),
      'utf8',
    );
    const brainVitestConfig = readFileSync(
      join(REPOSITORY_ROOT, 'packages/brain/vitest.config.js'),
      'utf8',
    );

    expect(rootVitestConfig).toContain(
      "'sprints/**/*.{test,spec}.?(c|m)[jt]s?(x)'",
    );
    expect(brainVitestConfig).not.toContain(
      "'../../sprints/**/*.{test,spec}.?(c|m)[jt]s?(x)'",
    );
    expect(evaluateRepositoryPolicy(REPOSITORY_ROOT)).toEqual({
      repository_policy_valid: true,
      duplicate_behavior_equivalence_contracts: [],
      forbidden_behavior_ledger_tables: [],
    });
  });
});
