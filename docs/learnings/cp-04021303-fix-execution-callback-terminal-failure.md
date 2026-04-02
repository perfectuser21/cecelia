# Learning: fix-execution-callback-terminal-failure

**Branch**: cp-04021303-fix-execution-callback-terminal-failure
**PR**: perfectuser21/cecelia#1788
**Date**: 2026-04-02

## 做了什么

修复 execution-callback 路由将 `failure_class=pipeline_terminal_failure` 的 pipeline
从 `failed` 状态覆盖为 `completed` 的 bug。

## 根本原因

`packages/brain/src/routes/execution.js` 中，当 Xian Bridge 回调返回 `AI Done`（即
`newStatus = 'completed'`）时，代码直接构建 UPDATE payload 并写库，没有检查当前任务是否
已处于 terminal failure 终态。`pipeline_terminal_failure` 是由 pipeline 执行器在遇到
不可恢复错误时写入的，语义上不应被 execution-callback 覆盖。

## 修复方案

在 P1-1 检查（`already_completed` guard）之后、构建 UPDATE payload 之前插入 P1-0 终态守卫：

```js
// P1-0: terminal failure guard
if (newStatus === 'completed') {
  const terminalCheck = await pool.query(
    `SELECT payload->>'failure_class' AS failure_class FROM tasks WHERE id = $1`,
    [task_id]
  );
  if (terminalCheck.rows[0]?.failure_class === 'pipeline_terminal_failure') {
    console.warn(`[execution-callback] 终态守卫命中：task=${task_id}，拒绝覆盖为 completed`);
    return res.json({ success: true, skipped: true, reason: 'terminal_failure_guard' });
  }
}
```

DB 查询失败时降级继续（不阻断正常流程）。

## CI Config Audit 规则

修改 `.github/workflows/**` 时，PR 标题必须包含 `[CONFIG]` 或 `[INFRA]` 标签，
否则 L1 Process Gate 的 CI Config Audit job 会失败。

本次顺带修复了 `ci-l3-code.yml` 中 `Security audit (npm audit)` 步骤缺少
`working-directory: packages/brain`，导致从 repo root 扫描到 recharts→lodash
CVE（GHSA-r5fr-rjxr-66jc）的问题。

## 关键决策

- **降级继续而非阻断**：terminal failure check 的 DB 查询如果出错，`catch` 里继续
  执行而不返回错误，避免 check 本身的故障影响正常的 execution-callback 流程。

- **`skipped: true` 响应**：返回 `{success: true, skipped: true, reason: ...}` 而非
  报错，让调用方（Xian Bridge）知道回调被接受但跳过了状态更新，不会重试。

## 踩的坑

1. 直接在主仓库 `perfect21/cecelia` 编辑 workflow 文件，导致改动落在 main 分支工作区
   而非 worktree。需手动 `cp` 到 worktree 再 revert 主仓库。

2. PR 标题改变不会触发新的 CI run（需要 push 新 commit 才能触发 `pull_request` 事件）。
