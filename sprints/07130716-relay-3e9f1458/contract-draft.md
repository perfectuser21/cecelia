# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面 + task-tasks route 现有约定）

### Endpoint: POST /api/brain/tasks
**Success (HTTP 200/201)**:
```json
{"id":"<string>","status":"<string>","task_type":"harness_initiative","title":"headless-smoke"}
```
- `id` (string, 必填): 来源——PRD Golden Path Step 2 要求返回新 task id。
- `status` (string, 必填): 来源——现有 `task-tasks.js` 创建接口返回任务行；本合同仅允许 valid smoke task 创建后不保持 `queued`。
- `task_type` (string, 必填): 来源——PRD 字面值 `harness_initiative`。
- `title` (string, 必填): 来源——PRD 字面值 `headless-smoke`。
**禁用字段名**: [`relay_run_id`, `tmux_session`, `tui_log`, `pr_url`]
**Error (HTTP 400)**:
```json
{"error":"<string>"}
```

### Endpoint: GET /api/brain/tasks/:id
**Success (HTTP 200)**:
```json
{"id":"<string>","status":"<string>"}
```
- `id` (string, 必填): 来源——现有单任务查询。
- `status` (string, 必填): 来源——PRD 要求验证 valid smoke task 不留下 queued 可调度状态。

### Endpoint: PATCH /api/brain/tasks/:id
**Success (HTTP 200)**:
```json
{"id":"<string>","status":"cancelled"}
```
- `id` (string, 必填): 来源——现有 PATCH 单任务更新。
- `status` (string, 必填): 来源——PRD 可接受实现路径之一：创建后 PATCH `status=cancelled`。

## 已知约束（来自回归测试）

- `packages/brain/src/__tests__/task-tasks-create-executor.test.js` -> `executor=claude + mode=headed -> 不再 400`
- `packages/brain/src/__tests__/task-tasks-create-executor.test.js` -> `executor=codex + mode=headed + orchestrator=skill-relay -> 合法`
- `packages/brain/src/__tests__/task-tasks-create-executor.test.js` -> `executor=claude + mode=headless -> 合法`
- `packages/brain/src/__tests__/task-tasks-create-executor.test.js` -> `mode=xxx 非白名单值 -> 仍 400`
- `packages/brain/src/__tests__/task-tasks-create-executor.test.js` -> `executor 非 claude/codex -> 仍 400`

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 修订 `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh` 的 headless case，使其验证合法 headless/codex payload，同时不遗留 queued 可调度 harness task。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 本地 Brain API 验收；脚本失败必须非 0；不得点火真实 relay；不得依赖真实 codex 完成 PR。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 合法 `executor=codex + orchestrator=skill-relay + mode=headless` 仍被接受；非法 `mode` 仍 400；成功创建的 valid smoke task 不保持 `queued`。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 当 `/api/brain/tasks` 创建/查询/PATCH schema 或 dispatcher 可 claim 状态集合变化时，本合同需更新；由后续改动者维护。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | smoke 脚本或本 sprint tests 在 CI/DevGate 中失败；执行者立即看到非 0 exit 和 FAIL 文案。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | Brain 不可达、合法 POST 无 id、非法 mode 非 400、valid task 仍 queued 均拦截并 exit 1；清理 PATCH 可重复执行到 terminal 状态。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？ | POST 后用返回 id 查询单任务状态，确认该 id 不等于 `queued`；非法 mode 用 HTTP 400 + error 字段确认。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| valid smoke task 是否仍可被 dispatcher claim | A. 只看 POST 200/201; B. 用返回 id 查询该任务 status; C. 查询任意 queued 列表 | B. 用返回 id 查询该任务 status | PRD 真实缺口是“成功创建的那个 task”留下 queued，按 id 定点读最精确 | 误判会让 smoke 自己触发完整 harness-controller |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain API 不可达 | smoke/test exit 1 | 是，未创建或未知 id 时可重跑 | 无降级，要求本地 API 就绪 |
| 合法 headless/codex POST 无 id | exit 1 | 是 | 不继续清理，暴露 schema 回归 |
| 清理或防调度后 GET 仍为 queued | exit 1 | 是，PATCH cancelled 可重试 | 无降级，阻止 dispatch 风险 |
| 非法 mode 未返回 400 | exit 1 | 是 | 无降级，阻止白名单回归 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 本地 smoke 脚本硬编码 JSON payload | 低风险内部输入 | N/A：无 LLM prompt 入口 | 非法 executor/mode/orchestrator 由 Brain API 400 拒绝 |

## 接缝清单

- Brain API 接缝：真实 `localhost:5221/api/brain/tasks` 创建、查询、PATCH；用 curl + jq 验证。
- Dispatcher 接缝：不直接启动 dispatcher；通过同一 task id 的 `status != queued` 证明它不在可 claim 初始状态。

## Golden Path

`codex-headed-dispatch-smoke.sh` headless case -> POST `/api/brain/tasks` -> API 校验合法/非法 payload -> 返回 task id -> smoke 自清理或创建为不可调度状态 -> 查询确认 valid task 非 queued。

### Step 1: 提交合法 headless/codex relay payload
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步。

**可观测行为**: 调用方 POST `task_type=harness_initiative`、`title=headless-smoke`、`payload.executor=codex`、`payload.orchestrator=skill-relay`、`payload.mode=headless`。

**验证命令**:
```bash
BRAIN="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless-smoke-contract-step1","payload":{"orchestrator":"skill-relay","executor":"codex","mode":"headless"}}')
echo "$RESP" | jq -e '.id | type == "string"'
```

**硬阈值**: HTTP 200/201 且 `.id` 为 string；验证命令必须 exit 0。

---

### Step 2: 合法 payload 保留 schema 且不漂移到真实 relay 产物
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步和“不要求真实 codex 完成 PR/headed/tmux/tui.log”边界。

**可观测行为**: 返回体包含 task 基础字段，不要求 `relay_run_id`、`tmux_session`、`tui_log` 或 `pr_url`。

**验证命令**:
```bash
echo "$RESP" | jq -e '.id and .status and .task_type == "harness_initiative"'
echo "$RESP" | jq -e 'has("relay_run_id") | not'
echo "$RESP" | jq -e 'has("tmux_session") | not'
echo "$RESP" | jq -e 'has("tui_log") | not'
echo "$RESP" | jq -e 'has("pr_url") | not'
```

**硬阈值**: 必填字段存在；禁用字段均不存在；验证命令必须 exit 0。

---

### Step 3: valid smoke task 不留下 queued 可调度状态
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步和合同范围铁律。

**可观测行为**: smoke 对新 task 执行自清理或等价防调度机制；按 id 查询该 task 时 `status != "queued"`。

**验证命令**:
```bash
TASK_ID=$(echo "$RESP" | jq -r '.id')
curl -sf -X PATCH "$BRAIN/api/brain/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"cancelled"}' >/dev/null
STATUS=$(curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | jq -r '.status')
[ "$STATUS" != "queued" ] || { echo "FAIL: valid smoke task still queued: $TASK_ID"; exit 1; }
```

**硬阈值**: 新创建的 valid smoke task 最终 `status != queued`；若采用创建时 `status=pending_postdeploy`，等价验证仍必须按 id 查询非 queued。

---

### Step 4: 非法 mode 仍被白名单拒绝
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步和边界情况。

**可观测行为**: `mode=turbo` 返回 HTTP 400，响应体含 string `error`。

**验证命令**:
```bash
BAD_BODY=$(mktemp)
CODE=$(curl -s -o "$BAD_BODY" -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"invalid-mode-contract","payload":{"orchestrator":"skill-relay","executor":"codex","mode":"turbo"}}')
[ "$CODE" = "400" ] || { echo "FAIL: expected 400 for invalid mode, got $CODE"; cat "$BAD_BODY"; exit 1; }
jq -e '.error | type == "string"' "$BAD_BODY"
```

**硬阈值**: HTTP code = 400 且 `.error` 为 string。

## E2E 验收

**journey_type**: autonomous  
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
SMOKE_TITLE="headless-smoke-e2e-$(date +%s)-$$"

echo "1. legal headless/codex payload returns task id"
RESP=$(curl -sf -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"harness_initiative\",\"title\":\"${SMOKE_TITLE}\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\",\"mode\":\"headless\"}}")
TASK_ID=$(echo "$RESP" | jq -er '.id | select(type=="string" and length>0)')
echo "$RESP" | jq -e '.task_type == "harness_initiative"'
echo "$RESP" | jq -e 'has("relay_run_id") | not and has("tmux_session") | not and has("tui_log") | not and has("pr_url") | not'

echo "2. valid smoke task is made non-queued"
STATUS=$(echo "$RESP" | jq -r '.status // empty')
if [ "$STATUS" = "queued" ]; then
  curl -sf -X PATCH "$BRAIN/api/brain/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -d '{"status":"cancelled"}' >/dev/null
fi
FINAL=$(curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | jq -er '.status')
[ "$FINAL" != "queued" ] || { echo "FAIL: valid smoke task left queued id=$TASK_ID"; exit 1; }

echo "3. invalid mode remains rejected"
BAD=$(mktemp)
CODE=$(curl -s -o "$BAD" -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"invalid-mode-e2e","payload":{"orchestrator":"skill-relay","executor":"codex","mode":"turbo"}}')
[ "$CODE" = "400" ] || { echo "FAIL: invalid mode expected 400 got $CODE"; cat "$BAD"; exit 1; }
jq -e '.error | type == "string"' "$BAD" >/dev/null

echo "OK headless/codex accepted, invalid mode rejected, valid smoke task not queued"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| headless smoke 防调度 | `tests/headless-smoke-no-dispatch.test.ts` | `valid headless smoke task 创建后必须被取消或创建为非 queued` | 当前脚本只检查 HTTP code，未解析 id/PATCH/GET，测试失败 |
| headless smoke 合法 POST | `tests/headless-smoke-no-dispatch.test.ts` | `合法 headless/codex POST 校验必须保留` | 若 generator 删除合法 headless case，测试失败 |
| 非法 mode 白名单 | `tests/headless-smoke-no-dispatch.test.ts` | `非法 mode 白名单校验必须保留` | 若 generator 删除 invalid mode case，测试失败 |

## Notes

- contract-gate: code layer present in Cecelia repo; no third-party skip.
- 本合同只允许最小 PR 修改 `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh`。
- 禁止扩大到真实 codex 完成 PR、headed/tmux/tui.log、人审闭环或业务 executor 改造。
