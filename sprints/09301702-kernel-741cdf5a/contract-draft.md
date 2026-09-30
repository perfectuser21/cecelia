# Sprint Contract Draft (Round 2)

价值流建模⑤（收窄版）：`step_probes → probes`（+ target_type/target_id + 消费方切换）+ `journey_step_links`（cells）扩 step/enabler 级 + steps/enablers Notion 投影。**`golden_path`/`golden_paths`/`golden_path_contract_versions` 三表退役已按 Round 1 Reviewer 方案 A 收窄出本 sprint，独立成 Brain task `3e60816d-81d9-439f-8820-a764c7f953f3`**（见 `## golden_path* 退役 deferral`）。

**锚定父路声明**：独立小路（无父路）——本 sprint 为价值流建模基础设施迁移（决策 3e867cad 第 11/13 张表 + 收尾），PRD `journey_id: none`、`step_id: none`，无父 Golden Path 依赖。

**journey_type**: autonomous
**target_environment**: local_api
**target_environment 理由**: 纯 `packages/brain/`（migrations + src 投影/消费方切换），验收用 `psql`（$DB_URL）+ `node` 脚本，无 UI / 无微信 / 无远端机器。

`gp-anchor: skipped (product-map.json not found)`（cecelia 仓无 `product-map/generated/product-map.json`，GP-Anchor 段跳过不阻塞）。

`contract-gate: skipped (file not found, third-party repo)` 判定：`packages/brain/src/lib/contract-gate.js` 若不存在则跳代码层 gate，仅走 skill 内置规则。（cecelia 为本仓，若存在则按原逻辑走。）

---

## Round 2 修订说明（案卷 closure — 对 Round 1 Reviewer blocker 逐条关闭）

Round 1 判定 REVISION，两条 blocker 均源于 **golden_path\* 三表退役的影响面在 scope 内无合法达成路径**。本轮采纳 Reviewer 明列的 **方案 A（推荐）**：收窄 scope（只做 probes / cells / Notion 投影），golden_path\* 退役独立成 Brain task。逐条 closure 见 `## 案卷 closure 声明`。

**净变化（B50 精简纪律）**：本轮相对 Round 1 **删多于加**——删除 Golden Path Step 4（DROP golden_path\*）、DoD B-04/B-05（to_regclass NULL + golden_path\* 零残留 grep）、禁 mock 边的 golden_path\* 边、E2E 的 golden_path\* 段、两份冻结测试的 golden_path\* 断言块；新增 golden_path\* deferral 段（带 task_id）+ 把 Round 1 已隐含但未列全的 `step_probes` RENAME 消费方切换补成**完整清单 + 一条已声明文件集内的 grep 闸**（这是 R1-1「zero-residue 门禁必须配完整影响面清单」的同款纪律，应用到本 sprint 唯一保留的 rename）。合同行数下降。

---

## Unified Map 半径

`[MAP_NOT_CONFIGURED]` — task.payload.map_scope=`["MJ5"]` 存在但无 `expected_files` 注入，`/api/brain/map/radius` 无从计算受影响业务节点半径；`must_run_assertions` 为空，回归约束来自下方「已知约束」与 Invariant 段，不回退领域硬编码。

---

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应（纯 DB 迁移 + 脚本投影 + 消费方 SQL 表名切换）。验收全部走 `psql`（schema/数据断言）与 `node`/`grep`（脚本执行 + 残留断言），无新增 REST 端点、无改现有端点响应 shape（routes/step-probes.js 仅内部 SQL 表名 step_probes→probes，列与响应 shape 不变）。Reviewer 第 6 维按 N/A 计。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①`step_probes` RENAME→`probes`，加 `target_type`(activity\|step\|enabler)+`target_id`，旧行回填 target_type='activity'，**并把所有活跃消费方 SQL 表名 step_probes→probes 切换**（routes/step-probes.js / notion-probe-projection.js / lib/business-probe-judge.js / ops-notion-schema.js + notion_projection_map 登记行 + notion-probe smoke）；②`journey_step_links` 加 `target_type`+`target_id`，允许 cell 指向 steps.id/enablers.id；③steps/enablers 注册进 `notion_projection_map` 并投影进 Notion 承诺地图（回执/digest 落库） |
| **NFR（做得多好）** | 性能/可靠性 | 迁移幂等可重跑（RENAME 用 IF EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING）；迁移后 selfcheck `MAX(schema_version) >= EXPECTED_SCHEMA_VERSION` 绿；无显式延迟/频控要求 |
| **Invariant（永不违反）** | 不变量 | [探针零丢失] RENAME 保数据、up 段无 `DROP TABLE step_probes`（INV-4）；[枚举单份] target_type 枚举值单份定义（INV-1）；[幂等CAS]/[jsonb浅合并] 见 Invariant 段（本 sprint N/A 说明） |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见「判定点登记表」 |
| **保质期（何时过期）** | 何时失效 | `step_probes` 表名本 sprint 退役（改名 `probes`，消费方随动）；Notion 投影回执随 digest 刷新；`golden_path*` 三表退役 deferral 到 task 3e60816d |
| **死亡告警（停了谁知道）** | 告警手段 | Notion 投影失败 → 写 Brain log（`console.error`/日志行），不静默假成功（NFR、边界④）；迁移失败 → `runMigrations` 抛错、schema_version 不前进、selfcheck 转红；消费方漏切 → 冻结测试 grep 闸 RED（合同阶段拦） |
| **失败语义（挂了怎么办）** | 故障策略 | 见「失败语义声明」 |
| **效果确认（已发≠已生效）** | 回执确认 | Notion 投影以「回执/digest 落库 + 无失败日志」确认；迁移以「to_regclass/列/CHECK/count psql 断言」确认；消费方切换以「活跃 src grep step_probes SQL 零残留」确认 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ 旧探针是否零丢失迁入 probes | A. RENAME 原表（数据物理保留）; B. CREATE probes + INSERT SELECT 复制再 DROP step_probes | A. RENAME | RENAME 不复制数据、不可能漏行；复制方案有 WHERE/批次漏行风险 | 误判为零丢失但实际丢探针 → 归位断言永久失灵（面客灰格）；标 ⚠️ 属升拍板级，见 notes |
| ⚠️ step_probes RENAME 后消费方是否全部切到 probes | A. 活跃 src grep `(FROM\|INTO\|UPDATE\|JOIN) step_probes` + `step_probes\.` 零残留 + 完整消费方清单逐文件核对; B. 只改投影脚本、其余 DROP 后观察 | A. grep 零残留闸 + 完整清单 | step_probes 有明确承接表 probes（同列 + 两新可空列），切换是机械改表名、无响应 shape/前端契约变更；grep 是确定性前置闸 | 漏切 routes/step-probes.js 等 → RENAME 后运行时 500（与 R1 golden_path* 同类，故本轮补全清单） |
| Notion 投影目标外部不可达时算成功还是失败 | A. 无 token/HTTP 失败 → 写 log 且不落假回执; B. 吞错静默 return | A. 写 log 不假成功 | NFR/边界④ 明令不得静默假成功 | 静默假成功 → 承诺地图与真相漂移，主理人看到空 steps/enablers 却以为已投影 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写 DB | 是（幂等键=task_id） | 客户端重试 |
| migration 中途失败 | `runMigrations` 抛错、事务回滚、schema_version 不前进 | 是（RENAME IF EXISTS / ADD IF NOT EXISTS / ON CONFLICT DO NOTHING，重跑不覆盖） | 修复后重跑迁移 |
| Notion 投影目标不可达 | 写 Brain log（错误行）、该目标不落假回执、Postgres 保持真相源 | 是（按 digest 指纹去重，重跑只补差） | 记录失败，下轮投影链重试 |
| step_probes RENAME 后消费方仍读旧表名 | 应在同一 sprint 内已全部切换（前置 grep 闸）；若漏 → 运行时报表缺失错误（非静默） | N/A（表名切换一次性） | 冻结测试 grep 闸在合同阶段 RED 拦截 |

### 输入对抗面

N/A — 本 sprint 无对外暴露 agent / 无外部用户可写入接口，纯内部 DB 迁移 + 投影脚本 + 消费方 SQL 表名切换。

---

## 已知约束

**回归测试约束（Step 1.2，来源 migration 474/478/492 结构测试 + selfcheck 测试）**：
- `migration-474-step-probes.test.js` / `scripts/smoke/step-probes-smoke.sh` → step_probes 结构（probe_key UNIQUE、severity/spec_hash CHECK ^[0-9a-f]{64}$、FK journey_step_links）——本 sprint RENAME 后对应断言应迁移到 `probes`（名变、列增），不得让 474 探针语义丢失；474/476/478 历史迁移文件不可改（RENAME 在新迁移 493+ 里做）。
- `scripts/smoke/notion-probe-projection-smoke.sh` → mock 断言 `FROM step_probes sp`——notion-probe-projection.js 改 `FROM probes sp` 后本 smoke 需随动更新（列进影响面清单）。
- `migration-492-steps-enablers.test.js` → steps/enablers/enabler_calls 结构（本 sprint **不得重建/回退**这三表，累积 FR）。
- `selfcheck.test.js` → `EXPECTED_SCHEMA_VERSION` 与 `MAX(schema_version)` 比较逻辑（迁移推进后仍须绿：`DB max >= expected`）。

**累积 FR（Step 1.3）**：
- `context-manifest: unavailable`（无 journey_id 注入，`/api/brain/line/<journey_id>/context-manifest` 无从查询）。
- migration 492（steps/enablers/enabler_calls）已落地为基线，本 sprint 只在其上扩 cells/probes 挂点与投影，不重建。

**铁律清单映射（Step 1.3）**：见下方 Invariant 段 INV-1..INV-4 逐条映射。

---

## 禁 mock 边清单

本单改动涉及 **DB 写路径**（migrations 改表 + probes/cells 写路径）、**跨模块数据传递**（steps/enablers → notion_projection_map 投影链；step_probes→probes 表名跨消费方切换）。failing test 对这些边必须真 Postgres、不 mock：

- 代码 ↔ `probes` 表（本单 RENAME `step_probes`→`probes` 且加 target_type/target_id 写路径，测试必须真 Postgres 验列存在 + CHECK 生效 + target_type 回填 activity）
- 代码 ↔ `journey_step_links` 表（本单加 target_type/target_id 扩 step/enabler 级写路径，测试必须真 Postgres 验可插入指向 steps.id/enablers.id 的 cell）
- 代码 ↔ `steps` / `enablers` 表 → `notion_projection_map`（本单新增两投影目标，测试必须真 Postgres 验 registry 行存在且 active）

对应真 PG 测试落 `packages/brain/src/__tests__/integration/migration-493-probes-cells.pg.integration.test.js` 并登记进 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS`（brain-integration job 起真 Postgres 跑）。sprint 冻结结构测试（`sprints/09301702-kernel-741cdf5a/tests/`）读迁移 SQL / src 文件做确定性断言，与真 PG 测试互补。

（golden_path\* 相关的边随退役 deferral 一并移出本清单，见 `## golden_path* 退役 deferral`。）

## 真实调用方请求 shape

N/A — 本 sprint 无设备/agent 调服务端的真实调用方（纯内部迁移 + 脚本投影 + 消费方切换）。

## 未覆盖真实链路清单

- **Notion 真实 API 推送**｜autonomous CI/Fleet 无 Notion token，且 Notion 为外部不可达面（边界④）｜真验证补位：投影 **wiring** 由本合同覆盖（`notion_projection_map` 新增 steps/enablers active 行 + 投影函数真跑产结构化结果 + 失败写 log 不假成功，均可机检）；**真实 push** 由 nightly `integration-nightly.yml` / 主理人手动带 token 环境验证，不在本 autonomous 轮阻塞。controller 请把本条呈现进 PR 描述。

---

## 案卷 closure 声明（Round 1 Reviewer blocker 逐条关闭）

> propose_round=2；对 `inputs.case_file` 中 Round 1 reviewer（attempt afd02ffc）的 R1-1 / R1-2 两条 blocker 逐条 closure。closure 引用本轮合同新增/修改后的原文片段（≥20 字）。

### R1-1（internal_consistency）— golden_path\* 退役影响面枚举不全，与 B-05 零残留门禁矛盾

**closure**：采纳方案 A，**本 sprint 不再退役 golden_path\***——彻底删除 Golden Path Step 4（DROP 三表）、DoD B-04（to_regclass NULL）、B-05（golden_path\* 活跃 src 零残留 grep 闸）、禁 mock 边的 golden_path\* 边、E2E 的 golden_path\* DROP+残留段、两份冻结测试的 golden_path\* 断言。既无 DROP 也无零残留门禁，「门禁与不完整影响面清单」的矛盾从根上消失。golden_path\* 退役连同 12 文件完整影响面清单转入独立 Brain task（见下）。
quote: `**`golden_path`/`golden_paths`/`golden_path_contract_versions` 三表退役已按 Round 1 Reviewer 方案 A 收窄出本 sprint，独立成 Brain task `3e60816d-81d9-439f-8820-a764c7f953f3``

### R1-2（risk_registered）— DROP 击穿 dashboard 消费的 /api/brain/golden-paths，且本 sprint 无合法「切到新表」承接；缺带 task_id 的 deferral

**closure**：本 sprint 不 DROP 任何 golden_path\* 表 → `/api/brain/golden-paths`（routes/golden-paths.js）及 dashboard StrategistPage/GPVersionTable/ReportDetailPage 4+ 页面消费方**不受影响、无 500 风险**。退役工作已建 Brain task `3e60816d-81d9-439f-8820-a764c7f953f3`（task_type=dev，status=queued/backlog，payload 记 deferred_from_task=741cdf5a、12 文件 impacted_files、需先解 PRD「Dashboard UI 变更」冲突或定义 GP-蓝图承接表），task_id 已写进合同——满足 rule 19（禁只写「留给后续 sprint」无跟进项）。判定点登记表已移除「golden_path\* 无活跃依赖可安全 DROP」的错误结论。
quote: `退役工作已建 Brain task `3e60816d-81d9-439f-8820-a764c7f953f3`（task_type=dev，status=queued/backlog，payload 记 deferred_from_task=741cdf5a、12 文件 impacted_files`

---

## golden_path* 退役 deferral（Round 2 收窄 — 方案 A）

**决定**：`golden_path` / `golden_paths` / `golden_path_contract_versions` 三张旧表的退役与代码残留清理，**移出本 sprint**，转入独立 Brain task。

- **跟进 task_id**：`3e60816d-81d9-439f-8820-a764c7f953f3`（Brain `/api/brain/tasks`，task_type=dev，payload.deferred_from_task=`741cdf5a-1043-45b9-9612-1a6ae2fce4d1`、payload.deferred_from_sprint=`sprints/09301702-kernel-741cdf5a`、decision_refs=`["3e867cad"]`）
- **完整影响面清单（~50 行 / 12 活跃 src 文件，退役 task 必须逐一处理）**：
  1. `packages/brain/src/routes/golden-paths.js` — 对外 `/api/brain/golden-paths` 实时 REST（GET candidate/converged/proposed + POST action），dashboard 4+ 页面消费；DROP 前须定去向（迁新表 / 端点下线 + 前端联动）
  2. `packages/brain/src/routes/abilities.js` — `golden_path`（单数）CRUD
  3. `packages/brain/src/impact-contract/assertion-receipts.js` — JOIN golden_paths / golden_path_contract_versions
  4. `packages/brain/src/golden-path-contracts.js` — golden_paths / golden_path_contract_versions 读写主体
  5. `packages/brain/src/battle-report.js`；6. `direction-proposer.js`；7. `capture-triage.js`；8. `gp-shelf-life.js`；9. `harness-line-context.js`（JOIN golden_path 单数）；10. `ledger-hygiene.js`；11. `harness-promote-regression.js`（DELETE/INSERT golden_path 单数）；12. harness identity 对 golden_path_contract_versions 的引用
- **为何 deferral（PRD 冲突消解）**：PRD「不在范围内: Dashboard UI 变更」与 PRD 边界情况③「有活跃依赖则先切到新表」在 `golden_paths` 蓝图实体上冲突——本 sprint 的价值流新表 `steps`/`enablers` 是「活动步骤」概念，**并非** GP 蓝图实体（golden_paths）的承接表，故 B-05 零残留门禁在本 sprint scope 内无合法达成路径。退役需先由该 task 定义蓝图承接表或端点下线方案（并 PRD 先解 Dashboard 冲突）。

---

## Golden Path

覆盖父路：独立小路（无父路）。

[运维者执行本 sprint 迁移 + 消费方切换] → [probes 重挂点 / cells 扩级 / steps-enablers Notion 投影] → [探针精确落 step/enabler 级、旧探针零丢失、承诺地图现 steps/enablers、DevGate + selfcheck 绿]

---

### Step 1: 执行迁移 493+ —— `step_probes` RENAME→`probes` + target_type/target_id + 回填 + 消费方切换
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（step_probes 更名/改造为 probes）+ 边界情况②（旧探针 100% 迁入、计数一致、零丢失）+ 边界情况③（退役/更名前确认无活跃依赖，有则先切，避免运行时 500）+ Invariant [探针零丢失]

**可观测行为**: 迁移后 `to_regclass('probes')` 非 NULL、`to_regclass('step_probes')` 为 NULL；`probes` 有 `target_type`（CHECK IN activity|step|enabler，NOT NULL DEFAULT 'activity'）+ `target_id`（uuid，可空）列；迁移用 **RENAME**（不复制数据、up 段不 DROP 原表），旧行按 target_type='activity' 就位、零丢失。**所有活跃 src 消费方 SQL 表名由 step_probes 切到 probes**（routes/step-probes.js / notion-probe-projection.js / lib/business-probe-judge.js / ops-notion-schema.js），`notion_projection_map` 中 `brain_table='step_probes'` 登记行 UPDATE 为 `'probes'`，`notion-probe-projection.js` 不再出现 `step_probes` 字面。

**验证命令**:
```bash
# probes 就位、step_probes 消失
psql "$DB_URL" -tAc "SELECT to_regclass('probes') IS NOT NULL AND to_regclass('step_probes') IS NULL" | grep -qx t
# target_type/target_id 列
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='probes' AND column_name IN ('target_type','target_id')" | grep -qx 2
# 迁移用 RENAME、up 迁移无 DROP TABLE step_probes（零丢失结构保证）
grep -REl "ALTER TABLE (IF EXISTS )?step_probes RENAME TO probes" packages/brain/migrations/*.sql >/dev/null
! grep -RE "DROP TABLE (IF EXISTS )?step_probes" packages/brain/migrations/*.sql | grep -v rollback
# 消费方切换：活跃 src 无 step_probes 表 SQL 残留（排除 __tests__ / 注释）
! grep -REn "(FROM|INTO|UPDATE|JOIN)[[:space:]]+step_probes\b|step_probes\." packages/brain/src --include=*.js | grep -v "__tests__" | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*)"
```

**硬阈值**: `probes` 存在且 `step_probes` 不存在；target_type/target_id 两列齐；CHECK 接受 activity/step/enabler 拒绝其他；迁移含 RENAME 且 up 段无 `DROP TABLE step_probes`；活跃 src 无 step_probes 表 SQL 残留。

---

### Step 2: `journey_step_links`（cells）扩 step/enabler 级
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（cell 允许指向 steps.id / enablers.id，进 map_projection 与 Notion 承诺地图链）

**可观测行为**: `journey_step_links` 加 `target_type`（CHECK IN activity|step|enabler，NOT NULL DEFAULT 'activity'）+ `target_id`（uuid，可空）；既有 cell 回填 target_type='activity'（不丢现有格子）；可插入指向真实 `steps.id`/`enablers.id` 的 cell 且非法 target_type 被 CHECK 拒绝。

**验证命令**:
```bash
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='journey_step_links' AND column_name IN ('target_type','target_id')" | grep -qx 2
# CHECK 生效：约束存在
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.check_constraints WHERE constraint_name LIKE '%journey_step_links%target_type%'" | grep -qE "^[1-9]"
```

**硬阈值**: 两列齐；target_type CHECK 存在且拒非法值；既有 cell target_type 非 NULL（回填 activity）。

---

### Step 3: steps/enablers Notion 投影 + 回执
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条（sync-steps + Notion projection 把 steps/enablers 投影进承诺地图，回执写投影链）+ NFR「投影失败写 log 不假成功」

**可观测行为**: `notion_projection_map` 出现 steps 与 enablers 两个投影目标行（active，direction push/both）；投影函数对 steps/enablers 真跑产结构化结果（回执/digest 落库或结构化返回）；外部不可达时写 Brain log、不落假回执（`console.error`/日志行 + 不 return 假成功）。真实 Notion push 见「未覆盖真实链路清单」。

**验证命令**:
```bash
# notion_projection_map 有 steps + enablers active 投影行
psql "$DB_URL" -tAc "SELECT count(*) FROM notion_projection_map WHERE brain_table IN ('steps','enablers') AND status='active' AND direction IN ('push','both')" | awk '{if($1>=2)exit 0;else exit 1}'
# 投影入口脚本存在
test -f packages/brain/scripts/sync-steps-from-workspace.mjs
```
> 注：`notion_projection_map` 列名（brain_table/status/direction）以迁移 450/478/488 实际列为准（已核实：notion_db_id/title/face/brain_table/direction/vessel/status/space/notes）；generator 若列名不同须在本合同同步修正断言列名（见 Test Contract 冻结测试锚定）。

**硬阈值**: steps + enablers 投影行 ≥ 2 且 active；投影脚本存在；失败路径有 log、无静默假成功。

---

### Step 4: 出口可观测 —— DevGate 三闸 + selfcheck 绿
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条 + NFR「selfcheck schema 版本绿」

**可观测行为**: `facts-check.mjs` / `check-version-sync.sh` / `check-dod-mapping.cjs` 三闸退 0；`MAX(schema_version) >= EXPECTED_SCHEMA_VERSION` 且新迁移（≥493）已登记 schema_version。

**验证命令**:
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
psql "$DB_URL" -tAc "SELECT (SELECT MAX(version::int) FROM schema_version WHERE version ~ '^[0-9]{1,4}$') >= 493" | grep -qx t
```

**硬阈值**: 三闸全退 0；schema_version 最大值 ≥ 493。

---

## Invariant 约束（铁律逐条映射）

- **INV-1 [枚举单份]**：`target_type` 枚举语义常量（activity|step|enabler）只允许一份，落在被各消费方共同 import 的 service（如 `packages/brain/src/` 下一处 const），禁止手抄同值副本。验证：全库对该枚举字面三元组的 JS 定义仅一处（DoD 段 INV-1 条目）。
- **INV-2 [幂等CAS]**：本 sprint 无「SELECT 判态再 UPDATE」状态机改动（DDL 迁移 + 投影 + 消费方切换）。迁移幂等靠 RENAME IF EXISTS / ADD IF NOT EXISTS / ON CONFLICT DO NOTHING 实现，重跑不覆盖。→ CAS 状态机层面 **N/A：本 sprint 不改任务/探针状态迁移路径**。
- **INV-3 [jsonb浅合并]**：Notion 投影若把回执写进任务 `result`，必须用固定子键（receipt）浅合并、不覆盖 payload。本 sprint 投影回执落投影链 digest 列/结构化返回、不写任务 result → **N/A：本 sprint 投影不触达任务 result.payload**（若 generator 改为写 result 须遵此浅合并）。
- **INV-4 [探针零丢失]**：`step_probes` 迁入 `probes` 后计数一致、禁止丢探针。验证：迁移用 RENAME（不复制、up 段不 DROP 原表），真 PG roundtrip 验行保留（DoD 段 INV-4 + 集成测试）。

---

## E2E 验收（local_api — 由 evaluator 独立 final-e2e task 执行）

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"

# 1. 对本 attempt 空库跑仓库真实全量迁移（含本 sprint 新增 493+），机检目标表就位
node packages/brain/src/migrate.js
psql "$DB_URL" -tAc "SELECT to_regclass('probes') IS NOT NULL" | grep -qx t

# 2. probes 重挂点：step_probes 消失、target_type/target_id 列 + CHECK
psql "$DB_URL" -tAc "SELECT to_regclass('probes') IS NOT NULL AND to_regclass('step_probes') IS NULL" | grep -qx t
COLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='probes' AND column_name IN ('target_type','target_id')" | tr -d ' ')
[ "$COLS" = "2" ] || { echo "FAIL: probes 缺 target_type/target_id 列 (got $COLS)"; exit 1; }
# CHECK 拒非法 target_type：插一行合法（默认 activity）+ 一行非法（应失败）
psql "$DB_URL" -c "INSERT INTO probes (probe_key,workflow,stage,spec,spec_hash,target_type,target_id) VALUES ('e2e-legacy','wf','st','{}'::jsonb,repeat('a',64),'activity',gen_random_uuid()) ON CONFLICT (probe_key) DO NOTHING"
psql "$DB_URL" -tAc "SELECT target_type FROM probes WHERE probe_key='e2e-legacy'" | grep -qx activity
if psql "$DB_URL" -c "INSERT INTO probes (probe_key,workflow,stage,spec,spec_hash,target_type) VALUES ('e2e-bad','wf','st','{}'::jsonb,repeat('b',64),'bogus')" 2>/dev/null; then
  echo "FAIL: target_type CHECK 未拒绝非法值 bogus"; exit 1
fi
# 迁移结构：RENAME 存在、up 段无 DROP step_probes（零丢失）
grep -REl "ALTER TABLE (IF EXISTS )?step_probes RENAME TO probes" packages/brain/migrations/*.sql >/dev/null || { echo "FAIL: 缺 RENAME step_probes->probes"; exit 1; }
if grep -RE "DROP TABLE (IF EXISTS )?step_probes" packages/brain/migrations/*.sql | grep -v rollback; then echo "FAIL: up 迁移含 DROP TABLE step_probes（丢探针风险）"; exit 1; fi

# 3. 消费方切换：活跃 src 无 step_probes 表 SQL 残留（RENAME 后不 500 的前置闸）
if grep -REn "(FROM|INTO|UPDATE|JOIN)[[:space:]]+step_probes\b|step_probes\." packages/brain/src --include=*.js | grep -v "__tests__" | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*)"; then
  echo "FAIL: 活跃 src 仍有 step_probes 表 SQL 残留（RENAME 后运行时 500 风险）"; exit 1
fi

# 4. cells 扩 step/enabler 级：journey_step_links 加 target_type/target_id
JCOLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='journey_step_links' AND column_name IN ('target_type','target_id')" | tr -d ' ')
[ "$JCOLS" = "2" ] || { echo "FAIL: journey_step_links 缺 target_type/target_id (got $JCOLS)"; exit 1; }

# 5. steps/enablers Notion 投影 wiring：notion_projection_map 有两投影目标 active
NP=$(psql "$DB_URL" -tAc "SELECT count(*) FROM notion_projection_map WHERE brain_table IN ('steps','enablers') AND status='active' AND direction IN ('push','both')" | tr -d ' ')
[ "$NP" -ge 2 ] || { echo "FAIL: notion_projection_map 缺 steps/enablers active 投影行 (got $NP)"; exit 1; }
test -f packages/brain/scripts/sync-steps-from-workspace.mjs || { echo "FAIL: sync-steps 脚本缺失"; exit 1; }

# 6. schema_version 前进 + selfcheck 绿
psql "$DB_URL" -tAc "SELECT (SELECT MAX(version::int) FROM schema_version WHERE version ~ '^[0-9]{1,4}$') >= 493" | grep -qx t || { echo "FAIL: schema_version 未前进到 >=493"; exit 1; }

# 7. DevGate 三闸
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs

echo "✅ Golden Path 验证通过（probes 重挂点+消费方切换 / cells 扩级 / Notion 投影 wiring / DevGate 绿）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（本 sprint 为迁移 + 表名切换，回归面高，按默认）
高风险面:
- 错输入: 向 `probes.target_type` / `journey_step_links.target_type` 插入非枚举值（如 `'stepp'`/空串），应被 CHECK 拒绝而非静默落库
- 重复提交: 重跑 `node packages/brain/src/migrate.js` 两次，第二次应 0 变更、不报错（幂等）；重跑不得把已改的 target_type 覆盖回默认；RENAME IF EXISTS 二次重跑不因 step_probes 已改名报错
- 中途中断: 迁移执行到一半中断——重跑应能续跑且不因表已改名报错（IF EXISTS 幂等）
- 边界值: `step_probes` 改名后触发 routes/step-probes.js（GET /list、POST upsert）、notion-probe-projection.pushStepProbes、business-probe-judge 相关路径（若可无副作用触发），确认不因表名切换 500；历史 assertion_ref `probe:<key>` 仍能被解析（改名不破坏 cell 断言链）
发现分级: P0/P1（丢探针 / RENAME 后运行时 500 / 静默假投影）→ 阻塞 merge；P2/P3（日志措辞、非关键列命名）→ 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| probes 重挂点 + cells 扩级（迁移结构，冻结） | `sprints/09301702-kernel-741cdf5a/tests/migration-probes-cells.test.ts` | RENAME step_probes 到 probes、probes target_type CHECK activity step enabler、journey_step_links target_type target_id、schema_version 493 | → 迁移文件无对应 DDL → 多条 fail |
| 消费方切换 + Notion 投影 wiring（src grep，冻结） | `sprints/09301702-kernel-741cdf5a/tests/projection-and-cleanup.test.ts` | 活跃 src 无 step_probes 表 SQL 残留、notion-probe-projection 引用 probes 非 step_probes、notion_projection_map 注册 steps enablers | → 现有 step_probes 残留/未注册 → 多条 fail |
| probes/cells 真 Postgres roundtrip（补充，真 PG） | `packages/brain/src/__tests__/integration/migration-493-probes-cells.pg.integration.test.js` | probes target_type 回填 activity、CHECK 拒非法、journey_step_links step enabler cell 插入 | → 迁移未落 → 真库断言 fail |

> Test File 列均为完整真实路径。冻结测试至少一行落 `sprints/09301702-kernel-741cdf5a/tests/`（本 sprint 两份结构测试均在此，已落盘并进 commit）；`packages/...` 真 PG 测试为补充行，并登记进 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS`。
> BEHAVIOR 覆盖名均为对应 `it()` 名的字面子串。
