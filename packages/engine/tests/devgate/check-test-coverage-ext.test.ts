/**
 * check-test-coverage-ext.test.ts — Test Contract gate 的测试文件扩展名支持
 *
 * 回归 bug：check-test-coverage.cjs 的正则只认 `.test.ts` / `.test.js`，
 * 导致前端 harness 任务（组件测试必须 `.test.tsx`、e2e `.spec.ts`）
 * 全部被 `continue` 跳过 → 解析 0 行 → 误报「表为空」→ 卡死整个 sprint PR。
 *
 * 修复后 gate 必须接受 .test.tsx / .test.jsx / .spec.ts / .spec.tsx，
 * 同时不回归 .test.ts。
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/check-test-coverage.cjs');

/**
 * 在临时目录里造一个最小 sprint：合同 + 同步副本测试文件，
 * 然后用指定扩展名的 testFile 跑 gate，返回 exit code（0=通过）。
 */
function runGate(
  testFileRel: string,
  swappedColumns = false,
  repoRelative = false
): number {
  const tmp = mkdtempSync(join(tmpdir(), 'ctc-'));
  const sprintDir = join(tmp, 'sprints', 'sprint-x');
  const subDir = testFileRel.split('/').slice(0, -1).join('/') || '.';
  mkdirSync(join(sprintDir, subDir), { recursive: true });

  // 同步副本测试文件：含一个能 substring 命中 behavior「渲染」的 it()
  writeFileSync(
    join(sprintDir, testFileRel),
    `import { describe, it, expect } from 'vitest';\n` +
      `describe('x', () => { it('渲染 PrepPRD 全文', () => { expect(1).toBe(1); }); });\n`
  );

  const contractTestPath = repoRelative
    ? `sprints/sprint-x/${testFileRel}`
    : testFileRel;
  const contract = [
    '# Contract',
    '',
    '## Test Contract',
    '',
    swappedColumns
      ? '| 功能 | BEHAVIOR 覆盖 | Test File | 预期红证据 |'
      : '| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |',
    '|---|---|---|---|',
    swappedColumns
      ? `| 组件层 | 渲染 | \`${contractTestPath}\` | 当前实现缺失 → 断言 FAIL |`
      : `| 组件层 | \`${contractTestPath}\` | 渲染 | 当前实现缺失 → 断言 FAIL |`,
    '',
  ].join('\n');
  const contractPath = join(sprintDir, 'contract-draft.md');
  writeFileSync(contractPath, contract);

  let exitCode = 0;
  try {
    execSync(`node "${SCRIPT}" "${contractPath}"`, {
      cwd: repoRelative ? tmp : undefined,
      encoding: 'utf8',
    });
  } catch (e: any) {
    exitCode = e.status || 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return exitCode;
}

describe('check-test-coverage 测试文件扩展名', () => {
  it('接受 .test.tsx（React 组件测试）', () => {
    expect(runGate('tests/Foo.test.tsx')).toBe(0);
  });

  it('接受 .spec.ts（Playwright e2e）', () => {
    expect(runGate('e2e/Foo.spec.ts')).toBe(0);
  });

  it('不回归：仍接受 .test.ts', () => {
    expect(runGate('tests/Foo.test.ts')).toBe(0);
  });

  it('按表头定位列，接受 BEHAVIOR 覆盖位于 Test File 之前', () => {
    expect(runGate('tests/Foo.test.ts', true)).toBe(0);
  });

  it('接受从仓库根开始的 Test File 路径', () => {
    expect(runGate('tests/Foo.test.ts', false, true)).toBe(0);
  });
});
