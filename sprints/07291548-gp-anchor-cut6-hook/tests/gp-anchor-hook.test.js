/**
 * gp-anchor-hook.test.js — 刀6 sprint 合同测试（vitest 包装器）
 *
 * 真实执行 packages/engine/hooks/tests/branch-protect-gp-anchor.test.sh
 * （真调 branch-protect.sh + 真实临时 git worktree，无 mock——禁 mock 边清单要求）。
 * Red 阶段：hook 无 gp_anchor 逻辑 → bash 测试 S1/S4 失败 → 本测试红。
 * 运行: npx vitest run sprints/07291548-gp-anchor-cut6-hook/tests/
 */

import { test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const BASH_TEST = resolve(REPO_ROOT, 'packages/engine/hooks/tests/branch-protect-gp-anchor.test.sh');

test('branch-protect gp_anchor 硬校验 S1~S5 全过', () => {
  const r = spawnSync('bash', [BASH_TEST], { encoding: 'utf8', timeout: 60000 });
  expect(r.status, `bash 测试非零退出(${r.status})：\n${r.stdout}\n${r.stderr}`).toBe(0);
  expect(r.stdout, `期望 5 pass / 0 fail，实际输出：\n${r.stdout}`).toMatch(/5 pass \/ 0 fail/);
});
