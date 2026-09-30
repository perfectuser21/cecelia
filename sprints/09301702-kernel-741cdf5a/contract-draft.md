# Sprint Contract Draft (Round 1)

价值流建模⑤：`step_probes → probes`（+ target_type/target_id）+ `journey_step_links`（cells）扩 step/enabler 级 + steps/enablers Notion 投影 + `golden_path`/`golden_paths`/`golden_path_contract_versions` 三张旧表退役。

**锚定父路声明**：独立小路（无父路）——本 sprint 为价值流建模基础设施迁移（决策 3e867cad 第 11/13 张表 + 收尾），PRD `journey_id: none`、`step_id: none`，无父 Golden Path 依赖。

**journey_type**: autonomous
**target_environment**: local_api
**target_environment 理由**: 纯 `packages/brain/`（migrations + src 投影/清理），验收用 `psql`（$DB_URL）+ `node` 脚本，无 UI / 无微信 / 无远端机器。

`gp-anchor: skipped (product-map.json not found)`（cecelia 仓无 `product-map/generated/product-map.json`，GP-Anchor 段跳过不阻塞）。

`contract-gate: skipped (file not found, third-party repo)` 判定：`packages/brain/src/lib/contract-gate.js` 若不存在则跳代码层 gate，仅走 skill 内置规则。（cecelia 为本仓，若存在则按原逻辑走。）

---

## Unified Map 半径

`[MAP_NOT_CONFIGURED]` — task.payload 无 `map_scope`/`map_repo` 注入（本 sprint 为 schema 迁移基础设施，非业务地图节点半径任务）；`must_run_assertions` 为空，回归约束来自下方「已知约束」与 Invariant 段，不回退领域硬编码。

---

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应（纯 DB 迁移 + 脚本投影 + 代码清理）。验收全部走 `psql`（schema/数据断言）与 `node`（脚本执行断言），无新增 REST 端点。Reviewer 第 6 维按 N/A 计。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①`step_probes` RENAME→`probes`，加 `target_type`(activity\|step\|enabler)+`target_id`，旧行回填 target_type='activity'；②`journey_step_links` 加 `target_type`+`target_id`，允许 cell 指向 steps.id/enablers.id；③steps/enablers 注册进 `notion_projection_map` 并投影进 Notion 承诺地图（回执/digest 落库）；④DROP `golden_path`/`golden_paths`/`golden_path_contract_versions`，清理 src 对三表的活跃读写 |
| **NFR（做得多好）** | 性能/可靠性 | 迁移幂等可重跑（RENAME/ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING）；迁移后 selfcheck `MAX(schema_version) >= EXPECTED_SCHEMA_VERSION` 绿；无显式延迟/频控要求 |
| **Invariant（永不违反）** | 不变量 | [探针零丢失] RENAME 保数据、迁后 `count(probes)`≥迁前 `count(step_probes)`、无 `DROP TABLE step_probes`（见 Invariant 段 INV-4）；[枚举单份] target_type 枚举值单份定义（INV-1）；[幂等CAS]/[jsonb浅合并] 见 Invariant 段 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见「判定点登记表」 |
| **保质期（何时过期）** | 何时失效 | `golden_path*` 三表本 sprint 退役（永久 DROP）；`step_probes` 名本 sprint 退役（改名 `probes`）；Notion 投影回执随 digest 刷新 |
| **死亡告警（停了谁知道）** | 告警手段 | Notion 投影失败 → 写 Brain log（`console.error`/日志行），不静默假成功（NFR 约束、边界情况④）；迁移失败 → `runMigrations` 抛错、schema_version 不前进、selfcheck 转红 |
| **失败语义（挂了怎么办）** | 故障策略 | 见「失败语义声明」 |
| **效果确认（已发≠已生效）** | 回执确认 | Notion 投影以「回执/digest 落库 + 无失败日志」确认；迁移以「to_regclass/列/CHECK/count psql 断言」确认；旧表退役以「to_regclass IS NULL + src grep 零残留」确认 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ 旧探针是否零丢失迁入 probes | A. RENAME 原表（数据物理保留）; B. CREATE probes + INSERT SELECT 复制再 DROP step_probes | A. RENAME | RENAME 不复制数据、不可能漏行；复制方案有 WHERE/批次漏行风险 | 误判为零丢失但实际丢探针 → 归位断言永久失灵（面客灰格）；标 ⚠️ 属升拍板级，见 notes |
| golden_path* 是否无活跃代码依赖可安全 DROP | A. src grep `(FROM\|INTO\|UPDATE\|JOIN) golden_paths?`+`golden_path_contract_versions` 零残留后再 DROP; B. 直接 DROP 观察是否 500 | A. grep 零残留门禁 + DROP 前置切换 | 直接 DROP 会运行时 500（边界③）；grep 是确定性前置闸 | 残留读写未清 → DROP 后 battle-report/direction-proposer/capture-triage/harness identity 运行时 500 |
| Notion 投影目标外部不可达时算成功还是失败 | A. 无 token/HTTP 失败 → 写 log 且不落假回执; B. 吞错静默 return | A. 写 log 不假成功 | NFR/边界④ 明令不得静默假成功 | 静默假成功 → 承诺地图与真相漂移，主理人看到空 steps/enablers 却以为已投影 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写 DB | 是（幂等键=task_id） | 客户端重试 |
| migration 中途失败 | `runMigrations` 抛错、事务回滚、schema_version 不前进 | 是（RENAME/ADD IF NOT EXISTS / ON CONFLICT DO NOTHING，重跑不覆盖） | 修复后重跑迁移 |
| Notion 投影目标不可达 | 写 Brain log（错误行）、该目标不落假回执、Postgres 保持真相源 | 是（按 digest 指纹去重，重跑只补差） | 记录失败，下轮投影链重试 |
| golden_path* DROP 时残留代码仍读该表 | 应在 DROP 前已切换/删除（前置 grep 门禁）；若漏 → 运行时报表缺失错误（非静默） | N/A（DROP 一次性） | DROP 前 grep 零残留是硬前置 |

### 输入对抗面

N/A — 本 sprint 无对外暴露 agent / 无外部用户可写入接口，纯内部 DB 迁移 + 投影脚本 + 代码清理。

---

## 已知约束

**回归测试约束（Step 1.2，来源 migration 474/492 结构测试 + selfcheck 测试）**：
- `migration-474-step-probes.test.js` → step_probes 结构（probe_key UNIQUE、severity/spec_hash CHECK、FK journey_step_links、schema_version 474、rollback 删表）——本 sprint RENAME 后对应断言应迁移到 `probes`（名变、列增），不得让 474 探针语义丢失。
- `migration-492-steps-enablers.test.js`（对应 492）→ steps/enablers/enabler_calls 结构（本 sprint **不得重建/回退**这三表，累积 FR）。
- `selfcheck.test.js` → `EXPECTED_SCHEMA_VERSION` 与 `MAX(schema_version)` 比较逻辑（迁移推进后仍须绿：`DB max >= expected`）。

**累积 FR（Step 1.3）**：
- `context-manifest: unavailable`（无 journey_id 注入，`/api/brain/line/<journey_id>/context-manifest` 无从查询）。
- migration 492（steps/enablers/enabler_calls）已落地为基线，本 sprint 只在其上扩 cells/probes 挂点与投影，不重建。

**铁律清单映射（Step 1.3）**：见下方 Invariant 段 INV-1..INV-4 逐条映射。

---

## 禁 mock 边清单

本单改动涉及 **DB 写路径**（migrations 改表 + probes/cells 写路径）、**跨模块数据传递**（steps/enablers → notion_projection_map 投影链），failing test 对这些边必须真 Postgres、不 mock：

- 代码 ↔ `probes` 表（本单 RENAME `step_probes`→`probes` 且加 target_type/target_id 写路径，测试必须真 Postgres 验列存在 + CHECK 生效 + target_type 回填 activity）
- 代码 ↔ `journey_step_links` 表（本单加 target_type/target_id 扩 step/enabler 级写路径，测试必须真 Postgres 验可插入指向 steps.id/enablers.id 的 cell）
- 代码 ↔ `steps` / `enablers` 表 → `notion_projection_map`（本单新增两投影目标，测试必须真 Postgres 验 registry 行存在且 active）
- 代码 ↔ `golden_path`/`golden_paths`/`golden_path_contract_versions` 三表（本单 DROP 写路径，测试必须真 Postgres 验 `to_regclass` 三者 NULL；src grep 验残留读写零清理）

对应真 PG 测试落 `packages/brain/src/__tests__/integration/migration-493-probes-cells-goldenpath.pg.integration.test.js` 并登记进 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS`（brain-integration job 起真 Postgres 跑）。sprint 冻结结构测试（`sprints/09301702-kernel-741cdf5a/tests/`）读迁移 SQL / src 文件做确定性断言，与真 PG 测试互补。

## 真实调用方请求 shape

N/A — 本 sprint 无设备/agent 调服务端的真实调用方（纯内部迁移 + 脚本投影 + 代码清理）。

## 未覆盖真实链路清单

- **Notion 真实 API 推送**｜autonomous CI/Fleet 无 Notion token，且 Notion 为外部不可达面（边界④）｜真验证补位：投影**wiring** 由本合同覆盖（`notion_projection_map` 新增 steps/enablers active 行 + 投影函数真跑产结构化结果 + 失败写 log 不假成功，均可机检）；**真实 push** 由 nightly `integration-nightly.yml` / 主理人手动带 token 环境验证，不在本 autonomous 轮阻塞。controller 请把本条呈现进 PR 描述。

---

## Golden Path

[运维者执行本 sprint 迁移+清理] → [probes 重挂点 / cells 扩级 / steps-enablers Notion 投影 / golden_path* 退役] → [探针精确落 step/enabler 级、承诺地图现 steps/enablers、golden_path* 消失、DevGate+selfcheck 绿]

---

### Step 1: 执行迁移 493+ —— `step_probes` RENAME→`probes` + target_type/target_id + 回填
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条 + 边界情况②（旧探针 100% 迁入、计数一致、零丢失）+ Invariant [探针零丢失]

**可观测行为**: 迁移后 `to_regclass('probes')` 非 NULL、`to_regclass('step_probes')` 为 NULL；`probes` 有 `target_type`（CHECK IN activity|step|enabler，NOT NULL DEFAULT 'activity'）+ `target_id`（uuid，可空）列；迁移用 **RENAME**（不复制数据、不 DROP 原表），旧行按 target_type='activity' 就位、零丢失。

**验证命令**:
```bash
# probes 就位、step_probes 消失
psql "$DB_URL" -tAc "SELECT to_regclass('probes') IS NOT NULL AND to_regclass('step_probes') IS NULL" | grep -qx t
# target_type/target_id 列 + CHECK
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='probes' AND column_name IN ('target_type','target_id')" | grep -qx 2
# 迁移用 RENAME、up 迁移无 DROP TABLE step_probes（零丢失结构保证）
grep -REl "ALTER TABLE (IF EXISTS )?step_probes RENAME TO probes" packages/brain/migrations/*.sql >/dev/null
! grep -RE "DROP TABLE (IF EXISTS )?step_probes" packages/brain/migrations/*.sql | grep -v rollback
```

**硬阈值**: `probes` 存在且 `step_probes` 不存在；target_type/target_id 两列齐；CHECK 接受 activity/step/enabler 拒绝其他；迁移含 RENAME 且 up 段无 `DROP TABLE step_probes`。

---

### Step 2: `journey_step_links`（cells）扩 step/enabler 级
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（cell 允许指向 steps.id / enablers.id，进 map_projection 与 Notion 承诺地图链）

**可观测行为**: `journey_step_links` 加 `target_type`（CHECK IN activity|step|enabler，NOT NULL DEFAULT 'activity'）+ `target_id`（uuid，可空）；既有 cell 回填 target_type='activity'（不丢现有格子）；可插入指向真实 `steps.id`/`enablers.id` 的 cell 且非法 target_type 被 CHECK 拒绝。

**验证命令**:
```bash
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='journey_step_links' AND column_name IN ('target_type','target_id')" | grep -qx 2
# CHECK 生效：非法值被拒（预期 psql 报错，命令整体应非0）
psql "$DB_URL" -c "UPDATE journey_step_links SET target_type='bogus' WHERE false" 2>&1 | grep -qiE "check|constraint" || psql "$DB_URL" -tAc "SELECT 1 FROM information_schema.check_constraints WHERE constraint_name LIKE '%journey_step_links%target_type%'" | grep -qx 1
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
# 投影入口脚本存在且可 dry-run（无 token 时结构化报失败、非静默假成功）
test -f packages/brain/scripts/sync-steps-from-workspace.mjs
```
> 注：`notion_projection_map` 列名（brain_table/status/direction）以迁移 450/487 实际列为准；generator 若列名不同须在本合同同步修正断言列名（见 Test Contract 冻结测试锚定）。

**硬阈值**: steps + enablers 投影行 ≥ 2 且 active；投影脚本存在；失败路径有 log、无静默假成功。

---

### Step 4: `golden_path`/`golden_paths`/`golden_path_contract_versions` 三表退役 + 代码残留清理
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条 + 边界情况③（退役前确认无活跃代码依赖，有则先切新表，避免 DROP 后 500）

**可观测行为**: 迁移 DROP 三表（IF EXISTS）；`to_regclass` 三者均 NULL；`packages/brain/src/*.js`（排除 `__tests__`）对三表的 SQL 读写（`FROM/INTO/UPDATE/JOIN golden_paths?`、`golden_path_contract_versions`）零残留（切到新价值流表或删死路径）；受影响活跃路径（battle-report / direction-proposer / capture-triage / gp-shelf-life / golden-path-contracts / harness-line-context / ledger-hygiene / harness-promote-regression + harness identity `golden_path_contract_versions`）不 500。

**验证命令**:
```bash
psql "$DB_URL" -tAc "SELECT to_regclass('golden_path') IS NULL AND to_regclass('golden_paths') IS NULL AND to_regclass('golden_path_contract_versions') IS NULL" | grep -qx t
# 活跃 src 无三表 SQL 残留（排除 __tests__ / 注释 / yaml-key doc.golden_paths）
! grep -REn "(FROM|INTO|UPDATE|JOIN)[[:space:]]+golden_paths?[^_a-z]|golden_path_contract_versions" packages/brain/src --include=*.js | grep -v "__tests__" | grep -vE "^\s*//|^\s*\*"
```

**硬阈值**: 三表 `to_regclass` 全 NULL；活跃 src SQL 零残留（排除测试/注释）；DevGate + selfcheck 绿证明无运行时崩。

---

### Step 5: 出口可观测 —— DevGate 三闸 + selfcheck 绿
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
- **INV-2 [幂等CAS]**：本 sprint 无「SELECT 判态再 UPDATE」状态机改动（DDL 迁移 + 投影 + 清理）。迁移幂等靠 RENAME/ADD IF NOT EXISTS / ON CONFLICT DO NOTHING 实现，重跑不覆盖。→ CAS 状态机层面 **N/A：本 sprint 不改任务/探针状态迁移路径**。
- **INV-3 [jsonb浅合并]**：Notion 投影若把回执写进任务 `result`，必须用固定子键（receipt）浅合并、不覆盖 payload。本 sprint 投影回执落投影链 digest 列/结构化返回、不写任务 result → **N/A：本 sprint 投影不触达任务 result.payload**（若 generator 改为写 result 须遵此浅合并）。
- **INV-4 [探针零丢失]**：`step_probes` 迁入 `probes` 后计数一致、禁止丢探针。验证：迁移用 RENAME（不复制、不 DROP 原表），up 段无 `DROP TABLE step_probes`；真 PG roundtrip 验行保留（DoD 段 INV-4 + 集成测试）。

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

# 3. cells 扩 step/enabler 级：journey_step_links 加 target_type/target_id
JCOLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='journey_step_links' AND column_name IN ('target_type','target_id')" | tr -d ' ')
[ "$JCOLS" = "2" ] || { echo "FAIL: journey_step_links 缺 target_type/target_id (got $JCOLS)"; exit 1; }

# 4. steps/enablers Notion 投影 wiring：notion_projection_map 有两投影目标 active
NP=$(psql "$DB_URL" -tAc "SELECT count(*) FROM notion_projection_map WHERE brain_table IN ('steps','enablers') AND status='active' AND direction IN ('push','both')" | tr -d ' ')
[ "$NP" -ge 2 ] || { echo "FAIL: notion_projection_map 缺 steps/enablers active 投影行 (got $NP)"; exit 1; }
test -f packages/brain/scripts/sync-steps-from-workspace.mjs || { echo "FAIL: sync-steps 脚本缺失"; exit 1; }

# 5. golden_path* 三表退役 + 代码零残留
psql "$DB_URL" -tAc "SELECT to_regclass('golden_path') IS NULL AND to_regclass('golden_paths') IS NULL AND to_regclass('golden_path_contract_versions') IS NULL" | grep -qx t || { echo "FAIL: golden_path* 未全部 DROP"; exit 1; }
if grep -REn "(FROM|INTO|UPDATE|JOIN)[[:space:]]+golden_paths?[^_a-z]|golden_path_contract_versions" packages/brain/src --include=*.js | grep -v "__tests__" | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*)"; then
  echo "FAIL: 活跃 src 仍有 golden_path* SQL 残留"; exit 1
fi

# 6. schema_version 前进 + selfcheck 绿
psql "$DB_URL" -tAc "SELECT (SELECT MAX(version::int) FROM schema_version WHERE version ~ '^[0-9]{1,4}\$') >= 493" | grep -qx t || { echo "FAIL: schema_version 未前进到 >=493"; exit 1; }

# 7. DevGate 三闸
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs

echo "✅ Golden Path 验证通过（probes 重挂点 / cells 扩级 / Notion 投影 wiring / golden_path* 退役 / DevGate 绿）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（本 sprint 为迁移+退役，回归面高，按默认）
高风险面:
- 错输入: 向 `probes.target_type` / `journey_step_links.target_type` 插入非枚举值（如 `'stepp'`/空串），应被 CHECK 拒绝而非静默落库
- 重复提交: 重跑 `node packages/brain/src/migrate.js` 两次，第二次应 0 变更、不报错（幂等）；重跑不得把已改的 target_type 覆盖回默认
- 中途中断: 迁移执行到一半 DROP golden_paths 后中断——重跑应能续跑且不因表已 DROP 报错（IF EXISTS 幂等）
- 边界值: `golden_path*` 三表退役后，触发 battle-report / direction-proposer / capture-triage / harness identity 相关路径（若可无副作用触发），确认不因表缺失 500；`step_probes` 名的历史 assertion_ref `probe:<key>` 仍能被解析（改名不破坏 cell 断言链）
发现分级: P0/P1（丢探针 / DROP 后运行时 500 / 静默假投影）→ 阻塞 merge；P2/P3（日志措辞、非关键列命名）→ 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| probes 重挂点 + cells 扩级 + golden_path* 退役（迁移结构，冻结） | `sprints/09301702-kernel-741cdf5a/tests/migration-probes-cells-goldenpath.test.ts` | RENAME step_probes 到 probes、probes target_type CHECK activity step enabler、journey_step_links target_type target_id、DROP golden_path golden_paths golden_path_contract_versions、schema_version 493 | → 迁移文件无对应 DDL → 多条 fail |
| 代码残留清理 + Notion 投影 wiring（src grep，冻结） | `sprints/09301702-kernel-741cdf5a/tests/code-cleanup-and-projection.test.ts` | 活跃 src 无 golden_paths SQL 残留、notion-probe-projection 引用 probes 非 step_probes、notion_projection_map 注册 steps enablers | → 现有残留/step_probes 引用/未注册 → 多条 fail |
| probes/cells/golden_path* 真 Postgres roundtrip（补充，真 PG） | `packages/brain/src/__tests__/integration/migration-493-probes-cells-goldenpath.pg.integration.test.js` | probes target_type 回填 activity、CHECK 拒非法、journey_step_links step enabler cell 插入、golden_path 三表 to_regclass NULL | → 迁移未落 → 真库断言 fail |

> Test File 列均为完整真实路径。冻结测试至少一行落 `sprints/09301702-kernel-741cdf5a/tests/`（本 sprint 两份结构测试均在此，已落盘并进 commit）；`packages/...` 真 PG 测试为补充行，并登记进 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS`。
> BEHAVIOR 覆盖名均为对应 `it()` 名的字面子串。
