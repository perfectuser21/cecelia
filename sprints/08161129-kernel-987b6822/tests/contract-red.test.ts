import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// TDD Red 契约（合同冻结产物，kernel 采集自 sprints/<sprint_dir>/tests/）：
// 以下断言在实现前必须全部失败，实现后转绿。覆盖 Golden Path 三处改动的静态契约
// （真实行为断言见 dev-mode-tool-guard.test.sh + headed-attempts.pg.integration.test.js + ## E2E 验收）。
//
// r2 说明：本文件是本轮唯一被 kernel 采集的合同冻结测试路径；永久回归测试由 Generator
// 落到 packages/brain/src/__tests__/integration/ 与 packages/engine/tests/integration/，两者分工不混用。

const read = (p: string) => readFileSync(p, 'utf8');

describe('有头 /dev 收编签发口 [BEHAVIOR-contract]', () => {
  it('Brain work-routing.js 新增 headed-attempts 签发路由', () => {
    const src = read('packages/brain/src/routes/work-routing.js');
    expect(src).toContain('headed-attempts');
    // 走既有鉴权（Invariant [端点鉴权]），不裸开
    expect(src).toContain('workRoutingAuthorization');
  });

  it('worktree-manage.sh 支持 --task-id 调签发口并改 cp-branch', () => {
    const src = read('packages/engine/skills/dev/scripts/worktree-manage.sh');
    expect(src).toContain('--task-id');
    expect(src).toContain('headed-attempts');
    // 禁写死环境：端点走 env（Invariant [禁写死环境]）
    expect(src).toMatch(/CECELIA_ROUTING_HEADED_URL|BRAIN_URL/);
  });

  it('hook 补 worktree-manage.sh 精确路径 bootstrap 逃生口', () => {
    const src = read('packages/engine/hooks/dev-mode-tool-guard.sh');
    // 逃生口必须精确匹配 worktree-manage.sh 路径，且仅无 lock 时放行
    expect(src).toContain('worktree-manage.sh');
    // 必须解析 tool_input.command 才能做精确路径匹配
    expect(src).toMatch(/tool_input|command/);
  });
});
