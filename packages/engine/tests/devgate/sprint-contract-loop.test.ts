import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/sprint-contract-loop.sh');
const ENGINE_ROOT = resolve(__dirname, '../..');

function createTempDir(): string {
  return mkdtempSync(join(ENGINE_ROOT, '.tmp-scl-'));
}

function runLoop(
  branch: string,
  projectRoot: string
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(`bash "${SCRIPT}" "${branch}" "${projectRoot}"`, {
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e: any) {
    return {
      code: e.status ?? 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

function writeEvalSeal(dir: string, branch: string, plans: object[]) {
  const seal = {
    verdict: 'PASS',
    sealed_by: 'spec-review',
    branch,
    timestamp: new Date().toISOString(),
    independent_test_plans: plans,
    negotiation_result: 'test',
    issues: [],
  };
  writeFileSync(join(dir, `.dev-gate-spec.${branch}`), JSON.stringify(seal));
}

function writeGenSeal(dir: string, branch: string, proposals: object[]) {
  const seal = {
    sealed_by: 'sprint-contract-generator',
    branch,
    timestamp: new Date().toISOString(),
    proposals,
  };
  writeFileSync(join(dir, `.dev-gate-generator-sprint.${branch}`), JSON.stringify(seal));
}

describe('sprint-contract-loop.sh', () => {
  let tmpDir: string;
  const branch = 'test-branch';

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exit 2 when missing BRANCH argument', () => {
    const result = runLoop('', tmpDir);
    expect(result.code).toBe(2);
  });

  it('exit 2 when Evaluator seal missing', () => {
    writeGenSeal(tmpDir, branch, []);
    const result = runLoop(branch, tmpDir);
    expect(result.code).toBe(2);
  });

  it('exit 2 when Generator seal missing', () => {
    writeEvalSeal(tmpDir, branch, [
      { dod_item: 'item 1', my_test: 'node -e "1"', agent_test: 'TODO', consistent: true },
    ]);
    const result = runLoop(branch, tmpDir);
    expect(result.code).toBe(2);
  });

  it('exit 0 (PASS) when all consistent=true', () => {
    writeEvalSeal(tmpDir, branch, [
      { dod_item: 'item 1', my_test: 'node -e "1"', agent_test: 'TODO', consistent: true },
      { dod_item: 'item 2', my_test: 'node -e "2"', agent_test: 'TODO', consistent: true },
    ]);
    writeGenSeal(tmpDir, branch, [
      { dod_item: 'item 1', proposed_test: 'node -e "1"' },
    ]);
    const result = runLoop(branch, tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('blocker_count == 0');
  });

  it('exit 1 (diverge) when consistent=false exists', () => {
    writeEvalSeal(tmpDir, branch, [
      { dod_item: 'item 1', my_test: 'node -e "1"', agent_test: 'TODO', consistent: false },
    ]);
    writeGenSeal(tmpDir, branch, [
      { dod_item: 'item 1', proposed_test: 'node -e "other"' },
    ]);
    const result = runLoop(branch, tmpDir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('blocker');
  });

  it('writes state file on each run', () => {
    writeEvalSeal(tmpDir, branch, [
      { dod_item: 'item 1', my_test: 'node -e "1"', agent_test: 'TODO', consistent: true },
    ]);
    writeGenSeal(tmpDir, branch, []);
    runLoop(branch, tmpDir);
    const stateFile = join(tmpDir, `.sprint-contract-state.${branch}`);
    expect(existsSync(stateFile)).toBe(true);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    expect(state).toHaveProperty('round');
    expect(state).toHaveProperty('blocker_count');
    expect(state.round).toBe(1);
  });

  it('increments round counter on subsequent runs', () => {
    writeEvalSeal(tmpDir, branch, [
      { dod_item: 'item 1', my_test: 'node -e "1"', agent_test: 'TODO', consistent: true },
    ]);
    writeGenSeal(tmpDir, branch, []);
    runLoop(branch, tmpDir);
    runLoop(branch, tmpDir);
    const state = JSON.parse(readFileSync(join(tmpDir, `.sprint-contract-state.${branch}`), 'utf8'));
    expect(state.round).toBe(2);
  });
});
