# Learning: Slice9 — promote 复合闸 + tested_sha 锚定 + 终态守卫

> 2026-06-27 · harness pipeline 9-slice 之 Slice 9（收官 brain slice）· PR cp-06272112-promote-gate-sha

## 背景
20-agent 审计 promote 层正确性缺口 + 终态写漏点。staging→production 放行链有三个洞：
1. **per-PR 单独放行**：handlePromote 单个 PR PASS（内部线）就 auto-promote，漏掉同 initiative
   其他 PR 的 staging FAIL → 上了带病代码。
2. **无 SHA 锚定**：run 在飞期间别的 PR merge → main 前进，staging 测的是旧 SHA，promote 部署
   新 main → 上了没经 staging 验证的代码。
3. **终态裸写**：reportNode 的 `UPDATE ... WHERE id=$1`（无守卫）会把已被别处标 completed 的
   task/run 重新覆盖（子图 END 漏写 status 裸透传 race），completed→failed 误判。

## 四件
1. **migration308 tested_sha** + recordResult 写入：锚定 staging 实测的 git HEAD。
2. **handlePromote 复合闸**（auto 前两道）：
   - 聚合 gate：`checkInitiativeAggregate` 查该 initiative 所有 staging_e2e_results，**有任何 FAIL
     就不放行**（SKIP 是加分项跳过不算失败，PASS/SKIP 都 OK）→ 挂 pending 等全绿。
   - SHA 锚定：tested_sha != 当前 HEAD → 漂移 → 挂 pending。**两端非空才比（fail-open）**，
     getCurrentSha/git 失败不阻断。
3. **reportNode 终态守卫**：两个终态 UPDATE 加 `status NOT IN('completed','failed')` /
   `phase NOT IN('done','failed')`，已终态不被晚到 reportNode 覆盖。
4. **task-router 补登 staging_e2e**：VALID_TASK_TYPES/LOCATION_MAP/SKILL_WHITELIST + **DEFINITION.md**。

## 非显然点 / 踩坑
- **DevGate facts-check 抓 task-router↔DEFINITION.md 漂移**：往 LOCATION_MAP 加 task_type 必须
  同步 DEFINITION.md 的 task_types 表，否则 `facts-check FAILED: doc=missing`。这是 SSOT 防漂移，
  不是噪音——改 task-router 路由表永远记得同步 DEFINITION.md。
- **聚合 gate 用"无 FAIL"而非"全 PASS 且数量齐"**：因为不知道 initiative 应有几个 PR（sub_task
  数）。"有已知 FAIL 不上生产"是保守正确的最小可行闸；完整"全 PR 齐且全绿"留二期（需 sub_task 计数）。
- **改被多 test 共用的入口（handlePromote/runStagingE2E）务必 fail-open + 注入默认**：聚合 gate 默认
  查空 rows→allPass=true、SHA 两端非空才比，让现有 promote test 零改动通过（参见
  [[cp-06272056-slice6-staging-advisory-lock]] / [[cp-06272018-slice5-pipeline-patrol-loop]] 同款教训）。

## 下次预防
- [ ] 改 task-router 的 VALID_TASK_TYPES/LOCATION_MAP/SKILL_WHITELIST → 必同步 DEFINITION.md task_types 表（facts-check 强制）。
- [ ] promote/部署决策加闸务必 fail-open（闸机制故障不该误阻生产放行，但也不该误放——保守挂 pending）。
- [ ] regression 守卫：staging-e2e-runner.test（tested_sha + 聚合 gate + SHA 漂移）/ harness-initiative-graph.test（终态守卫）/ task-router-core.test（补登）已留 CI。
