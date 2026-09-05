# Sprint Contract Draft (Round 1) — map↔画布对齐：画布 stages 由 golden_path 生成 + run 终态回写 step 成熟度

锚定父路声明: 独立小路（无父路）—— 本 line（journey e6f803f2）现有 ability 均为 planned 态，无 done/working 父路可挂；本 sprint 独立推进 map 投影新增「画布层」。

## Response Schema（推导来源: PRD 字面 + api_registry 推导 — GET /api/brain/map 现有端点扩展）

### Endpoint: GET /api/brain/map?scope=<scope_key>
本 sprint **不新增端点**，扩展现有 `/api/brain/map` 读出口，让其暴露「画布层」节点与体检摘要。

**Success (HTTP 200)** — 相对现状新增/变更字段（其余现有字段不动）:
```json
{
  "scope_key": "F1",
  "nodes": [
    {"id":"<64hex>","key":"step-1","type":"stage","name":"步骤1","attributes":{"canvas_layer":"stage","order_no":1,"maturity":"unknown"}}
  ],
  "edges": [
    {"id":"<64hex>","key":"step-1:step-2","from":"step-1","to":"step-2","type":"precedes"}
  ],
  "summary": {"stages": 3, "stage_maturity": {"unknown": 3, "passing": 0, "failing": 0}}
}
```
- `nodes[]` 新增画布层节点，`type` ∈ `"canvas"`（L3 ability→画布）/ `"stage"`（L4 step→格）/ `"feature"`（L5 feature→技能体）。来源: PRD Golden Path 第 2 步三层映射。
- `stage` 节点必带 `attributes.canvas_layer=="stage"`、`attributes.order_no`(number)、`attributes.maturity`(string)。来源: PRD 第 4/5 步「成熟度字段挂 step 层节点」。
- `attributes.maturity` (string, 枚举): `"unknown"` | `"passing"` | `"failing"`。来源: PRD 第 4 步 run 终态回写。默认 `"unknown"`。
- `summary.stages` (number): 本 scope 画布格（stage 节点）总数。来源: api_registry 现有 summary 字段风格（value_streams/capabilities 计数）推导。
- `summary.stage_maturity` (object): 成熟度直方图，key 为枚举值，value 为计数。`[NEW_PATTERN]` — 体检表新增。
- `edges[]` 新增 `type=="precedes"`（相邻 stage 有序）与 `type=="contains"`（canvas→stage、stage→feature）。来源: PRD「结构/条数/顺序对齐」。

**禁用字段名**（api_registry map 端点无这些同义词，禁止漂移）: `stage_status`、`step_health`、`grade`、`level`（成熟度一律用 `maturity`）；`sequence`/`index`（顺序一律用 `order_no`）。

**Error (HTTP 4xx)**（现有行为，保持）:
```json
{"error": {"code": "MAP_SCOPE_REQUIRED", "message": "scope query parameter is required"}}
```

### 内部契约函数（本 sprint 新增导出，contract IS LAW，generator 必须字面实现）

1. **`projectGoldenPathCanvas({ scopeKey, ability, steps })`** — `packages/brain/src/lib/map-projector.js`（纯函数，无 DB，画布投影 SSOT 引擎）
   - 入参: `ability={key,name}`；`steps=[{key,name,order_no,features?:[{key,name}]}]`（无序允许）。
   - 返回 `{ nodes, edges }`:
     - 恰 1 个 canvas 节点: `node_type="canvas"`, `node_key=ability.key`, `attributes.canvas_layer="canvas"`。
     - 每个 step 一个 stage 节点: `node_type="stage"`, `node_key=step.key`, `attributes={canvas_layer:"stage",order_no:step.order_no,maturity:"unknown"}`；**按 order_no 升序稳定排列**。
     - 每个 feature 一个 feature 节点: `node_type="feature"`, `attributes.canvas_layer="feature"`。
     - edges: canvas `contains` 每个 stage；相邻 stage `precedes`（按 order 顺序，共 `max(0, steps-1)` 条）；stage `contains` 其 feature。
     - `node_id`/`edge_id` 用现有 `stableMapNodeId(scopeKey,type,key)`/`stableMapEdgeId`（64 hex）。
     - **空 steps → 仅 canvas 节点，stage=0，edges=[]，不抛错**（PRD 边界: 空 ability 画布为空但不报错）。
   - 必须被 `buildMapProjection` 在有 golden_path steps 输入时调用并并入 nodes/edges（map=SSOT）。

2. **`writebackStepMaturity(client, { scopeKey, stepKey, outcome })`** — `packages/brain/src/lib/map-projection-store.js`（真 DB，接受调用方事务 client）
   - `outcome` ∈ `{"done","failed"}` → maturity 映射 `{"done":"passing","failed":"failing"}`。
   - 先 `pg_advisory_xact_lock` 锁 scope（复用既有 `lockScope('map-projection', scopeKey)`，对齐 PRD「并发多 run 回写同 scope 需串行保护」）。
   - 定位该 scope 的 `status='active'` projection run，找 `node_type='stage' AND node_key=stepKey` 的节点。
     - **找到** → `UPDATE map_projection_nodes SET attributes = jsonb_set(attributes,'{maturity}',to_jsonb(<maturity>::text))`，返回 `{updated:true, skipped:false, node_id, maturity}`。
     - **找不到**（step 已删 / 换代 receipt 锚过期）→ **不写任何行**，`console.warn` 结构化日志（含 `scopeKey`/`stepKey`/`reason:'step_not_found'`），返回 `{updated:false, skipped:true, reason:'step_not_found'}`（PRD 边界: 幂等跳过 + 记日志 + 不写脏数据）。
   - 必须被下方 `applyRunTerminalMaturity` 调用（回写落库的真 DB 边）。

3. **`applyRunTerminalMaturity(client, { task, outcome })`** — `packages/brain/src/orchestrator/kernel-run-store.js`（终态→回写生命周期接力，真 DB，接受调用方事务 client）
   - 从 `task.payload.map_scope`(取首元素) + `task.payload.gp_step_key` 读回写锚。
   - 两者齐备 → 调用 `writebackStepMaturity(client,{scopeKey,stepKey,outcome})` 并返回其结果。
   - 任一缺失（非 GP 锚定 run / 换代 receipt 锚过期）→ **不调用回写**，返回 `{updated:false, skipped:true, reason:'no_anchor'}`。
   - 必须被 `finalizeKernelRun` 终态副作用（`willBeTerminal`/`changed` 块内，同一事务 client）调用，`outcome` 传 finalize 的 `outcome`（done/failed）。此设计把「run→step 锚解析」抽成可单测的薄桥，集成测试直接构造 `task` 对象验真 DB 回写，无需 seed 完整 initiative_run。

## Golden Path

[对 scope 请求 map 投影] → [projector 以 golden_path 为 SSOT 生成 canvas/stage/feature 节点] → [harness run 到达终态] → [终态回写对应 step 成熟度到 map] → [再查 map：画布与 golden_path 对齐 + 成熟度反映最近 run]

### Step 1: 对某 scope 请求 map 投影/查询
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步（对含 golden_path steps 的 scope 请求投影）。

**可观测行为**: 该 scope 下有一个 L3 ability，其 golden_path 已含有序 steps；投影引擎可被调用。

**验证命令**:
```bash
psql "$DB_URL" -tAc "SELECT to_regclass('public.golden_path') IS NOT NULL AND to_regclass('public.map_projection_nodes') IS NOT NULL"
# 期望: t
```
**硬阈值**: golden_path 与 map_projection_nodes 表均存在。

---

### Step 2: projector 以 golden_path 为 SSOT 生成画布 stages
**来源**: `[FROM_PRD]` — PRD 第 2 步（L3 ability→画布, L4 step→格, L5 feature→技能体；map=SSOT，不再画布侧手写）。

**可观测行为**: `projectGoldenPathCanvas` 对有序 golden_path steps 生成条数/顺序 1:1 对齐的 stage 节点（含 canvas / feature 层与 precedes/contains 边）。

**验证命令**:
```bash
node --input-type=module -e "import(process.cwd()+'/packages/brain/src/lib/map-projector.js').then(m=>{const r=m.projectGoldenPathCanvas({scopeKey:'F1',ability:{key:'a',name:'A'},steps:[{key:'s2',name:'S2',order_no:2},{key:'s1',name:'S1',order_no:1,features:[{key:'f1',name:'F1'}]}]});const st=r.nodes.filter(n=>n.node_type==='stage');if(st.length!==2)throw new Error('stage count '+st.length);if(st[0].attributes.order_no!==1)throw new Error('order not sorted');if(!r.nodes.some(n=>n.node_type==='canvas'))throw new Error('no canvas');if(!r.nodes.some(n=>n.node_type==='feature'))throw new Error('no feature');if(r.edges.filter(e=>e.edge_type==='precedes').length!==1)throw new Error('precedes count');console.log('OK')}).catch(e=>{console.error('FAIL',e.message);process.exit(1)})"
# 期望: OK
```
**硬阈值**: 2 steps → 2 stage 节点，order_no 升序，含 canvas + feature 节点，precedes 边 = 1。

---

### Step 3: 某 harness run 到达终态（PASS/FAIL/blocked）
**来源**: `[FROM_PRD]` — PRD 第 3 步。

**可观测行为**: `finalizeKernelRun(outcome='done'|'failed')` 到达终态时，若 run 的 task.payload 带 `map_scope`+`gp_step_key`，触发成熟度回写。

**验证命令**:
```bash
node --input-type=module -e "import(process.cwd()+'/packages/brain/src/orchestrator/kernel-run-store.js').then(m=>{if(typeof m.finalizeKernelRun!=='function')throw new Error('finalizeKernelRun missing');console.log('OK')}).catch(e=>{console.error('FAIL',e.message);process.exit(1)})"
# 期望: OK
```
**硬阈值**: finalizeKernelRun 导出存在（回写钩子挂载点）。

---

### Step 4: 终态回写对应 step 成熟度（幂等：step 不存在跳过+记日志，不写脏数据）
**来源**: `[FROM_PRD]` — PRD 第 4 步 + 边界（step 已删 / 换代 receipt 锚过期 → 幂等跳过）。

**可观测行为**: `writebackStepMaturity` 对存在的 stage 节点更新 maturity 落库；对不存在的 step 跳过、记日志、无脏写。

**验证命令**:
```bash
node sprints/09060638-kernel-c07dfadc/tests/verify-writeback.mjs
# 期望: 末行 OK（存在step→passing 落库 + 缺失step→skipped 且无脏写；全程 tx rollback 无残留）
```
**硬阈值**: 存在 step 回写后 DB 中该 stage 节点 `attributes.maturity='passing'`；缺失 step 返回 `skipped:true` 且节点行数不变。

---

### Step 5: 再查 map — 画布与 golden_path 对齐 + 成熟度反映最近 run（map=实时体检表）
**来源**: `[FROM_PRD]` — PRD 第 5 步（可观测结果）。

**可观测行为**: `GET /api/brain/map?scope=F1` 返回 stage 层节点，且 `summary.stages` 与 `summary.stage_maturity` 反映当前画布体检状态。

**验证命令**:
```bash
RESP=$(curl -sf "http://127.0.0.1:5221/api/brain/map?scope=F1")
echo "$RESP" | jq -e '(.summary.stages|type=="number") and (.summary.stage_maturity|type=="object") and ([.nodes[]|select(.type=="stage")]|length>=1)'
# 期望: true
```
**硬阈值**: 响应含 stage 节点，summary.stages 为 number，summary.stage_maturity 为 object。

---

### Step 6（边界）: 空 golden_path → 画布为空但不报错
**来源**: `[FROM_PRD]` — PRD 边界情况第 1 条。

**可观测行为**: `projectGoldenPathCanvas` 对空 steps 只产出 canvas 节点、0 个 stage、不抛错。

**验证命令**:
```bash
node --input-type=module -e "import(process.cwd()+'/packages/brain/src/lib/map-projector.js').then(m=>{const r=m.projectGoldenPathCanvas({scopeKey:'F1',ability:{key:'a',name:'A'},steps:[]});const st=r.nodes.filter(n=>n.node_type==='stage');if(st.length!==0)throw new Error('not empty '+st.length);console.log('OK')}).catch(e=>{console.error('FAIL',e.message);process.exit(1)})"
# 期望: OK
```
**硬阈值**: 空 steps → 0 stage 节点，无异常。

---

## 禁 mock 边清单

本单涉及「跨模块数据传递（golden_path→投影引擎）」「DB 写路径（成熟度落库）」「生命周期钩子（run 终态→回写）」三类接缝，failing test 必须不 mock 被改的边：

- **golden_path 表 ↔ map-projector（画布 SSOT）**: 画布 stages 从 golden_path 生成，投影必须读 golden_path 真数据结构（纯函数层用真实 steps 结构入参，不 mock；DB 层用真 Postgres 验 stage 节点落库）。
- **代码 ↔ map_projection_nodes 表（成熟度写路径）**: `writebackStepMaturity` 改写 `attributes.maturity`，集成测试必须真 Postgres 验行落库 / 幂等跳过时验行数不变，禁止 mock pg client。
- **run 终态锚 ↔ writebackStepMaturity（生命周期钩子接力）**: `applyRunTerminalMaturity` 从 task.payload 解析锚并回写，集成测试必须真调它（真 Postgres、真构造 task 对象），验锚齐备→真回写落库 / 锚缺失→跳过，禁止 stub 掉 writeback 或 pg client。`finalizeKernelRun` 调用 `applyRunTerminalMaturity` 的接线由 ARTIFACT 源码断言 + E2E 覆盖（不 seed 完整 initiative_run，规避冻结测试对复杂 run schema 的脆弱依赖）。

（仅允许 mock 更外层无关依赖，如通知渠道；被改的边一律真调。需真 PG 的测试落 `*.integration.test.ts`，由 brain-integration job 起真 Postgres 跑。）

## 已知约束（来自回归测试 + 累积 FR + must_run_assertions）

- [migration-405-map-projection.test.js] node/edge 使用 stable id、受限类型（node_type/edge_type CHECK 枚举）与 run-scoped 引用 → 本单新增 `'canvas'`/`'stage'` 到 node_type CHECK 时必须保留既有 8 个枚举值，回归测试遍历断言其存在。
- [map-read-service] readMap 现有 summary 字段（value_streams/capabilities/boundaries/crosscuts/prerequisites）不得删除，只可新增 stages/stage_maturity。
- [累积FR] 本 line 暂无 done/working 历史（PRD 声明），无既有行为需保护。
- [must_run_assertions] MAP_NOT_CONFIGURED — task.payload.map_repo=null 且本 attempt DB 未连（localhost:5432 refused），Unified Map radius 未配置；本合同回归约束以 migration-405 回归测试 + map-read-service summary 契约为准，不回退到领域硬编码。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 画布 stages 由 golden_path 投影生成（map=SSOT，三层映射）；run 终态回写 step 成熟度到 map 体检表。 |
| **NFR（做得多好）** | | PRD 未指定超时/频控（待定）；并发多 run 回写同 scope 必须串行（advisory xact lock）。 |
| **Invariant（永不违反）** | | 见下 INV 覆盖；核心: 回写找不到 step 绝不写脏数据；node_type CHECK 既有枚举不得删。 |
| **判定点（怎么知道）** | | 见判定点登记表。 |
| **保质期（何时过期）** | | maturity 反映「最近一次 run」结果，无 TTL；换代后 receipt 锚过期 → 回写跳过（不覆盖旧值为脏）。 |
| **死亡告警（停了谁知道）** | | 回写失败/跳过必须写 Brain log（PRD NFR 可观测），可 grep `[map-writeback]` 追溯。 |
| **失败语义（挂了怎么办）** | | 见失败语义声明。 |
| **效果确认（已发≠已生效）** | | 回写返回 `{updated}`；调用方以 DB 中 `attributes.maturity` 实际值为准（集成测试 psql 复核），非「调用即成功」。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ run 终态对应哪个 step（回写锚） | A. 从 task.payload 显式 `gp_step_key`+`map_scope`; B. 从 routing receipt 反查 | A. task.payload 显式锚 | receipt 反查在换代后锚过期不可靠（PRD 边界），显式锚可判定「找不到即跳过」 | 锚错 → 回写到错 step，体检表误报（面客错误）→ 标 ⚠️ |
| step 是否存在于当前画布 | A. 查 active projection stage 节点 node_key; B. 查 golden_path 原表 | A. 查 active projection stage 节点 | 回写目标是 map 投影节点（体检表），非原表 | 误判存在 → jsonb_set 到不存在节点静默丢；误判不存在 → 漏回写 |

> judgment-pending-user: run 终态回写锚（gp_step_key 语义）—— PrepPRD 未拍板 receipt 锚过期的具体判定，合同采用 task.payload 显式锚 + 找不到即跳过，待主理人确认。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 回写时 step 不存在（换代/删除） | 跳过 + warn log，返回 skipped:true，**不写脏** | 是（找不到恒跳过） | 无（体检表保留旧值，不覆盖为脏） |
| 并发多 run 回写同 scope | advisory xact lock 串行 | 是（各自更新各自 stepKey） | 阻塞等锁，不脏写 |
| golden_path 空 / ability 空 | 画布仅 canvas 节点，0 stage | 是 | 空画布，不报错 |

### 输入对抗面

N/A —— 本 sprint 为纯 Brain 后端内部投影/回写逻辑，无对外暴露 agent 任务、无外部用户可写入接口（/api/brain/map 为内部读端点，写路由 /rebuild 受 internalAuthOrLoopback 保护）。

## Invariant 覆盖（铁律逐条映射）

- [多租户] N/A：map 投影按 scope_key 隔离，本 sprint 不引入跨租户读写。
- [真验证] 覆盖：writeback/read 断言走真 Postgres（integration.test.ts + E2E psql），非仅单测绿。
- [禁写死] 覆盖：maturity 从 outcome 推导、order_no 从 golden_path 读，无屏幕坐标/假 env 类写死值。
- [凭据安全] N/A：无凭据引入；DB_URL 由 Fleet 注入不入库不入 git。
- [单slot串行] N/A（执行编排层，非本 sprint 逻辑）；回写并发由 advisory lock 串行。
- [planner分支] N/A（proposer 用服务端签发 role branch）。
- [PR冲突路由] N/A（路由层，非本 sprint 逻辑）。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
SCOPE="F1"
BASE_URL="${BASE_URL:-http://127.0.0.1:5221}"
APP_PID=""
cleanup() {
  [ -z "$APP_PID" ] || kill "$APP_PID" 2>/dev/null || true
  rm -f /tmp/harness-brain.log
}
trap cleanup EXIT

# 1. schema bootstrap：按序应用全部 brain migrations 到空库（migrations 均 IF NOT EXISTS / ON CONFLICT，幂等）
# gate-allow: cheat/or-true 单条 migration 在全新空库按序 re-apply 容忍历史迁移个别 no-op 跳过；下方对目标表/列做硬断言
for f in $(ls packages/brain/migrations/*.sql | sort -V); do
  psql "$DB_URL" -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1 || true
done
# gate-allow: domain/db-no-time-window 下三条为 schema/DDL 元数据存在性探测（to_regclass / pg_constraint），非业务数据行，无历史冒充面也无 created_at 可加窗
psql "$DB_URL" -tAc "SELECT to_regclass('public.map_projection_nodes') IS NOT NULL" | grep -qx t || { echo "FAIL: map_projection_nodes 表缺失（bootstrap 未就绪）"; exit 1; }
psql "$DB_URL" -tAc "SELECT to_regclass('public.golden_path') IS NOT NULL" | grep -qx t || { echo "FAIL: golden_path 表缺失"; exit 1; }

# 2. 断言本 sprint 新增 migration 已把 'stage' 并入 node_type CHECK（查 pg_constraint 定义，schema 元数据）
STAGE_OK=$(psql "$DB_URL" -tAc "SELECT 1 WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conname='map_projection_nodes_node_type_check' AND pg_get_constraintdef(oid) LIKE '%stage%')")
[ "$STAGE_OK" = "1" ] || { echo "FAIL: node_type CHECK 未含 'stage'（本 sprint migration 缺失）"; exit 1; }

# 3. Step 2/6：纯投影 SSOT 引擎（golden_path steps → 有序 stage 节点 + 空 steps 不报错）
node --input-type=module -e "import(process.cwd()+'/packages/brain/src/lib/map-projector.js').then(m=>{const r=m.projectGoldenPathCanvas({scopeKey:'F1',ability:{key:'a',name:'A'},steps:[{key:'s2',name:'S2',order_no:2},{key:'s1',name:'S1',order_no:1,features:[{key:'f1',name:'F1'}]}]});const st=r.nodes.filter(n=>n.node_type==='stage');if(st.length!==2)throw new Error('stage count '+st.length);if(st[0].attributes.order_no!==1)throw new Error('order');if(!r.nodes.some(n=>n.node_type==='canvas'))throw new Error('canvas');if(!r.nodes.some(n=>n.node_type==='feature'))throw new Error('feature');if(r.edges.filter(e=>e.edge_type==='precedes').length!==1)throw new Error('precedes');const e=m.projectGoldenPathCanvas({scopeKey:'F1',ability:{key:'a',name:'A'},steps:[]});if(e.nodes.filter(n=>n.node_type==='stage').length!==0)throw new Error('empty');console.log('OK: SSOT projection')}).catch(err=>{console.error('FAIL',err.message);process.exit(1)})"

# 4. Step 4：回写成熟度落库 + 幂等跳过（真 Postgres，全程 tx rollback 无残留）
node sprints/09060638-kernel-c07dfadc/tests/verify-writeback.mjs

# 5. 启动真实 Brain（指向本 attempt 空库），等待健康
node packages/brain/server.js >/tmp/harness-brain.log 2>&1 &
APP_PID=$!
for i in $(seq 1 60); do
  curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/brain/health" 2>/dev/null | grep -q '^200$' && break
  [ "$i" = 60 ] && { echo "FAIL: Brain 未在 60s 内就绪"; cat /tmp/harness-brain.log; exit 1; }
  sleep 1
done

# 6. Step 5：seed 一份 active projection（含 stage 节点）后 GET /api/brain/map 暴露画布层 + 体检摘要
psql "$DB_URL" >/dev/null <<'SEEDSQL'
DO $$
DECLARE d uuid; mvid uuid; runid uuid; dg text := encode(sha256('e2e-F1-manifest'::bytea),'hex'); pg2 text := encode(sha256('e2e-F1-proj'::bytea),'hex');
BEGIN
  INSERT INTO decisions(category,topic,decision,reason,status)
    VALUES('judgment','e2e-canvas-seed','approved','e2e local_api seed','active') RETURNING id INTO d;
  INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at)
    VALUES('F1',1,d, jsonb_build_object('scope_key','F1','schema_version','1','source_decision_id',d::text), dg,'active',now())
    RETURNING id INTO mvid;
  INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at)
    VALUES('F1',mvid,dg,'{}'::jsonb,'map-projector-v1',pg2,'active',now()) RETURNING id INTO runid;
  INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name,attributes)
    VALUES(runid, encode(sha256('F1:canvas:a'::bytea),'hex'),'canvas','a','能力A画布','{"canvas_layer":"canvas"}'::jsonb);
  INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name,attributes)
  SELECT runid, encode(sha256(('F1:stage:step-'||n)::bytea),'hex'),'stage','step-'||n,'步骤'||n,
         jsonb_build_object('canvas_layer','stage','order_no',n,'maturity','unknown')
    FROM generate_series(1,3) n;
END $$;
SEEDSQL

RESP=$(curl -sf "$BASE_URL/api/brain/map?scope=F1")
echo "$RESP" | jq -e '(.summary.stages|type=="number") and (.summary.stage_maturity|type=="object") and ([.nodes[]|select(.type=="stage")]|length>=3)' >/dev/null || { echo "FAIL: /api/brain/map 未暴露画布层/体检摘要"; echo "$RESP" | head -c 500; exit 1; }

# 7. error path：缺 scope → 400 + error 字段
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/brain/map")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 scope 未返 400 (got $CODE)"; exit 1; }

echo "✅ Golden Path 验证通过（SSOT 投影 + 回写落库 + 体检表读出 + error path）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `writebackStepMaturity` outcome 传非 done/failed 值（如 'blocked'/''/null）→ 期望不写脏、明确报错或归 unknown，不得静默写入非法 maturity。
- 重复提交: 对同一 stepKey 连续两次回写不同 outcome → 期望最后一次 win，无并发脏写（advisory lock）。
- 中途中断: 回写事务中途 ROLLBACK → 期望 maturity 不落库（无半写）。
- 边界值: golden_path 单 step / 大量 step（如 200）→ 期望 stage 节点条数/顺序 1:1，precedes 边 = n-1。
发现分级: P0/P1（体检表误报成熟度 / 写脏数据 / 覆盖旧值为错）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 画布 SSOT 纯投影 | `sprints/09060638-kernel-c07dfadc/tests/canvas-projection.test.ts` | golden_path steps 投影为有序 stage 节点、feature 映射技能体、空 steps 画布为空不报错 | projectGoldenPathCanvas is not a function → N failures |
| node_type migration 扩展 | `sprints/09060638-kernel-c07dfadc/tests/node-type-migration.test.ts` | migration 把 canvas 与 stage 并入 node_type CHECK 且保留既有枚举 | 无新 migration 文件含 stage → fail |
| 回写落库+幂等+终态锚接力 | `sprints/09060638-kernel-c07dfadc/tests/maturity-writeback.integration.test.ts` | 回写更新 maturity 落库、缺失 step 幂等跳过不写脏、终态锚接力 applyRunTerminalMaturity 触发回写 | writebackStepMaturity is not a function → N failures |

补充行（repo 既有回归，仅引用不冻结）: `packages/brain/src/__tests__/migration-405-map-projection.test.js`（node_type/edge_type 枚举回归，本单扩展枚举不得破坏）。
