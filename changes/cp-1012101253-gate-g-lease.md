## Brain {VERSION} — 统一领单租约 + 心跳 + 设备锁跟租约走 + 设备池（派发总闸 G）

- 迁移 553：`task_leases`（领单租约，单独成表不给 tasks 加列）+ `device_pools` / `device_pool_members`（手机按「平台.账号类型」成池，种子 `douyin.internal` = 小彩/Ai办公室）
- `POST /api/brain/tasks/:id/claim` 统一领单：带 `lease_seconds`（30~14400）即落租约、响应带 `lease_until`；`on_lease_expire=auto|requeue|fail`；不带则与旧行为一致。新增 `POST /tasks/:id/heartbeat`（续约，409 `lease_lost` = 已被回收、执行者必须停手）与 `POST /tasks/:id/lease/release`
- scheduler job `task-lease-reaper`（60s）：过期租约按任务类型现有语义处置——合同 onStale=requeue/release-claim-and-alert 回队（同一任务最多 3 次），外部执行体判 lost（failed，`lease_expired:`）；Brain 自派 openclaw-agent 的租约（超时+15min）过期先探活：alive 续 15min、dead 宽限 10min 留专属收割、unknown 判 lost（不再「生死未知不处置」）；回队/判 lost 同时释放该任务持有的设备锁
- 设备锁跟租约走：占用判据从「持有任务 in_progress」改为「in_progress 且租约未过期」，无租约的旧持有者最多保护到 locked_at+240 分钟；心跳/落租约同步把持有的锁 expires_at 拉到 lease_until；只回收已过期的锁
- 设备池：`lib/device-pool.js` 按 priority 依次过设备闸（资源健康 + Brain 锁），被占/不健康/未注册换下一台，全被占只等不接管；抖音视频发布 workflow_dispatch（`config/factory-workflows.json` device.pool=douyin.internal）改为从池里选机，调度单写选中那台，留痕 `device_pool_selected`
- openclaw-agent 派发（秋米/手机队列）与 workflow_dispatch 起跑后落 Brain 租约
- factory-dispatcher：claim 带 600s 租约、等锁与守望每轮心跳；409 停手（杀会话、放自己的锁、不回写）。coding-workflow-runner：claim 带 900s 租约（`CODING_WF_LEASE_SECONDS`），执行期间每 3 分钟心跳（`CODING_WF_HEARTBEAT_MS`），409 中止执行器不回写终态
