import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';

// 仓库根：sprints/<sprint>/tests/ → 上三层
const ROOT = join(__dirname, '..', '..', '..');
const ROUTER = join(ROOT, 'packages/brain/scripts/ci/changed-test-router.mjs');
const CHECKER = join(ROOT, 'packages/brain/scripts/ci/skill-contract-check.mjs');
const EXISTS = join(ROOT, 'packages/brain/scripts/ci/contract-exists.mjs');
const FIXTURES = join(ROOT, 'packages/brain/scripts/ci/__tests__/fixtures');
const EVALUATOR = join(ROOT, 'packages/workflows/skills/harness-evaluator/SKILL.md');

function runNode(file: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('node', [file, ...args], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('CI 防线三件套 [BEHAVIOR]', () => {
  it('Step1 正向: changed-test-router 对 evaluator SKILL.md 输出含 skill-contract 的清单', () => {
    expect(existsSync(ROUTER)).toBe(true);
    const { code, out } = runNode(ROUTER, ['packages/workflows/skills/harness-evaluator/SKILL.md']);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim().split('\n').filter(l => l.startsWith('{')).pop()!);
    expect(parsed.extraTests.some((t: string) => /skill-contract/.test(t))).toBe(true);
  });

  it('Step1 负向: 非 skill 文件不误报 skill 契约测试', () => {
    expect(existsSync(ROUTER)).toBe(true);
    const { out } = runNode(ROUTER, ['packages/brain/src/server.js']);
    const parsed = JSON.parse(out.trim().split('\n').filter(l => l.startsWith('{')).pop()!);
    expect(parsed.extraTests.some((t: string) => /skill-contract/.test(t))).toBe(false);
  });

  it('Step3 篡改检出: checkEvaluator 删 env_missing 后 ok=false 且 missing 含 env_missing', async () => {
    expect(existsSync(CHECKER)).toBe(true);
    const m: any = await import(CHECKER);
    const content = readFileSync(EVALUATOR, 'utf8');
    const tampered = content.replace(/env_missing/g, 'ENV_REMOVED');
    const r = m.checkEvaluator(tampered);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('env_missing');
    // 现网真实快照应全绿
    expect(m.checkEvaluator(content).ok).toBe(true);
  });

  it('Step4 缺合同: 缺 contract-draft.md 的 diff → 非零退出且点名', () => {
    expect(existsSync(EXISTS)).toBe(true);
    const { code, out } = runNode(EXISTS, ['--fixture', join(FIXTURES, 'diff-missing-contract.txt')]);
    expect(code).not.toBe(0);
    expect(out).toMatch(/contract-draft\.md/);
  });

  it('Step4 完整/非harness: 完整 diff 与非 harness diff 均退出 0', () => {
    expect(existsSync(EXISTS)).toBe(true);
    expect(runNode(EXISTS, ['--fixture', join(FIXTURES, 'diff-complete.txt')]).code).toBe(0);
    expect(runNode(EXISTS, ['--fixture', join(FIXTURES, 'diff-non-harness.txt')]).code).toBe(0);
  });
});
