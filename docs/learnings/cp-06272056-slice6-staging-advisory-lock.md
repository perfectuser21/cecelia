# Learning: Slice6 — staging_e2e 并发止血 advisory lock

> 2026-06-27 · harness pipeline 9-slice 之 Slice 6 · PR cp-06272056-staging-advisory-lock

## 背景
20-agent 审计「运行时无隔离」根因 #4 的一半：staging_e2e 部署到固定端口（内部线 :5223 /
非内部 :5222）的单实例。N 路并发 staging_e2e（多 PR 同时 merge）会互相 `docker rm` 顶掉，
验的不是自己那路。

## 根本认知（handoff §1 三层验证模型）
staging 天生**单数串行**——它就是"合一起通不通"的共享集成环境，不是 per-PR 隔离环境
（那是 preview 的活）。所以正解不是开多实例，是**串行化**：一路在跑时别路 SKIP 等下一轮。

## 设计
1. **pg_try_advisory_lock 止血**：runStagingE2E deploy 前抢锁，抢不到 → `SKIP staging_busy`
   （不部署，让在跑那路独占）；抢到 → `finally` 必释放。
2. **dedicated client（关键陷阱）**：advisory lock 是 **session 级**，`pg_try_advisory_lock` 和
   `pg_advisory_unlock` 必须在**同一连接**。`pool.query` 每次可能拿不同连接 → lock/unlock 漂到
   不同 session，锁永不释放。必须 `pool.connect()` 拿独占 client，持有期间不放回池，unlock 后 release。
3. **fail-open**：pool 无 connect（测试 mock）/ 抢锁基础设施异常 → 返回 no-op lock 继续跑。
   锁是并发**止血**不是正确性**硬门**——锁机制本身故障不该阻断 staging。这也让所有现有
   runStagingE2E test（pool mock 无 connect）零改动通过。
4. **project_id 透传**：_spawnStagingE2eTask payload 带 project_id，为二期 coalescing 单实例
   patrol（按 project 合并并发任务）铺路。

## 下次预防
- [ ] 用 PG advisory lock 务必 dedicated client（connect/release 配对），**禁用 pool.query** 直接抢
      session 级锁（连接漂移 = 锁泄漏）。
- [ ] 改 runStagingE2E 这种被多 test 文件共用的入口 → 新增依赖务必 fail-open 或注入默认，
      否则所有调用方 test 的 mock 都要跟改（参见 [[cp-06272018-slice5-pipeline-patrol-loop]] 的
      getInternalTaskHandler 45 文件连带修复教训）。
- [ ] regression 守卫：staging-e2e-runner.test（staging_busy + finally release）+
      permerge-staging.test（project_id 透传）已留 CI。
