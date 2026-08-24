# Sprint Contract Draft (Round 1)

## 锚定父路声明

独立小路（无父路）—— 本 sprint 是 G1「统一查询能力」的用户可视化出口（journey_id `8bb8252f-29b4-4c34-acb9-1accda7ddfcf`，step `keep-green`），把已存在的 `/map` 页面从列表/表格视图升级为直连 `/api/brain/map` 现算渲染的三层可折叠 mind-elixir 脑图。不新增业务价值流步骤，只上线既有投影能力的前端出口。

## Response Schema（推导来源: PRD 明确「仅消费 GET /api/brain/map」 + 运行时 API 实测 manifest_version=7）

### Endpoint（消费，不新建、不改算法）: `GET /api/brain/map?scope=<scope_key>`

页面 live-fetch（不落缓存快照）该端点，依赖下列字段渲染：

**Success (HTTP 200)**:
```json
{
  "scope_key": "cecelia",
  "manifest_version": 7,
  "manifest_digest": "<64hex>",
  "projection_digest": "<64hex>",
  "fact_revisions": { "cecelia": "<40hex sha>" },
  "generated_at": "<ISO8601>",
  "freshness": { "status": "fresh|stale|unknown", "reason_code": "<string>" },
  "shared_prerequisites": { "applicable": false, "reason": "<string>", "items": [] },
  "nodes": [ { "key": "<string>", "type": "value_stream|capability|feature|crosscut|assertion|artifact", "name": "<string>", "display_order": 1, "attributes": {}, "state": "green|red|gray|unknown|not_applicable", "state_reason": "<string|null>" } ],
  "edges": [ { "from": "<key>", "to": "<key>", "type": "contains|implements|proves|serves|hands_off_to|owned_by|affects", "attributes": {} } ],
  "summary": { "value_streams": 2, "capabilities": 11, "boundaries": 2, "crosscuts": 7, "prerequisites": 0 }
}
```
- `summary.value_streams` (number, 必填): 来源——运行时 API 实测 cecelia=2，对应 PRD 可观测出口「2 条价值流」。
- `summary.capabilities` (number, 必填): 来源——运行时 API 实测 cecelia=11，对应 PRD「11 个能力」。
- `nodes[].type` (string 枚举, 必填): 三层脑图分层依据（value_stream→capability→feature）；`crosscut` 进横切件面板；`assertion`/`artifact` 为特性下的测试证明。
- `edges[].type` (string 枚举, 必填): `contains` 建立父子层级，`hands_off_to` 建立交接（handoff）面板，`proves` 建立特性→测试证明。
- `freshness.status` / `freshness.reason_code` (必填): 徽标与过期提示的唯一数据源。

**禁用字段名**（不得在页面/合同 jq 断言里当作数据源）: `count`（用 `summary.value_streams`/`summary.capabilities`）、`fresh`（布尔标记，须用 `freshness.status` 字符串）、`level`（API 无此字段，分层靠 `type`+`edges`）。

**Error / 非 200**: 页面必须进入错误态（不白屏）。API 返回空 `nodes`/`edges` 时进入空态（不白屏）。

---

## Golden Path

[打开 /map 页面] → [选 scope + 展开脑图 + 搜索] → [看到与 API 一致的系统总图]

### Step 1: 打开 `/map`，直连 `GET /api/brain/map?scope=cecelia` 现算渲染
**来源**: `[FROM_PRD]` — Golden Path 第 1 点「页面直连 GET /api/brain/map?scope=cecelia 现算拉取（不落缓存快照），渲染 manifest_version / digest / freshness / nodes / edges」。

**可观测行为**: 浏览器打开 `localhost:5174/map`，页面发起对 `/api/brain/map?scope=cecelia` 的真实请求（经 dashboard vite proxy 转 5221），渲染出 manifest 版本、digest、freshness 徽标、脑图节点。

**验证命令**:
```bash
# API 侧真实存在且现算（页面消费同一端点）
curl -sf "localhost:5221/api/brain/map?scope=cecelia" | jq -e '.manifest_version and (.nodes|length>0) and (.edges|length>0)'
# 期望: exit 0（有 manifest_version、非空 nodes/edges）
```
**硬阈值**: HTTP 200 且 `nodes`、`edges` 非空；页面不落缓存快照（每次打开重新 fetch）。

---

### Step 2: 三层可折叠 mind-elixir 脑图（价值流 → 能力 → 特性）+ 横切件/交接面板
**来源**: `[FROM_PRD]` — Golden Path 第 2 点「以 mind-elixir 脑图呈现三层可折叠结构：价值流 → 能力 → 特性；特性节点显示测试证明数与覆盖条，并展示横切件与交接（handoff）面板」。

**可观测行为**: 脑图根下挂 2 个价值流节点（管家 / 工厂），价值流可展开出能力层，能力可展开出特性层；特性节点显示测试证明数（proves/assertion 计数）与覆盖条；页面另有横切件（crosscut）与交接（hands_off_to）面板。折叠/展开可交互。

**验证命令**（Playwright，见 `## E2E 验收`；此处给 API 侧结构断言，证明分层数据可用）:
```bash
curl -sf "localhost:5221/api/brain/map?scope=cecelia" -o /tmp/map_c.json
jq -e '([.nodes[]|select(.type=="value_stream")]|length)==2' /tmp/map_c.json
jq -e '([.nodes[]|select(.type=="capability")]|length)==11' /tmp/map_c.json
jq -e '([.edges[]|select(.type=="contains")]|length)>0 and ([.edges[]|select(.type=="hands_off_to")]|length)>=0' /tmp/map_c.json
# 期望: exit 0
```
**硬阈值**: value_stream=2、capability=11、`contains` 边存在（用于建立父子层级）。

---

### Step 3: 切换 scope 到 `zenithjoy-workspace`，脑图重新现算渲染 + 搜索定位节点
**来源**: `[FROM_PRD]` — Golden Path 第 3 点「切换 scope 到 zenithjoy-workspace，脑图重新现算渲染对应投影；可用搜索定位节点」。

**可观测行为**: 在 scope 输入切到 `zenithjoy-workspace` 并加载后，页面对 `/api/brain/map?scope=zenithjoy-workspace` 重新 fetch，脑图内容替换为对应投影；搜索框输入关键字可定位/高亮匹配节点。

**验证命令**（Playwright，见 `## E2E 验收`；API 侧证明第二 scope 可现算）:
```bash
curl -sf "localhost:5221/api/brain/map?scope=zenithjoy-workspace" | jq -e '.scope_key=="zenithjoy-workspace"'
# 期望: exit 0（第二 scope 现算可达）
```
**硬阈值**: 切 scope 后页面 fetch 的 URL 含 `scope=zenithjoy-workspace`，脑图重渲染；搜索命中至少 1 个节点。

---

### Step 4: freshness 徽标；`freshness.status` 非 `fresh` 时出现可见过期提示 + reason_code
**来源**: `[FROM_PRD]` — Golden Path 第 4 点 + 边界情况「freshness 非 fresh（stale/unknown）→ 徽标变色 + 显示 reason_code 文案，不得静默当作 fresh」+ NFR「freshness 非 fresh 必须有可见提示，禁止静默判 fresh」。

**可观测行为**: 页面读取 `freshness.status`：为 `fresh` 显示新鲜徽标；非 `fresh`（`stale`/`unknown`）时徽标变色并显示 `reason_code` 文案，页面出现可见过期提示，绝不静默按 fresh 处理。（运行时实测当前 cecelia `freshness.status=unknown`，此路径为真实可观察态。）

**验证命令**（页面徽标须与 API `freshness` 一致，E2E cross-check）:
```bash
FS=$(curl -sf "localhost:5221/api/brain/map?scope=cecelia" | jq -r '.freshness.status')
echo "api freshness.status=$FS"
# 非 fresh 时 E2E 断言页面出现过期提示 + reason_code（见 ## E2E 验收）
[ -n "$FS" ] || { echo "FAIL: 无 freshness.status"; exit 1; }
```
**硬阈值**: 页面徽标/提示与 API `freshness.status` 一致；非 fresh 时页面 DOM 含 `reason_code` 文案。

---

### Step 5: 可观测出口——cecelia scope 渲染 2 价值流、11 能力，节点数量/名称与 API 一致
**来源**: `[FROM_PRD]` — Golden Path 第 5 点「cecelia scope 渲染出 2 条价值流、11 个能力，且节点数量/名称与 API 返回一致」。

**可观测行为**: 页面渲染的价值流节点数=2（名称含「管家」「工厂」），能力节点数=11，且不额外造数、不丢数（与 API `nodes` 的 value_stream/capability 计数逐一对齐）。

**验证命令**:
```bash
curl -sf "localhost:5221/api/brain/map?scope=cecelia" -o /tmp/map_c.json
jq -e '.summary.value_streams==2 and .summary.capabilities==11' /tmp/map_c.json
jq -e '([.nodes[]|select(.type=="value_stream")|.name]|sort)==(["工厂","管家"]|sort)' /tmp/map_c.json
# 期望: exit 0
```
**硬阈值**: `summary.value_streams==2` 且 `summary.capabilities==11`，价值流名称集合与 API 一致。

---

### Step 6: 空态 / 错误态不白屏；scope 并发请求 last-wins
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD「边界情况」列出「API 返回空 nodes/edges 或请求失败 → 显示空态/错误态，不白屏」「scope 切换的并发请求 → 以最后一次选择为准」，需 codify 成可验证断言防止实现漏做导致白屏/旧响应覆盖。

**可观测行为**: fetch 失败时页面渲染错误态（有可见错误文案，非空白 DOM）；空 `nodes` 时渲染空态；快速连续切 scope 时最终视图对应最后一次选择（旧请求响应不覆盖新视图）。

**验证命令**（组件层，dashboard vitest 用 mock fetch 触发失败/空态；E2E 不 mock）:
```bash
( cd apps/dashboard && npx vitest run src/pages/map/MapPage.test.tsx --reporter=basic ) 2>&1 | tail -5
# 期望: 组件测试覆盖空/错误态与 last-wins 断言且通过
```
**硬阈值**: 错误态/空态测试通过；错误态 DOM 非空（不白屏）。

---

### Step 7: mind-elixir(MIT) 入依赖 + `/map` 路由与既有 dashboard 测试 keep-green
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 范围「mind-elixir(MIT) 加入 apps/dashboard/package.json 依赖」「更新 apps/dashboard/src/pages/map/MapPage.test.tsx 验证 /map 路由存在并保持通过」，且 step_id=keep-green 要求不回退既有路由。

**可观测行为**: `apps/dashboard/package.json` dependencies 含 `mind-elixir`（MIT 许可）；`/map` 路由仍由 `apps/api/features/planning` manifest 注册（component `MapPage`，navItem「地图」），system-hub 不注册 `/map`；dashboard 的 `MapPage.test.tsx` 路由存在性断言保持通过。

**验证命令**:
```bash
node -e "const p=require('./apps/dashboard/package.json');if(!p.dependencies['mind-elixir'])process.exit(1)"
( cd apps/dashboard && npx vitest run src/pages/map/MapPage.test.tsx src/pages/map/MapPage.auth.test.tsx --reporter=basic ) 2>&1 | tail -5
# 期望: mind-elixir 存在 + 两个 dashboard 测试通过
```
**硬阈值**: `dependencies.mind-elixir` 存在；dashboard MapPage 测试通过。

---

## 已知约束（来自回归测试 + 累积 FR）

- [apps/dashboard/src/pages/map/MapPage.test.tsx] → 「只从动态 feature manifest 注册唯一 /map 页面」：`/map` 仅由 `@features/core/planning` 注册（component MapPage，navItem 「地图」），`system-hub` 不得注册 `/map`，且 `apps/dashboard/src/pages/map/MapPage.tsx` 物理文件不得存在（页面实体在 feature 模块内）。
- [apps/dashboard/src/pages/map/MapPage.test.tsx] → 「Level 1 展示冻结清单、投影元数据、横切件和不适用前置」：页面须渲染 manifest 元数据、能力计数、边界数、横切件数、共享前置文案、freshness 文案。
- [apps/dashboard/src/pages/map/MapPage.test.tsx] → 「从 Capability 下钻到 Feature/Assertion，再显示真实 receipt」：三层下钻链路（价值流/能力→特性→验收证据）须保留。
- [apps/dashboard/src/pages/map/MapPage.auth.test.tsx] → 「does not expose internal map rebuild through the public dashboard proxy」：页面不得暴露「重建」按钮（只读消费，不触发内部重建）。
- [累积FR] — 本 line 暂无历史（context-manifest: 本 sprint 无累积 FR 回退风险）。
- [MAP_NOT_CONFIGURED] — 任务未注入 `payload.map_scope/map_repo`，无 Unified Map radius 必跑断言可加载；回归约束以上述回归测试为准，不回退领域硬编码。

## 禁 mock 边清单

- 页面 ↔ `GET /api/brain/map?scope=<scope>`（本 sprint 核心改动=前端直连该端点现算渲染）：**Final E2E（mode B, Playwright）禁止 `page.route()` 拦截该请求，必须打真实 Brain（经 vite proxy → localhost:5221）**。dashboard 组件单测（vitest, happy-dom）允许 mock `global.fetch` 触发空/错误/并发态——那是单元层、不是 E2E，不属被改的真实接缝。
- 本 sprint 为纯前端只读页面，**不触及**调度 / 状态机 / 跨模块 DB 写路径 / 生命周期钩子，故无需真 Postgres 集成测试；被改的唯一外部边即「页面↔map API」，已在上条登记。

## 真实调用方请求 shape

N/A —— 本 sprint 无「设备/agent 调服务端」入站方向；页面是 `GET /api/brain/map` 的调用方（浏览器），无自定义认证 header/body 字段，走 dashboard 现有 vite proxy。

## 未覆盖真实链路清单

- freshness 非 fresh 分支的确定性触发：Final E2E 以「页面徽标/提示与运行时 API `freshness.status` 一致」做 cross-check 断言（当前实测为 `unknown`，属真实非 fresh 态，可真验）。若 evaluate 时 registry-scan 恰好把状态刷成 `fresh`，则该次 E2E 验「新鲜徽标存在且与 API 一致」，非 fresh 提示分支改由 dashboard 组件单测（mock freshness=unknown）覆盖并在此登记为 logic-done-pending（真机 fresh 态下无法同时观察非 fresh 提示）。除此之外本合同无 mock 豁免。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | `/map` 直连 `GET /api/brain/map` 现算渲染三层可折叠 mind-elixir 脑图（价值流→能力→特性），含横切件/交接面板、scope 切换、搜索、freshness 徽标 |
| **NFR（做得多好）** | 性能/可靠性 | 超时/频控 PRD 未指定（待定）；依赖许可：mind-elixir 必须 MIT；可观测：freshness 非 fresh 必须有可见提示 |
| **Invariant（永不违反）** | 不变量 | [凭据隔离] 见下 INV-1；`/map` 仅由 planning manifest 注册（唯一来源），page 实体不落 `apps/dashboard/src/pages/map/MapPage.tsx` |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | 页面无自持数据，freshness 由 API 现算给出；页面不缓存快照，天然随 API 过期 |
| **死亡告警（停了谁知道）** | 谁多久知道 | `/map` 路由回归测试（dashboard MapPage.test.tsx）在 CI 保护；页面白屏由 E2E + 组件错误态测试拦截 |
| **失败语义（挂了怎么办）** | 放行/拦截 | API 失败/空 → 页面拦截为错误态/空态（不白屏、不静默 fresh）；scope 并发以最后一次为准 |
| **效果确认（已发≠已生效）** | 回执方式 | 页面渲染的价值流/能力计数与名称须与 API `summary`/`nodes` 逐一 cross-check（E2E + curl 双侧） |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ freshness 是否 fresh | A. 读 `freshness.status` 字符串; B. 看是否有 `generated_at` | A. 读 `freshness.status`（fresh 之外全按非 fresh 处理，显示 reason_code） | 布尔化/看时间戳会把 unknown 误当 fresh，违反 NFR「禁止静默判 fresh」 | 静默把过期投影当权威展示给主理人，误导决策 |
| 脑图分层父子关系 | A. 用 `edges` type=contains; B. 猜 name 前缀 | A. 用 `edges(contains)` 建父子 | 分层是 API 权威结构，name 猜测会错挂 | 节点错挂层级，脑图结构与 API 不一致 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `/api/brain/map` 请求失败 | 页面显示错误态（可见文案），不白屏 | 是（GET 幂等，可重新加载） | 显示错误态 + 允许重试/切 scope |
| API 返回空 nodes/edges | 页面显示空态，不白屏 | 是 | 空态提示 |
| 快速连续切 scope | 以最后一次选择为准 | 是 | 旧响应到达时若非当前 scope 则丢弃 |

### 输入对抗面

N/A —— 本 sprint 为内部只读展示页面，无对外暴露的 agent 写入入口。

## Invariant 覆盖

- [ ] [BEHAVIOR] INV-1 [凭据隔离] N/A：本 sprint 为纯前端只读页面，仅 `GET /api/brain/map`，不涉及多人协作凭据混用/他人账号资源操作，无凭据边可破坏。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（冻结锚点） | `sprints/08241425-kernel-89957abc/tests/map-page-contract.test.ts` | mind-elixir 依赖已声明; MapPage 接入 mind-elixir 渲染; /map 仅由 planning manifest 注册 | mind-elixir 未入 deps + MapPage 未接 mind-elixir → 2 failures |
| 组件行为（补充） | `apps/dashboard/src/pages/map/MapPage.test.tsx` | Level 1 展示; 从 Capability 下钻到 Feature/Assertion; 第二个 scope | 现有回归，keep-green |

## E2E 验收（最终 final-e2e 跑 — target_environment=mac_web，Playwright localhost:5174）

**journey_type**: user_facing
**target_environment**: mac_web

> mode B final-e2e 由 evaluator 独立执行本段脚本；生成器负责写就 `apps/dashboard/e2e/map.spec.ts`（禁 `page.route()` 拦截 `/api/brain/map`，所有请求打真实后端 localhost:5221）。截图存 `${SPRINT_DIR}/screenshots/`。

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="${SPRINT_DIR:-sprints/08241425-kernel-89957abc}"
DASH_DIR="apps/dashboard"
DASH_URL="${DASHBOARD_URL:-http://localhost:5174}"
mkdir -p "${SPRINT_DIR}/screenshots"

# 0. 前置：真实 Brain map API 可达（页面 live-fetch 的真源）
curl -sf "localhost:5221/api/brain/map?scope=cecelia" -o /tmp/e2e_map_c.json
jq -e '.summary.value_streams==2 and .summary.capabilities==11' /tmp/e2e_map_c.json || { echo "FAIL: API 侧价值流/能力计数不符"; exit 1; }
API_FRESH=$(jq -r '.freshness.status' /tmp/e2e_map_c.json)
echo "API freshness.status=$API_FRESH"

# 1. 启动 dashboard dev server（内建 vite proxy /api/brain → localhost:5221），等待 5174 就绪
DEV_PID=""
cleanup() { [ -z "$DEV_PID" ] || kill "$DEV_PID" 2>/dev/null || true; }
trap cleanup EXIT
( cd "$DASH_DIR" && npm run dev ) >/tmp/dash-dev.log 2>&1 &
DEV_PID=$!
for i in $(seq 1 60); do
  curl -sf "$DASH_URL/" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "FAIL: dashboard 未在 60s 内就绪"; cat /tmp/dash-dev.log | tail -20; exit 1; }
  sleep 1
done

# 2. 跑 Playwright E2E（真实浏览器打真实后端，禁 page.route）
( cd "$DASH_DIR" && DASHBOARD_URL="$DASH_URL" API_FRESHNESS="$API_FRESH" npx playwright test e2e/map.spec.ts --reporter=list ) || { echo "FAIL: Playwright E2E 失败"; exit 1; }

# 3. 收集截图到 SPRINT_DIR/screenshots
cp "$DASH_DIR"/screenshots/*.png "${SPRINT_DIR}/screenshots/" 2>/dev/null || true
cp "$DASH_DIR"/e2e/screenshots/*.png "${SPRINT_DIR}/screenshots/" 2>/dev/null || true

echo "✅ mac_web Golden Path E2E 验证通过（真实 Brain map API + mind-elixir 脑图）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: scope 输入非法值（如 `not-a-scope` / 空串）→ 页面应进错误态/空态，不白屏、不 crash。
- 重复提交: 快速连点「加载」或连续切 scope（cecelia↔zenithjoy-workspace）→ 最终视图须对应最后一次选择（last-wins），无旧响应覆盖。
- 中途中断: 脑图加载中刷新页面 / 展开节点过程中切 scope → 无残留旧 scope 节点、无脑图渲染残影。
- 边界值: 搜索空串 / 超长串 / 无匹配关键字 → 无匹配时给出「无结果」反馈而非白屏；能力全展开时脑图仍可交互。
发现分级: P0/P1（白屏 / 静默把非 fresh 当 fresh / 节点数与 API 不一致）→ 阻塞 merge；P2/P3（交互瑕疵）→ 记 findings 不阻塞

## staging 预览闸（user_facing 专属 — cecelia 仓，通知式）

### 步骤 A：落 staging
- 引用 cecelia staging 环境 `localhost:5212`（不重造部署脚本，仅引用现有发布流程把本分支 dashboard 落 staging）。

### 步骤 B：Final E2E 在 staging 跑 + 截图
- 上述 `## E2E 验收` 脚本以 `DASHBOARD_URL=http://localhost:5212` 在 staging 环境执行；截图存 `${SPRINT_DIR}/screenshots/staging-<step>.png`。

### 步骤 C：Bark 推主理人预览链接（通知式，24h 无异议自动放行）
```bash
curl -sf "$BARK_URL" -d "系统总图页 /map 已上 staging 预览：http://localhost:5212/map（24h 无异议自动放行）"
# Brain PATCH 写 promote_after（UTC+24h）
curl -sf -X PATCH "localhost:5221/api/brain/tasks/$TASK_ID" -H 'Content-Type: application/json' \
  -d '{"metadata":{"staging_deployed":true,"promote_after":"<UTC+24h>","staging_url":"http://localhost:5212/map"}}'
```

## notes

- contract-gate: cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在，走代码层 Contract Gate（本合同按合规惯用法速查表书写：curl -f + jq -e 同管道、DB 断言本 sprint 无、Playwright 含显式断言）。
- judgment-pending-user: freshness 判定点（⚠️）—— PrepPRD 已在 NFR 显式「禁止静默判 fresh」，视为已拍板，无需额外请教用户。
- Kernel validation identity: 本合同 E2E 不写任何 attempt/capability UUID 字面值；如需身份从 Runner 注入的 `HARNESS_*`/`CAPABILITY_SNAPSHOT_ID` 读取（本 UI sprint E2E 无身份断言需求）。
