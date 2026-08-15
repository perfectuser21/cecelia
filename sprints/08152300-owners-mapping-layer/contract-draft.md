# Sprint Contract Draft (Round 1) — MJ5 OWNERS 映射层刀1

**journey_type**: user_facing
**target_environment**: mac_web

## 锚定父路声明

独立小路（无父路）—— journey 51754939 为 skeleton line，golden-paths 返回 `[]`，本刀锚定到 feature `92d14f1e`「OWNERS 映射层」（planned/thin → thin 可用），不覆盖任何已封版 Golden Path 的具体步。

## Unified Map 影响半径

`[MAP_NOT_CONFIGURED]` —— task.payload `map_repo=null`、`expected_files=null`；`map_scope=["MJ5"]` 为 capability，而非 map scope（实测 `GET /api/brain/map?scope=MJ5` manifest missing，`scope=cecelia` healthy，MJ5 是 cecelia scope 下 capability 节点，name=「承诺地图」）。因此 radius 记为 not_configured，本合同不注入 `must_run_assertions`（Step 1.0 输出为空），归属校验全部走 OWNERS 声明本身。

## GP-Anchor

gp-anchor: skipped (product-map.json not found) —— 当前仓库根不存在 `product-map/generated/product-map.json`（cecelia 仓），Step 1.7 整体跳过，不阻塞。

## Response Schema（推导来源: PRD 明确 + api_registry 现状推导 + NEW_PATTERN）

PRD 未在正文钉字段名（`## Response Schema 由 Proposer 在 Step 1.1 读 api_registry/db_schema 后推导`）。以下依据现网 `packages/brain/src/lib/map-read-service.js` / `routes/map.js` 实际返回结构推导，新增字段标 `[NEW_PATTERN]`。字段名一经本合同钉定即为 ground truth，generator 必须字面实现。

### Endpoint 1: `GET /api/brain/map/nodes/:key?scope=cecelia`（capability 详情，读；本刀扩展）

**Success (HTTP 200)** —— 在现有 `NodeResponse`（envelope + `node`/`upstream`/`downstream`/`boundaries`/`affected_nodes`）基础上新增：

```json
{
  "node": {"key": "MJ5", "type": "capability", "name": "承诺地图"},
  "owned_artifacts": [
    {"stable_ref": "packages/brain/src/map/radius.test.js", "fact_kind": "test", "capability_key": "MJ5", "owners_dir": "packages/brain/src/map", "source": "owners"}
  ]
}
```

- `owned_artifacts` (array, 必填, `[NEW_PATTERN]`): 按 OWNERS 声明确定性归属到该 capability 的照相层事实节点列表；空数组表示该 capability 无 OWNERS 声明覆盖。
  - `stable_ref` (string, 必填): 事实的稳定引用（test/graph=file_path 前缀匹配；api=path；db_schema=table_name），与现有 artifact 节点 `attributes.stable_ref` 同义。
  - `fact_kind` (string, 必填): `test`|`api`|`db_schema`|`graph` 之一（照相层四类，不新增口径）。
  - `capability_key` (string, 必填): 归属的 capability key，本刀样板恒为 `"MJ5"`。
  - `owners_dir` (string, 必填): 命中的 OWNERS 声明所在目录（相对仓根），供追溯「谁把它挂上来」。
  - `source` (string, 必填): 恒为 `"owners"`，区别于 legacy-ledger feature 锚点。

**禁用字段名**（`[NEW_PATTERN]`，禁止语义化改名）: `files` / `artifacts` / `owned` / `claimed` / `nodes`（这些是现有 map 其他语义占用词，owned_artifacts 不得改写成它们）；归属 key 字段名必须是 `capability_key`，禁用 `cap` / `capability` / `owner` 作为该字段名。

**Not Found (HTTP 404)**: `{"error": {"code": "MAP_NODE_NOT_FOUND", "message": "<string>"}}`（复用现网 `MapReadError` 形态，见 routes/map.js `sendError`）。

### Endpoint 2: `GET /api/brain/map/health?scope=cecelia`（健康，读；本刀扩展）

**Success (HTTP 200)** —— 在现有 `{overall, layers:{manifest,facts,projection,state_resolver}}` 基础上新增：

```json
{
  "overall": "degraded",
  "layers": {"owners": {"status": "degraded"}},
  "owners_conflicts": [
    {"path": "packages/brain/src/map/__tests__", "reason_code": "capability_not_in_manifest", "declared_capability": "cecelia/__NOT_A_REAL_CAP__"}
  ]
}
```

- `layers.owners.status` (string, 必填, `[NEW_PATTERN]`): `ok`|`degraded`；存在任一冲突时为 `degraded`，并使 `overall` 变 `degraded`（PRD「/map/health 亮黄」）。无冲突且 owners 快照新鲜时为 `ok`。
- `owners_conflicts` (array, 必填, `[NEW_PATTERN]`): 声明冲突清单；无冲突时为空数组 `[]`。
  - `path` (string, 必填): 冲突声明所在目录（相对仓根）。
  - `reason_code` (string, 必填): `duplicate_capability_declaration` | `capability_not_in_manifest` | `step_not_in_product_map` | `owners_parse_error` 四者之一。
  - `declared_capability` (string, 可选): 声明里写的 capability（用于人肉追溯）；`owners_parse_error` 另带 `line` (number)。

**禁用字段名**: `conflicts` 顶层裸键（必须是 `owners_conflicts`，避免与 impact-contract 语义混淆）；reason 字段名必须是 `reason_code`，禁用 `reason` / `code` / `type`。

### Endpoint 3: `GET /api/brain/map/unclaimed?scope=cecelia`（无主清单，读；形状不变）

现网返回 `{...envelope, unclaimed_count: <int>, unclaimed: [{repo, fact_kind, method?, stable_ref}]}`。本刀不改形状，只要求：OWNERS 样板落地 + rebuild 后，被声明目录下的事实从 `unclaimed` 移出，`unclaimed_count` 相对 rebuild 前**下降**。

### Endpoint 4: `POST /api/brain/map/rebuild {"scope_key":"cecelia"}`（重投影，写；形状不变）

现网返回 `{...envelope, rebuilt: true}`，`internalAuthOrLoopback`（loopback 免 token）。本刀不改形状，只要求 rebuild 后投影包含 OWNERS 归属结果。

## 真实调用方请求 shape

本刀无「设备/agent 调服务端」外部调用方；唯一带鉴权的写端点是 `POST /api/brain/map/rebuild` 与内部扫描器：

- 认证方式：`internalAuthOrLoopback`（`packages/brain/src/middleware/internal-auth.js`）——本机 loopback（127.0.0.1）直接放行；非 loopback 需 header `X-Internal-Token: $CECELIA_INTERNAL_TOKEN`。E2E 在本机执行，走 loopback，不传 token（与现网 `map.test.js` 一致）。
- 扫描器 `scripts/scan/scan-owners.js` 通过 `packages/brain/src/lib/fact-snapshot-header.js` 的 `upsertFactSnapshotHeader(client,'owners',{repo,sourceRevision,scannerVersion,rowCount})` 写 header——generator 必须把 `'owners'` 加入该文件 `SNAPSHOT_KINDS` 集合，否则写入抛 `unsupported snapshot header kind`。字段名逐字与现有四类扫描器一致。

## 已知约束（来自回归测试 + 累积 FR + 铁律）

来自回归测试（`packages/brain/src/lib/__tests__/map-read-service.test.js`、`packages/brain/src/map/__tests__/*.test.js`、`packages/brain/src/routes/__tests__/map.test.js`）：
- [map-read-service.test.js] → 四类 repo snapshot 都新鲜时返回可追溯 fresh 汇总（`summarizeMapFreshness` 依赖 `REQUIRED_FACT_KINDS`——新增 `owners` 会进入 fresh 判定，generator 须同步样板扫描保证 cecelia owners 快照新鲜，否则既有 fresh 汇总回归变 unknown）。
- [map.test.js] → `/nodes/F0`、`/health`、`/unclaimed` 现网 200；`/rebuild` 未授权（非 loopback 无 token）401——本刀不得放松该鉴权。
- [projector.test.js / manifest-schema.test.js] → 投影确定性（node_id/edge_id 稳定哈希、排序）——OWNERS 投影产物必须同样走 `stableMapNodeId`/排序，保持 `projection_digest` 幂等。

累积 FR `[累积FR]`：journey 51754939 golden-paths 返回 `[]`（skeleton line，无历史沉淀），本 line 暂无累积 FR 约束（context-manifest 无条目）。

铁律映射（Invariant → DoD，见 contract-dod.md INV 条目）：
- INV-1 [不猜归属]：声明冲突即报不投影 → B-04 proven-to-fire 覆盖。
- INV-2 [租户隔离]：map 投影是 scope 级只读聚合，不碰 per-tenant 业务数据行 → DoD 标 `N/A：本刀不读写租户数据表，投影只聚合照相层事实（test/api/db_schema/graph）与 OWNERS 声明，无租户维度`。
- INV-3 [测试默认多租户]：同上，无租户数据面 → DoD 标 `N/A：无租户数据，逻辑守卫单测种入的是 OWNERS 声明与事实 fixture，非租户`。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | Brain 读目录级 OWNERS 声明（kind=owners 新事实）→ 确定性投影照相层事实到 capability/step → `/nodes/:key` 出 `owned_artifacts`、`/health` 出 `owners_conflicts`、`/unclaimed` 下降、`/map` Level-2 声明驱动渲染 |
| **NFR（做得多好）** | 性能/并发阈值 | PrepPRD 未钉超时/频控；沿用现网 map 读一致性快照（`runConsistentMapRead`）+ rebuild advisory lock；投影须幂等（同一 OWNERS 集合两次 rebuild `projection_digest` 一致） |
| **Invariant（永不违反）** | 不变量 | 不猜归属（冲突即报不投影）；不改照相层四类事实口径；不建平行账本（不改 journey_step_links/GP 11 要素结构）；投影确定性哈希 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | owners 快照沿用照相层 >24h stale / 10min 哨兵；OWNERS 文件删除后下次扫描即从投影移除 |
| **死亡告警（停了谁知道）** | 谁多久知道 | 扫描器停摆 >24h → `/registry` 与 `/map/health` freshness 变 stale/degraded（既有哨兵，不新增口径）；冲突→`/map/health` owners 层 degraded |
| **失败语义（挂了怎么办）** | 放行/拦截 | 冲突/解析错=拦截该条声明（不投影），不静默、不猜；单文件 YAML 解析失败不使整仓扫描失败（进冲突清单带行号）；见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执方式 | 每次投影结果通过 `POST /rebuild` 回执 + `GET /nodes/:key` owned_artifacts + `GET /health` owners 层同步可查；E2E proven-to-fire 先见红（冲突 degraded）再改绿 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ 声明作用域怎么算（一个 OWNERS 管到哪） | A) 本目录及全部子目录，子目录 OWNERS 覆盖父级（Meta 语义）; B) 仅当前目录 | A | 与 Meta OWNERS 一致，少写文件 | 选 B 声明爆炸、漏声明；选 A 须明确「子覆盖父」避免双归属 |
| ⚠️ 同一路径多重声明怎么处理 | A) 报冲突不投影; B) 取最深目录; C) 全部投影 | A（冲突即报） | 主理人拍板「映射必须准」，不猜 | 选 B/C 静默错归属，正是主理人反对的 |
| capability key 合法性 | 必须存在于该 scope active manifest capabilities | 唯一候选 | 地图 SSOT | 不校验 → 声明打空/错挂 |
| 事实归属粒度 | 文件级：test/graph 按 file_path 前缀匹配；api/db_schema 按其源文件/table 路径匹配 | 唯一候选（现有事实表已有路径字段则用之，缺则本刀补） | 照相层字段实况 | 粒度错把别人的事实挂到我名下 |

⚠️ 两条判定点（作用域、多重声明）已由主理人 2026-08-15 拍板（对照 Meta OWNERS，07-18 决策），非待确认。`judgment-pending-user: 无`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 503 不写库 | 是 | 客户端重试 |
| OWNERS YAML 解析失败 | 该文件进 `owners_conflicts`（reason=owners_parse_error, line=N），**不使整仓扫描失败** | 是（同内容重扫同结果） | 其余合法声明照常投影 |
| capability key 不在 manifest / step 不在 product-map | 该声明进冲突清单（reason=capability_not_in_manifest / step_not_in_product_map），不投影 | 是 | 该目录退回无主清单/父级 |
| 同一路径重复声明（非父子覆盖） | 冲突清单（reason=duplicate_capability_declaration），两侧都不投影 | 是 | 该路径不上图，进冲突可见 |
| 扫描器进程挂 | 沿用 >24h stale 哨兵报红（照相层规矩），不新增口径 | 是 | freshness=unknown |

### 输入对抗面

`N/A` —— 本刀非对外暴露 agent；OWNERS 文件是仓内代码评审进仓的可信输入（PR 门禁把关），非外部用户可写接口；rebuild/scan 走 internal-auth/loopback。无 prompt injection 面。

## Golden Path

[开发者放 OWNERS 声明] → [Brain 读为 kind=owners 事实] → [rebuild 确定性投影] → [`/nodes` owned_artifacts + `/unclaimed` 下降] → [冲突→`/health` 亮黄不投影] → [`/map` Level-2 声明驱动渲染]

### Step 1: 开发者在目录放 OWNERS 声明（cecelia 样板）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1、6 步（`packages/brain/src/map/`、`apps/dashboard/src/pages/map/` 贴 `capability: cecelia/MJ5`）

**可观测行为**: 仓内出现 `packages/brain/src/map/OWNERS` 与 `apps/dashboard/src/pages/map/OWNERS`，内容为合法 YAML（`capability: cecelia/MJ5`）。

**验证命令**:
```bash
test -f packages/brain/src/map/OWNERS && grep -q 'capability:[[:space:]]*cecelia/MJ5' packages/brain/src/map/OWNERS || { echo FAIL; exit 1; }
```
**硬阈值**: 两个样板 OWNERS 文件存在且含 `capability: cecelia/MJ5`。

---

### Step 2: Brain 扫描读 OWNERS → kind=owners 事实
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步（新事实种类 kind=owners，`fact_snapshot_headers` + REQUIRED_FACT_KINDS + 哨兵）

**可观测行为**: 跑 owners 扫描后，`fact_snapshot_headers` 出现 `kind='owners' AND repo='cecelia'` 行，`row_count ≥ 2`（样板目录数），`source_revision` 为完整 git object id（哨兵生效）。

**验证命令**:
```bash
SCAN_REPO_NAME=cecelia node scripts/scan/scan-owners.js
psql "${MAP_DATABASE_URL:-postgres://cecelia@localhost:5432/cecelia}" -tAc "SELECT row_count FROM fact_snapshot_headers WHERE kind='owners' AND repo='cecelia'" | awk 'NR==1{ if($1+0>=2) exit 0; exit 1 }'
```
**硬阈值**: kind=owners 行存在且 row_count ≥ 2。

---

### Step 3: rebuild 按声明确定性投影
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步（rebuild/read 时把目录下事实确定性挂到 capability）

**可观测行为**: `POST /rebuild {scope_key:cecelia}` 返回 `rebuilt:true`；两次 rebuild 的 `projection_digest` 相同（幂等）。

**验证命令**:
```bash
curl -sf -X POST localhost:5221/api/brain/map/rebuild -H 'Content-Type: application/json' -d '{"scope_key":"cecelia"}' | jq -e '.rebuilt==true'
```
**硬阈值**: rebuilt=true；`AI_ADDED` 幂等：`projection_digest` 两次一致。

---

### Step 4: `/nodes/MJ5` 出 owned_artifacts；`/unclaimed` 下降
**来源**: `[FROM_PRD]` — PRD 完成后用户能第 2 条（`GET /nodes/<capability>` 拿按 OWNERS 归属列表）+ 验收标准第 2 条（unclaimed 下降）

**可观测行为**: `GET /nodes/MJ5?scope=cecelia` 的 `owned_artifacts` 含 `packages/brain/src/map/radius.test.js`，每项 `capability_key=="MJ5"`；rebuild 后 `unclaimed_count` 低于 rebuild 前基线，且被声明文件不再出现在 `unclaimed`。

**验证命令**:
```bash
curl -sf "localhost:5221/api/brain/map/nodes/MJ5?scope=cecelia" | jq -e '[.owned_artifacts[].stable_ref] | index("packages/brain/src/map/radius.test.js")'
curl -sf "localhost:5221/api/brain/map/unclaimed?scope=cecelia" | jq -e '([.unclaimed[].stable_ref] | index("packages/brain/src/map/radius.test.js")) | not'
```
**硬阈值**: owned_artifacts 含样板文件；该文件从 unclaimed 移出。

---

### Step 5: 冲突即报不投影（proven-to-fire）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 + 验收标准第 3 条（双重/非法声明 → /health 报冲突且不投影，先见红再改绿）

**可观测行为**: 制造一个非法 capability 声明（`capability: cecelia/__NOT_A_REAL_CAP__`）→ 扫描 + rebuild 后 `/health?scope=cecelia` 的 `owners_conflicts` 含该 path 且 `layers.owners.status=="degraded"`、`overall=="degraded"`；移除后重扫重建 → `layers.owners.status=="ok"`（红→绿）。

**验证命令**:
```bash
# 见 ## E2E 验收 段的 proven-to-fire 完整流程（造红→断言→清理→复绿）
curl -sf "localhost:5221/api/brain/map/health?scope=cecelia" | jq -e '.owners_conflicts | type=="array"'
```
**硬阈值**: 冲突态 owners_conflicts 非空 + owners 层 degraded；清理后复绿。

---

### Step 6: `/map` Level-2 声明驱动渲染（非 UUID 串）
**来源**: `[FROM_PRD]` — PRD 客户视角 + 验收标准第 4 条（`/map` Level-2 对 MJ5 显示声明驱动目录/文件列表，Playwright 截图断言）

**可观测行为**: 浏览器打开 `/map`（scope=cecelia）→ 点 MJ5 → Level-2「承诺地图」面板的「事实锚点」列表出现真实文件路径（如 `packages/brain/src/map/radius.test.js`），不是空、不是 UUID 串。

**验证命令**: 见 `## E2E 验收` Playwright 段（`toBeVisible` 断言 + 截图）。

**硬阈值**: Level-2 事实锚点列表含样板文件路径文本，截图留证。

---

## 禁 mock 边清单

本单涉及「跨模块数据传递」（OWNERS 声明 → 投影 → 读服务）与「DB 写路径」（新写 `fact_snapshot_headers` kind=owners），故：

- 代码 ↔ DB 表 `fact_snapshot_headers`（本单新增 kind=owners 写路径，B-01 必须真 Postgres 验行落库，禁 mock）
- owners-reader ↔ map 投影/读服务（本单改了「声明→capability 归属」这条边，B-02/B-04 必须真 rebuild + 真 `/nodes`、`/health` 读，禁 mock 被改的这条边）

逻辑守卫单测（`tests/owners-reader.test.ts`）测的是**纯函数**（YAML 解析 / 作用域 child-覆盖-parent / 冲突判定 / capability 合法性），无被改的接缝边可 mock（不碰 DB、不碰相邻投影模块）；接缝边（DB 写、跨模块投影）由上面 BEHAVIOR/E2E 真 PG + 真 Brain 覆盖。generator 测试中若对 `fact_snapshot_headers` 或投影/读服务这两条边用 `vi.mock`/stub 即违约（CONTRACT IS LAW）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）—— E2E 全程真扫描器、真 Postgres、真 Brain API、真 Playwright 浏览器，无 force_*/stub/假数据。

## E2E 验收（最终 final-e2e 跑 — target_environment=mac_web）

> evaluator 1.22.0 起提取本段全部 bash 块按序拼接执行；本段单块。后端 curl+psql 为强 oracle，Playwright 为 Level-2 UI 断言。前置：Brain 已在 localhost:5221（现网服务），Postgres 可达，OWNERS 样板已由 generator 提交进仓。

```bash
#!/bin/bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PGURL="${MAP_DATABASE_URL:-postgres://cecelia@localhost:5432/cecelia}"
SPRINT_DIR="sprints/08152300-owners-mapping-layer"
mkdir -p "$SPRINT_DIR/screenshots"
CONFLICT_DIR="packages/brain/src/map/__tests__"
CONFLICT_OWNERS="$CONFLICT_DIR/OWNERS"
cleanup() { rm -f "$CONFLICT_OWNERS" 2>/dev/null || true; }
trap cleanup EXIT

# --- Step 1: 样板 OWNERS 存在 ---
test -f packages/brain/src/map/OWNERS || { echo "FAIL: 缺 packages/brain/src/map/OWNERS"; exit 1; }
test -f apps/dashboard/src/pages/map/OWNERS || { echo "FAIL: 缺 dashboard OWNERS 样板"; exit 1; }
grep -q 'capability:[[:space:]]*cecelia/MJ5' packages/brain/src/map/OWNERS || { echo "FAIL: 样板未声明 cecelia/MJ5"; exit 1; }

# --- 基线：投影前 unclaimed ---
BASE_UNCLAIMED=$(curl -sf "$BRAIN/api/brain/map/unclaimed?scope=cecelia" | jq -r '.unclaimed_count')
echo "baseline unclaimed=$BASE_UNCLAIMED"

# --- Step 2: 跑 owners 扫描 → kind=owners 事实 ---
SCAN_REPO_NAME=cecelia node scripts/scan/scan-owners.js
OWNERS_ROWS=$(psql "$PGURL" -tAc "SELECT row_count FROM fact_snapshot_headers WHERE kind='owners' AND repo='cecelia'" | head -1 | tr -d ' ')
[ "${OWNERS_ROWS:-0}" -ge 2 ] || { echo "FAIL: kind=owners row_count=$OWNERS_ROWS <2"; exit 1; }
SR=$(psql "$PGURL" -tAc "SELECT source_revision FROM fact_snapshot_headers WHERE kind='owners' AND repo='cecelia'" | head -1 | tr -d ' ')
echo "$SR" | grep -Eq '^[0-9a-f]{40}$' || { echo "FAIL: owners source_revision 非完整 git id: $SR"; exit 1; }

# --- Step 3: rebuild 确定性投影（幂等）---
curl -sf -X POST "$BRAIN/api/brain/map/rebuild" -H 'Content-Type: application/json' -d '{"scope_key":"cecelia"}' | jq -e '.rebuilt==true' >/dev/null || { echo "FAIL: rebuild 未 rebuilt"; exit 1; }
D1=$(curl -sf -X POST "$BRAIN/api/brain/map/rebuild" -H 'Content-Type: application/json' -d '{"scope_key":"cecelia"}' | jq -r '.projection_digest')
D2=$(curl -sf -X POST "$BRAIN/api/brain/map/rebuild" -H 'Content-Type: application/json' -d '{"scope_key":"cecelia"}' | jq -r '.projection_digest')
[ -n "$D1" ] && [ "$D1" = "$D2" ] || { echo "FAIL: projection_digest 非幂等 d1=$D1 d2=$D2"; exit 1; }

# --- Step 4: /nodes/MJ5 owned_artifacts + capability_key + /unclaimed 下降 ---
NODE=$(curl -sf "$BRAIN/api/brain/map/nodes/MJ5?scope=cecelia")
echo "$NODE" | jq -e '[.owned_artifacts[].stable_ref] | index("packages/brain/src/map/radius.test.js")' >/dev/null || { echo "FAIL: owned_artifacts 缺样板文件"; exit 1; }
echo "$NODE" | jq -e '.owned_artifacts | length >= 1 and all(.[]; .capability_key=="MJ5" and .source=="owners")' >/dev/null || { echo "FAIL: owned_artifacts schema/归属不符"; exit 1; }
AFTER_UNCLAIMED=$(curl -sf "$BRAIN/api/brain/map/unclaimed?scope=cecelia" | jq -r '.unclaimed_count')
[ "$AFTER_UNCLAIMED" -lt "$BASE_UNCLAIMED" ] || { echo "FAIL: unclaimed 未下降 base=$BASE_UNCLAIMED after=$AFTER_UNCLAIMED"; exit 1; }
curl -sf "$BRAIN/api/brain/map/unclaimed?scope=cecelia" | jq -e '([.unclaimed[].stable_ref] | index("packages/brain/src/map/radius.test.js")) | not' >/dev/null || { echo "FAIL: 样板文件仍在 unclaimed"; exit 1; }

# --- Step 5: 冲突 proven-to-fire（造红 → 断言 → 清理 → 复绿）---
printf 'capability: cecelia/__NOT_A_REAL_CAP__\n' > "$CONFLICT_OWNERS"
SCAN_REPO_NAME=cecelia node scripts/scan/scan-owners.js
curl -sf -X POST "$BRAIN/api/brain/map/rebuild" -H 'Content-Type: application/json' -d '{"scope_key":"cecelia"}' >/dev/null
HEALTH_RED=$(curl -sf "$BRAIN/api/brain/map/health?scope=cecelia")
echo "$HEALTH_RED" | jq -e '.layers.owners.status=="degraded"' >/dev/null || { echo "FAIL: 冲突未使 owners 层 degraded"; exit 1; }
echo "$HEALTH_RED" | jq -e '.overall=="degraded"' >/dev/null || { echo "FAIL: 冲突未使 overall degraded(亮黄)"; exit 1; }
echo "$HEALTH_RED" | jq -e '[.owners_conflicts[] | select(.reason_code=="capability_not_in_manifest")] | length >= 1' >/dev/null || { echo "FAIL: owners_conflicts 未含 capability_not_in_manifest"; exit 1; }
# 该非法声明的 __tests__ 目录不得被投影到不存在的 capability（不猜）
curl -s "$BRAIN/api/brain/map/nodes/__NOT_A_REAL_CAP__?scope=cecelia" -o /dev/null -w '%{http_code}' | grep -q 404 || { echo "FAIL: 非法 capability 竟被投影出节点"; exit 1; }
cleanup
SCAN_REPO_NAME=cecelia node scripts/scan/scan-owners.js
curl -sf -X POST "$BRAIN/api/brain/map/rebuild" -H 'Content-Type: application/json' -d '{"scope_key":"cecelia"}' >/dev/null
curl -sf "$BRAIN/api/brain/map/health?scope=cecelia" | jq -e '.layers.owners.status=="ok"' >/dev/null || { echo "FAIL: 清理后 owners 层未复绿"; exit 1; }
echo "backend E2E PASS"

# --- Step 6: /map Level-2 Playwright 声明驱动渲染 ---
DASH="$ROOT/apps/dashboard"
( cd "$DASH" && VITE_SKIP_AUTH=true npx vite build >/tmp/vite-owners-build.log 2>&1 ) || { echo "FAIL: dashboard build 失败(见 /tmp/vite-owners-build.log)"; exit 1; }
( cd "$DASH" && VITE_SKIP_AUTH=true npx vite preview --port 5174 --host >/tmp/vite-owners-e2e.log 2>&1 & echo $! > /tmp/vite-owners.pid )
VPID=$(cat /tmp/vite-owners.pid)
stop_vite() { kill "$VPID" 2>/dev/null || true; }
trap 'cleanup; stop_vite' EXIT
for i in $(seq 1 30); do curl -sf "http://localhost:5174" >/dev/null 2>&1 && break; [ "$i" = 30 ] && { echo "FAIL: vite preview 未就绪"; exit 1; }; sleep 1; done
( cd "$DASH" && E2E_BASE_URL="http://localhost:5174" SPRINT_SHOTS="$ROOT/$SPRINT_DIR/screenshots" node "$ROOT/$SPRINT_DIR/tests/map-owners-ui.spec.mjs" )
echo "✅ Golden Path E2E 验证通过（后端真验 + Level-2 UI 截图）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `packages/brain/src/map/OWNERS` 写成非法 YAML（如 `capability: [unclosed`）→ 期望进 owners_conflicts(reason=owners_parse_error, line=N)，**不使整仓扫描失败**、其余声明照常投影。
- 重复提交: 连续 3 次 `POST /rebuild` → owned_artifacts 与 projection_digest 保持一致（幂等，不重复挂节点）。
- 中途中断: owners 扫描进行中删除样板 OWNERS 文件 → 下次 rebuild 该目录事实退回 unclaimed，不残留幽灵归属。
- 边界值: OWNERS 声明 `step: step999`（不在 product-map）→ owners_conflicts(reason=step_not_in_product_map)，capability 级仍可投影 or 整条不投影（按实现，须与 /health 一致，不静默）；空 OWNERS 文件（0 字节）→ 视为无声明，进无主清单，不报错。
- 父子覆盖: 父目录声明 MJ5、子目录声明另一合法 capability → 子覆盖父（非冲突），子目录事实归子、父其余归父。
发现分级: P0/P1（错归属 / 声明冲突被静默投影 / 整仓扫描因单文件崩）→ 阻塞 merge；P2/P3（UI 文案/排序）→ 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| OWNERS 解析/作用域/冲突/合法性纯函数 | `tests/owners-reader.test.ts` | `解析合法 OWNERS`；`YAML 解析失败带行号`；`子目录覆盖父级`；`capability 不在 manifest 判冲突`；`同一路径重复声明判冲突`；`按前缀投影事实到 capability` | → 6 failures（`owners-reader.js` 不存在，import 即失败）|
| Level-2 声明驱动 UI | `tests/map-owners-ui.spec.mjs` | （E2E Playwright，非 vitest oracle）| — |
