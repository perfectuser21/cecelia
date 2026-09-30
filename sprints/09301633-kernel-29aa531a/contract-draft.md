# Sprint Contract Draft (Round 1)

**锚定父路声明**: 独立小路（无父路）——PRD `journey_id: none`，本 sprint 为纯 Brain DB 建模基础设施，不推进任何具体 Golden Path 客户步骤，为决策 3e867cad 13 表方案的第 4-5 张表落库。

**journey_type**: autonomous
**target_environment**: local_api
**map_scope**: `[MJ5]`；`map_repo` 为 null 且无 `expected_files` → 半径不可计算，标 `[MAP_NOT_CONFIGURED]`（不回退领域硬编码；`must_run_assertions` 无注入项）。

---

## Response Schema（推导来源: PRD 字面 + 现有迁移 482/492/436 约定）

**N/A — 任务无 HTTP 响应**：本 sprint 是纯 DDL/数据迁移，无新增 HTTP 端点。可观测契约是 **DB schema + 种子数据**，验证一律走 `psql` SQL 断言（见 Golden Path 验证命令与 E2E 验收）。以下为本迁移必须落库的 schema 契约（generator 必须字面实现，列名不可漂移）：

### 新表 `workflows`（决策 752b7166：Workflow = 一个 Capability 在某渠道/形态的可执行链条）
必含列（PRD 字面）：`capability_id` / `channel` / `version` / `status`；补充列 `id`(uuid pk) / `name` / `created_at` / `updated_at`（`name` 用于按 PRD 给定名称「抖音·关键词获客」「对标获客」定位与幂等种子，属 PRD 隐含必需，非扩张）。
- `capability_id` (text, NOT NULL): 所属 Capability 标识，取 `capability_key` 语义值（如 `keyword_acquisition`）。软引用 `system_capabilities.capability_key`，**不加硬 FK**（PRD 假设仅约束「该列存在且非空标识所属 Capability」；见判定点登记表 J1）。
- `channel` (text, NOT NULL): 渠道/形态，如 `douyin`。
- `version` (text, NOT NULL DEFAULT '1.0')。
- `status` (text, NOT NULL DEFAULT 'active')。

### `journey_steps`（视图 `backbone_activities`）新增列
- `workflow_id` (uuid, 可空, REFERENCES workflows(id)): 该活动的 home/primary workflow。
- `executor_kind` (text, 可空, CHECK IN ('code','agent','human')): 谁来执行。**活动层比 enablers.kind 多一个 `human`**（对照 492 `enablers_kind_check` 仅 `code|agent`）。CHECK 允许 NULL（既有行不受影响）。
- `enabler_id` (uuid, 可空, REFERENCES enablers(id)): Call Activity 指向共用件；不调用共用件的活动为 NULL，**不得强制 NOT NULL**。

### 桥表 `workflow_activities`（M:N 共用，`[AI_ADDED]` — 见下方来源理由）
`workflow_id` (uuid, REFERENCES workflows(id) ON DELETE CASCADE) + `activity_id` (uuid, REFERENCES journey_steps(id) ON DELETE CASCADE) + `UNIQUE(workflow_id, activity_id)`。这是「同一批 journey_steps 行被多个 workflow 复用、不插物理副本」的唯一无副本可观测载体。

### `ops_workflows` 新增列
- `workflow_id` (uuid, 可空, REFERENCES workflows(id)): 历史 n8n 画布回指其所属 workflow。可空，历史行不强制回填。

**禁用字段名**（generator 不得用同义替换）：`workflows` 的 capability 列必须字面叫 `capability_id`（禁 `cap_id`/`capability_key`/`capability`）；执行体列必须字面叫 `executor_kind`（禁 `executor`/`runner_kind`/`kind`）。

### 两 workflow 种子规格（generator 必须字面按此灌，name + channel 都要对）
| workflow | name（冻结测试按此定位） | capability_id | channel（DoD 断言按此定位） | version | status |
|---|---|---|---|---|---|
| wf1 | `抖音·关键词获客` | `keyword_acquisition` | `douyin` | `1.0` | `active` |
| wf2 | `对标获客` | `keyword_acquisition` | `douyin_benchmark` | `1.0` | `active` |

- 改挂：`capability_key='keyword_acquisition'` 最新 backbone_version 的 8 个活动，`workflow_id` 回填 wf1、`executor_kind` 设合法值（判定点 J4：qualification/scoring/outreach=`agent`，其余=`code`）。改挂 UPDATE 必须 `WHERE workflow_id IS NULL` 以幂等且不覆盖后来人改动。
- 共用：桥表为 wf2 插 7 条 `workflow_activities`（排除 `discovery`，判定点 J3），指向 wf1 的既有活动行，`ON CONFLICT (workflow_id, activity_id) DO NOTHING`。

---

## Golden Path

[跑迁移 493] → [建 workflows 表 + journey_steps 加 3 列 + ops_workflows 加列 + 建 workflow_activities 桥] → [灌两 workflow 种子 + 8 活动改挂 + 7 活动共用桥接] → [SQL 可查两 workflow 及共用活动]

### Step 1: 运行迁移后 workflows 表存在含四列 + schema_version 记 493
**来源**: `[FROM_PRD]` — Golden Path 第 1 条「新表 workflows 存在，含列 capability_id/channel/version/status；schema_version 表新增本迁移记录」。

**可观测行为**: 迁移应用后 `information_schema` 查得 `workflows` 表及 4 列；`schema_version` 有 `493` 行。

**验证命令**:
```bash
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='workflows' AND column_name IN ('capability_id','channel','version','status')" | grep -qx 4 || { echo FAIL; exit 1; }
psql "$DB_URL" -tAc "SELECT 1 FROM schema_version WHERE version='493'" | grep -qx 1 || { echo FAIL; exit 1; }
```
**硬阈值**: 四列齐（count=4）；schema_version 含 493。

---

### Step 2: journey_steps 新增 workflow_id / executor_kind / 可空 enabler_id，executor_kind CHECK 生效
**来源**: `[FROM_PRD]` — Golden Path 第 2 条 + 边界情况「executor_kind 只允许 code|agent|human，非法值须被 CHECK 拒绝」「enabler_id 可空」。

**可观测行为**: 三列存在；`enabler_id` 可空；对 keyword_acquisition 活动写非法 `executor_kind` 被 CHECK 拒绝。

**验证命令**:
```bash
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='journey_steps' AND column_name IN ('workflow_id','executor_kind','enabler_id')" | grep -qx 3 || { echo FAIL; exit 1; }
# 非法值必须被拒（事务回滚不留痕）；命令整体应因 CHECK 报错而使 psql 退出非 0
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; UPDATE journey_steps SET executor_kind='illegal_kind' WHERE capability_key='keyword_acquisition'; ROLLBACK;" && { echo 'FAIL: 非法 executor_kind 未被 CHECK 拒绝'; exit 1; } || echo 'OK: CHECK 拒绝非法值'
```
**硬阈值**: 三列齐（count=3）；非法 executor_kind 写入被 CHECK 拒绝（psql 非 0 退出）。

---

### Step 3: 灌 workflow「抖音·关键词获客」，8 个 keyword_acquisition 活动 workflow_id 回填 + executor_kind 合法
**来源**: `[FROM_PRD]` — Golden Path 第 3 条 + 第 6 条「抖音·关键词获客下挂 8 个活动、每个活动有 workflow_id 且 executor_kind 合法」。

**可观测行为**: `workflows` 有 name='抖音·关键词获客' 行（capability_id='keyword_acquisition'）；8 个 keyword_acquisition 最新骨干活动 `workflow_id` 指向它、`executor_kind` ∈ {code,agent,human}。

**验证命令**:
```bash
WF1=$(psql "$DB_URL" -tAc "SELECT id FROM workflows WHERE name='抖音·关键词获客'")
[ -n "$WF1" ] || { echo 'FAIL: 未建 workflow 抖音·关键词获客'; exit 1; }
psql "$DB_URL" -tAc "SELECT count(*) FROM journey_steps WHERE capability_key='keyword_acquisition' AND workflow_id='$WF1' AND executor_kind IN ('code','agent','human')" | grep -qx 8 || { echo 'FAIL: 8 活动未正确改挂/executor_kind 非法'; exit 1; }
```
**硬阈值**: 恰好 8 个活动改挂到 wf1 且 executor_kind 合法。

---

### Step 4: 灌第二个 workflow「对标获客」，共用 7 个活动（同批行，无物理副本）
**来源**: `[FROM_PRD]` — Golden Path 第 4 条 + 边界「同一批 journey_steps 行被第二个 workflow 引用/复用，不得为共用活动重复插入物理副本」。

**可观测行为**: `workflows` 有 name='对标获客' 行；桥表 `workflow_activities` 为它登记 7 条链接，且这 7 条指向的 activity_id 都是既有 keyword_acquisition 行（非新插入）；keyword_acquisition 最新骨干活动物理行数仍为 8（未复制）。

**验证命令**:
```bash
WF2=$(psql "$DB_URL" -tAc "SELECT id FROM workflows WHERE name='对标获客'")
[ -n "$WF2" ] || { echo 'FAIL: 未建 workflow 对标获客'; exit 1; }
psql "$DB_URL" -tAc "SELECT count(*) FROM workflow_activities wa JOIN journey_steps js ON js.id=wa.activity_id WHERE wa.workflow_id='$WF2' AND js.capability_key='keyword_acquisition'" | grep -qx 7 || { echo 'FAIL: 对标获客共用活动数不为 7'; exit 1; }
psql "$DB_URL" -tAc "SELECT count(*) FROM journey_steps WHERE capability_key='keyword_acquisition' AND backbone_version=(SELECT max(backbone_version) FROM journey_steps WHERE capability_key='keyword_acquisition')" | grep -qx 8 || { echo 'FAIL: 出现物理副本，骨干活动行数不为 8'; exit 1; }
```
**硬阈值**: 对标获客共用恰好 7 个既有活动；骨干活动物理行数仍为 8（零副本）。

---

### Step 5: ops_workflows 新增可空列 workflow_id
**来源**: `[FROM_PRD]` — Golden Path 第 5 条「ops_workflows 新增可空列 workflow_id（指向 workflows），历史行不强制回填」。

**可观测行为**: `ops_workflows.workflow_id` 列存在且 `is_nullable='YES'`。

**验证命令**:
```bash
psql "$DB_URL" -tAc "SELECT is_nullable FROM information_schema.columns WHERE table_name='ops_workflows' AND column_name='workflow_id'" | grep -qx YES || { echo 'FAIL: ops_workflows.workflow_id 缺失或非空'; exit 1; }
```
**硬阈值**: 列存在且可空。

---

### Step 6: 迁移幂等——重跑 migrate 结果不变
**来源**: `[FROM_PRD]` — 边界「迁移可重复执行（IF NOT EXISTS / ON CONFLICT DO NOTHING），重跑不覆盖后来人改动、不重复灌种子」+ Invariant [幂等CAS]。

**可观测行为**: 再次 `node src/migrate.js` 后，两 workflow 行数仍为 2、8 活动改挂数仍为 8、对标共用仍为 7（无重复）。

**验证命令**:
```bash
(cd packages/brain && DATABASE_URL="$DB_URL" node src/migrate.js) >/dev/null 2>&1
psql "$DB_URL" -tAc "SELECT count(*) FROM workflows WHERE name IN ('抖音·关键词获客','对标获客')" | grep -qx 2 || { echo 'FAIL: 重跑后 workflow 数不为 2'; exit 1; }
```
**硬阈值**: 重跑后 workflow 数=2（无重复灌种子）。

**`[AI_ADDED]` 来源理由（桥表 workflow_activities）**：PRD 三条硬约束——(a) Step 3「8 活动 workflow_id 改挂到 wf1」使 wf1 拥有 8 活动、(b) Step 4/6「对标获客共用 7 个**同一批** journey_steps 行」、(c) 边界「不得插入物理副本」——在单值列 `journey_steps.workflow_id`（N:1）上**不可同时成立**（单列被 wf1 占用后无法再表达 wf2 复用同批行）。PRD 「8+7 活动改挂」= 15 次挂接，正对应桥表 8+7=15 条链接。桥表是唯一无副本、可 SQL 观测的 M:N 实现，故新增。此为 proposer 判定，已登记判定点 J2（⚠️）并入 notes `judgment-pending-user`。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `packages/brain/migrations/492_steps_enablers.sql`：enablers.kind CHECK 仅 `code|agent`；enabler `return_to_results`（归位）已挂 keyword_acquisition `collection` 活动。本 sprint 不得改动 492 三表（steps/enablers/enabler_calls）结构。
- [回归] `packages/brain/migrations/482_backbone_activity_contracts.sql`：keyword_acquisition v3.0 八活动已种（activity_key: preflight/discovery/qualification/collection/scoring/delivery/outreach/cleanup），journey afa6abca；唯一索引 `uq_journey_steps_activity (journey_id, activity_key)`。改挂不得破坏此唯一约束与 `journey_id` NOT NULL 外键。
- [回归] `packages/brain/migrations/436_ops_workflows.sql`：ops_workflows `UNIQUE(source, wf_id)`。加列不得破坏。
- [累积FR] context-manifest: unavailable（本 task 无 journey_id，无法拉 line golden-paths；同方案前序迁移 492 仅供不回退参考）。
- [MAP] must_run_assertions: 无（map_repo 为 null，半径未计算）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 建 workflows 表 + workflow_activities 桥；journey_steps 加 workflow_id/executor_kind/enabler_id；ops_workflows 加 workflow_id；灌两 workflow 种子 + 8 改挂 + 7 共用 |
| **NFR（做得多好）** | 性能/可靠 | 一次性 DDL，无在线延迟要求；迁移编号单调递增（493）；schema_version 记录 |
| **Invariant（永不违反）** | 不变量 | [幂等CAS] 重跑不重复不覆盖；[枚举单源] executor_kind 枚举只一份定义；[不破坏既有] 不破坏 journey_steps 既有 journey_id 外键与 (journey_id, activity_key) 唯一约束 |
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表 |
| **保质期（何时过期）** | 失效退役 | schema 长期有效；本 sprint 不退役旧 golden_path*（范围外） |
| **死亡告警（停了谁知道）** | 告警 | N/A（DDL 迁移，非常驻功能；迁移失败 → migrate.js 非 0 退出 → CI 红） |
| **失败语义（挂了怎么办）** | 故障策略 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 迁移生效以 psql 查 schema/种子为准（见 E2E），不以「migrate 打印成功」为准 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳 | 静默丢消息 |
| J1: workflows.capability_id 指向什么 | A. 硬 FK→system_capabilities.capability_key; B. 硬 FK→golden_paths; C. text 软引用 capability_key 不加 FK | C. text 软引用不加 FK | PRD 假设仅要求「该列存在且非空标识 Capability」；system_capabilities 是否含 keyword_acquisition 行不确定，硬 FK 会致种子失败 | 误判致迁移插入失败或建模指错源 |
| ⚠️ J2: 「对标获客共用 7 活动」如何建模 | A. 单列 workflow_id 重指(会夺走 wf1 的活动，违反 Step 6 wf1=8); B. 复制 7 物理行(违反禁副本); C. 新增 M:N 桥表 workflow_activities | C. 桥表 | 唯一同时满足 wf1=8、wf2 共用同批 7 行、零副本、可 SQL 观测的方案；PRD「8+7 改挂」正对应 15 桥链接 | 误判致 wf2 共用不可观测 / 破坏 wf1 活动 / 产生物理副本脏数据（面客建模错误） |
| ⚠️ J3: 共用的是哪 7 个活动 | A. 排除 discovery(关键词搜索特有); B. 排除 cleanup; C. 任取 7 | A. 排除 discovery | 对标获客=对标账号抓取，discovery(关键词发现)是关键词获客特有环节，其余 7 环节(preflight/qualification/collection/scoring/delivery/outreach/cleanup)通用 | 误选致语义错配，但计数仍=7；后续对标 workflow 执行链缺环 |
| J4: 8 活动的 executor_kind 取值 | A. 全 code; B. 按环节性质映射 | B. qualification/scoring/outreach=agent，其余=code | 判定/评分/触达偏 agent 决策，其余偏脚本；oracle 仅校验合法非空，取值不影响验收 | 误判仅影响后续调度选执行体，可后续 UPDATE 修正 |
| J5: 对标获客 channel 值 | A. douyin; B. douyin_benchmark | B. douyin_benchmark（与 wf1 channel 区分，符合假设「仅 channel/名不同」） | oracle 按 name 定位不依赖 channel 值 | 误判仅影响 channel 展示，可修正 |

> ⚠️ J2/J3 误判后果涉及面客建模数据，属「升拍板点」级别；PrepPRD/对齐会未拍过 → 见 notes `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写 DB | 是 | 客户端重试 |
| 迁移 493 中途报错 | migrate.js 事务 ROLLBACK 整个文件，非 0 退出，schema_version 不记 493 | 是（IF NOT EXISTS/ON CONFLICT/UPDATE WHERE workflow_id IS NULL；migrate.js 按 version skip 已应用项） | 修迁移后重跑，无脏中间态 |
| capability_key='keyword_acquisition' 活动不足 8 | 改挂 UPDATE 命中 <8 行，Step 3 oracle FAIL | 是 | 上报数据前置缺失（482 种子未灌），不静默放行 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 为 Brain 内部 DDL/数据迁移，无对外暴露 agent、无外部用户可写入接口、无 Prompt 注入面。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## 禁 mock 边清单

本单是 DB 写路径 + 跨表建模（DDL + 种子 UPDATE/INSERT + 新 FK/CHECK/桥表），冻结测试必须真 Postgres、禁 mock 下列被改的边：

- 代码 ↔ DB 表 `workflows`（本单新建，测试必真 Postgres 验表/列存在）
- 代码 ↔ DB 表 `journey_steps`（本单 ALTER 加 3 列 + 改挂 UPDATE，测试必真 Postgres 验列/CHECK/回填计数）
- 代码 ↔ DB 表 `workflow_activities`（本单新建桥表，测试必真 Postgres 验共用 7 链接与零副本）
- 代码 ↔ DB 表 `ops_workflows`（本单 ALTER 加列，测试必真 Postgres 验列可空）

冻结测试 `tests/workflows-modeling.test.ts` 直连 `pg`（无 `vi.mock('pg')`/`vi.mock('../db.js')`），命中上述边即违约。真 PG 由 harness「Sprint Tests 实跑」job 的 postgres service + `node src/migrate.js` 提供。

## 真实调用方请求 shape

N/A — 无设备/agent 调服务端，纯内部迁移。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A —— 所有 DB 边均真 Postgres 验证。）

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> evaluator 模式 B：注入 attempt 级 `DB_URL`（空库），跑本 sprint 迁移 → psql 断言全部 6 个验收点 + 幂等重跑。vitest 冻结测试从仓库根跑（sprints/** 在根 vitest include 内），无需子 shell 切包。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
KEYWORD_CAP="keyword_acquisition"
WF1_NAME="抖音·关键词获客"
WF2_NAME="对标获客"

# 1. 对空库跑全量迁移（含本 sprint 493）；migrate.js 从 packages/brain 读 migrations/*.sql
(cd packages/brain && DATABASE_URL="$DB_URL" node src/migrate.js)

# 2. workflows 表四列 + schema_version 493
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='workflows' AND column_name IN ('capability_id','channel','version','status')" | grep -qx 4 || { echo "FAIL: workflows 四列不全"; exit 1; }
psql "$DB_URL" -tAc "SELECT 1 FROM schema_version WHERE version='493'" | grep -qx 1 || { echo "FAIL: schema_version 无 493"; exit 1; }

# 3. journey_steps 三新列 + executor_kind CHECK 拒非法
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='journey_steps' AND column_name IN ('workflow_id','executor_kind','enabler_id')" | grep -qx 3 || { echo "FAIL: journey_steps 三列不全"; exit 1; }
psql "$DB_URL" -tAc "SELECT is_nullable FROM information_schema.columns WHERE table_name='journey_steps' AND column_name='enabler_id'" | grep -qx YES || { echo "FAIL: enabler_id 非可空"; exit 1; }
if psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; UPDATE journey_steps SET executor_kind='illegal_kind' WHERE capability_key='$KEYWORD_CAP'; ROLLBACK;" >/dev/null 2>&1; then
  echo "FAIL: 非法 executor_kind 未被 CHECK 拒绝"; exit 1
fi
echo "OK: executor_kind CHECK 生效"

# 4. wf1 抖音·关键词获客 + 8 活动改挂
WF1=$(psql "$DB_URL" -tAc "SELECT id FROM workflows WHERE name='$WF1_NAME'")
[ -n "$WF1" ] || { echo "FAIL: 未建 $WF1_NAME"; exit 1; }
psql "$DB_URL" -tAc "SELECT count(*) FROM journey_steps WHERE capability_key='$KEYWORD_CAP' AND workflow_id='$WF1' AND executor_kind IN ('code','agent','human')" | grep -qx 8 || { echo "FAIL: 8 活动未正确改挂"; exit 1; }

# 5. wf2 对标获客 + 共用 7 活动 + 零物理副本
WF2=$(psql "$DB_URL" -tAc "SELECT id FROM workflows WHERE name='$WF2_NAME'")
[ -n "$WF2" ] || { echo "FAIL: 未建 $WF2_NAME"; exit 1; }
psql "$DB_URL" -tAc "SELECT count(*) FROM workflow_activities wa JOIN journey_steps js ON js.id=wa.activity_id WHERE wa.workflow_id='$WF2' AND js.capability_key='$KEYWORD_CAP'" | grep -qx 7 || { echo "FAIL: 对标获客共用活动数不为 7"; exit 1; }
psql "$DB_URL" -tAc "SELECT count(*) FROM journey_steps WHERE capability_key='$KEYWORD_CAP' AND backbone_version=(SELECT max(backbone_version) FROM journey_steps WHERE capability_key='$KEYWORD_CAP')" | grep -qx 8 || { echo "FAIL: 出现物理副本"; exit 1; }

# 6. ops_workflows.workflow_id 可空列
psql "$DB_URL" -tAc "SELECT is_nullable FROM information_schema.columns WHERE table_name='ops_workflows' AND column_name='workflow_id'" | grep -qx YES || { echo "FAIL: ops_workflows.workflow_id 缺失或非空"; exit 1; }

# 7. 幂等重跑：再次 migrate（migrate.js 按 version skip），种子不重复
(cd packages/brain && DATABASE_URL="$DB_URL" node src/migrate.js) >/dev/null 2>&1
psql "$DB_URL" -tAc "SELECT count(*) FROM workflows WHERE name IN ('$WF1_NAME','$WF2_NAME')" | grep -qx 2 || { echo "FAIL: 重跑后 workflow 数不为 2"; exit 1; }
psql "$DB_URL" -tAc "SELECT count(*) FROM workflow_activities WHERE workflow_id='$WF2'" | grep -qx 7 || { echo "FAIL: 重跑后共用链接重复"; exit 1; }

# 8. 冻结回归测试（真 PG）从仓库根跑
TEST_DATABASE_URL="$DB_URL" npx vitest run sprints/09301633-kernel-29aa531a/tests/workflows-modeling.test.ts --reporter=verbose || { echo "FAIL: 冻结测试未通过"; exit 1; }

echo "✅ Golden Path 验证通过（价值流建模③）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: 对 `workflows.status` / `journey_steps.executor_kind` 写非法值（如 executor_kind='CODE' 大写、'coder'），验 CHECK 是否严格；对 `workflow_activities` 插入 workflow_id 不存在的行，验 FK 是否拦截。
- 重复提交: 连跑 `node src/migrate.js` 两次以上，验种子不翻倍、8 改挂不变、7 共用不变（幂等边界）。
- 中途中断: 模拟迁移文件语法错（在副本上），验事务 ROLLBACK 后 schema_version 不记 493、无半建表残留。
- 边界值: keyword_acquisition 活动恰好 8 行的假设——若最新 backbone_version 活动数 ≠ 8，Step 3/4 计数断言应 FAIL 而非静默放行；对标共用 7 与 8 活动的边界（是否误挂第 8 个 discovery）。
发现分级: P0/P1（物理副本脏数据 / CHECK 失效 / 破坏既有 journey_id 唯一约束）→ 阻塞 merge；P2/P3（channel 值、executor_kind 具体取值语义）→ 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| workflows 表 schema | `sprints/09301633-kernel-29aa531a/tests/workflows-modeling.test.ts` | workflows 表存在 | → relation/column 不存在，红 |
| journey_steps 三列 | `sprints/09301633-kernel-29aa531a/tests/workflows-modeling.test.ts` | journey_steps 含 workflow_id executor_kind enabler_id | → 列不存在，红 |
| executor_kind CHECK | `sprints/09301633-kernel-29aa531a/tests/workflows-modeling.test.ts` | executor_kind CHECK 拒绝非法值 | → 列不存在/无 CHECK，红 |
| wf1 8 活动改挂 | `sprints/09301633-kernel-29aa531a/tests/workflows-modeling.test.ts` | 抖音·关键词获客 workflow 下挂 8 个 | → workflow 行不存在，红 |
| wf2 共用 7 活动 | `sprints/09301633-kernel-29aa531a/tests/workflows-modeling.test.ts` | 对标获客 workflow 共用 7 个活动 | → 桥表不存在，红 |
| ops_workflows 加列 | `sprints/09301633-kernel-29aa531a/tests/workflows-modeling.test.ts` | ops_workflows 含可空 workflow_id 列 | → 列不存在，红 |
| schema_version 记录 | `sprints/09301633-kernel-29aa531a/tests/workflows-modeling.test.ts` | schema_version 含 493 记录 | → 无 493 行，红 |
