# Bug PrepPRD：派发时重锚定 base_sha——main 每合并一次，队列里所有已路由任务全部撞 map_revision_mismatch 自动停车

## 症状
- 2026-09-23 12h 内 22 次 `triggerCeceliaRun failed: map_revision_mismatch`，5 把新刀（含 P0 9dfd873a）3 振后 `dispatch_fail_autoblock`；历史 100+ 条 autoblock 任务同源。
- 建单当天没派出去的任务，只要 main 又合并一次（一天约 10 次），就永久派不出去，直到人工重登。

## 根因（file:line 已核实）
- `work-routing-store.js:63-96`：路由收据在**建单时**冻结 `{branch, base_sha}`（base_sha=当时 `git rev-parse origin/main`）。
- 派发闸链：`dispatcher.js:848 enforceDispatchRoutingReceipt → :850 triggerCeceliaRun → executor.js:3554 → harness-skill-relay.js:272 createKernelRun → kernel-run-store.js:558 ensureMapImpactPreflight → map-impact-contract.js:259` 抛 `map_revision_mismatch` → relay 不捕获 → `executor.js:3586 {success:false, reason:'kernel_authority_not_created', error:'map_revision_mismatch'}` → `dispatcher.js:997-1032` 三振 autoblock，detail 只有 `last_error` 字符串。
- 全链无重锚定；`map_recovery` 逃生门（`map-impact-contract.js:346-361`）只对 bugfix + `lib/map-*` 路径开放。
- 收据**不可变**：`migrations/413:29-38` BEFORE UPDATE/DELETE 触发器 RAISE；`:25 UNIQUE(source,source_id,router_version)`；`supersedes_receipt_id` 有列无写者。`migrations/421:16-19` 触发器要求 `tasks.payload.routing_receipt_id` == 该任务最新收据 id。
- `workspace-spec.js:126` 与 `orchestrator/dispatcher.js:1661-1662` 分别注入 `CECELIA_BASE_SHA`(payload) / `CECELIA_ROUTING_BASE_SHA`(收据)：两者必须同事务同步。

## 修法（P0 本 PR，M1–M8）
| # | 文件 | 改动 |
|---|---|---|
| M1 | 新迁移 `migrations/4xx_work_routing_receipt_supersession.sql` | 加列 `anchor_generation int NOT NULL DEFAULT 1`；UNIQUE 改为 `(source,source_id,router_version,anchor_generation)`；`supersedes_receipt_id` 加 UNIQUE（一对一链）；带 rollback |
| M2 | 新文件 `orchestrator/preflight/base-sha-reanchor.js` | `reanchorReceiptIfEmptyBranch(client,{task,receipt,map,now})`：条件 = `work_kind==='coding_mutation'` ∧ `payload.map_recovery!==true` ∧ `created_source!=='explicit_recovery'` ∧ `!has_v2_run` ∧ 无 initiative_runs ∧ 无 harness_attempts artifact/PR ∧ 地图 `repos[repo].status==='fresh'` ∧ `source_revision!==evidence.base_sha` ∧ `metadata.base_sha_fastforward_count<5`（≥5 抛 `map_thrash`）→ `pg_advisory_xact_lock('work-route:…')` → INSERT 接班收据（复制全列，`evidence={...旧, base_sha:新, prev_base_sha:旧, resigned_at, reanchor_reason:'map_revision_advanced'}`，`supersedes_receipt_id=旧id`，`anchor_generation+1`）→ 同事务 `UPDATE tasks SET payload=payload||{routing_receipt_id:新,base_sha:新}, metadata=metadata||{base_sha_fastforward_count:n+1}` → 写 `cecelia_events work_route_reanchored` + `task_events`。有 run/artifact → 抛 `Error('needs_rebase')` 带 `code`+detail |
| M3 | `orchestrator/kernel-run-store.js:553-559` | `assertRouteSnapshotLaunchAuthority` 后、`runPreflight` 前：`authority=lockMapProjectionAuthority`、`map=readMap` 各一次；`receipt = (await reanchor(...)) ?? receipt`；authority/map 经 deps 传给 preflight（`map-impact-contract.js:253-254` 优先取 deps 已读值，避免二次读与 TOCTOU） |
| M5 | `work-routing-store.js:167-180, 233-250` | existing 查询 `ORDER BY anchor_generation DESC LIMIT 1`；sameRoute 比对 evidence 时剔除 base_sha（否则重入撞 `work_route_idempotency_conflict`） |
| M6 | `harness-skill-relay.js:272` 外层 / `executor.js:3586-3593` | `error.code==='needs_rebase'` → `{success:false, reason:'needs_rebase', reason_code:'needs_rebase', detail}`；其它 map_*/impact_* 错误 `reason_code=error.message` |
| M7 | `dispatcher.js:990-1032` | `reason==='needs_rebase'` → 直接 `blockTask(reason:'needs_rebase', detail)`、不计数、`raise('P3','needs_rebase', dedupe repo\|needs_rebase)`；autoblock detail 增 `reason_code`（`/^(map_\|impact_\|credential_)/` 命中取原串，否则 `executor_failed`）；`:974-978` task_events 同步带 reason_code。**map_*/impact_* 继续计数**（保留止血），快进循环由 M2 的 fastforward_count≥5 → `map_thrash` 兜底 |
| M8 | 新脚本 `packages/brain/scripts/reanchor-blocked-tasks.mjs` + `scheduler-jobs.js` 每 10 分钟 | 选 `status='blocked' AND blocked_reason='dispatch_fail_autoblock' AND (blocked_detail->>'reason_code'='map_revision_mismatch' OR blocked_detail->>'last_error'='map_revision_mismatch' OR blocked_detail::text LIKE '%base_sha 落后%')` → 逐条 `unblockTask` + `metadata.dispatch_fail_consecutive=0`；快进交给下次派发；`--dry-run`；台账进 task_events |

## 已拍板的判定点（主理人授权"你就解决"，据此自决并登记 judgment）
| 判定点 | 候选 | 所选 | 依据 | 误判后果 |
|---|---|---|---|---|
| "分支无提交"判据 | ① git ls-remote ② DB 事实（has_v2_run/initiative_runs/harness_attempts） | ② | kernel-v1 不 push，候选在跑场机本地，git 看不到 | 误判会毁掉留存候选与 recovery 回溯 → 任一有痕即 needs_rebase |
| 重锚定目标 revision | ① 容器 origin/main ② 地图 fact revision（authority 锁内读） | ② | preflight 比对对象就是它；容器 origin/main 已陈旧（745222e） | scanner 与 runner 的 main 分叉 → runner 启动断言（后续刀 91211a1c 同批） |
| UNIQUE 放宽方式 | ① 部分唯一索引 ② `anchor_generation` 列入键 | ② | 幂等键显式、链式追加不撞链头 | — |
| map_*/impact_* 是否免计 autoblock | ① 免计 ② 计数+reason_code | ② | 保留止血信号；快进循环另有 map_thrash 闸 | — |
| needs_rebase 出口 | ① 仅 blocked ② 派 generator-fix 到 fleet rebase | ① 本 PR；② 另立刀 | us-vps 零执行；先可见再自动化 | — |
| 跨 repo | 仅 cecelia | zenithjoy-workspace 地图恒 unknown → map_stale 不快进（行为不变） | — | — |

## 不做（另立）
- fleet 侧自动 rebase 有提交分支；runner 启动 `merge-base` 基线断言（并入 91211a1c）。

## 关联上下文
- Issue e180b05c（事实扫描链全挂 map stale）下半场；铁律 7e9a3a67 / 26793221 不冲突；决策 b6bc299f（留痕落点）与 task_events 记录一致。

## Regression Test 计划（先红后绿，永久留 CI）
- `src/orchestrator/__tests__/kernel-run-store.test.js`：`createKernelRun` 以 mock client 按 SQL 文本路由（loadActiveKernelRun→[]；receipt→`{evidence:{base_sha:A},has_v2_run:false,superseded:false,work_kind:'coding_mutation',pipeline:'harness',canonical_task_type:'harness_initiative',impact_contract_required:true,map_scope_validation_version}`；initiative_runs/harness_attempts 计数→0）、deps.readMap→fresh 且 `source_revision:B`、readRadius→1 capability+1 assertion、persistContract→active。断言：不抛；出现 `INSERT INTO work_routing_receipts` 且参数含 `supersedes_receipt_id=旧id`、evidence.base_sha=B；`UPDATE tasks SET payload` 含 base_sha:B；`work_route_reanchored` 事件。**现状抛 map_revision_mismatch → 红**。
- 同文件：harness_attempts 计数→1 → 抛 `needs_rebase` 且不 INSERT；`payload.map_recovery=true` → 不追加、仍抛 `map_revision_mismatch`；`base_sha_fastforward_count=5` → `map_thrash`；`created_source='explicit_recovery'` → 跳过快进。
- `src/__tests__/dispatch-fail-autoblock.test.js`：`mockTriggerCeceliaRun→{success:false,reason:'kernel_authority_not_created',error:'map_revision_mismatch'}` → `mockBlockTask` detail `toMatchObject({reason_code:'map_revision_mismatch'})`（现状无此字段 → 红）；`reason:'needs_rebase'` → blockTask(reason 'needs_rebase') 且计数不变。
- `work-routing-store` 测试：existing 查询取最新 generation；sameRoute 忽略 base_sha。
- 迁移 M1 有 up/down 测试（migration lint）。
- 守卫：逻辑接缝=以上 CI test；环境接缝无（本修复不新增外部调用）。

## 验收标准
- [ ] failing tests 先 commit（commit-1），修复后变绿（commit-2）；DevGate 三件套通过
- [ ] 部署后 E2E（数据写入类）：建 2 条 harness 任务 → 合并无关 PR 使 main 前进 → 两条均派出；`work_routing_receipts` 出现 generation=2 接班收据（prev_base_sha/resigned_at）；`tasks.payload.routing_receipt_id` 指向新收据；`task_events` 有 base_sha_reanchored；一条有 artifact 的任务 blocked reason=needs_rebase 且 detail.reason_code 可查
- [ ] 跑 `reanchor-blocked-tasks.mjs`：29 条停车任务回 queued 并在下次派发被快进；6 把一本账刀重登（map_scope 含 F1/G1/MJ5）后可派
- [ ] CI 全绿
