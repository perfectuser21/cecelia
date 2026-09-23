## Brain {VERSION} — 秋米 qiumi_task 被 cecelia-run 熔断误伤 + 每 tick 白打 Jev 重复路由

- 现象（0923 03:48–03:55 生产实证）：首条秋米真活两次 `qiumi_route_decided`（run_id 不同）无 `openclaw_agent_spawned`，每 tick 回 queued；`cecelia-run` 熔断 reset 后才派出。
- 根因：qiumi_task 的执行体是 `openclaw-agent`（ssh 直派 MMV，不经 cecelia-bridge），却被 `needsBridgeCheck` 拉去过 `cecelia-run` 熔断 + bridge 健康两道闸；路由副作用（Jev + persistDecision）发生在闸之前，所以每 tick 重路由换 run_id；openclaw 路径失败还反向计入 `cecelia-run`。
- 修法（四项同刀，单独上产会反向污染）：① `needsBridgeCheck` 按注册表 surface 派生，`openclaw-agent` 表面豁免两道 bridge 闸（不手抄名单）；② `dispatchQiumiTask` 入口先查独立熔断键 `openclaw-agent`，OPEN → 放 claim、派发统计记 `openclaw_agent_circuit_open`、不路由；③ 路由幂等：payload 已有 `qiumi_route`+`run_id` 直接 proceed，复用 run_id（执行体 ALREADY 探针防重起）；④ 熔断计数分键：openclaw 表面失败 `recordFailure('openclaw-agent')`、成功 `recordSuccess('openclaw-agent')`（包 try/catch，事后记账失败不影响已 spawn 任务），不动 `cecelia-run`。
- 守卫：`dispatcher-qiumi-routing.test.js` 新增熔断豁免用例（cecelia-run OPEN 仍派 / bridge 不可用仍派 / openclaw-agent OPEN skip / 幂等 proceed / 分键 / recordSuccess 抛错不标 failed），每条已变异验证红；不改 `circuit-breaker.js`。主理人可 `POST /api/brain/circuit-breaker/openclaw-agent/reset`。
