## Brain {VERSION} — Commander 通用活动契约执行与真实事件账

通用业务活动执行（阶段3，显式调用）：`packages/brain/scripts/activity-contract-run.js` 读取已组装JSON契约，按 order/runtime.entry/budget/failure 与 per_item 分组调用活动，保留产物、指标、证据，预算到期请求清理并执行 finalize。协议与接线边界见 `packages/brain/src/orchestrator/README.md`；生产任务路由未接入，未部署。

真实事件账（阶段3续作，显式启用）：CLI 组合 `--event-db --brain-run-id <已有run UUID> --event-source-id <每次调用独立UUID>` 与 `ACTIVITY_EVENT_DATABASE_URL`，服务可调用 `activity-event-sink.js` 的 `runActivityContractWithEventStore`。开始/心跳/完成/finalize经既有 `run-event-store` 追加并读回；`event_ledger` 区分DB cursor与local_cursor。复用或并发source、非法run在活动前拒绝；存储失败保留产物与全部finalize。默认不连接数据库、不创建/完成Brain任务或run；隔离scratch真数据库smoke永久纳入allowlist。

Commander 验收补修：接班消息通过注册表主网关 SSH 读取 SOP，明确日志、findings 与 openclaw 的网关上下文，心跳也在网关执行。JSON 经过 cron 消息及 SSH 两层 shell 引用仍原样到达 curl；永久测试用真实 shell 解码并读回。修复落在草稿，尚未部署或完成真实接班验收。

接班时限补修：登记新陪跑后立即请求首轮执行，避免在15分钟心跳过期与调度门之后再等10分钟周期；有效恢复仍只认实际心跳，首轮入队失败单独记事件。显式 COMMANDER_BRAIN_URL 与 COMMANDER_ESCORT_DELIVERY=none 支持隔离验收，默认生产心跳与投递保持原值。

Commander 售后协调器在真实 finalize 后异步请求末轮，只接受同 run 随机 nonce 回执；Brain 原子留痕并读回成功后暂停周期，确认当前 tick 自然结束再注销。协调器缺失、读不到、重名、售后失败与超时保留现场。独立安装器成套发布 CLI 与模块，生产业务入口未切换。

阶段4：`generate-commander-skill.mjs` 设计时读取显式编译契约与业务SOP，按order生成活动正常态、预算、失败分类、探针与售后规则；纯stdin/stdout无网络和模型调用。接班读取同cap专属skill，缺能力不自选。生产未部署；真机验证结果以Brain阶段4原任务为准。

角色一致性：陪跑与Brain接班统一召唤PRD指定的`work-commander`，保持同TAG/session/cap及网关访问。售后禁用运输可能中断抢跑tick，后续必须真实读回ok；error时保留，不把取消当自然成功。
