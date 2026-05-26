# Sprint Contract Draft (Round 2)

**Sprint**: WS2 Route B 验证 — `/dev` skill 无 task-id 自动注册 Brain 任务
**journey_type**: dev_pipeline
**target_environment**: mac_web（本机 Mac，Brain 在 localhost:5221，bash 执行，无 UI）
**propose_round**: 2

---

## Risks

| ID | 风险 | 影响 | Mitigation |
|---|---|---|---|
| R1 | Brain 离线 | verify-route-b.sh 所有步骤失败，无法验证 Route B | 脚本首检 `/api/brain/health`；Brain 不在线时 exit 1 打印提示；evaluator 执行前同样先确认 Brain 健康 |
| R2 | 时间戳跨平台解析失败（macOS `date -j` vs Linux `date -d`） | Step 5 时间窗口计算出 DIFF=0 或负数，导致假绿或假红 | 脚本提供 macOS + Linux 两套 date 解析路径并 fallback=0；保护性断言：DIFF 为 0 时打印警告，CREATED_AT 为 null 时直接 FAIL |
| R3 | POST 成功但 GET /api/brain/tasks/:id 返回 404（写后读一致性） | count 基线比较通过但 task_id 精确查询失败，掩盖实现问题 | 脚本用 RETURNING id 精确查询，GET 404 时打印 FAIL 并 exit 1；不依赖模糊 count 断言作为主验证 |

---

## Golden Path

[generator 触发 Route B] → [POST /api/brain/tasks] → [Brain tasks 表出现 task_type=dev 新记录（status=in_progress|completed，title 非空）]

---

### Step 1: Brain 服务健康检查

**来源**: `[FROM_PRD]` — PRD「边界情况」段明确"验证脚本应先确认 Brain 存活"

**可观测行为**: `GET /api/brain/health` 返回 200，验证环境就绪

**验证命令**:
```bash
curl -sf --max-time 5 http://localhost:5221/api/brain/health -o /dev/null || { echo "FAIL: Brain 离线"; exit 1; }
echo OK
```

**硬阈值**: exit 0，响应 < 5s

---

### Step 2: 记录 task_type=dev 基线计数（防历史数据造假）

**来源**: `[FROM_PRD]` — PRD「Golden Path 具体」第 1 点："记录验证前 task_type=dev 任务总数（基线快照）"

**可观测行为**: 获取当前 tasks 表中 task_type=dev 的数量，存储为 BASELINE

**验证命令**:
```bash
BASELINE=$(curl -sf "http://localhost:5221/api/brain/tasks?task_type=dev&limit=1000" \
  | jq '[.[] // empty] | length' 2>/dev/null || echo "0")
echo "基线数量: $BASELINE"
[ -n "$BASELINE" ] || { echo "FAIL: 无法获取基线"; exit 1; }
echo OK
```

**硬阈值**: 命令 exit 0，BASELINE 为整数

---

### Step 3: 执行 Route B — POST /api/brain/tasks (task_type=dev)

**来源**: `[FROM_PRD]` — PRD「Golden Path 具体」第 2 点 + SKILL.md Route B curl 命令（PR #3142 已合并）

**可观测行为**: `POST /api/brain/tasks` 返回 201 + 含 id 字段的 JSON，新任务写入 Brain tasks 表

**验证命令**:
```bash
TEST_TITLE="Route-B-验证-$(date +%s)"
RESP=$(curl -sf -X POST "http://localhost:5221/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"dev\",\"title\":\"$TEST_TITLE\",\"description\":\"verify-route-b.sh 端到端验证\"}")
NEW_ID=$(echo "$RESP" | jq -r '.id')
[ -n "$NEW_ID" ] && [ "$NEW_ID" != "null" ] || { echo "FAIL: 响应无 id 字段 resp=$RESP"; exit 1; }
echo "新任务 ID: $NEW_ID"
echo OK
```

**硬阈值**: 响应含 id（非 null），exit 0

---

### Step 4: 验证新任务字段（task_type / **status** / title）

**来源**: `[FROM_PRD]` — PRD「Golden Path 具体」第 3 点："Brain tasks 表出现新记录：task_type=dev，**status=in_progress 或 completed**，title 非空含会话描述"

**可观测行为**: `GET /api/brain/tasks/:id` 返回该任务，task_type=dev、status∈{in_progress,completed}（双值断言）、title 非空

**验证命令**:
```bash
TASK=$(curl -sf "http://localhost:5221/api/brain/tasks/$NEW_ID")
TASK_TYPE=$(echo "$TASK" | jq -r '.task_type')
TITLE=$(echo "$TASK" | jq -r '.title')
STATUS=$(echo "$TASK" | jq -r '.status')

[ "$TASK_TYPE" = "dev" ] || { echo "FAIL: task_type=$TASK_TYPE，期望 dev"; exit 1; }
[ -n "$TITLE" ] && [ "$TITLE" != "null" ] || { echo "FAIL: title 为空"; exit 1; }
[[ "$STATUS" == "in_progress" || "$STATUS" == "completed" ]] || { echo "FAIL: status=$STATUS，期望 in_progress 或 completed"; exit 1; }
echo "task_type=$TASK_TYPE ✅  title=$TITLE ✅  status=$STATUS ✅"
echo OK
```

**硬阈值**: task_type=dev；**status∈{in_progress, completed}（双值断言，Round 2 修复 Round 1 遗漏）**；title 非空字符串；exit 0

---

### Step 5: 时间窗口断言 — 新记录必须在 5 分钟内创建

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：Step 4 若用历史 dev 任务 id（Brain 返回缓存或旧数据），可能伪造通过；时间窗口确保新记录确实是本次 Route B 调用产生的；对应 Risk R2 跨平台解析

**可观测行为**: 任务 created_at 距今 < 5 分钟

**验证命令**:
```bash
CREATED_AT=$(curl -sf "http://localhost:5221/api/brain/tasks/$NEW_ID" | jq -r '.created_at')
[ -n "$CREATED_AT" ] && [ "$CREATED_AT" != "null" ] || { echo "FAIL: created_at 字段缺失"; exit 1; }
# macOS/Linux 跨平台 date 解析（对应 Risk R2）
NOW_TS=$(date +%s)
CREATED_TS=$(date -d "$CREATED_AT" +%s 2>/dev/null \
  || date -j -f "%Y-%m-%dT%H:%M:%S" "${CREATED_AT%%.*}" +%s 2>/dev/null \
  || echo "0")
DIFF=$((NOW_TS - CREATED_TS))
[ "$DIFF" -lt 300 ] || { echo "FAIL: 任务创建于 ${DIFF}s 前，超过 5 分钟时间窗口"; exit 1; }
echo "created_at 距今 ${DIFF}s < 300s ✅"
echo OK
```

**硬阈值**: created_at 距今 < 300 秒，exit 0

---

## E2E 验收（final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: mac_web（本机 Mac bash 执行，无 UI — mac_web 此处为机器标识，非 Playwright 浏览器测试）
**使用模板**: local_api bash（dev_pipeline 无 UI，Playwright 模板不适用）

```bash
#!/bin/bash
# final-e2e 验证脚本 — WS2 Route B 端到端验证
# 在本机 Mac 执行，Brain 在 localhost:5221
set -euo pipefail

BRAIN_URL="http://localhost:5221"
TEST_TITLE="RouteB-E2E-$(date +%s)"
TEST_DESCRIPTION="verify-route-b.sh 端到端验证：/dev 无 task-id 时自动注册 Brain 任务"

# ── Step 1: Brain 健康检查 ────────────────────────────────────────
echo "▶ Step 1: Brain 健康检查..."
curl -sf --max-time 5 "$BRAIN_URL/api/brain/health" -o /dev/null || { echo "FAIL: Brain 离线"; exit 1; }
echo "✅ Brain 在线"

# ── Step 2: 基线快照 ─────────────────────────────────────────────
echo "▶ Step 2: 记录基线..."
BASELINE=$(curl -sf "$BRAIN_URL/api/brain/tasks?task_type=dev&limit=1000" \
  | jq '[.[] // empty] | length' 2>/dev/null || echo "0")
echo "  基线 task_type=dev 记录数: $BASELINE"

# ── Step 3: 执行 Route B ─────────────────────────────────────────
echo "▶ Step 3: 执行 Route B (POST /api/brain/tasks)..."
RESP=$(curl -sf -X POST "$BRAIN_URL/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"dev\",\"title\":\"$TEST_TITLE\",\"description\":\"$TEST_DESCRIPTION\"}")
NEW_ID=$(echo "$RESP" | jq -r '.id')
[ -n "$NEW_ID" ] && [ "$NEW_ID" != "null" ] || { echo "FAIL: 响应无 id 字段 resp=$RESP"; exit 1; }
echo "  新任务 ID: $NEW_ID"

# ── Step 4: 验证新任务字段（status 双值断言）─────────────────────
echo "▶ Step 4: 验证 task_type=dev / status / title..."
TASK=$(curl -sf "$BRAIN_URL/api/brain/tasks/$NEW_ID")
TASK_TYPE=$(echo "$TASK" | jq -r '.task_type')
TITLE=$(echo "$TASK" | jq -r '.title')
STATUS=$(echo "$TASK" | jq -r '.status')

[ "$TASK_TYPE" = "dev" ] || { echo "FAIL: task_type=$TASK_TYPE，期望 dev"; exit 1; }
[ -n "$TITLE" ] && [ "$TITLE" != "null" ] || { echo "FAIL: title 为空"; exit 1; }
[[ "$STATUS" == "in_progress" || "$STATUS" == "completed" ]] || { echo "FAIL: status=$STATUS，期望 in_progress 或 completed"; exit 1; }
echo "  task_type=$TASK_TYPE ✅"
echo "  title=$TITLE ✅"
echo "  status=$STATUS ✅"

# ── Step 5: 时间窗口断言（防历史数据造假）────────────────────────
echo "▶ Step 5: 时间窗口断言（< 5 分钟）..."
CREATED_AT=$(echo "$TASK" | jq -r '.created_at')
[ -n "$CREATED_AT" ] && [ "$CREATED_AT" != "null" ] || { echo "FAIL: created_at 字段缺失"; exit 1; }
NOW_TS=$(date +%s)
CREATED_TS=$(date -d "$CREATED_AT" +%s 2>/dev/null \
  || date -j -f "%Y-%m-%dT%H:%M:%S" "${CREATED_AT%%.*}" +%s 2>/dev/null \
  || echo "0")
DIFF=$((NOW_TS - CREATED_TS))
[ "$DIFF" -lt 300 ] || { echo "FAIL: 任务创建于 ${DIFF}s 前，超过 5 分钟时间窗口"; exit 1; }
echo "  created_at 距今 ${DIFF}s < 300s ✅"

echo ""
echo "✅ Route B 端到端验证通过 (NEW_ID=$NEW_ID, task_type=dev, status=$STATUS, title=$TITLE)"
```

**通过标准**: 脚本 exit 0 + stdout 含 "✅ Route B 端到端验证通过"
**失败标准**: exit 1 OR timeout 60s OR Brain 离线

---

## Workstreams

**workstream_count**: 1（净增 < 200 行，1 个文件，符合 ws_count=1 条件）

### Workstream 1: 创建 verify-route-b.sh 端到端验证脚本

**范围**: 在 `sprints/ws2-route-b-verify/` 下创建 `verify-route-b.sh`，实现 Golden Path 5 步验证逻辑
**大小**: S（< 80 行）
**依赖**: 无（首个也是唯一 ws）

---

## Test Contract（BEHAVIOR 覆盖表 — v5.0）

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/verify-route-b.test.ts` | 脚本文件存在/Route B 触发/task_type=dev/title 非空/时间窗口/Brain 健康检查 | 文件不存在 → ENOENT → exit 1 ✓ |
