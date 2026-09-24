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
    // 契约：swap 失败 → 必然 exit 1，且早于 compose up 起新容器。
    //
    // 断言写法已被重构撑爆两次，都不是契约破了：
    //   #3700 在守卫块内插入 drain-cancel 恢复逻辑 → 撑爆 120 字符邻近窗口
    //   #5529 为先 rm -f 清理临时 env 文件，把 exit 1 从 `if ! …swap; then` 块挪到
    //         随后的 `if [[ "$SWAP_OK" == false ]]` 块 → 撑爆"块内匹配"
    // 所以这里钉的是**失败路径这条因果链**，不绑某一种代码块形状。
    // ⚠️ 别退化成"脚本里某处有 exit 1"——本文件另有 7 处 exit 1，那样等于没测
    //（第一版改写就是这么松的，变异实测两条都没拦住）。

    // ① swap 的失败必须被记录下来（当前形态：SWAP_OK=false；或直接 if ! …then）
    const failMark = SH.match(/SWAP_OK=false/) || SH.match(/if\s+!\s[^\n]*bluegreen_swap;\s*then/);
    expect(failMark, 'swap 失败没有任何记录/分支 —— 失败会被当成成功往下走').not.toBeNull();

    // ② 从「记下失败」到「compose up 起新容器」之间，必须有 exit 1 把路截断
    const markAt = SH.indexOf(failMark[0]);
    const composeUpAt = SH.search(/docker compose[^\n]*\n?[^\n]*up -d node-brain/);
    expect(composeUpAt, '找不到 compose up node-brain —— 守卫锚点要跟着改').toBeGreaterThan(markAt);

    const between = SH.slice(markAt, composeUpAt);
    expect(between, 'swap 失败到 compose up 之间没有 exit 1 —— canary 没过照样起新容器')
      .toMatch(/\bexit 1\b/);

    // ③ 那个 exit 1 必须真的挂在失败条件下，不是无条件执行
    expect(between, 'exit 1 没有挂在 swap 失败的判断里')
      .toMatch(/(SWAP_OK["'\s]*==["'\s]*false|if\s+!\s[^\n]*bluegreen_swap)/);
  });});
