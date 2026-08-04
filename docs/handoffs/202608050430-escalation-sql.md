# Handoff：熔断 SQL $3 类型推断双修

- verdict: **PASS**
- PR: https://github.com/perfectuser21/cecelia/pull/4624（已合并 merge_sha=3f4fc6dd）
- task_id: unknown（用户直接口头指派，未走 Brain 注册）

## 完成
- `cancelPendingTasks`（L2 紧急制动）与 `pauseLowPriorityTasks`（L1 优雅降级）两处裸 `$3` 全部改为 `$3::text`；SQL 各抽为纯函数 `buildCancelPendingQuery` / `buildPauseLowPriorityQuery`
- 真库守卫 `packages/brain/src/__tests__/integration/escalation-cancel-pending-sql.integration.test.js`（7 项），归 brain-integration job
- Brain 版本 bump 1.267.219 + DEFINITION.md 同步

## 根因与教训
- `$3` 同时落在 `error_message = $3`（text）与 `jsonb_build_object(..., $3)`（形参 any），两处皆无标注时 Postgres 于 PREPARE 阶段报 could not determine data type
- **只要有一处带 `::text`，整个 $3 即可推断**——所以半修也能"看起来好了"，必须两处都改
- 既有 escalation 单测 mock 了 pool.query，SQL 从未被真正解析，这是 bug 逃逸主因（同源事故：autoblock-sql-integration，上次是 $2）

## 守卫怎么写才有效（变异测试连踩两坑才定型）
- ✗ `client.query(sql, values)`：pg 驱动在 Parse 消息里替服务器把参数类型定死，裸 $3 照样过
- ✗ `PREPARE name(text[], text[], text)`：显式声明 $3 类型，同样绕过推断
- ✓ `PREPARE name(text[], text[])`：**故意不声明 $3**，服务器必须自行推断 → 裸 $3 立即报错
- proven-to-fire：两处 $3 全退回裸写后 5/7 报红，三条 PREPARE 测试吐出与线上一字不差的错误

## CI 踩坑
- 需真库的测试放 `src/__tests__/` 根目录会被 brain-unit 分片扫到（无 DB，报 AggregateError from pg-pool 而非 SQL 错）→ 必须放 `src/__tests__/integration/` 并命名 `*.integration.test.js`
- 改 brain src 必须 bump `packages/brain/package.json` 版本，且 `DEFINITION.md` 的 Brain 版本要同步（gp-governance-decisions-smoke 的 Facts 核对项）

## 没做 / 下一步
- 熔断触发的真实根因（本机持续高负载 CPU 83%、load 7~8）未处理；安全模式仍可能再次触发停派发
- 队列已人工清场 65→19（46 个过期定时任务标 cancelled 可恢复），但**四类定时任务的消费者仍是死的**（arch_review 从无成功记录、staging_e2e 末次成功 07-23、strategist_decision/ci_patrol 停在 07-30）——治标未治本
- 孤儿 PR 现象：任务被误标 failed 但 PR 干净挂着（实例：zenithjoy PR#1602），未做系统性排查
