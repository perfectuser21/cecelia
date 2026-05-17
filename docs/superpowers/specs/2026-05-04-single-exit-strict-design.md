# Stop Hook 二次精修 — 开发模式中唯一 exit 0 = PR 真完成

分支：`cp-0504140226-single-exit-strict`
Brain Task：`60d121d8-2db4-452b-a5fa-6e7e612e16c4`
日期：2026-05-04
前置：PR #2745（cp-0504114459，已合 c1f1e65ed）做了散点 12 → 集中 3 处的拓扑归一

## 背景

PR #2745 把 stop-dev.sh 的 7 处 `exit 0` 收敛到 1 处（L52）+ devloop-check.sh 的 4 处 `return 0` 收敛到 2 处（每个函数末尾各 1）。但 stop-dev.sh L52 把 **`not-dev` 路径也归到 exit 0**：

```bash
case "$status" in
    not-dev|done)        # ← 共享 exit 0
        ...
        exit 0
        ;;
    *)
        ...
        exit 2
        ;;
esac
```

这意味着以下情况都 exit 0：
- ✓ 主分支日常对话（合理）
- ✓ bypass env（合理）
- ✗ **cwd 探测失败 / git rev-parse 抖动失败**（误判成 not-dev → 误放行）
- ✗ **无 .dev-mode 文件**（如果文件因竞态读不到，误放行）

后两种是 Alex 最早说的"PR1 开就停"故障的真正源头——在 dev 流程中某次 stop hook 调用，刚好遇到 git rev-parse 短暂失败 → 走 L29 早退（旧版）或 not-dev 路径（PR #2745 后） → exit 0 → assistant 真停。

## 用户意图（澄清版）

> "你一旦确认进入开发模式（开始写代码这个模式），它只有一个（exit 0），而不是很多地方等等待"

含义：
- **一旦确认进入开发模式**（.dev-mode 文件存在 + cp-* 分支）
- **唯一的 exit 0** = PR 真完成（status=done）
- 所有"等待"状态——等 CI / 等合并 / 等 cleanup / 等 stage 完成 / 探测异常 / 文件读不到——**全部 exit 2** 让 assistant 继续干活
- 不是"很多地方"散开判断"我现在该不该 exit 0"

## 目标（精化版 — Research Subagent APPROVED 后简化）

**关键澄清**：Alex 说"**一旦确认进入开发模式**（.dev-mode 存在 + cp-* 分支），只有一个 exit 0"。not-dev 路径（主分支聊天 / bypass）根本不在"开发模式"范围内——它走 exit 0 不违反 Alex 意图。

真正的故障源 = **classify_session 把"探测失败"误归到 not-dev**（cwd 不是目录 / git rev-parse 抖动失败）→ stop-dev.sh 走 not-dev|done) exit 0 → 误放行。

最小最干净的修法 = **只 fail-closed 化 classify_session 的探测失败路径**，不动 stop-dev.sh 出口拓扑。

精化后目标：

1. **classify_session 探测失败路径 fail-closed**：cwd 不是目录 / git rev-parse 失败 → status=`blocked`（不再 `not-dev`）
2. **stop-dev.sh 出口拓扑保持 PR #2745 现状**：case `not-dev|done) exit 0` / `*) exit 2`（字面 1 个 exit 0，开发模式中唯一 exit 0 = done）
3. **不需要 exit 99 / 不需要改 stop.sh 路由**（Research Subagent 抓到的硬阻碍消除）
4. **不需要改既有 174+ stop-hook-exit-codes 测试**（出口码不变）

实施量收敛到 ~10 行 diff（仅 classify_session 4 处 status 字符串调整）。

## 不做

- 不改 `devloop_check` 主函数（已是末尾单点出口，符合精神）
- 不改 `classify_session` 主入口的状态分类逻辑（仅改 stop-dev.sh 处理 status 的方式）
- 不改 .dev-mode / .dev-lock 字段
- 不改 worktree-manage.sh
- 不改 cleanup.sh / auto-merge / Brain 回写
- 不改 12 场景 E2E 既有断言（行为兼容）
- 不引入新依赖

## 设计（最小化精修 — 仅改 classify_session）

### classify_session fail-closed 化

`packages/engine/lib/devloop-check.sh` 内的 classify_session 当前把"探测失败"也归到 not-dev：

| 触发条件 | 当前 status | 改后 status |
|---|---|---|
| `CECELIA_STOP_HOOK_BYPASS=1` | not-dev | not-dev（保持，确认绕过）|
| `cwd` 不是目录 | not-dev | **blocked**（fail-closed）|
| `git rev-parse --show-toplevel` 失败 | not-dev | **blocked**（fail-closed）|
| `git rev-parse --abbrev-ref` 失败 | not-dev | **blocked**（fail-closed）|
| 主分支（main/master/develop/HEAD）| not-dev | not-dev（保持，明确非 dev）|
| 无 .dev-mode 文件 | not-dev | not-dev（保持，明确非 dev）|
| .dev-mode 格式异常 | blocked | blocked（保持，已 fail-closed）|

**判定原则**：能明确"用户在跟我聊天，不是在跑 /dev"的情况 → not-dev；任何"我读不到状态"的情况 → blocked（fail-closed）。

classify_session 末尾出口逻辑（PR #2745 已实现）保持不变：
```bash
case "$_final_status" in
    not-dev|done) return 0 ;;
    *) return 2 ;;
esac
```

由于"探测失败"现在归 `blocked`，会走 `*) return 2` 分支 → stop-dev.sh 走 `*) exit 2` 分支。**dev 上下文中遇到任何异常都 fail-closed**，不再误放行。

### stop-dev.sh / stop.sh

**不改**。出口拓扑保持 PR #2745 现状：
- stop-dev.sh：`case not-dev|done) exit 0; *) exit 2`
- stop.sh：路由透传

效果：
- 主分支聊天 → classify=not-dev → stop-dev exit 0 ✓ 合理（用户能停下来）
- bypass env → classify=not-dev → stop-dev exit 0 ✓ 合理
- 在 cp-* 分支跑 /dev 但 cwd/git 短暂失败 → classify=blocked（**新行为**）→ stop-dev exit 2 ✓ 不再误放行
- 在 cp-* 分支跑 /dev 各阶段 → classify=blocked → stop-dev exit 2 ✓
- PR 真完成 → classify=done → stop-dev exit 0 ✓ **开发模式中唯一 exit 0**

## 测试策略

按 Cecelia 测试金字塔分类：

- **既有 E2E（rigid，必须 100% 回归）**：
  - `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` 12 场景
  - `packages/engine/tests/e2e/dev-workflow-e2e.test.ts`
  - `packages/engine/tests/e2e/engine-dynamic-behavior.test.ts`
  - `packages/engine/tests/hooks/stop-hook-exit-codes.test.ts` 174+ 场景
  - `packages/engine/tests/hooks/stop-hook-exit.test.ts`

- **新增 integration**：扩展 `packages/engine/tests/integration/devloop-classify.test.sh`，新增 4 个 case 验证 fail-closed：
  9. cwd 不是目录 → status=blocked（不再是 not-dev）
  10. 非 git repo → status=blocked
  11. cwd 是 git repo 但 rev-parse --abbrev-ref 失败（detached HEAD 模拟） → status=blocked 或 not-dev（HEAD 路径）
  12. cp-* 分支 + .dev-mode 存在但格式异常 → status=blocked（已存在，回归保护）

- **新增 unit**：`packages/engine/tests/hooks/stop-dev-exit-99.test.ts` 1 个 unit case 验证非 dev 上下文 stop-dev.sh 返回 exit 99（用 bash 直跑断言 `$?`）

- **trivial 验证**：grep 守护本身（check-single-exit.sh）

## CI 守护

不改 `scripts/check-single-exit.sh`。出口拓扑未变，既有验收（stop-dev.sh exit 0 = 1、devloop-check.sh return 0 = 2）继续生效。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| classify_session 探测失败归 blocked 后，老 stop-hook-exit-codes 测试可能断言 not-dev 路径 EXIT:0，但现在改成 EXIT:2 | 仔细审 174+ 测试断言：只有"主分支 / bypass / 无 .dev-mode" 测试断言 EXIT:0（这些路径仍 not-dev）；"cwd 异常"类的测试如果存在则需更新断言。**实施时先扫一遍 stop-hook-exit-codes 测试套，找到所有"探测失败"场景断言，确认行为是否符合新预期** |
| Claude Code 在 hook 启动时 cwd 短暂异常被 fail-closed 成 blocked，导致主分支聊天也被 block？ | 不会。case 第 4 步（主分支检查）依赖 `git rev-parse --abbrev-ref HEAD`，主分支 cwd 总是 worktree 根，不会触发 cwd 不是目录场景。fail-closed 仅作用于"在 dev worktree 内但 git 临时失败"的极少数 corner case |
| dev 流程中误归 blocked 但其实是 done，会一直 block？ | 不会。done 判定走 devloop_check 主函数（PR merged + step_4 + cleanup），不依赖 cwd/git rev-parse 是否成功。classify_session 探测失败仅影响"前置过滤"路径 |

## 验收清单

- [BEHAVIOR] classify_session：cwd 不是目录 / git rev-parse 失败 → status=blocked（不再 not-dev）
- [BEHAVIOR] classify_session：bypass / 主分支 / 无 .dev-mode → status=not-dev（保持）
- [BEHAVIOR] 既有 stop-dev.sh exit 0 = 1、devloop-check.sh return 0 = 2 守护不变
- [BEHAVIOR] 12 场景 E2E（stop-hook-full-lifecycle）100% 通过
- [BEHAVIOR] 174+ stop-hook-exit-codes 测试通过（如有"探测失败"断言需更新）
- [BEHAVIOR] integration 12 分支（含新增 4 fail-closed case）通过
- [ARTIFACT] Engine 版本 bump 18.17.0 → 18.17.1（patch，行为级精修）
- [ARTIFACT] feature-registry.yml changelog 加 18.17.1 条目

## 实施顺序

1. **TDD red**：integration 测试新增 4 个 fail-closed case（cwd 不是目录 / 非 git / git rev-parse 失败 → blocked），跑出 fail
2. **TDD green**：classify_session 改 4 处 status 字符串（not-dev → blocked），跑测试转 green
3. **回归**：12 场景 E2E + 174+ stop-hook-exit-codes，找出受影响断言（如有）并更新
4. **Engine 版本 bump**：18.17.0 → 18.17.1（patch，6 个版本文件 + SKILL.md frontmatter）
5. **feature-registry.yml** changelog 加 18.17.1 条目
6. **Learning** 文件
