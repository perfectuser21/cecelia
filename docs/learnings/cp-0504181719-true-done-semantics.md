# Learning — Stop Hook 真完成语义闭环

分支：cp-0504181719-true-done-semantics
日期：2026-05-04
Brain Task：f7aabf84-6851-48be-90b6-3b5c7bf2b5de
前置 PR：#2745 + #2746 + #2747

## 背景

PR #2747 完成出口拓扑严格三态分离（done=exit 0 / not-dev=exit 99 / blocked=exit 2）。但 Alex 反复指出"PR 一开就停"——assistant 在 PR 合并后但 Learning 没写时被提前 exit 0 真停。

## 根本原因

`devloop_check` condition 5（PR merged 后）有两条路径都能标 status=done，但都有问题：

**路径 1（step_4=done 早退）**：
- 检查 `step_4_status == "done"` → `_mark_cleanup_done` + `status=done` 直接 break
- **跳过 cleanup.sh / 部署调用**——用户可能已写 Learning 但部署没跑就被标 done

**路径 2（fallback）**：
- step_4=pending 时进 fallback
- 跑 cleanup.sh → 成功 → status=done
- **绕过 step_4 检查**——只要 cleanup.sh 跑成功就标 done，不管 Learning 写没写

第二条路径让 PR auto-merge 后 assistant 被提前真停（Learning 没写完）。这就是 Alex 看到的"PR 一开就停"。

## 本次解法

condition 5 严格守门，唯一 done 出口 = `step_4=done AND cleanup.sh 真跑成功`：

| 组合 | 之前 | 之后 |
|---|---|---|
| step_4=done + cleanup ok | done（**不跑** cleanup.sh）| done（**真跑** cleanup.sh + 部署）|
| step_4=done + cleanup fail | blocked（fallback）| blocked |
| **step_4=pending + cleanup ok** | **done ✗** | **blocked ✓** |
| step_4=pending + cleanup fail | blocked | blocked |
| step_4=done + cleanup.sh 不存在 | blocked（fallback else）| blocked |
| harness 模式 | 豁免 step_4 | 豁免 step_4（保留）|

`status=done` 真正含义：**PR 合 + Learning 写完 + cleanup.sh 跑成功（含 deploy-local.sh 部署 + worktree 归档）**。

实施量：condition 5 重写约 35 行 diff，4 个串行守门点（5.1 base ref / 5.2 step_4 / 5.3 cleanup.sh 存在 / 5.4 cleanup.sh 真跑成功）。

## 下次预防

- [ ] 任何"early-exit 路径"必须重新审视——不能因为某个标志位（如 `_mark_cleanup_done`）或某个动作（如 cleanup.sh 跑成功）就跳过其他守门
- [ ] "真完成"语义必须是**所有阶段全部完成**的合取（AND），不能是任意一个阶段完成的析取（OR）
- [ ] 任何 fallback 路径必须保持原始守门（不能为了 robustness 牺牲 strictness）
- [ ] integration 测试必须覆盖"中间阶段"组合（step_4=pending vs done × cleanup ok vs fail），不能只覆盖 happy path
- [ ] 每次 stop hook 改动后跑 12 场景 E2E + integration + stop-hook 套件全量回归

## Stop Hook 重构最终闭环

| 阶段 | PR | 内容 |
|---|---|---|
| 4/21 | #2503 | cwd-as-key 身份判定归一 |
| 5/4 | #2745 | 散点 12 → 集中 3 处 + 守护 |
| 5/4 | #2746 | 探测失败 fail-closed |
| 5/4 | #2747 | 严格三态出口分离 + 守护扩展 |
| 5/4 | **本 PR** | **真完成语义闭环（done = PR merged + Learning + 部署 + 归档）** |

## 验证证据

- 12 场景 E2E（packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts）100% 通过
- 158/159 stop-hook 测试通过（1 skipped，所有 hooks/ 测试 + dev-workflow-e2e）
- 10 分支 integration 100% 通过
- check-single-exit 守护 7/7 ✅（出口拓扑未变）
- 8 处版本文件同步 18.18.1
