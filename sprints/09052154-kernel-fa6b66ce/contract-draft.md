# Sprint Contract Draft (Round 1) — 四格路由器：task 入口增 artifact_kind + answer_known 并按四格路由

## 锚定父路声明

独立小路（无父路） — journey e6f803f2 下仅 planned ability，无 done/working 历史（PRD 累积 FR 段：本 line 暂无历史）。本 sprint 是四格路由架构的入口件。

## Response Schema（推导来源: PRD 字面 + api_registry 推导）

### Endpoint: POST /api/brain/tasks

现状（api_registry / 代码 `packages/brain/src/routes/task-tasks.js` 与 `work-routing-store.js`）：创建成功返回 `201` + 创建的 task 行（`RETURNING *`），其中 `payload` 是 JSONB 列；现有实现已把 `change_kind` 既落 `payload` 又在响应体顶层暴露（`responseBody.change_kind`，见 task-tasks.js:279）。本 sprint 三个新字段**跟进同一约定**：落 `payload` JSONB（无需 schema 迁移，符合 PRD ASSUMPTION「payload 或列，由 Proposer 读 schema 决定」→ 选 payload，最小侵入），并在响应体顶层镜像暴露。

**Success (HTTP 201)** — 在现有 task 行基础上，`payload` 内含且响应体顶层镜像：
```json
{
  "id": "<uuid>",
  "artifact_kind": "code",
  "answer_known": false,
  "routed_lane": "prototype_dev",
  "payload": { "artifact_kind": "code", "answer_known": false, "routed_lane": "prototype_dev" }
}
```
- `artifact_kind` (string, 必填): 取值枚举 **`"code"` | `"execution"`**。来源——PRD Golden Path 第 2 步字面定义。规则判定（无 LLM），空 description 也必给确定值。
- `answer_known` (boolean, 必填): 取值 **`true` | `false`**。来源——PRD Golden Path 第 3 步字面定义。一次 LLM 调用判定；失败走确定性兜底（默认 `false`，见失败语义）。
- `routed_lane` (string, 必填): 取值枚举 **`"dev"` | `"prototype_dev"` | `"canvas_skill"` | `"skill_explore"`**。来源——PRD Golden Path 第 4 步四格映射（见下表）。四格 → lane 为全函数，任一 (artifact_kind, answer_known) 命中且仅命中一个 lane。

四格 → lane 映射（PRD 第 4 步字面）：

| artifact_kind | answer_known | routed_lane | PRD 自然语言 |
|---|---|---|---|
| `code` | `true` | `dev` | `/dev` |
| `code` | `false` | `prototype_dev` | 原型 → `/dev` |
| `execution` | `true` | `canvas_skill` | 画布 + skill |
| `execution` | `false` | `skill_explore` | skill 探索 |

**禁用字段名**（api_registry 无同义端点，按 PRD 字面锁死，禁止漂移）: `kind`、`artifact`、`lane`、`route`、`answer`、`known`、`is_known`、`category`、`quadrant`（这些绝不作为响应/payload 的正向 key；只能出现在反向 `has()` 检查中）。

**Error (HTTP 4xx)**（沿用现有入口，本 sprint 不新增错误码）:
```json
{"error": "<string>"}
```
title 缺失仍返回现有 `400 {"error":"title is required"}`。**边界：description 为空不报错**——`artifact_kind` 规则仍给确定取值，任务正常 201 创建。

## Golden Path

[任务经 POST /api/brain/tasks 创建] → [规则判 artifact_kind + 一次 LLM 判 answer_known] → [四格判定落 routed_lane] → [任务记录含三字段并进入对应 lane]

---

### Step 1: 新任务经 POST /api/brain/tasks 进入 Brain
**来源**: `[FROM_PRD]` — Golden Path 第 1 步「一个新任务通过 POST /api/brain/tasks 进入 Brain（携带 title/description/payload）」

**可观测行为**: 携带 title/description/payload 的 POST 返回 201，创建出一条 task 行。

**验证命令**:
```bash
RESP=$(curl -sf -X POST "${BASE_URL:-http://localhost:5221}/api/brain/tasks" \
  -H 'content-type: application/json' \
  -d '{"title":"修复登录 bug 并实现重试逻辑","description":"复现后修 packages/brain 的重试","task_type":"dev","change_kind":"code"}')
echo "$RESP" | jq -e '.id | type == "string"'
```
**硬阈值**: HTTP 201，响应含 `.id`（string）。

---

### Step 2: 规则判 artifact_kind + 一次 LLM 判 answer_known
**来源**: `[FROM_PRD]` — Golden Path 第 2、3 步（artifact_kind 用**规则**、answer_known 用**一次 LLM 调用**）

**可观测行为**: 创建响应里 `artifact_kind ∈ {code,execution}`、`answer_known ∈ {true,false}`；answer_known 由真实 LLM 一次调用产生（LLM 失败则确定性兜底）。

**验证命令**:
```bash
echo "$RESP" | jq -e '.artifact_kind == "code" or .artifact_kind == "execution"'
echo "$RESP" | jq -e '.answer_known == true or .answer_known == false'
```
**硬阈值**: artifact_kind 命中枚举；answer_known 为布尔。

---

### Step 3: 四格判定落 routed_lane（互斥完备）
**来源**: `[FROM_PRD]` — Golden Path 第 4 步四格 → lane 映射

**可观测行为**: `routed_lane` 落入四个合法值之一，且与 (artifact_kind, answer_known) 严格对应；任一任务命中且仅命中一格。

**验证命令**:
```bash
echo "$RESP" | jq -e '.routed_lane | . == "dev" or . == "prototype_dev" or . == "canvas_skill" or . == "skill_explore"'
# 四格全覆盖 + 互斥完备由冻结 vitest（纯函数遍历 4 组合）与回放报告（30 真实任务 100% 完备）双证
```
**硬阈值**: routed_lane ∈ 四值集合。

---

### Step 4: 出口 — task 记录含三字段并持久化到 payload（真环境验证）
**来源**: `[FROM_PRD]` — Golden Path 第 5 步「任务记录上可读到 artifact_kind、answer_known、routed_lane 三字段」

**可观测行为**: DB `tasks.payload` JSONB 内含三字段（本轮新写，带 5 分钟时间窗防历史冒充）。

**验证命令**:
```bash
TID=$(echo "$RESP" | jq -r '.id')
psql "${DB_URL:-postgresql://localhost/cecelia}" -tAc "SELECT count(*) FROM tasks WHERE id='$TID' AND payload ? 'artifact_kind' AND payload ? 'answer_known' AND payload ? 'routed_lane' AND created_at > NOW() - interval '5 minutes'" | tr -d ' '
# 期望：1
```
**硬阈值**: count == 1。

---

### Step 5: 回放最近 30 个真实任务 → 分格完备准确率报告
**来源**: `[AI_ADDED]` — 理由：PRD 范围内明列「最近 30 个真实任务的回放分格准确率报告」为交付物；GAN 侧把它 codify 成可执行脚本 + JSON 产物，防止「报告」只是自然语言空话。

**可观测行为**: 回放脚本查 tasks 表最近 30 条真实（非 smoke）任务，逐条计算 artifact_kind（规则）+ routed_lane，产出 JSON 报告：每格命中数/总数 + 整体准确率；报告为真实文件产物可查。

> **准确率口径说明（本 sprint 显式定义）**：PRD ASSUMPTION 提到「人工/既有标注作为准确率基准」，但当前 tasks 表**无外部人工标注的 ground truth 列**（范围不含历史回填/标注）。故本 sprint「分格准确率」= **分格完备准确率** = 命中且仅命中一格的任务数 / 总任务数（直接验证 PRD 边界「四格互斥完备」不变量于真实数据上）。此口径为机器可检、无需外部标注。**列入 DONE_WITH_CONCERNS**，供 Reviewer/主理人确认是否需另接人工标注基准（若需，属独立 sprint）。

**验证命令**:
```bash
node "${SPRINT_DIR}/replay-four-lane-accuracy.mjs" > "${SPRINT_DIR}/replay-report.json"
jq -e '.total >= 1 and (.per_lane.dev + .per_lane.prototype_dev + .per_lane.canvas_skill + .per_lane.skill_explore == .total) and .completeness_rate == 1' "${SPRINT_DIR}/replay-report.json"
```
**硬阈值**: per-lane 计数之和 == total 且 completeness_rate == 1。

---

## 禁 mock 边清单

本单改动触及 **DB 写路径**（POST /api/brain/tasks 把 artifact_kind/answer_known/routed_lane 持久化进 `tasks.payload`）与**跨模块数据传递**（server 路由层 → task-router 分类/路由函数 → llm-caller）。据 v9.12 硬规则：

- **代码 ↔ DB 表 `tasks`（payload JSONB 写路径）**：本单在任务创建写路径新增三字段，验证必须真 Postgres（psql 查 `tasks.payload` 真落库，见 Step 4 与 B-02/B-06）；禁止用 mock DB 断言落库。冻结 vitest（纯函数层）不触碰此边，故无 mock 冲突。
- **task-tasks 路由 ↔ task-router 分类/路由函数**：接线处（POST handler 调 classifyArtifactKind / routeFourQuadrant / judgeAnswerKnown）由真 Brain E2E（curl localhost:5221 真实走通整条链）验证，不 mock 被改的接线边。
- **task-router ↔ llm-caller（answer_known 一次 LLM 调用）**：此为**第三方 LLM 外部边界**（更外层无关依赖），按规则允许在单测中注入替身以确定性验证兜底路径；正常路径的真实 LLM 调用由 E2E 真调一次覆盖（规则 B）。真实 LLM 失败兜底属**本单逻辑**，用注入 stub 触发失败是测「我们的兜底」而非 mock「被改的边」。已在下方「未覆盖真实链路清单」显式登记。

## 未覆盖真实链路清单（规则 C — mock 豁免显式登记）

| 被 mock 顶替的真实链路点 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| `judgeAnswerKnown` 的 LLM **失败/超时兜底**分支：冻结 vitest 注入一个必抛错的 llm stub 触发兜底 | 无法在 CI 内可靠、可复跑地触发真实 LLM 超时/报错（真超时不确定、且烧真 key） | 正常路径由 E2E（B-01）真调一次真实 `callLLM` 证明真实 LLM 生效；兜底分支的真实触发在生产由 Brain log（`four_lane_answer_known_fallback`）观测，运维侧真验 |

## 真实调用方请求 shape

本单**无设备/agent 真实外部调用方**（POST /api/brain/tasks 是 Brain 内部/既有调用方入口，认证走 server ingress 的 `x-tenant-id` header，本 sprint 不改）。规则 A：N/A（不新增外部调用方路径，沿用现有入口 shape）。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | POST /api/brain/tasks 创建任务时打 artifact_kind（规则）+ answer_known（LLM 一次）两维，按四格落 routed_lane，三字段持久化进 payload；产出 30 任务回放报告 |
| **NFR（做得多好）** | | LLM 判定须有超时兜底（PRD 未指定具体阈值 → 取 15s，见失败语义）；任务创建不因分类失败而中断（分类失败 = 确定性兜底，非 500） |
| **Invariant（永不违反）** | | 四格互斥完备：任一任务命中且仅命中一格；无 lane / 多 lane 均违规。artifact_kind/routed_lane 规则判定不写死环境值 |
| **判定点（怎么知道）** | | 见判定点登记表 |
| **保质期（何时过期）** | | 无 token/凭据引入；分类规则随 task_type 集合演进，无显式过期 → N/A |
| **死亡告警（停了谁知道）** | | LLM 兜底触发写 Brain log（含 task_id + reason，不含 prompt/凭据）；兜底率异常由既有 Brain log 巡检观测 |
| **失败语义（挂了怎么办）** | | 见失败语义声明 |
| **效果确认（已发≠已生效）** | | 创建响应 + psql 查 payload 双证三字段真落库（5 分钟时间窗） |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ 任务的答案/做法是否已知（answer_known） | A. 一次 LLM 判定; B. 纯规则关键词; C. 人工 | A. 一次 LLM 判定 + 失败确定性兜底 | PRD 第 3 步明确「一次 LLM 调用」；纯规则无法覆盖开放语义 | 误判 known→跳过探索直接 /dev，可能做错方向；误判 unknown→多一次原型/探索开销。故标 ⚠️（误判可致做错方向），兜底默认 unknown（偏保守，宁可多探索） |
| 任务产物形态（artifact_kind） | A. task_type/change_kind 规则; B. LLM | A. 规则（task_type ∈ 编码类 或 change_kind=write → code，否则 execution） | PRD 第 2 步明确「用规则」；确定、无外部依赖、空 description 安全 | 误判 code↔execution → 路由到错 lane，下游走错路线 |

> `judgment-pending-user: answer_known 误判做错方向的风险` — PrepPRD 未对「兜底默认取值 known vs unknown」拍板，合同取 unknown（保守），待主理人确认。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 | 是 | 客户端重试 |
| LLM 判 answer_known 超时/报错 | **不抛异常、不阻断任务创建**；answer_known 取确定性兜底值 `false`（unknown），写 Brain log `four_lane_answer_known_fallback`（含 task_id + reason，脱敏） | 是（分类是任务创建的纯附加步，重建幂等由现有 dedup 护栏保证） | 兜底 unknown → routed_lane 落 prototype_dev / skill_explore（仍是合法一格，绝不无 lane） |
| description 为空 | artifact_kind 规则仍给确定值（依赖 task_type），任务正常 201 | 是 | 无 |

### 输入对抗面

N/A — 本 sprint 不新增对外暴露 agent；POST /api/brain/tasks 为既有内部/受 ingress 鉴权入口，本 sprint 不改鉴权与信任边界。

## 已知约束（来自回归测试 + 累积 FR）

- [f1-registration-dispatch.test.js] → POST /api/brain/tasks 携带 status=blocked → DB 写入 blocked，blocked_at 非 null（本单不得破坏 status 入口语义）
- [task-tasks-create-executor.test.js] → executor/mode 白名单（claude/codex、headless/headed）（本单不改 executor 校验）
- [累积FR] → （本 line 暂无历史 — PRD 累积 FR 段：journey e6f803f2 下仅 planned ability）
- context-manifest: 本 sprint 未接 line context-manifest 端点（journey 无 done 历史，无累积 FR 摘要）

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> cecelia autonomous 惯例：E2E 打真实运行中的 Brain（`localhost:5221`）+ psql 真库（`${DB_URL:-postgresql://localhost/cecelia}`）。本 sprint 三字段落 `tasks.payload` JSONB，无需 schema migration；tasks 表由运行中的 Brain 保证存在（脚本前置机检该表）。POST /api/brain/tasks 为 Brain 内部自主入口，无用户 signup/login（autonomous 无业务身份），故不套用空库 signup 自举模板。

```bash
#!/bin/bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:5221}"
DB="${DB_URL:-postgresql://localhost/cecelia}"
SPRINT_DIR="${SPRINT_DIR:-sprints/09052154-kernel-fa6b66ce}"

# 0. 前置：Brain 健康 + tasks 表存在（真环境机检，不 bootstrap 生产库）
curl -sf "$BASE_URL/api/brain/health" | jq -e '.status=="healthy" or .status=="ok"' >/dev/null || { echo "FAIL: Brain 不健康"; exit 1; }
psql "$DB" -tAc "SELECT to_regclass('tasks') IS NOT NULL" | grep -qx t || { echo "FAIL: tasks 表不存在"; exit 1; }

# 1. 真实创建一个任务（真实走 classifyArtifactKind + 真实 LLM judgeAnswerKnown + routeFourQuadrant）
RESP=$(curl -sf -X POST "$BASE_URL/api/brain/tasks" \
  -H 'content-type: application/json' \
  -d '{"title":"修复登录 bug 并实现重试逻辑（four-lane e2e）","description":"复现后修 packages/brain 的重试","task_type":"dev","change_kind":"code"}')
TID=$(echo "$RESP" | jq -er '.id')
[ -n "$TID" ] || { echo "FAIL: 未返回 task id"; exit 1; }

# 2. 响应体三字段就绪且取值合法
echo "$RESP" | jq -e '.artifact_kind == "code" or .artifact_kind == "execution"' || { echo "FAIL: artifact_kind 非法"; exit 1; }
echo "$RESP" | jq -e '.answer_known == true or .answer_known == false' || { echo "FAIL: answer_known 非布尔"; exit 1; }
echo "$RESP" | jq -e '.routed_lane | . == "dev" or . == "prototype_dev" or . == "canvas_skill" or . == "skill_explore"' || { echo "FAIL: routed_lane 非法"; exit 1; }

# 3. 真库 payload 三字段落库（5 分钟时间窗防历史冒充）
C=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE id='$TID' AND payload ? 'artifact_kind' AND payload ? 'answer_known' AND payload ? 'routed_lane' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C" = "1" ] || { echo "FAIL: payload 三字段未落库 count=$C"; exit 1; }

# 4. 边界：description 为空仍 201 且 artifact_kind 有确定值（不抛异常）
RESP2=$(curl -sf -X POST "$BASE_URL/api/brain/tasks" \
  -H 'content-type: application/json' \
  -d '{"title":"empty-desc four-lane edge","task_type":"research"}')
echo "$RESP2" | jq -e '.artifact_kind == "code" or .artifact_kind == "execution"' || { echo "FAIL: 空 description 未给确定 artifact_kind"; exit 1; }

# 5. 冻结纯函数套件（四格互斥完备 + 兜底）从仓库根跑（sprints/** 在根 vitest include 内）
npx vitest run --no-cache "$SPRINT_DIR/tests/four-lane-router.test.ts" --reporter=dot || { echo "FAIL: 冻结 vitest 未过"; exit 1; }

# 6. 回放最近 30 真实任务 → 分格完备准确率报告（真库 + 真产物）
node "$SPRINT_DIR/replay-four-lane-accuracy.mjs" > "$SPRINT_DIR/replay-report.json"
jq -e '.total >= 1 and (.per_lane.dev + .per_lane.prototype_dev + .per_lane.canvas_skill + .per_lane.skill_explore == .total) and .completeness_rate == 1' "$SPRINT_DIR/replay-report.json" || { echo "FAIL: 回放报告完备率不达标"; exit 1; }

echo "✅ 四格路由器 Golden Path 验证通过 task=$TID"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: POST /api/brain/tasks 传 `task_type` 为未知枚举、`change_kind` 传非法值（如 `"xxx"`）→ 应走既有 400，不应污染四格字段或写半截 payload
- 重复提交: 同 title 连发两次 → 命中现有 dedup 护栏（返回 deduplicated:true），四格字段不应被重复 LLM 判定二次覆盖成不同值
- 中途中断: LLM 判定进行中任务创建——确认 LLM 慢/超时时任务仍在超时预算内 201 返回（兜底），不 500、不卡死
- 边界值: title 极长 / description 含多语言/emoji → artifact_kind 规则仍返回合法枚举，不抛异常
发现分级: P0/P1（任务无 lane / 多 lane / 创建 500 / payload 半截）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 四格路由核心（纯函数 + 兜底） | `sprints/09052154-kernel-fa6b66ce/tests/four-lane-router.test.ts` | classifyArtifactKind 规则 / routeFourQuadrant 四格互斥完备 / judgeAnswerKnown LLM 兜底 | → 冻结测试：import 的 classifyArtifactKind/routeFourQuadrant/judgeAnswerKnown 尚未从 task-router.js 导出 → N failures |
