# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

本 sprint 仅为验证 sprint，不实现新 HTTP 端点，不写新代码。
N/A — 任务无 HTTP 响应；Reviewer 第 6 维自动满分（schema oracle 不适用）。

---

## 已知约束（来自回归测试）

- [runSubTaskNode-payload.test.js] → `Slice4 gap 修复：透传 target_environment 到 sub-task payload（mac_web generator/evaluator 走 host）`
- [runSubTaskNode-payload.test.js] → `注入 logical_task_id 让 extractWorkstreamIndex 能解出 WORKSTREAM_INDEX`
- [harness-task-evaluator-host-routing.test.js] → `targetEnv=mac_web → 调 executeOnHost（非 spawnDetached），且 host env.BRAIN_URL=localhost`
- [harness-task-evaluator-host-routing.test.js] → `targetEnv=mac_web + executeOnHost 非 0 退出 → evaluate_verdict=FAIL`
- [harness-task-evaluator-host-routing.test.js] → `targetEnv=local_api → 仍走 spawnDetached（回归），不调 executeOnHost`
- [harness-task-evaluator-host-routing.test.js] → `host 路径 env 含 WECHAT_RPA_WORKFLOW`

---

## 接缝清单（DoD 必须分两类断言 — v9.3 要求）

| 接缝 | 真目标 | 验证方式 | 状态 |
|---|---|---|---|
| Brain 5221 API 可达 | localhost:5221（本机 Brain 进程） | `curl -sf localhost:5221/api/brain/health \| jq -e '.ok'` | 接缝 — 需 Brain 在线 |
| executeOnHost 被真实调用 | macOS host `/tmp/cecelia-host-prompts/` 文件系统 | `ls /tmp/cecelia-host-prompts/ \| grep "${TASK_ID}.*host\.prompt"` | 接缝 — 需真实派发 |
| tasks 表 status 可查 | 本机 PostgreSQL (cecelia DB) | `psql cecelia -t -c "SELECT status FROM tasks WHERE id='{id}'"` | 接缝 — 需 psql 可达 |

接缝断言需 Brain + psql 在线才可验；若环境不可达，标 `logic-done-pending`，仅代码层（Step 2/3）可标 done。

---

## Golden Path

[Brain 接收 mac_web harness 任务] → [runSubTaskNode 透传 target_environment] → [extractTargetEnv 路由到 executeOnHost] → [generator/evaluator 在 macOS host 执行] → [任务到达终态，回写 Brain API 5221]

---

### Step 1: POST harness 子任务（target_environment=mac_web）到 Brain 5221

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步："向 Brain API（localhost:5221）POST 一个 harness 子任务，payload 含 `target_environment: mac_web`"

**可观测行为**: POST /api/brain/tasks 返回 HTTP 200 + 含 `id` 字段的 JSON；`tasks` 表新增一行 `status='queued'`

**验证命令**:
```bash
START_TIME=$(date -Iseconds)
RESP=$(curl -sf -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "mac_web host-escape smoke (Slice4 verify)",
    "task_type": "harness_task",
    "payload": {
      "target_environment": "mac_web",
      "sprint_dir": "sprints/",
      "journey_type": "dev_pipeline"
    }
  }') || { echo "FAIL: POST /tasks 失败（Brain 未运行）"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.id // empty')
[ -n "$TASK_ID" ] || { echo "FAIL: 响应缺 id 字段 resp=$RESP"; exit 1; }
echo "OK: task_id=$TASK_ID"
```

**硬阈值**: HTTP 200 且响应 JSON 含非空 `id`；5s 内返回

---

### Step 2: 确认 Slice4 fix 代码就位 — runSubTaskNode 源码含 target_environment 透传

**来源**: `[FROM_PRD]` — PRD 背景段："PR #3461（Slice4 透传 gap）修复了 `runSubTaskNode` 漏传 `target_environment`"；PRD 范围："验证 `runSubTaskNode` 透传 `target_environment=mac_web` 到 sub-graph"

**可观测行为**: `harness-initiative.graph.js` 的 `runSubTaskNode` 函数体包含 `target_environment` 字段传递

**验证命令**:
```bash
node -e "
  const src = require('fs').readFileSync(
    'packages/brain/src/workflows/harness-initiative.graph.js', 'utf8'
  );
  const fn = src.match(/export async function runSubTaskNode[\s\S]*?\n\}/);
  if (!fn) { console.error('FAIL: runSubTaskNode 函数未找到'); process.exit(1); }
  if (!/target_environment:\s*state\.task\??\.payload\??\.target_environment/.test(fn[0])) {
    console.error('FAIL: runSubTaskNode 未透传 target_environment（Slice4 fix 未就位）');
    process.exit(1);
  }
  console.log('OK: Slice4 fix 代码已就位');
" || exit 1
```

**硬阈值**: 正则匹配成功；exit 0（**逻辑断言**，无需 Brain 在线）

---

### Step 3: extractTargetEnv 路由 mac_web → executeOnHost — 代码路径 + 回归单测

**来源**: `[FROM_PRD]` — PRD 范围："验证 generator spawner 调用 `executeOnHost` 而非 Docker 路径"；PRD Golden Path 第 3 步："generator spawner 走 `executeOnHost`（不走 Docker）"

**可观测行为**: `harness-task.graph.js` 含 `mac_web` → `executeOnHost` 分支；`harness-task-evaluator-host-routing.test.js` 全部通过

**验证命令**:
```bash
# 静态验证
node -e "
  const src = require('fs').readFileSync(
    'packages/brain/src/workflows/harness-task.graph.js', 'utf8'
  );
  if (!src.includes(\"targetEnv === 'mac_web'\")) { console.error('FAIL: 缺 mac_web 分支'); process.exit(1); }
  if (!src.includes('executeOnHost')) { console.error('FAIL: 未调用 executeOnHost'); process.exit(1); }
  console.log('OK: mac_web → executeOnHost 分支存在');
"

# 回归单测
npx vitest run \
  packages/brain/src/workflows/__tests__/harness-task-evaluator-host-routing.test.js \
  packages/brain/src/workflows/__tests__/runSubTaskNode-payload.test.js \
  --reporter=verbose 2>&1 | tail -20
```

**硬阈值**: 静态检查 exit 0；单测 0 failures（**逻辑断言**，无需 Brain 在线）

---

### Step 4: executeOnHost 被真实调用 — host.prompt 文件写入（接缝断言）

**来源**: `[AI_ADDED]` — 防造假：代码存在但运行时未触发（Brain 版本不含 fix / 旧二进制未重启）时此步 FAIL；`host-executor.js` 在 `executeOnHost` 第一行同步 `writeFileSync('/tmp/cecelia-host-prompts/${taskId}.${runId}-host.prompt')`，是调用最直接的证明

**可观测行为**: `/tmp/cecelia-host-prompts/` 出现含 `${TASK_ID}` 的 `.host.prompt` 文件

**验证命令**:
```bash
FOUND=0
for i in $(seq 1 30); do
  if ls /tmp/cecelia-host-prompts/ 2>/dev/null | grep -q "${TASK_ID}.*host\.prompt"; then
    FOUND=1; break
  fi
  sleep 1
done
[ "$FOUND" = "1" ] || {
  echo "FAIL: 30s 内 /tmp/cecelia-host-prompts/ 未出现 host.prompt（executeOnHost 未被调用）"
  exit 1
}
echo "OK: executeOnHost 已被真实调用"
```

**硬阈值**: 文件存在 + 文件名含 TASK_ID + 30s 内出现（**接缝断言**，需 Brain 在线 + 真实 tick 派发）

---

### Step 5: 任务在 120s 内离开 running 状态（接缝断言）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 步："任务状态变为 `completed` 或带明确 `failure_reason` 的 `failed`（不再是无限期 `running` 卡死）"

**可观测行为**: `tasks` 表 `status` 字段在 120s 内变为 `completed` 或 `failed`

**验证命令**:
```bash
MAX_WAIT=120
FINAL_STATUS=""
for i in $(seq 1 $MAX_WAIT); do
  STATUS=$(psql cecelia -t -c "SELECT status FROM tasks WHERE id='${TASK_ID}'" 2>/dev/null | tr -d ' \n')
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    FINAL_STATUS="$STATUS"; break
  fi
  [ "$i" = "$MAX_WAIT" ] && {
    echo "FAIL: 120s 后仍 status=${STATUS}（卡死，Slice4 fix 未生效）"
    exit 1
  }
  sleep 1
done
echo "OK: status=${FINAL_STATUS}"
```

**硬阈值**: `status IN ('completed','failed')` 120s 内（**接缝断言**，需 psql cecelia 可达）

---

### Step 6: 若 status=failed，failure_reason 非空有意义

**来源**: `[FROM_PRD]` — PRD 边界条件："generator 执行超时 → 任务 `failed` + failure_reason 非空，不卡死"

**可观测行为**: `failure_reason IS NOT NULL AND failure_reason != ''`（仅 status=failed 时验）

**验证命令**:
```bash
FINAL_STATUS=$(psql cecelia -t -c "SELECT status FROM tasks WHERE id='${TASK_ID}'" | tr -d ' \n')
if [ "$FINAL_STATUS" = "failed" ]; then
  REASON=$(psql cecelia -t -c "SELECT failure_reason FROM tasks WHERE id='${TASK_ID}'" | tr -d ' \n')
  [ -n "$REASON" ] || { echo "FAIL: status=failed 但 failure_reason 为空（静默卡死）"; exit 1; }
  echo "OK: failure_reason='${REASON}'"
else
  echo "OK: status=completed（不需验证 failure_reason）"
fi
```

**硬阈值**: `failure_reason` 非空（当 status=failed 时）（**接缝断言**，需 psql 可达）

---

## E2E 验收（final-e2e 跑 — dev_pipeline，bash/psql 验证）

**journey_type**: dev_pipeline
**target_environment**: mac_web（被测 harness 任务在 mac host 执行；验证脚本本身为 bash/curl/psql）

> **注意**: `target_environment=mac_web` 表示被测任务运行在 macOS host。
> E2E 验证脚本为 bash/curl/psql（非 Playwright），因为 Golden Path 的可观测输出
> 是 Brain API 状态和 DB 记录。PRD 明确："无 UI 截图验证（纯 pipeline 机制验证）"

```bash
#!/bin/bash
# final-e2e 验证脚本 — mac_web pipeline host-escape 验证（Slice4 透传 gap 修复确认）
# 执行环境：本机 macOS（Brain 5221 + psql cecelia + /tmp/cecelia-host-prompts/ 均可达）
set -e

DB="${DB_URL:-cecelia}"
SPRINT_DIR="${SPRINT_DIR:-sprints/}"

echo "=== mac_web pipeline E2E 验证开始 ==="
START_TIME=$(date -Iseconds)

# Step 2: Slice4 fix 代码验证（逻辑断言）
echo "▶ [Step 2] 验证 Slice4 fix 代码就位..."
node -e "
  const src = require('fs').readFileSync(
    'packages/brain/src/workflows/harness-initiative.graph.js', 'utf8'
  );
  const fn = src.match(/export async function runSubTaskNode[\s\S]*?\n\}/);
  if (!fn || !/target_environment:\s*state\.task\??\.payload\??\.target_environment/.test(fn[0])) {
    console.error('FAIL: runSubTaskNode 未透传 target_environment');
    process.exit(1);
  }
  console.log('OK: Slice4 fix 代码已就位');
"

# Step 3: 路由单测回归（逻辑断言）
echo "▶ [Step 3] 运行路由回归单测..."
npx vitest run \
  packages/brain/src/workflows/__tests__/harness-task-evaluator-host-routing.test.js \
  packages/brain/src/workflows/__tests__/runSubTaskNode-payload.test.js \
  --reporter=verbose 2>&1 | tail -20

# Step 1: POST 触发 harness 子任务（接缝断言）
echo "▶ [Step 1] POST harness_task（target_environment=mac_web）到 Brain 5221..."
RESP=$(curl -sf -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "mac_web host-escape smoke (Slice4 E2E verify)",
    "task_type": "harness_task",
    "payload": {
      "target_environment": "mac_web",
      "sprint_dir": "sprints/",
      "journey_type": "dev_pipeline"
    }
  }') || { echo "FAIL: Brain API 不可达（localhost:5221）"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.id // empty')
[ -n "$TASK_ID" ] || { echo "FAIL: 响应缺 id 字段"; exit 1; }
echo "OK: task_id=$TASK_ID"

# Step 4: executeOnHost 调用验证（接缝断言）
echo "▶ [Step 4] 等待 executeOnHost 写入 host.prompt 文件..."
FOUND=0
for i in $(seq 1 30); do
  if ls /tmp/cecelia-host-prompts/ 2>/dev/null | grep -q "${TASK_ID}.*host\.prompt"; then
    FOUND=1; break
  fi
  sleep 1
done
[ "$FOUND" = "1" ] || {
  echo "FAIL: 30s 内未出现 host.prompt（executeOnHost 未被调用，检查 Brain 版本 + Slice4 fix）"
  exit 1
}
echo "OK: executeOnHost 已被真实调用"

# Step 5: 任务终态验证（接缝断言）
echo "▶ [Step 5] 等待任务离开 running（最多 120s）..."
MAX_WAIT=120
FINAL_STATUS=""
for i in $(seq 1 $MAX_WAIT); do
  STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='${TASK_ID}'" 2>/dev/null | tr -d ' \n')
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    FINAL_STATUS="$STATUS"; break
  fi
  [ "$i" = "$MAX_WAIT" ] && { echo "FAIL: 120s 后仍 running（卡死，Slice4 fix 未生效）"; exit 1; }
  sleep 1
done
echo "OK: status=${FINAL_STATUS}"

# Step 6: failure_reason 验证
if [ "$FINAL_STATUS" = "failed" ]; then
  REASON=$(psql "$DB" -t -c "SELECT failure_reason FROM tasks WHERE id='${TASK_ID}'" | tr -d ' \n')
  [ -n "$REASON" ] || { echo "FAIL: status=failed 但 failure_reason 为空"; exit 1; }
  echo "OK: failure_reason='${REASON}'"
fi

# 写验证报告
cat > "${SPRINT_DIR}/e2e-verify-report.json" << REPORT_EOF
{
  "status": "PASS",
  "task_id": "${TASK_ID}",
  "final_status": "${FINAL_STATUS}",
  "executed_at": "${START_TIME}",
  "slice4_fix_verified": true,
  "host_escape_verified": true,
  "no_deadlock_verified": true
}
REPORT_EOF

echo "=== ✅ mac_web pipeline E2E 验证全部通过 ==="
echo "验证报告已写入 ${SPRINT_DIR}/e2e-verify-report.json"
```

**通过标准**: 脚本 exit 0 + `e2e-verify-report.json` 存在且 `status=PASS`
**失败标准**: 任何步骤 exit 1（含 Brain 不可达、host.prompt 未出现、任务卡死、failure_reason 为空）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Slice4 fix 代码验证 | `tests/mac-web-pipeline-verify.test.ts` | Step 2/3 逻辑断言 | 测试依赖 e2e-verify-report.json（文件不存在 → RED） |
| E2E 验证报告存在 | `tests/mac-web-pipeline-verify.test.ts` | Step 5 终态验证 | 报告未生成时 FAIL → 1 failure RED |
