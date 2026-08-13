# Sprint PRD — Harness 入口旁路修复：kernel-v1 绕过 Session Controller 门禁

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖（当前进度 ~84%）
- **本次推进预期**：+1%（封堵 kernel-v1 旁路，完整覆盖 INV-1~INV-10 所有权不变量）

## 背景

前置任务 77f19b77（PR #4860，已合并 79ad1b3a76）建立了：
- migration 415：initiative_runs 加 controller_session_id + controller_lease_expires_at 列
- createKernelRun fail-closed：无 controllerSessionId 拒绝创建
- _spawnKernelRuntime 内部收敛：controllerSessionId = randomUUID() 在同一事务先于 Kernel 落库
- kernel-controller-lifecycle.js：Kernel fatal 只结束 Kernel，Controller 存活
- derive.js 按 change_kind 分派执行 Profile（四档）

**遗留缺陷**（本任务修复目标）：

`spawnSkillRelaySession` 第 365-366 行对 `harness_runtime=kernel-v1` 做提前 return，跳过外层三道门禁：

1. **executor 白名单校验**（INV-8）：`executor='auto'` 等非法值经 kernel-v1 旁路可绕过白名单
2. **docker ps 去重守卫**：Brain 重启后重 claim 同一 kernel-v1 任务可双 spawn
3. **findActiveRunBlockingSpawn DB 幂等防重**：与 docker 去重守卫同根，活跃 run 存在时不拒绝

注意：xian/headed 路由被绕过是**设计正确**的（kernel-v1 不走容器路由）。preview-guard 在 early return 之前，**已覆盖**。

## Golden Path（核心场景）

Dispatcher 携带 `harness_runtime=kernel-v1` 的任务 → `spawnSkillRelaySession` 路由至
`_spawnKernelRuntime` → 途中必须通过 executor 白名单 + DB 幂等防重 → Controller 先取
ownership（controllerSessionId 落库）→ Kernel 启动 → Kernel 可执行态晚于 ownership 存在。

验收要点：
1. `executor='auto'` + `harness_runtime=kernel-v1` 直打 → executor 白名单拦截，task 回滚，不产生 run
2. 活跃 run 存在（`findActiveRunBlockingSpawn` 返回命中）时，`harness_runtime=kernel-v1` 再打
   → DB 幂等防重拦截，返回 `{deferred:true, reason:'active_run_guard'}`，不产生新 run
3. 合法路径（executor 缺省/claude + 无活跃 run）→ 创建 run，controller_session_id 非空（INV 仍满足）
4. `createKernelRun` 无 controllerSessionId → fail-closed 拒绝（PR #4860 已有，回归不得破坏）
5. derive.js 四档 change_kind Profile 行为（PR #4860 已有，回归不得破坏）

## 边界情况

- `executor='auto'` + `harness_runtime=kernel-v1`：现状被绕过白名单静默启动 → 修复后loud-fail + task 回滚
- `executor=undefined` + `harness_runtime=kernel-v1`：合法，照常走 `_spawnKernelRuntime`
- 活跃 run + `harness_runtime=kernel-v1` 重打：现状产生 `kernel_run_exists` 幂等（createKernelRun 幂等），
  但 docker ps 去重守卫未覆盖（kernel-v1 不用 docker，守卫无意义 → 只需补 DB 幂等防重）
- BRAIN_PREVIEW + `harness_runtime=kernel-v1`：preview-guard 已在 early return 之前，**不受影响**
- schema 碰撞 issue 8a782f87（66d5c0f7 并行处理）：migration 415 已落库，本分支仅 rebase main 即可

## 范围限定

**在范围内**：
- `packages/brain/src/harness-skill-relay.js`：第 363-366 行 early return 前插入 executor 白名单校验
  + `findActiveRunBlockingSpawn` DB 幂等防重（docker ps 守卫对 kernel-v1 无意义，跳过）
- `packages/brain/src/__tests__/harness-skill-relay.test.js`：补两个集成测试（禁 mock 被改边）
- `packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js`：
  补 executor 白名单 + 幂等防重 + 完整 INV-1~INV-10 覆盖检查

**不在范围内**：
- derive.js 四档 Profile（PR #4860 已完成）
- kernel-controller-lifecycle.js（PR #4860 已完成）
- migration 415（PR #4860 已完成）
- docker ps 去重守卫对 kernel-v1 路径（kernel-v1 不走 docker，守卫无意义）
- UI / Dashboard

## 假设

- [ASSUMPTION: migration 415 已在 main 分支落库，本分支 rebase main 后直接可用]
- [ASSUMPTION: `findActiveRunBlockingSpawn` 对 kernel-v1 任务行为正确（返回活跃 run 则阻断）]
- [ASSUMPTION: executor 白名单校验插入 early return 之前，不影响 `executor=undefined/null` 的合法路径]

## NFR 约束

- fail-closed：executor 非法值不得静默降级，必须 loud-fail + task 回滚 + 返回 `{ok:false, error:...}`
- 幂等：活跃 run 存在时，kernel-v1 再打必须返回 `{ok:false, deferred:true, reason:'active_run_guard'}`
- 可观测：executor 白名单拦截必须打 `[skill-relay][ALERT]` 日志
- 测试隔离：新增集成测试真打 spawnSkillRelaySession + 真 DB，禁 mock createKernelRun / pool.query

## Invariant 约束（INV-1~INV-10，本 sprint 全部覆盖检查）

<!-- 来源：PR #4860 + 本任务修复目标，合并为 INV-1~INV-10 完整清单 -->
- **INV-1**：任何活跃 Kernel Run 前必先有有效 Controller ownership（controller_session_id 非空且未过期）
- **INV-2**：Kernel fatal 只结束 Kernel process，Controller ownership 记录存活（controller_session_id 保持不动）
- **INV-3**：无主 run（controller_session_id IS NULL 或 lease 过期）fail-closed 进恢复流程，不静默放行
- **INV-4**：`createKernelRun` 无 controllerSessionId（缺失/空串）→ fail-closed 拒绝，不写半态 run
- **INV-5**：活跃 run 存在时禁止同 task 二次 spawn（DB 幂等防重，返回 deferred）
- **INV-6**：executor 非白名单值（含 'auto'）→ loud-fail + task 回滚，不静默降级启动
- **INV-7**：derive.js 按 change_kind 分派四档 Profile，四档全保留 G→E→J + merge fence
- **INV-8**：controller_session_id 先于 Kernel 可执行态写入（同一创建事务，ownership 先行）
- **INV-9**：Kernel failure_reason 结构化 + 脱敏（不落凭据明文，redactSecrets 过滤）
- **INV-10**：BRAIN_PREVIEW=1 下所有 harness spawn 路径（含 kernel-v1）全部拒绝

## 累积 FR（本 line 已验收行为，本 sprint 不得回退）

<!-- 来自 PR #4860 79ad1b3a76，以下行为已验收 -->
- FR-1：migration 415 initiative_runs 加 controller_session_id + controller_lease_expires_at 列（已验收）
- FR-2：createKernelRun fail-closed 无 controllerSessionId 拒绝（已验收）
- FR-3：_spawnKernelRuntime 内 controllerSessionId = randomUUID() 先于 Kernel 落库（已验收）
- FR-4：kernel-controller-lifecycle.js Kernel fatal 结构化脱敏 + Controller 存活（已验收）
- FR-5：derive.js 四档 change_kind Profile bugfix/parameter_only 跳 Planner/GAN（已验收）
- FR-6：executor 白名单拦截 kernel-v1 路径（本 sprint 新增）
- FR-7：DB 幂等防重覆盖 kernel-v1 路径（本 sprint 新增）

## 预期受影响文件

- `packages/brain/src/harness-skill-relay.js`：第 363 行 early return 前插入 executor 白名单 +
  findActiveRunBlockingSpawn DB 幂等防重（约 15 行增量）
- `packages/brain/src/__tests__/harness-skill-relay.test.js`：补 executor 白名单 + 幂等防重 单测
- `packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js`：
  补 INV-5（幂等防重）和 INV-6（executor 白名单）两个集成测试用例

## E2E 验收（集成测试，禁 mock 被改边）

```bash
# 运行集成测试（真 PG）
cd /workspace && node packages/brain/node_modules/.bin/vitest run \
  --config packages/brain/vitest.integration.config.js \
  packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js

# 运行 harness-skill-relay 单测（fake deps，验 executor 白名单 + 幂等防重）
cd /workspace && node packages/brain/node_modules/.bin/vitest run \
  --config packages/brain/vitest.config.js \
  packages/brain/src/__tests__/harness-skill-relay.test.js

# DevGate 校验
node /workspace/scripts/facts-check.mjs
bash /workspace/scripts/check-version-sync.sh
```

期望验收点：
1. executor='auto' + harness_runtime=kernel-v1 → `{ok:false, error:'unsupported executor: auto'}` + initiative_runs count=0
2. 活跃 run + harness_runtime=kernel-v1 重打 → `{ok:false, deferred:true, reason:'active_run_guard'}`
3. 合法路径 + harness_runtime=kernel-v1 → `{ok:true, mode:'kernel-v1'}` + controller_session_id 非空
4. createKernelRun 无 controllerSessionId → 抛 /missing controller ownership/ + initiative_runs count=0

## journey_type: autonomous
## target_environment: local_api
