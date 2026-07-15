# Reviewer Feedback R1（controller 直接发现，非 reviewer subagent）

## 问题：E2E 验收断言2（initiative_runs.orchestrator_host）与本次真实执行路径不符

contract-draft.md 的 E2E 验收断言2抄自先例（049ebf93/scripts/smoke/e2e/relay-049ebf93.sh），要求：
```
case "$HOST" in *skill-relay-claude-headed*) ;; *) FAIL ;; esac
```

但本次 task_id=63db6f8a 的真实派发历史：
- task payload 显示 `dispatched_by_orchestrator=true`、`orchestrator_dispatched_at=2026-07-15T05:52:09Z`，但 status 一直停留 `queued`，Brain 的 `_spawnHeadedSession` 从未真正 spawn 成功（未落 `initiative_runs` 行）。
- controller session 是通过 harness-controller skill Step 0.3「前台点火防护」手动认领的（HARNESS_TASK_ID 由外部注入，无 HARNESS_INITIATIVE_ID，符合前台点火特征）。
- 已调用官方补建档端点 `POST /api/brain/orchestrator/relay-runs/:initiative_id`（packages/brain/src/routes/initiatives.js:373，专为此场景设计）创建了 initiative_runs 行，但该端点固定写 `orchestrator_host='foreground'`，不是 `skill-relay-claude-headed`。

## 要求

请修改 contract-draft.md 的 E2E 验收断言2（以及 contract-dod.md 对应 [BEHAVIOR] 条目 + e2e-verify.sh 占位逻辑），使其同时接受两种合法 host：
- `*skill-relay-claude-headed*`（Brain 自动 spawn 的真实 headed 容器路径）
- `foreground`（skill Step 0.3 文档化的前台点火补建档路径，packages/brain/src/routes/initiatives.js:373 明确为此设计）

且 `## 未覆盖真实链路清单` 段需补一条：本次执行未覆盖"Brain 自动 headed spawn 落 initiative_runs（host=skill-relay-claude-headed）"这条真实链路（task 63db6f8a 的自动派发本身未跑通，转为前台补建档路径），这与 049ebf93 等先例覆盖的链路不同，不得混同呈现。

不修改其他既有断言（task payload 三元组、敏感字段脱敏、smoke 脚本 allowlist 登记）。
