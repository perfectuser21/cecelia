/**
 * bluegreen-deploy-contract.test.js
 * 文本契约：brain-deploy.sh 必须走 bluegreen_swap（green canary 验证后才动 blue），
 * 不再在 green 验证前无条件 docker rm -f blue。范畴：关键不变量文本校验
 * （真实切换行为由 bluegreen-swap.test.js 的 mock docker 行为测试覆盖）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// __dirname = tests/packages/brain → 上 3 层到 repo root
const REPO_ROOT = resolve(__dirname, '../../..');
const SH = readFileSync(resolve(REPO_ROOT, 'scripts/brain-deploy.sh'), 'utf8');

describe('brain-deploy blue-green contract', () => {
  it('source scripts/lib/bluegreen.sh 并调用 bluegreen_swap', () => {
    expect(SH).toMatch(/source\s+["']?\$\{?SCRIPT_DIR\}?\/lib\/bluegreen\.sh/);
    expect(SH).toContain('bluegreen_swap');
  });

  it('green 验证前不再无条件 xargs docker rm -f（blue 删除移入 bluegreen_swap 的 green 通过后）', () => {
    // bluegreen_swap 之前的脚本段不得含无条件 xargs docker rm -f
    const beforeSwap = SH.split('bluegreen_swap')[0];
    expect(beforeSwap).not.toMatch(/xargs docker rm -f/);
  });

  it('bluegreen_swap 失败时终止部署（exit 1，不继续 compose up 起新容器）', () => {
    // 必须有 "if ! ... bluegreen_swap; then ... exit 1 ... fi" 的守卫。
    // 原断言用 120 字符邻近窗口，#3700 在守卫块内插入 drain-cancel 恢复逻辑后被撑爆（契约语义未破）；
    // 改为结构化匹配：if ! …bluegreen_swap; then 块内（fi 之前）必须出现 exit 1。
    const guard = SH.match(/if\s+!\s[\s\S]*?bluegreen_swap;\s*then([\s\S]*?)\n\s*fi\b/);
    expect(guard, '缺少 if ! ... bluegreen_swap; then 守卫').not.toBeNull();
    expect(guard[1]).toMatch(/exit 1/);
  });
});
