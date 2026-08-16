# Sprint Contract Draft (Round 1)

**锚定父路声明**: 独立小路（无父路）— 本 sprint 是起跑预检第 9 类死法修复（调度/预检后端逻辑），无对应用户可观察 Golden Path 父路。关联 planner journey=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 step=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b。

gp-anchor: skipped (product-map.json not found)
contract-gate: present (packages/brain/src/lib/contract-gate.js 存在，代码层 Contract Gate 生效)

> **运行时说明**：`runtime_resources.postgres=false`、`node_deps=true`。故本轮机器 oracle 是 map-impact-contract.js 与 dispatcher 的 **vitest 依赖注入（DI）单测**（真跑本单改动的实现代码逻辑，DB/git 为注入边界）。真 PG 写边与真 run 起跑属接缝，登记进「未覆盖真实链路清单」，由 brain-integration job 与部署后本任务自身 run 覆盖。

---

## Response Schema（推导来源: PRD 字面 — N/A）

N/A — 任务无 HTTP 响应（纯 Brain 内部起跑预检 / dispatcher 调度逻辑改动，无对外 HTTP 端点）。

---

## Golden Path

[起跑预检检测到 map.source_revision ≠ receipt base_sha] → [按「祖先关系 × run 是否已开始」分流] → [同源后裔且 run 未开始 → 重定基放行；分叉/回退/追赶窗口 → 安全回队，均不永久锁死]

---

### Step 1: 起跑预检检测 revision 不一致（原 `map_revision_mismatch` 触发点）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条 + 「预期受影响文件」`map-impact-contract.js:256-259`。

**可观测行为**: `ensureNormalMapImpactPreflight` 读到 `map.freshness` 为 fresh 但 `repoFreshness.source_revision !== baseSha`（`baseSha` = `receipt.evidence.base_sha`），进入分流而非直接抛 `map_revision_mismatch`。

**验证命令**:
```bash
# DI 单测：source_revision != base_sha 时不再无条件抛 map_revision_mismatch，进入分流
npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "rebases receipt base_sha" 2>&1 | tail -5
# 期望：该用例 passed（进入重定基分支，未抛 map_revision_mismatch）
```

**硬阈值**: 该 it() 用例 passed（exit 0），未抛 `map_revision_mismatch`。
**验证命令**: `bash -c 'set -o pipefail; npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "rebases receipt base_sha" 2>&1 | tee /tmp/gp1.log; grep -Eq "[1-9][0-9]* passed" /tmp/gp1.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/gp1.log'`

---

### Step 2: 同源后裔 + run 未开始 → 重定基放行
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条 + 「假设」ASSUMPTION 三条。

**可观测行为**:
- 判据一：`git merge-base --is-ancestor <base_sha> <map_source_revision>` 为真（base_sha 是 map revision 的祖先，即 base_sha 落后同源）。判定通过注入边界 `deps.isAncestor(baseSha, mapRevision)`（默认实现 = 上述 git 命令）。
- 判据二：run 尚未开始 —— 该 task 无 `initiative_runs`（`current_task_id = task.id` 计数为 0），亦无 attempt。判定通过 `deps.hasRunStarted(client, task.id)`（默认实现 = 查 `initiative_runs`）。
- 两判据同时满足时：
  1. 先写审计事件 `route_rebased`（走既有 `cecelia_events` 通道，与本文件既有 `map_preflight_failed` 事件同款），payload 含 `{task_id, receipt_id, old_base_sha, new_base_sha, map_revision}`，**保留旧 base_sha 可审计**；
  2. `UPDATE work_routing_receipts SET evidence = jsonb_set(evidence,'{base_sha}', <new>)` where id = receipt.id；
  3. `UPDATE tasks SET payload = jsonb_set(payload,'{base_sha}', <new>)` where id = task.id；
  4. 本地 `effectiveBaseSha` 重定基为 `map.source_revision`，**下游所有校验（radius `source_revision` 比对、impact contract `base_revision`、`freshness_evidence.mapper_revision`）一律用新值**；
  5. 预检继续，正常 materialize active impact contract → 任务照常起跑。

**验证命令**:
```bash
# DI 单测：ancestor + run 未开始 → 重定基成功，新 base_revision = map revision，route_rebased 事件已下发
npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "rebases receipt base_sha" 2>&1 | tail -5
# 期望：persistContract 收到 base_revision = map revision；client.query 曾以 route_rebased 事件被调用（payload 含 old_base_sha）
```

**硬阈值**: 重定基后 `persistContract` 入参 `base_revision === map.source_revision`；`cecelia_events` 收到一条 `route_rebased`（payload.old_base_sha === 原 baseSha）。
**验证命令**: 同上 -t "rebases receipt base_sha" 的 exit-code oracle（见 DoD B-01/B-08）。

---

### Step 3: 非后裔（分叉/回退）→ `map_revision_diverged`，不计入 autoblock
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条 + 「边界情况」第 2 条（unreachable 视为非后裔）。

**可观测行为**:
- `deps.isAncestor` 返回 false（分叉/回退），**或**祖先判定不可达（git 报错 / 对象本地不可达，`isAncestor` throw）→ 一律按非后裔处理：抛新错误 `map_revision_diverged`，**不重定基**、**不写 route_rebased**、`persistContract` 不被调用。
- 该错误经 executor 冒泡为 `execResult.error='map_revision_diverged'`；dispatcher 识别后**不递增** `dispatch_fail_consecutive`、**不** `recordFailure('cecelia-run')`、**不触发** `dispatch_fail_autoblock`（判为环境漂移，与既有 `configError`/`spawn_deduplicated` 豁免同类），任务回 `queued` 等下一轮。

**验证命令**:
```bash
# DI 单测：非祖先 → 抛 map_revision_diverged，persistContract 未被调用
npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "map_revision_diverged" 2>&1 | tail -5
# DI 单测：dispatcher 对 map_revision_diverged 不计入 autoblock
npx vitest run packages/brain/src/__tests__/dispatch-fail-autoblock.test.js -t "map_revision_diverged" 2>&1 | tail -5
```

**硬阈值**: 抛 `map_revision_diverged`；dispatcher 该失败下 `dispatch_fail_consecutive` UPDATE 未发生、`blockTask` 未被调用。
**验证命令**: 见 DoD B-02 / B-05 / B-06 的 exit-code oracle。

---

### Step 4: `map_stale`（扫描器追赶窗口）不计入 autoblock
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 条。

**可观测行为**: `map.freshness.status !== 'fresh'`（或 repoFreshness 非 fresh）时预检仍抛 `map_stale`（既有行为，保持不变）；dispatcher 识别 `execResult.error='map_stale'` 后**不计入** autoblock 连败，任务回 `queued` 等下一 tick。

**验证命令**:
```bash
npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "throws map_stale" 2>&1 | tail -5
npx vitest run packages/brain/src/__tests__/dispatch-fail-autoblock.test.js -t "map_stale" 2>&1 | tail -5
```

**硬阈值**: 抛 `map_stale`（既有）；dispatcher 该失败下计数不增、不 block。
**验证命令**: 见 DoD B-04 / B-07 的 exit-code oracle。

---

### Step 5: run 已开始时落后 base_sha 不静默重定基（fail-closed）
**来源**: `[FROM_PRD]` — PRD「边界情况」第 1 条（避免 run 中途换基）。

**可观测行为**: `deps.hasRunStarted` 返回 true（该 task 已有 `initiative_runs`/attempt）且 base_sha 落后 → **不重定基**，走原有 fail-closed 路径抛 `map_revision_mismatch`，不写 route_rebased。

**验证命令**:
```bash
npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "run has already started" 2>&1 | tail -5
```

**硬阈值**: 抛 `map_revision_mismatch`；无 route_rebased 事件；persistContract 未调用。
**验证命令**: 见 DoD B-03 的 exit-code oracle。

---

### Step 6（出口 / error path）: 重定基写事件失败 → 不吞错，fail-closed 回队
**来源**: `[AI_ADDED]` — PRD「边界情况」第 3 条固化为可执行断言。理由：防止 generator 用 try/catch 吞掉事件写失败后带旧 base_sha 静默继续，破坏可审计性与 fail-closed。

**可观测行为**: `cecelia_events` 写 `route_rebased` 抛错时，错误向上传播（fail-closed），`persistContract` 不被调用、receipt/task 的 base_sha 不被改成半态；任务回队，旧 base_sha 保持可审计。

**验证命令**:
```bash
npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "route_rebased event write fails" 2>&1 | tail -5
```

**硬阈值**: 事件写失败时函数 reject（不 resolve）；persistContract 未被调用。
**验证命令**: 见 DoD B-09 的 exit-code oracle。

---

## 已知约束（来自回归测试 + 累积 FR）

回归测试约束（`packages/brain/src/orchestrator/preflight/map-impact-contract.test.js`）：
- [map-impact-contract.test.js] → accepts only fresh same-repo same-revision contracts（`assertMapImpactContract` 严格性不得放松）
- [map-impact-contract.test.js] → materializes an active contract only from fresh same-revision Map evidence（materialize 前提不得削弱）
- [map-impact-contract.test.js] → fails before contract persistence for stale Map evidence（stale 必须在 persist 前 fail）
- [map-impact-contract.test.js] → fails closed before persistence when map and radius projection identities drift（`map_projection_changed` 守卫保持）
- [map-impact-contract.test.js] → rejects an explicit recovery request while the normal Map path is fresh（`map_recovery_not_required`）
- [map-impact-contract.test.js] → creates a server-authorized recovery contract from last-known-good evidence only after stable Map failure（recovery 通道保持）

累积 FR `[累积FR]`：（本 line 暂无历史：F1 line 现有 ability 均为 planned，无 done/working 状态）
context-manifest: N/A（PRD 累积 FR 段已显式声明本 line 无历史）

`must_run_assertions` / Unified Map radius：`[MAP_NOT_CONFIGURED]` — task.payload 未提供 map_scope/map_repo（本任务为 kernel 自身死法修复），无 radius 硬回归约束注入。

---

## 真实调用方请求 shape

N/A — 本单无「设备/agent 调服务端」新调用方；改动完全在 Brain 内部起跑预检与 dispatcher 计数路径。

---

## 禁 mock 边清单

本单涉及 **DB 写路径** 与 **状态机计数**，以下边禁在「决策/写入逻辑」层用 mock 顶替被改的那条边：

- preflight ↔ `cecelia_events`（本单**新增** `route_rebased` 写路径）— 真 PG 由 `*.pg.integration.test.js` 覆盖
- preflight ↔ `work_routing_receipts`（本单**新增** `UPDATE evidence.base_sha`）— 真 PG 由 integration 覆盖
- preflight ↔ `tasks`（本单**新增** `UPDATE payload.base_sha`）— 真 PG 由 integration 覆盖
- preflight ↔ `initiative_runs`（run-started 读判据）— 真 PG 由 integration 覆盖
- dispatcher ↔ `tasks.metadata.dispatch_fail_consecutive`（状态机计数豁免）— 真 PG 由 integration 覆盖

**执行说明（postgres=false 约束下的诚实登记）**：本 fleet attempt `runtime_resources.postgres=false`，无法起真 Postgres。故：
1. 本轮 evaluator 机器 oracle = 该模块**既有 DI 单测 seam**（fake `client.query` 按 SQL regex 分派 + 捕获），断言本单改动的**决策逻辑真跑**（祖先分流 / diverged / fail-closed / 计数豁免均为真实代码路径，非替身）与**副作用 SQL 已下发**（route_rebased INSERT + base_sha UPDATE 的 SQL 与参数被捕获断言）。`isAncestor`（git 子进程）与 `client`（DB）为**更外层边界**注入，符合「只许 mock 更外层无关依赖」。
2. **被改的那条边的真 PG 持久化**由 `packages/brain/src/__tests__/integration/map-preflight-rebase.pg.integration.test.js`（新增，`*.pg.integration.test.js` 命名）覆盖，CI 由 **brain-integration job** 起真 Postgres 跑；本 attempt 不跑（见「未覆盖真实链路清单」）。

（纯 UI/纯文档豁免不适用——本单是调度/状态机/DB 写路径。）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 系统对外承诺做什么 | 起跑预检发现 map.source_revision≠receipt base_sha 时：同源后裔且 run 未开始→重定基放行并写 route_rebased；分叉/回退/不可达→map_revision_diverged 回队；扫描器追赶→map_stale 回队；后三者均不计入 dispatch_fail_autoblock |
| **NFR（做得多好）** | 性能/可靠性/并发阈值 | 待定（PrepPRD 未指定超时/频控）；祖先判定为一次本地 git merge-base，无网络往返 |
| **Invariant（永不违反）** | 安全/一致性/幂等 | ①fail-closed 默认；仅「同源后裔且 run 未开始」放行；②禁改扫描器/manifest、不放松 impact 闸（digest/radius/assertion 校验不变）；③run 已开始绝不换基；④旧 base_sha 必须可审计 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表（base_sha 是落后同源 vs 分叉/回退） |
| **保质期（何时过期）** | 何时失效谁退役 | route_rebased 为一次性审计事件，无过期；重定基仅在本次派发窗口生效 |
| **死亡告警（停了谁知道）** | 谁多久内知道 | 若重定基逻辑失效退回旧死法，dispatch 连败→已有 `dispatch_fail_autoblock` P2 告警会重新出现（回归信号） |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | 见下方失败语义声明（默认拦截回队；重定基写失败=fail-closed 不吞错） |
| **效果确认（已发≠已生效）** | 回执方式/时限 | route_rebased 事件落库为回执；重定基后同一次预检继续 materialize active contract 即生效确认 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ base_sha 是「落后同源」还是「分叉/回退」 | A. `git merge-base --is-ancestor base_sha map_revision`; B. 比对 commit 时间戳; C. 直接信任 map | A. `git merge-base --is-ancestor`（经注入边界 isAncestor 调用） | PRD 假设三明确指定；祖先关系是同源落后的准确判据，时间戳会被 rebase/回退骗过 | 误判分叉为祖先→错误重定基到不兼容 revision（但仅 run 未开始时、且下游 impact 闸仍校验 digest/radius，风险可控）；误判祖先为分叉→回队重试（安全，仅慢一轮）。判定不可达时按分叉安全处理 |

> ⚠️ 标注说明：该判定点已由 PrepPRD/PRD「假设三」拍板采用 `git merge-base --is-ancestor`，非待确认项；⚠️ 仅标其误判方向不对称（错误放行比错误回队后果重），提示 evaluator 重点验「非祖先/不可达 → 一律安全回队」。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写库 | 是（幂等键=task_id） | 客户端重试 |
| 非祖先 / 祖先判定不可达 | 抛 `map_revision_diverged`，不重定基 | 是（下轮重扫 map 后重判） | 回 queued 等下一轮，不计 autoblock |
| map_stale（扫描器追赶） | 抛 `map_stale`（既有） | 是 | 回 queued 等下一 tick，不计 autoblock |
| run 已开始 + base_sha 落后 | 抛 `map_revision_mismatch`（原路径） | 否（run 不换基） | 走既有 fail-closed |
| route_rebased 事件写失败 | 错误向上传播，fail-closed | 是（旧 base_sha 未动，可重试） | 回 queued，绝不吞错静默继续 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本单无对外暴露 agent / 外部可写入接口，改动均为 Brain 内部服务端逻辑。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api / postgres=false → DI vitest oracle）

**journey_type**: autonomous
**target_environment**: local_api

> 本 attempt `runtime_resources.postgres=false`，无 DB_URL 注入。故 final-e2e 以两个 vitest 套件为机器 oracle（真跑本单改动的实现代码逻辑）；真 PG 写边 + 真 run 起跑属接缝，见「未覆盖真实链路清单」，由 brain-integration job 与部署后本任务自身 run 覆盖。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 起跑预检 revision 分流单测（本单核心逻辑：祖先重定基 / diverged / fail-closed / error path）
npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js 2>&1 | tee /tmp/e2e-preflight.log
grep -Eq "[1-9][0-9]* passed" /tmp/e2e-preflight.log || { echo "FAIL: preflight suite 无 passed"; exit 1; }
grep -Eq "[1-9][0-9]* failed" /tmp/e2e-preflight.log && { echo "FAIL: preflight suite 有 failed"; exit 1; }

# 2. dispatcher autoblock 豁免单测（map_revision_diverged / map_stale 不计入连败）
npx vitest run packages/brain/src/__tests__/dispatch-fail-autoblock.test.js 2>&1 | tee /tmp/e2e-dispatch.log
grep -Eq "[1-9][0-9]* passed" /tmp/e2e-dispatch.log || { echo "FAIL: dispatch suite 无 passed"; exit 1; }
grep -Eq "[1-9][0-9]* failed" /tmp/e2e-dispatch.log && { echo "FAIL: dispatch suite 有 failed"; exit 1; }

echo "✅ Golden Path 验证通过（DI 单测全绿；真 PG 写边见 brain-integration，真 run 起跑见部署后自证）"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（须为 it() 名字面子串） | 预期红证据 |
|---|---|---|---|
| 祖先重定基放行 | `packages/brain/src/orchestrator/preflight/map-impact-contract.test.js` | rebases receipt base_sha | 未实现时抛 map_revision_mismatch → FAIL（已实证 Red） |
| 分叉→diverged | 同上 | map_revision_diverged when map revision is not a descendant | 同上 FAIL（已实证 Red） |
| run 已开始不换基 | 同上 | run has already started | 实现后仍抛 map_revision_mismatch（invariant 守卫） |
| map_stale 保持 | 同上 | throws map_stale | 既有行为守卫 |
| 不可达→diverged | 同上 | unreachable ancestry as diverged | 未实现时抛 map_revision_mismatch → FAIL（已实证 Red） |
| 零变更回归 | 同上 | same-revision fresh map without route_rebased | happy-path 守卫 |
| 写事件失败 fail-closed | 同上 | route_rebased event write fails | 实现吞错则 FAIL |
| dispatcher diverged 豁免 | `packages/brain/src/__tests__/dispatch-fail-autoblock.test.js` | map_revision_diverged dispatch failure | 未豁免时计数递增 → FAIL |
| dispatcher stale 豁免 | 同上 | map_stale dispatch failure | 未豁免时计数递增 → FAIL |

> Red 实证：`npx vitest run sprints/08161917-kernel-feb6c5ad/tests/map-preflight-rebase.test.js` → 3 failed（rebase / diverged / unreachable）| 4 passed（invariant 守卫）。generator 落地时把这些用例并入 in-repo 回归测试文件，并在 dispatch-fail-autoblock.test.js 扩两条豁免用例。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `deps.isAncestor` 返回非布尔（null/undefined/字符串）时，分流是否安全落到「非后裔→map_revision_diverged」而非误放行
- 错输入: `repoFreshness.source_revision` 为非法 SHA / 空 时，是否仍 fail-closed（不重定基）
- 重复提交: 同一 task 连续两轮都落后同源 → 第二轮重定基是否幂等（新 base 已等于 map revision 时不再重复写 route_rebased）
- 中途中断: 重定基三步（写事件→UPDATE receipt→UPDATE task）中途某步抛错 → 是否 fail-closed 不留半态（不得只更新 receipt 未更新 task）
- 边界值: base_sha === map revision（相等）时不得进入重定基分支（零变更路径回归）
发现分级: P0/P1（错误放行到不兼容 base / 半态写库 / 永久锁死复发）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## 接缝清单（接缝 vs 逻辑）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 本轮状态 |
|---|--------|----------------|----------------|----------|
| 1 | `git merge-base --is-ancestor` 祖先判定 | 真实 git 仓库对象可达性 | 部署后真 run + brain-integration 用真 git；本轮单测注入 isAncestor | logic-done-pending（真 git 未在本 attempt 验） |
| 2 | route_rebased / receipt / task 真 PG 写 | 真实 Postgres 事务落库 | brain-integration job 跑 `*.pg.integration.test.js` | logic-done-pending（postgres=false 本轮不跑） |
| 3 | 真 run 起跑（main 前进后本任务自身） | live Brain 5221 + 真实 main 前进 + 真派发 | 部署后本任务 run 产出 route_rebased 事件写进本 sprint 证据目录 | logic-done-pending |

逻辑断言（环境无关，本轮 CI/单测验绿 = 真 done）：revision 分流决策、diverged/fail-closed 分支、dispatcher 计数豁免分类。

---

## 未覆盖真实链路清单

- **route_rebased 真 PG 落库 + receipt/task base_sha 真更新**：本轮 DI 单测断言副作用 SQL 已下发（fake client 捕获），**真 PG 持久化**由新增 `packages/brain/src/__tests__/integration/map-preflight-rebase.pg.integration.test.js`（`*.pg.integration.test.js` 命名）覆盖，brain-integration CI job 起真 Postgres 跑；本 fleet attempt `postgres=false` 无法执行。补位责任人/时机：brain-integration CI（merge 前必跑）。
- **真 run 起跑验证（PRD 验收 4「本任务自身 main 前进后仍能起跑」）**：需 live Brain 5221 + 真实 main 前进 + 真派发，本 attempt 无法复现。补位：部署后由本任务自身 run 产出 `route_rebased` 事件写进 sprint 证据目录（logic-done-pending）。
- **git merge-base 真判定**：本轮以注入 `isAncestor` 验分流；真 git 可达性判定由接缝 1（部署后真 run + integration）覆盖。

（以上为规则 C mock 豁免显式登记：本单单测对 DB/git 用注入边界，非对被改的决策逻辑 mock；真边覆盖已按上表落到 brain-integration 与部署自证。）
