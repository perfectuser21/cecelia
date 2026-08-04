/**
 * auto-learning-harness.test.ts
 *
 * auto-learning VALUABLE_TASK_TYPES 覆盖回归测试（纯逻辑，无 DB）。
 * 根因回归：08-04 窗口内 12 个 harness_initiative failed 任务零 learning
 * （VALUABLE_TASK_TYPES=['dev','feature','research'] 未含 harness_initiative）。
 * 毕业位置：packages/brain/src/__tests__/（无需 PG，默认 CI 直跑）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function repoRoot(): string {
  let d = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(d, 'DEFINITION.md'))) {
    const parent = path.dirname(d);
    if (parent === d) throw new Error('repo root not found (DEFINITION.md)');
    d = parent;
  }
  return d;
}
const ROOT = repoRoot();

const { VALUABLE_TASK_TYPES } = await import(
  pathToFileURL(path.join(ROOT, 'packages/brain/src/auto-learning.js')).href
);

describe('auto-learning — 自主侧产出登记覆盖 [BEHAVIOR]', () => {
  it('VALUABLE_TASK_TYPES 含 harness_initiative', () => {
    expect(VALUABLE_TASK_TYPES).toContain('harness_initiative');
  });

  it('VALUABLE_TASK_TYPES 保留 dev feature research 不回退', () => {
    for (const t of ['dev', 'feature', 'research']) {
      expect(VALUABLE_TASK_TYPES).toContain(t);
    }
  });

  it('VALUABLE_TASK_TYPES 不纳入 code_review 等高频低价值类型', () => {
    expect(VALUABLE_TASK_TYPES).not.toContain('code_review');
  });
});
