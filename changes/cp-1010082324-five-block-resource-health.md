## Brain {VERSION} — 资源健康进仓库：账号/手机等资源当下五态落库、账号切换三态判据、调度前检查与变坏预警

决策 de6dff5d（五块模型）第 5 步，任务 5bf2512a。仓库 warehouse_items 原来只登记「有什么」，现在知道「现在能不能用」。

- 迁移 539：`resource_health` 一资源一行当下健康（类型 account/phone/machine/warehouse_item/service/other；状态 healthy/degraded/offline/restricted/unknown；原因、证据 jsonb、来源、观测时间取库时钟、执行端自报时间另存 reported_at、status_since），可挂到仓库物件 `warehouse_item_id`；`resource_health_events` 状态变化历史由触发器写（首报、每次状态变化各一条，同状态不记，psql 直改也留痕）；视图 `v_warehouse_item_health` 给每件仓库物件的各态计数与最差状态。不另造设备表：手机键 = device_locks / phone_registry 的 serial，账号键 = `<平台>:<账号 id>`，仓库物件键 = warehouse_items.key。
- 账号切换三态判据（主理人规矩，平台通用）：切换列表里账号消失 = offline（掉线，停用该号）；切换要身份校验/人脸 = restricted（被风控，立即退出不验证）；切换成功可用 = healthy。
- 接口：`POST /api/brain/resource-health/report`、`POST /api/brain/resource-health/account-switch`（内部令牌；不健康结果必须带证据；回 `action` 告诉执行端怎么做）、`POST /api/brain/resource-health/check`（按资源清单或 task_id）、`GET /api/brain/resource-health`、`GET /api/brain/resource-health/warehouse`、`GET /api/brain/resource-health/:type/:key/history`。
- 调度前检查：任务经 `payload.device_serial` / 秋米路由手机 / `payload.account_ref` / `payload.resource_refs` 引用的资源若 offline/restricted，dispatcher 候选循环、秋米新定路由、worker 池、两个手动派发入口都不派（保持 queued，恢复后自动放行），原因写 task_events `resource_health_blocked`（同单同原因只记一次）、派发统计记 `resource_unhealthy`；手动派发可设 `resource_health_override=true` 人工放行。degraded、没记录、过期的 healthy 只提示不挡。闸自身出错一律放行只记日志。
- 预警：变成 offline/restricted → Bark（按资源+状态 6 小时去重）+ alerting P1；变成 degraded → P1；从 offline/restricted 恢复 → P2。告警失败不影响写入。
