---
task_id: 142c9ad0-2150-4f03-978c-3dd30ab32ed1
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 9
可验证: 8
场景覆盖: 8
回归风险: 7
可执行: 9

### R-1
针对: Q-4, S-3, I-3
严重度: 重要
场景: QA 在预览环境照 Q-4 执行 `POST /api/brain/pipelines` 建了一条 `qa-canary6-<时间戳>` 流水线，验完 4 个 GET 就结束了。这条 `task_type=content-pipeline`、`status=queued` 的任务会一直留在库里，会被当成真实待办派出去（外部 worker / 西安 Codex 编排入口），也会算进 `daily-stats`、选题缺口分析和日报的计数。QA 每跑一次就多一条脏的真实任务，Q-6 的 `daily-stats` 读数也会被前几次 QA 跑出来的残留污染。
依据: `packages/brain/src/routes/content-pipeline.js:366-379` 用 `createTask` 写入 `status: 'queued'`，description 写明"将由 tick 自动编排"；`packages/brain/src/lib/task-type-registry.js:126/548` 把 `content-pipeline` 登记为 external-worker 可派发、路由到 xian；`topic-gap-analyzer.js:47`、`daily-report-generator.js:129`、`content-pipeline.js:251`（daily-stats）都按 `task_type='content-pipeline'` 计数。规格 Q-4 没有清理步骤，`## 未覆盖真实链路` 也没登记这个副作用。
说明: Q-4 末尾加一步清理，必须是用户能操作、结果能看到的那种。例如 `PATCH $B/api/brain/tasks/$P` 把状态改成 `cancelled`（或仓库里现成的终态），期望返回 200，再 `GET` 一次确认已是终态。如果预览环境确实没有任何 worker 消费 `content-pipeline`，要在前提里写明依据，并把"残留任务会进计数"登记到 `## 未覆盖真实链路`。Q-5 复用 `$P` 的话，清理要放到 Q-5 跑完之后。

### R-2
针对: Q-1, Q-7, Q-8
严重度: 建议
场景: 预览环境没配 `CECELIA_INTERNAL_TOKEN`，QA 又不在 Brain 本机（经代理或从另一台机器）发起 curl。这时 `/api/brain/runs/*` 返回的是 503，不是 404，Q-1、Q-7、Q-8 会被误判为失败。
依据: `packages/brain/src/middleware/internal-auth.js:74-77` 的 `internalAuthOrLoopback`：没配 token 时只放行非 production 的 loopback 请求，其他一律 503。
说明: 在 QA 约定里补一句：没配 token 时必须在 Brain 本机通过 loopback 发请求；拿到 503 时报告为环境前提不满足，不算产品失败。
