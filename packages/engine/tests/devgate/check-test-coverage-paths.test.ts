import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const CHECKER = resolve(
  __dirname,
  '../../scripts/devgate/check-test-coverage.cjs'
);
const PATH_HELPERS = resolve(
  __dirname,
  '../../../../scripts/lib/test-contract-paths.cjs'
);
const require = createRequire(import.meta.url);
const temporaryDirectories: string[] = [];

type GateFixture = {
  declaredPath: string;
  existingPaths?: string[];
};

function writeTestFile(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "import { describe, expect, it } from 'vitest';",
      "describe('contract', () => {",
      "  it('resolves the declared path', () => expect(true).toBe(true));",
      '});',
      '',
    ].join('\n')
  );
}

function runGate({
  declaredPath,
  existingPaths = [],
}: GateFixture): {
  status: number | null;
  output: string;
  repoRoot: string;
} {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'coverage-paths-'));
  temporaryDirectories.push(fixtureRoot);
  const repoRoot = join(fixtureRoot, 'repo');
  const sprintDir = join(repoRoot, 'sprints', 'demo');
  mkdirSync(sprintDir, { recursive: true });

  for (const existingPath of existingPaths) {
    writeTestFile(
      existingPath.startsWith('/')
        ? existingPath
        : join(repoRoot, existingPath)
    );
  }

  const contractPath = join(sprintDir, 'contract-draft.md');
  writeFileSync(
    contractPath,
    [
      '# Contract',
      '',
      '## Test Contract',
      '',
      '| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |',
      '|---|---|---|---|',
      `| WS1 | \`${declaredPath}\` | resolves the declared path | missing resolver |`,
      '',
    ].join('\n')
  );

  const result = spawnSync(process.execPath, [CHECKER, contractPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    repoRoot,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('check-test-coverage contract path resolution', () => {
  it('exports a shared pure parser, root inference, and resolver API', () => {
    const helpers = require(PATH_HELPERS);
    const root = resolve('/tmp/example-repo');
    const contractPath = join(root, 'sprints', 'demo', 'contract-draft.md');
    const content = [
      '## Test Contract',
      '| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |',
      '|---|---|---|---|',
      '| WS1 | `tests/path.test.ts` | path behavior | red |',
    ].join('\n');

    expect(helpers.parseTestContract(content)).toEqual([
      {
        ws: 'WS1',
        testFile: 'tests/path.test.ts',
        behaviors: ['path behavior'],
      },
    ]);
    expect(helpers.inferRepositoryRoot(contractPath)).toBe(root);
    expect(helpers.inferRepositoryRoot('/somewhere/contract.md', root)).toBe(
      root
    );

    const permanentTarget = join(
      root,
      'tests',
      'regression',
      'demo',
      'path.test.ts'
    );
    const resolution = helpers.resolveContractTestFile({
      root,
      contractPath,
      testFile: 'tests/path.test.ts',
      existsSync: (candidate: string) => candidate === permanentTarget,
    });
    expect(resolution.resolvedPath).toBe(permanentTarget);
    expect(resolution.candidates).toEqual([
      join(root, 'sprints', 'demo', 'tests', 'path.test.ts'),
      permanentTarget,
    ]);
    expect(resolution.error).toBeNull();
  });

  it('resolves a repo-relative contract path against an explicit root', () => {
    const helpers = require(PATH_HELPERS);
    const root = resolve('/tmp/explicit-repo');
    const source = join(root, 'sprints', 'demo', 'tests', 'path.test.ts');

    const resolution = helpers.resolveContractTestFile({
      root,
      contractPath: 'sprints/demo/contract-draft.md',
      testFile: 'tests/path.test.ts',
      existsSync: (candidate: string) => candidate === source,
    });

    expect(resolution.resolvedPath).toBe(source);
    expect(resolution.error).toBeNull();
  });

  it('resolves a complete sprint repo-relative path exactly once', () => {
    const result = runGate({
      declaredPath: 'sprints/demo/tests/path.test.ts',
      existingPaths: ['sprints/demo/tests/path.test.ts'],
    });

    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('Test Coverage 检查通过');
  });

  it('keeps legacy tests paths relative to the sprint', () => {
    const result = runGate({
      declaredPath: 'tests/path.test.ts',
      existingPaths: ['sprints/demo/tests/path.test.ts'],
    });

    expect(result.status, result.output).toBe(0);
  });

  it('uses the permanent regression target after the sprint source is frozen', () => {
    const result = runGate({
      declaredPath: 'tests/path.test.ts',
      existingPaths: ['tests/regression/demo/path.test.ts'],
    });

    expect(result.status, result.output).toBe(0);
  });

  it('uses the permanent regression target for a frozen repo-relative source', () => {
    const result = runGate({
      declaredPath: 'sprints/demo/tests/path.test.ts',
      existingPaths: ['tests/regression/demo/path.test.ts'],
    });

    expect(result.status, result.output).toBe(0);
  });

  it('fails closed for a parent traversal even when the resolved file exists', () => {
    const result = runGate({
      declaredPath: '../../outside.test.ts',
      existingPaths: ['outside.test.ts'],
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('../../outside.test.ts');
    expect(result.output).toMatch(/不安全|拒绝/);
  });

  it('fails closed for an absolute declaration even when the file exists', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'coverage-absolute-'));
    temporaryDirectories.push(fixtureRoot);
    const absoluteTest = join(fixtureRoot, 'absolute.test.ts');
    writeTestFile(absoluteTest);

    const result = runGate({
      declaredPath: absoluteTest,
      existingPaths: [],
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain(absoluteTest);
    expect(result.output).toMatch(/不安全|绝对路径|拒绝/);
  });

  it('fails closed when traversal escapes the repository root', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'coverage-escape-'));
    temporaryDirectories.push(fixtureRoot);
    const repoRoot = join(fixtureRoot, 'repo');
    const outsideTest = join(fixtureRoot, 'outside.test.ts');
    writeTestFile(outsideTest);
    const sprintDir = join(repoRoot, 'sprints', 'demo');
    mkdirSync(sprintDir, { recursive: true });
    const contractPath = join(sprintDir, 'contract-draft.md');
    writeFileSync(
      contractPath,
      [
        '## Test Contract',
        '| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |',
        '|---|---|---|---|',
        '| WS1 | `../../../outside.test.ts` | resolves the declared path | red |',
      ].join('\n')
    );

    const run = spawnSync(process.execPath, [CHECKER, contractPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const output = `${run.stdout}${run.stderr}`;

    expect(run.status).toBe(1);
    expect(output).toContain('../../../outside.test.ts');
    expect(output).toMatch(/仓库|越界|不安全|拒绝/);
  });

  it('reports the declaration and every safe candidate when no file exists', () => {
    const result = runGate({
      declaredPath: 'tests/missing.test.ts',
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('tests/missing.test.ts');
    expect(result.output).toContain(
      join(result.repoRoot, 'sprints/demo/tests/missing.test.ts')
    );
    expect(result.output).toContain(
      join(result.repoRoot, 'tests/regression/demo/missing.test.ts')
    );
    expect(result.output).toMatch(/候选|尝试/);
  });
});
