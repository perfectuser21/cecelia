# Sprint Contract Draft (Round 1) — MJ5 OWNERS 映射层刀1：Brain 读目录级 OWNERS 声明并确定性投影

**锚定父路声明**：独立小路（无父路）—— feature `92d14f1e` OWNERS 映射层；GP-Anchor `factory/MJ5 keep-green`（keep-green，本刀不新增 MJ5 步骤，只加厚投影能力）。

**journey_type**: user_facing
**target_environment**: mac_web（Playwright `/map` 截图断言 localhost:5174 + 同机 curl localhost:5221 API 断言）

---

## Unified Map 半径

- `map_scope` = `["MJ5"]`，`map_repo` = `null`，`expected_files` = `null`（task.payload 实况）。
- 影响半径 `[MAP_NOT_CONFIGURED]`：`map_repo`/`expected_files` 缺失，本轮无 `must_run_assertions` 注入，禁止回退领域硬编码；合同的必跑断言以下方 Golden Path/DoD 为准。

---

## Response Schema（推导来源: PRD 未定义 HTTP schema → 由 proposer 按现有 map 端点实况 + api_registry 惯例推导；本刀新增字段标 [NEW_PATTERN]）

现有 map 端点（`packages/brain/src/routes/map.js` + `map-read-service.js`）返回统一 envelope：
`scope_key / manifest_version_id / manifest_version / manifest_digest / projection_run_id / projection_digest / fact_revisions / generated_at / freshness`。本刀在此基础上叠加 OWNERS 字段，**不改动**既有字段名。

### Endpoint: GET /api/brain/map/health?scope=cecelia
**Success (HTTP 200)**（既有 envelope + `overall` + `layers` + 新增 `owners`）:
```json
{
  "overall": "healthy|degraded",
  "layers": {"manifest": {"status": "ok"}, "facts": {"status": "..."}, "projection": {"status": "ok"}, "state_resolver": {"status": "ok"}},
  "owners": {
    "status": "ok|degraded",
    "snapshot": {"kind": "owners", "row_count": 3, "source_revision": "abc123", "scanned_at": "2026-08-16T00:00:00.000Z"},
    "conflicts": [{"path": "packages/x", "capabilities": ["MJ5", "F0"], "reason": "multiple_declarations"}]
  }
}
```
- `owners.snapshot.row_count` (int, 必填): 本 scope 已读取的 OWNERS 声明文件数（kind=owners 事实行数）。来源——[NEW_PATTERN]
- `owners.snapshot.source_revision` (string|null, 必填): 声明快照的 git 版本哨兵（照相层规矩）。来源——[NEW_PATTERN]
- `owners.status` (string, 必填): 有冲突/语法错 → `degraded`（"亮黄"），否则 `ok`。来源——[NEW_PATTERN]
- `owners.conflicts` (array, 必填, 无冲突时为 `[]`): 每条 `{path, capabilities[], reason}`。来源——[NEW_PATTERN]
**禁用字段名**: `owner`（单数、语义歧义）/ `owns` / `claims`（与既有 crosscut `owned_by` 边混淆）——OWNERS 层字段一律挂在顶层 `owners` 对象内。
**Error**: 缺 `scope` → HTTP 400 `{"error": {"code": "MAP_SCOPE_REQUIRED", "message": "..."}}`（既有行为，不改）。

### Endpoint: GET /api/brain/map/nodes/MJ5?scope=cecelia
**Success (HTTP 200)**（既有 node envelope + 新增 `owned_artifacts`）:
```json
{
  "node": {"key": "MJ5", "type": "capability", "name": "承诺地图"},
  "upstream": [], "downstream": [], "boundaries": [], "affected_nodes": [],
  "owned_artifacts": [{"repo": "cecelia", "fact_kind": "graph", "stable_ref": "packages/brain/src/map/projector.js", "method": null}]
}
```
- `owned_artifacts` (array, 必填, 无声明时为 `[]`): 按 OWNERS 声明确定性归属到本 capability 的照相层事实。每条含 `repo/fact_kind/stable_ref/method`（与 `findUnclaimedFacts` 的 factKey 口径逐字段一致，见 `map-read-service.js:24`）。来源——[NEW_PATTERN]
**禁用字段名**: `files` / `owned_files` / `artifacts`（含义模糊，不区分事实种类）——统一用 `owned_artifacts`。
**Error**: 未知 capability key → HTTP 404 `{"error": {"code": "MAP_NODE_NOT_FOUND", "message": "..."}}`（既有行为，不改）。

### Endpoint: GET /api/brain/map/unclaimed?scope=cecelia
**Success (HTTP 200)**: 既有 `{"unclaimed_count": <int>, "unclaimed": [...]}`（**不改**）。OWNERS 投影后被归属的事实从此列表移除 → `unclaimed_count` 单调下降。

### Endpoint: POST /api/brain/map/rebuild  body `{"scope_key": "cecelia"}`
**Success (HTTP 200)**: 既有 envelope + `{"rebuilt": true}`（**不改**）。鉴权：`internalAuthOrLoopback`（loopback 放行；跨机需 `X-Internal-Token`）。
**Error**: 缺 `scope_key` → HTTP 400 `MAP_SCOPE_REQUIRED`（既有）。

---

## 已知约束（来自回归测试 + 累积 FR + 铁律）

来源标注：`[回归测试]` / `[累积FR]` / `[铁律]`

- `[回归测试]` `packages/brain/src/routes/__tests__/map.test.js` → nodes/health/unclaimed/radius/rebuild 现有响应与鉴权（401 未授权 rebuild）不得破坏
- `[回归测试]` `packages/brain/src/map/radius.test.js` → 影响半径投影确定性（同输入同 digest）不得破坏
- `[回归测试]` `packages/brain/src/__tests__/integration/map-state-resolver.integration.test.js` → 节点状态解析不得破坏
- `[回归测试]` `apps/api/features/planning/pages/MapPage.test.tsx` / `MapPage.auth.test.tsx` → `/map` 页现有渲染与鉴权不得破坏
- `[累积FR]` journey `51754939` 为 skeleton，认领制三闸 / 引用重跑闸图驱动 两 sibling 均 working/thin 未毕业 → 本 line 暂无已验收 ability 约束（context-manifest: 本轮以 PRD 累积 FR 段为准，无追加）
- `[铁律]` 见下方「铁律 → INV 映射」（六条逐条落 DoD）

**铁律 → INV 映射**（每条铁律映射到 DoD 一条 INV-N 或显式 N/A）：
- INV-1 [不猜归属] → DoD INV-1：无 OWNERS 覆盖的路径不进任何 capability，`unclaimed_count` 投影后仍 > 5000（照相层不定归属）
- INV-2 [冲突即报] → DoD INV-2：双重声明冲突进 `owners.conflicts` 且该路径不出现在任一 capability 的 `owned_artifacts`（proven-to-fire 由 conflict 集成测试红→绿担保）
- INV-3 [key 合法性] → DoD INV-3：声明的 capability key 不在 active manifest → 该声明打空进 conflicts（`reason:"unknown_capability"`），不投影
- INV-4 [子覆盖父] → DoD INV-4：子目录 OWNERS 覆盖父级（单元测试断言最深声明生效，父级不重复归属）
- INV-5 [禁平行账本] → N/A 断言：本刀不改 `journey_step_links` / GP 封版 11 要素结构；由既有 `map.test.js` + `npm run test:product-map`（zenithjoy 侧）保持绿担保（DoD INV-5 CI 绿）
- INV-6 [planner 分支纪律] → N/A：proposer 使用服务端注入的 `$PROPOSE_BRANCH`，不自行 checkout 业务分支

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺 | Brain 读目录级 OWNERS 声明（YAML）为 kind=owners 事实；rebuild 时按声明把照相层事实（test/api/db_schema/graph）确定性挂到对应 capability；冲突即报不投影；`/map` Level-2 与 `/nodes/<cap>` 声明驱动展示 |
| **NFR（做得多好）** | 性能/可靠性 | 投影确定性（同声明+同事实→同结果，无随机）；rebuild 单次 < 30s；owners 读取只读声明不解析代码语义；不引入第三方 OWNERS 解析库 |
| **Invariant（永不违反）** | 不变量 | 见 INV-1..6：不猜归属 / 冲突即报 / key 合法性 / 子覆盖父 / 禁平行账本 / planner 分支纪律 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下「判定点登记表」 |
| **保质期（何时过期）** | 失效与退役 | owners 事实沿用照相层新鲜度哨兵：>24h 未刷新标 stale（health degraded），10min 扫描窗；OWNERS 文件删除后下次 scan+rebuild 即从投影移除 |
| **死亡告警（停了谁知道）** | 告警手段 | owners scanner 挂 → fact_snapshot_headers(kind=owners).scanned_at 老化 → `/map/health` `owners.status=degraded`（既有照相层 stale 报红路径复用） |
| **失败语义（挂了怎么办）** | 故障策略 | 见下「失败语义声明」 |
| **效果确认（已发≠已生效）** | 回执方式 | rebuild 返回 `rebuilt:true` 仅表示投影完成；真实生效以 `/nodes/MJ5` `owned_artifacts` 非空 + `unclaimed_count` 下降为准（DoD B-02/B-03 亲验） |

### 判定点登记表（decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ OWNERS 作用域算到哪 | A) 目录及全部子目录，子覆盖父（Meta 语义）; B) 仅当前目录 | A | 与 Meta OWNERS 一致，少写声明文件 | 选 B 声明数量爆炸/漏声明；选 A 需显式"子覆盖父"避免双归属 |
| ⚠️ 同一路径多重声明 | A) 报冲突不投影; B) 取最深目录; C) 全部投影 | A（冲突即报） | 主理人拍板"映射必须准，不猜" | 选 B/C 静默产生错归属（正是主理人反对的"扫坏了就坏了"） |
| capability key 合法性 | 必须在该 scope active manifest capabilities 内 | 唯一候选 | 地图 SSOT | 不校验 → 声明打空、错挂 |
| 事实归属粒度 | test/graph 按 file_path 前缀匹配；api/db_schema 按其源文件路径 | 唯一候选（现有事实表已有路径字段则用之） | 照相层字段实况（`map-read-service.js:384` loadAllFacts） | 粒度错把别人的 API 挂到 MJ5 名下 |

> ⚠️ 判定点均已在 PrepPRD/PRD 边界情况段由主理人拍板（决策 07-18/08-15），无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| OWNERS YAML 语法错 | 该文件不投影、进 conflicts（带文件路径/行号），不 crash 整个 rebuild | 是（幂等：同声明同结果） | 其余合法声明正常投影 |
| 声明的 capability key 不在 manifest | 该声明打空、进 conflicts（`unknown_capability`），不投影 | 是 | 不影响其他声明 |
| 同一路径双重声明 | 报冲突、该路径不投影（不猜） | 是 | 冲突路径回落无主清单 |
| owners scanner 不可达 | fact_snapshot_headers(kind=owners) 老化 → health degraded | 是 | 沿用上次快照（stale 标红），不静默 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A | — | — | 本刀不暴露对外 agent 输入；OWNERS 文件为仓内可信声明，只按白名单字段（capability/step/steps/owner）解析，未知字段忽略；capability key 必须过 manifest 合法性校验 |

---

## 真实调用方请求 shape

N/A —— 本刀无「设备/外部 agent 调服务端」链路。map 端点由 loopback / `X-Internal-Token`（内部）调用；OWNERS 声明是仓内静态文件，无外部调用方。

---

## 未覆盖真实链路清单

- **冲突投影的"亲眼见红"** 由集成测试 `tests/owners-projection-conflict.integration.test.ts`（真 Postgres、真 projector、真 map_projection_nodes 写路径）担保红→绿，在 CI `brain-integration` job 执行；本 attempt 运行环境 `runtime_resources.postgres=false`（无 attempt 级 DB_URL），故 DoD 的 live BEHAVIOR 只在活的 Brain（localhost:5221）上断言 `owners.conflicts` 字段已接线且干净样板态为空数组，**冲突实际触发**的红证据在 CI 集成测试里，标 `logic-done (CI real-PG integration)`。补位计划：CI brain-integration job 每次 PR 跑该集成测试；主理人无需人工介入。
- 除此之外本合同 **无 mock 豁免**（DoD 全部走真 curl 活 Brain / 真 Playwright），其余项 N/A。

---

## 禁 mock 边清单

本单改动涉及【DB 写路径】（fact_snapshot_headers kind=owners 写入、map_projection_nodes/edges artifact 节点写入）+【跨模块数据传递】（owners-reader → projector → map-read-service）+【投影生命周期】（rebuild 重投影）。以下边**禁 mock**，failing/integration 测试必须真调：

- owners-reader ↔ `fact_snapshot_headers`（本单新增 kind=owners 写路径，集成测试必须真 Postgres 验行落库 + row_count/source_revision）
- projector ↔ `map_projection_nodes`/`map_projection_edges`（本单新增 artifact 节点 + owns 归属写入，集成测试必须真 PG 验 MJ5 名下 artifact 节点确定性生成）
- map-read-service ↔ active projection（`readNode`/`readUnclaimed` 读投影，集成测试/live BEHAVIOR 必须真 Brain API，禁 stub projection）

> 纯逻辑守卫单测（YAML 解析 / 子覆盖父作用域 / 冲突检测 / key 合法性）不碰上述边，是纯函数（对 OWNERS 声明对象做归属决议），允许无 DB 直跑——这正是"更外层无关依赖"，不违反禁 mock 边。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

> 当前仓库（cecelia）根目录无 `product-map/generated/product-map.json`（仅 zenithjoy-workspace 有），按刀3 file-existence gated 规则整体跳过，不阻塞。

> contract-gate: cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在，代码层 Contract Gate 生效（非跳过）。

---

## Golden Path

[OWNERS 声明进仓] → [Brain scan 读声明为 owners 事实] → [rebuild 按声明确定性投影 artifact 到 capability] → [冲突即报不投影] → [/map Level-2 声明驱动展示]

---

### Step 1: 开发者在目录放 `OWNERS` 声明并进仓（cecelia 自贴样板）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1/6 步（"在某目录放 OWNERS 声明…cecelia 仓给 packages/brain/src/map/** 贴 OWNERS→cecelia/MJ5 样板"）

**可观测行为**: 仓内至少一个 `OWNERS` 文件（YAML，字段 `capability: cecelia/MJ5`，可选 `step`/`steps`/`owner`），置于一个含 ≥1 真实照相层事实的目录（推荐 `packages/brain/src/map/OWNERS`，该目录当前有 15 条无主事实）。

**验证命令**:
```bash
test -f packages/brain/src/map/OWNERS && grep -Eq 'capability:\s*cecelia/MJ5' packages/brain/src/map/OWNERS || { echo "FAIL: 样板 OWNERS 缺失或未声明 cecelia/MJ5"; exit 1; }
```
**硬阈值**: 样板 OWNERS 存在且声明 `cecelia/MJ5`。

---

### Step 2: Brain scan 读取 OWNERS 声明为 kind=owners 事实（只读声明，不解析代码）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步 + NFR（新鲜度哨兵）

**可观测行为**: 运行 owners 扫描后，`fact_snapshot_headers` 出现 kind=owners 行（row_count ≥ 样板声明数、带 source_revision），并可从 `/map/health` `owners.snapshot` 观测。

**验证命令**:
```bash
# 触发 owners 扫描（新增 scan-owners，或 run-all-scans 含 owners），再读 health
node scripts/scan/scan-owners.mjs --scope cecelia 2>/dev/null || bash scripts/scan/run-all-scans.sh cecelia
RESP=$(curl -sf "localhost:5221/api/brain/map/health?scope=cecelia")
echo "$RESP" | jq -e '.owners.snapshot.kind == "owners" and (.owners.snapshot.row_count >= 1) and (.owners.snapshot.source_revision | type == "string")' || { echo "FAIL: owners 快照未生成"; exit 1; }
```
**硬阈值**: `owners.snapshot.kind=="owners"` 且 `row_count>=1` 且 `source_revision` 为字符串。

---

### Step 3: rebuild 按 OWNERS 声明确定性投影 → capability 名下出现 artifact + unclaimed 下降
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + 验收 #2

**可观测行为**: rebuild 前记录 `unclaimed_count`；`POST /map/rebuild {scope_key:cecelia}` 后 `/nodes/MJ5` 的 `owned_artifacts` 非空（≥ 样板目录真实事实数），`unclaimed_count` 严格下降。

**验证命令**:
```bash
BEFORE=$(curl -sf "localhost:5221/api/brain/map/unclaimed?scope=cecelia" | jq '.unclaimed_count')
curl -sf -X POST "localhost:5221/api/brain/map/rebuild" -H 'Content-Type: application/json' -d '{"scope_key":"cecelia"}' | jq -e '.rebuilt == true' || { echo "FAIL: rebuild 未成功"; exit 1; }
NODE=$(curl -sf "localhost:5221/api/brain/map/nodes/MJ5?scope=cecelia")
echo "$NODE" | jq -e '(.owned_artifacts | length) >= 1 and ([.owned_artifacts[].stable_ref] | any(test("packages/brain/src/map/")))' || { echo "FAIL: MJ5 名下无声明归属的 artifact"; exit 1; }
AFTER=$(curl -sf "localhost:5221/api/brain/map/unclaimed?scope=cecelia" | jq '.unclaimed_count')
[ "$AFTER" -lt "$BEFORE" ] || { echo "FAIL: unclaimed_count 未下降 before=$BEFORE after=$AFTER"; exit 1; }
```
**硬阈值**: `owned_artifacts>=1` 且含 `packages/brain/src/map/` 前缀事实；`AFTER < BEFORE`。

---

### Step 4: 双重声明冲突 → health 报冲突且该路径不投影（不猜、不静默）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 + 验收 #3（proven-to-fire）；`[AI_ADDED]` 冲突路径同时不出现在任一 capability owned_artifacts（防"静默错挂"，对齐 INV-2）

**可观测行为**: 干净样板态 `/map/health` `owners.conflicts` 为已接线的空数组、`owners.status=="ok"`。冲突"亲眼见红"由集成测试 `tests/owners-projection-conflict.integration.test.ts`（真 PG）担保：同一路径被两个 capability 声明 → 该路径进 `owners.conflicts`（`reason:"multiple_declarations"`）且不被投影到任一 capability。

**验证命令**:
```bash
# live（无冲突样板态）：字段已接线，干净态 conflicts 为空
curl -sf "localhost:5221/api/brain/map/health?scope=cecelia" | jq -e '(.owners.conflicts | type == "array") and (.owners.status | type == "string")' || { echo "FAIL: health.owners 未接线"; exit 1; }
# proven-to-fire（真 PG，CI brain-integration）：冲突场景红→绿
# npx vitest run sprints/08152300-owners-mapping-layer/tests/owners-projection-conflict.integration.test.ts
```
**硬阈值**: `owners.conflicts` 为数组、`owners.status` 为字符串；冲突集成测试红→绿（CI）。

---

### Step 5: 无 OWNERS 覆盖的路径继续走无主清单 + island-check 棘轮（既有，只降不升）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步 + INV-1（不猜归属）

**可观测行为**: 投影后仍有大量无主事实（cecelia 仅贴样板目录，未全仓贴 OWNERS）；`unclaimed_count` 投影后依然 > 5000（照相层不定归属，声明缺失即无主）。

**验证命令**:
```bash
UNCLAIMED=$(curl -sf "localhost:5221/api/brain/map/unclaimed?scope=cecelia" | jq '.unclaimed_count')
[ "$UNCLAIMED" -gt 5000 ] || { echo "FAIL: unclaimed 异常偏低=$UNCLAIMED（疑似猜归属越权投影）"; exit 1; }
```
**硬阈值**: 投影后 `unclaimed_count > 5000`（仅样板目录被归属，其余仍无主）。

---

### Step 6: `/map` Level-2 对 MJ5 显示声明驱动的目录/文件列表（非 UUID 串）
**来源**: `[FROM_PRD]` — PRD Golden Path 出口 + 验收 #4（Playwright mac_web 截图断言）

**可观测行为**: 打开 `/map`，切到 MJ5，Level-2 展示按 OWNERS 归属的目录/文件（真实路径文本，非裸 UUID），并与后端 `/nodes/MJ5` `owned_artifacts` 交叉一致。

**验证命令**: 见 `## E2E 验收` Playwright 段（截图 + `toBeVisible` + 后端交叉验证）。
**硬阈值**: Level-2 出现 ≥1 条真实文件路径文本（含 `map`），后端 `owned_artifacts` 非空。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `OWNERS` 文件写非法 YAML（缩进错/tab 混用）、`capability` 写不存在的 key（如 `cecelia/ZZZ`）、`step` 写 product-map 里没有的步 → 应进 conflicts 且不 crash rebuild
- 重复提交: 连续两次 `POST /map/rebuild {scope_key:cecelia}` → 投影确定性（两次 `projection_digest` 应一致，`owned_artifacts` 集合一致，无重复挂载）
- 中途中断: 一个目录同时有父级 OWNERS 与子级 OWNERS（子覆盖父）→ 该路径只归属子声明，父声明不重复归属
- 边界值: 空 `OWNERS` 文件 / 只有注释的 OWNERS / OWNERS 声明的目录下无任何照相层事实 → owned_artifacts 该目录贡献 0，但不报错、不进 conflicts
发现分级: P0/P1（错归属把别人的文件挂到 MJ5 / 冲突被静默投影 / rebuild crash）→ 阻塞 merge；P2/P3（提示文案、空态展示）→ 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=mac_web）

> evaluator 1.22.0 起按序拼接本段全部 ```bash 块执行。第一块含 shebang/set，第二块为纯命令续体。API 断言打活 Brain（localhost:5221），UI 断言打 Cecelia Dashboard（localhost:5174）。postgres:false → 全程 curl/Playwright，不依赖 attempt 级 psql。

```bash
#!/bin/bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="${SPRINT_DIR:-sprints/08152300-owners-mapping-layer}"
mkdir -p "$SPRINT_DIR/screenshots"

# --- Step 1: 样板 OWNERS 进仓 ---
test -f packages/brain/src/map/OWNERS && grep -Eq 'capability:[[:space:]]*cecelia/MJ5' packages/brain/src/map/OWNERS \
  || { echo "FAIL: 样板 OWNERS 缺失或未声明 cecelia/MJ5"; exit 1; }

# --- Step 2: owners 扫描 → kind=owners 快照 ---
node scripts/scan/scan-owners.mjs --scope cecelia 2>/dev/null || bash scripts/scan/run-all-scans.sh cecelia || true
HEALTH=$(curl -sf "$BRAIN/api/brain/map/health?scope=cecelia")
echo "$HEALTH" | jq -e '.owners.snapshot.kind == "owners" and (.owners.snapshot.row_count >= 1) and (.owners.snapshot.source_revision | type == "string")' \
  || { echo "FAIL: owners 快照未生成"; exit 1; }

# --- Step 3: rebuild → MJ5 owned_artifacts 非空 + unclaimed 下降 ---
BEFORE=$(curl -sf "$BRAIN/api/brain/map/unclaimed?scope=cecelia" | jq '.unclaimed_count')
curl -sf -X POST "$BRAIN/api/brain/map/rebuild" -H 'Content-Type: application/json' -d '{"scope_key":"cecelia"}' \
  | jq -e '.rebuilt == true' || { echo "FAIL: rebuild 未成功"; exit 1; }
NODE=$(curl -sf "$BRAIN/api/brain/map/nodes/MJ5?scope=cecelia")
echo "$NODE" | jq -e '(.owned_artifacts | length) >= 1 and ([.owned_artifacts[].stable_ref] | any(test("packages/brain/src/map/")))' \
  || { echo "FAIL: MJ5 名下无声明归属 artifact"; exit 1; }
AFTER=$(curl -sf "$BRAIN/api/brain/map/unclaimed?scope=cecelia" | jq '.unclaimed_count')
[ "$AFTER" -lt "$BEFORE" ] || { echo "FAIL: unclaimed 未下降 before=$BEFORE after=$AFTER"; exit 1; }

# --- Step 4: 冲突字段接线（干净样板态为空数组） ---
echo "$HEALTH" | jq -e '(.owners.conflicts | type == "array") and (.owners.status | type == "string")' \
  || { echo "FAIL: health.owners.conflicts 未接线"; exit 1; }

# --- Step 5: 无声明路径仍无主（不猜归属） ---
[ "$AFTER" -gt 5000 ] || { echo "FAIL: unclaimed 异常偏低=$AFTER（疑似越权投影）"; exit 1; }

# --- Step 6a: 投影确定性（连续两次 rebuild digest 一致） ---
D1=$(curl -sf -X POST "$BRAIN/api/brain/map/rebuild" -H 'Content-Type: application/json' -d '{"scope_key":"cecelia"}' | jq -r '.projection_digest')
D2=$(curl -sf -X POST "$BRAIN/api/brain/map/rebuild" -H 'Content-Type: application/json' -d '{"scope_key":"cecelia"}' | jq -r '.projection_digest')
[ "$D1" = "$D2" ] || { echo "FAIL: 投影不确定性 d1=$D1 d2=$D2"; exit 1; }
echo "API 层 Golden Path 全过"
```

```bash
# --- Step 6b: /map Level-2 UI 声明驱动渲染（Playwright，非 UUID 串） ---
BRAIN="${BRAIN_URL:-http://localhost:5221}"
DASH="${DASH_URL:-http://localhost:5174}"
SPRINT_DIR="${SPRINT_DIR:-sprints/08152300-owners-mapping-layer}"
SPEC=$(mktemp /tmp/map-owners-e2e-XXXX.cjs)
cat > "$SPEC" <<'PWEOF'
const { chromium } = require('playwright');
(async () => {
  const dash = process.env.DASH || 'http://localhost:5174';
  const brain = process.env.BRAIN || 'http://localhost:5221';
  const dir = process.env.SPRINT_DIR + '/screenshots';
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(dash + '/map', { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: dir + '/map-01-initial.png' });
  // 后端交叉验证：MJ5 owned_artifacts 非空
  const api = await page.request.get(brain + '/api/brain/map/nodes/MJ5?scope=cecelia');
  const node = await api.json();
  const owned = (node.owned_artifacts || []);
  if (owned.length < 1) { console.error('FAIL: 后端 owned_artifacts 为空'); process.exit(1); }
  // UI：页面正文出现真实文件路径文本（含 map），非裸 UUID
  const body = await page.textContent('body');
  await page.screenshot({ path: dir + '/map-02-mj5-level2.png' });
  if (!/map[-/][a-z]/i.test(body || '')) { console.error('FAIL: Level-2 未见声明驱动的文件路径文本'); process.exit(1); }
  await browser.close();
  console.log('UI Level-2 声明驱动渲染验证通过');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
PWEOF
DASH="$DASH" BRAIN="$BRAIN" SPRINT_DIR="$SPRINT_DIR" node "$SPEC"
rm -f "$SPEC"
echo "mac_web E2E 全过"
```

---

## staging 预览闸（user_facing 专属 — cecelia 仓通知式）

- **步骤 A（落 staging）**: 引用现有 cecelia staging 环境 `localhost:5212`（不重造部署脚本），部署本 PR 分支的 Brain + Dashboard。
- **步骤 B（Final E2E 在 staging 跑 + 截图）**: 上方 `## E2E 验收` 脚本以 `BRAIN_URL=http://localhost:5212`（或 staging 对应端口）+ staging Dashboard 执行；截图存 `${SPRINT_DIR}/screenshots/staging-<step>.png`。
- **步骤 C（Bark 推主理人预览链接）**: `curl -s "$BARK_URL" ...` 推送 staging `/map` 预览链接 + 截图 URL，注明「24h 无异议自动放行」；并 `PATCH localhost:5221/api/brain/tasks/$TASK_ID` 写 `metadata:{staging_deployed:true, promote_after:"<UTC+24h>", staging_url:"http://localhost:5212/map"}`。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| OWNERS 声明解析/作用域/冲突/合法性（纯逻辑守卫） | `tests/owners-declaration-resolver.test.ts` | `解析合法 OWNERS YAML`；`子目录 OWNERS 覆盖父级`；`同一路径双重声明报冲突不投影`；`capability key 不在 manifest 打空` | → 模块未实现，import 失败 / N failures |
| OWNERS 投影 + 冲突进 health（真 PG，CI brain-integration） | `tests/owners-projection-conflict.integration.test.ts` | `双重声明路径进 owners.conflicts 且不投影` | → 投影未接 OWNERS，冲突未上报 / FAIL |
