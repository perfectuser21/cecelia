## Brain {VERSION} — Commander 通用活动契约执行与真实事件账

通用业务活动执行（阶段3，显式调用）：`packages/brain/scripts/activity-contract-run.js` 读取已组装JSON契约，按 order/runtime.entry/budget/failure 与 per_item 分组调用活动，保留产物、指标、证据，预算到期请求清理并执行 finalize。协议与接线边界见 `packages/brain/src/orchestrator/README.md`；生产任务路由未接入，未部署。

真实事件账（阶段3续作，显式启用）：CLI 组合 `--event-db --brain-run-id <已有run UUID> --event-source-id <每次调用独立UUID>` 与 `ACTIVITY_EVENT_DATABASE_URL`，服务可调用 `activity-event-sink.js` 的 `runActivityContractWithEventStore`。开始/心跳/完成/finalize经既有 `run-event-store` 追加并读回；`event_ledger` 区分DB cursor与local_cursor。复用或并发source、非法run在活动前拒绝；存储失败保留产物与全部finalize。默认不连接数据库、不创建/完成Brain任务或run；隔离scratch真数据库smoke永久纳入allowlist。
