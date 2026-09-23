# 设计：派发时重锚定 base_sha（接班收据）— 2026-09-23

任务 d9c405e2 · 决策 49035988（bug-fix）· PrepPRD：`sprints/09231717-reanchor-base-sha/prep-prd.md`

## 问题

路由收据在建单时冻结 `{branch, base_sha}`（`work-routing-store.js:63-96`），派发 preflight 要求 `receipt.evidence.base_sha === 地图 fact revision`（`orchestrator/preflight/map-impact-contract.js:259`），main 每合并一次，所有已路由的 queued 任务撞 `map_revision_mismatch`，三振后 `dispatch_fail_autoblock`。收据表由触发器保证 append-only（迁移 413，只拦 UPDATE/DELETE；417 已删 `UNIQUE(task_id)` 为链式接班留门），不能原地改，只能插接班收据。

## 目标

任务分支尚无任何产出（无 kernel run、无 artifact、无 PR）时，派发前自动把路由锚快进到地图当前 revision；有产出的任务明确标 `needs_rebase`；阻塞原因结构化可统计；存量停车任务可批量恢复。

## 架构（改动单元与边界）

| 单元 | 职责 | 接口 | 依赖 |
|---|---|---|---|
| M1 迁移 `4xx_work_routing_receipt_supersession.sql` | 允许同一任务链式追加收据 | `anchor_generation int NOT NULL DEFAULT 1`；UNIQUE 改为 `(source,source_id,router_version,anchor_generation)`；`supersedes_receipt_id` UNIQUE | 413/421 保持不变（append-only 触发器、payload 投影守卫） |
| M2 `orchestrator/preflight/base-sha-reanchor.js` | 判定是否可快进并写接班收据 | `reanchorReceiptIfEmptyBranch(client, {task, receipt, map, now}) → receipt \| null`；抛 `needs_rebase` / `map_thrash` | pg 事务 client（task 行已 `FOR UPDATE`，不再另加 advisory 锁）、`cecelia_events`、`task_events` |
| M3 `orchestrator/kernel-run-store.js` | task 行 SELECT 取 `metadata`；向预检透传 `createdSource`；返回体带预检最终收据的 `base_sha`/`routing_receipt_id`；导出 `syncTaskPayloadFromKernelRun(task, created)` 供三处调用方（relay 本地/远程 kernel、headed runtime）在 createRun 后回流内存 task.payload | `createKernelRun → {created, run, base_sha, routing_receipt_id}`；`syncTaskPayloadFromKernelRun` | M4 |
| M4 `map-impact-contract.js` | 检测到 `map_revision_mismatch` 时先调 M2 快进，成功则用接班收据 `activeReceipt` 继续算半径/合同，返回体加 `receipt: activeReceipt`；M2 抛出的非 recovery 码原样上抛 | 现有 deps 注入约定 + `deps.reanchorReceipt` | M2 |
| M5 `work-routing-store.js` | 幂等回读取最新 generation；sameRoute 比对忽略 `base_sha` | 现有函数 | — |
| M6 `harness-skill-relay.js` / `executor.js` | 把 `needs_rebase` 与 `map_*`/`impact_*` 错误以 `reason_code` 结构化返回 | `{success:false, reason, reason_code, detail}` | — |
| M7 `dispatcher.js` | `needs_rebase` 直接 block（不计数、P3 去重告警）；autoblock detail 带 `reason_code`；task_events 同步 | `blockTask(reason, detail)` | task-updater、alerting |
| M8 `scripts/reanchor-blocked-tasks.mjs`（一次性回填，不做定时 job——定时解封会与 map_recovery/explicit_recovery/map_thrash 任务形成永久 churn） | 批量解锁 mismatch 停车任务并清零计数 | CLI `--dry-run` / `--resume` | task-updater.unblockTask |

## 数据流（一次派发）

```
dispatcher.tick → claim(claimed_by IS NULL) → enforceDispatchRoutingReceipt(内存 payload)
  → triggerCeceliaRun → runHarnessInitiativeRouter → createKernelRun(事务开始)
     → 读 task/receipt(含 has_v2_run/superseded) → assertRouteSnapshotLaunchAuthority
     → [M3] authority=lock; map=readMap
     → [M2] 条件全过 → INSERT 接班收据(gen+1, supersedes=旧) ; UPDATE tasks.payload{routing_receipt_id,base_sha} ; events
            条件不过 → 原 receipt 继续（地图 unknown→map_stale；有产出→throw needs_rebase）
     → ensureMapImpactPreflight(deps.authority/map) → 合同 active → INSERT initiative_runs → COMMIT
  失败 → [M6] reason_code → [M7] needs_rebase:block 不计数 ; 其它:计数+reason_code
```

## 快进条件（全部为真才快进）

`receipt.work_kind==='coding_mutation'` ∧ `task.payload.map_recovery!==true` ∧ `createdSource!=='explicit_recovery'` ∧ **无任何 `initiative_runs`**（`current_task_id=$task OR initiative_id=$task`；`harness_attempts.run_id` 是其 NOT NULL FK，artifact 只存在 attempt.result.artifacts，故此一条即覆盖 v2 run / attempt / artifact 三事实）∧ `map.freshness.repos[repo].status==='fresh'` ∧ `source_revision!==receipt.evidence.base_sha` ∧ `metadata.base_sha_fastforward_count<5`。

- 计数 ≥5 → 抛 `map_thrash`（进 autoblock 计数，detail.reason_code=map_thrash）。
- 有产出 → 抛 `needs_rebase`，detail=`{old_base_sha,new_base_sha,branch,has_v2_run}`。
- 并发：task 行 `FOR UPDATE`（kernel-run-store.js:436-442）串行化同任务，接班只在该锁内发生；INSERT 唯一键 `(source,source_id,router_version,anchor_generation)` 仅作数据完整性兜底，不单独处理 23505（撞键即整事务回滚、下 tick 重试）。
- 顺序：**先 INSERT 接班收据，后 UPDATE tasks.payload**——421 触发器按 `created_at DESC` 取最新收据比对 `routing_receipt_id`；M5 回读排序统一为 `anchor_generation DESC, created_at DESC`（接班收据 `created_at` 用 `now()`=事务开始时刻，并发下可能倒置；`anchor_generation` 单调唯一，排在前）。
- 接线行号（origin/main 745222e）：autoblock 逻辑 `dispatcher.js:1233-1272`，`failed_dispatch` 事件 `:1204-1208`；`harness-skill-relay.js:274` 不 catch，错误落 `executor.js:3606-3631` 的 catch → M6 在此读 `err.code==='needs_rebase'`。

## 错误处理

| 情形 | 行为 |
|---|---|
| 地图 unknown | 不快进，原样 `map_stale` |
| `receipt.evidence` 为 null / 无 `base_sha` | 不快进，原样 `map_context_missing` 由预检报（预检在调用本模块前已校验 base_sha，此处只是模块自身的准入契约，缺旧锚就无从写 `prev_base_sha`） |
| receipt 已被接班（`superseded=true`） | 抛 `receipt_superseded`，零写库——调用方契约违约（必须传当前生效收据），否则会插出 supersedes 分叉链被 465 唯一键拒 |
| 快进后 preflight 仍失败（如 impact_assertion_missing） | 事务回滚，接班收据不落库；reason_code 区分 |
| 收据唯一键冲突 | 事务回滚，任务留 queued，下 tick 重试 |
| needs_rebase | blocked，不计 autoblock；P3 告警 eventType=`needs_rebase`（只落日志不推送；任务一经 blocked 不再被选中，同一任务只响一次，重复上限=同 repo 停车任务数，故不按 repo 去重）；停车失败（blockTask 返回 success:false）→ P2 `needs_rebase_park_failed` |
| 批量脚本中途失败 | 逐条独立事务，`--resume` 重跑只处理仍 blocked 的 |

## 测试策略（TDD，先红后绿，永久留 CI）

- **E2E（integration，本地 vitest 走 mock client）**：`orchestrator/__tests__/kernel-run-store.test.js` 新 describe：createKernelRun 在 receipt.base_sha=A、地图 fresh 且 revision=B、无 run/artifact 时**不抛**并 INSERT 接班收据（supersedes=旧 id，evidence.base_sha=B）、UPDATE payload、写 `work_route_reanchored`；有 artifact → `needs_rebase` 且零 INSERT；`map_recovery=true` → 仍 `map_revision_mismatch`；`fastforward_count=5` → `map_thrash`；`explicit_recovery` → 跳过快进。
- **unit**：`orchestrator/preflight/base-sha-reanchor.test.js` 条件矩阵；`work-routing-store` 的 sameRoute 忽略 base_sha 与最新 generation 回读。
- **unit**：`__tests__/dispatch-fail-autoblock.test.js`：detail 含 `reason_code:'map_revision_mismatch'`；`needs_rebase` → `blockTask('needs_rebase')` 且计数不变。
- **integration（真 PG）**：仿 `src/__tests__/work-routing-validation-route.integration.test.js`：应用 M1 后，同事务 INSERT 接班收据（gen=2, supersedes=旧）→ UPDATE tasks.payload.routing_receipt_id → 421 触发器放行；只插接班收据不同步投影时，该任务后续任何 payload 写入被 421（tasks 上的 BEFORE UPDATE 触发器）拒绝、对齐后放行；二次接班先被模块 receipt_superseded 拒，绕过模块直插撞 465 唯一键 23505；EXPLAIN 断言两侧索引可用。
- **migration（trivial）**：M1 up/down SQL 正则测试（仿 migration-405 测试）。
- **部署后真验（数据写入类）**：见 PrepPRD 验收标准（接班收据 generation=2、payload 指向新收据、task_events 事件、needs_rebase 可查）。
- **守卫**：逻辑接缝=上述 CI；无新增环境接缝。

## 不做

fleet 侧自动 rebase；runner 启动 merge-base 断言（并入 91211a1c）；跨 repo 快进（zenithjoy-workspace 地图恒 unknown，行为不变）。
