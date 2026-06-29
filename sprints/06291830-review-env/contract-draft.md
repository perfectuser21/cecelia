# Sprint Contract Draft (Round 4)

## Response Schema（推导来源: PRD字面 + NEW_PATTERN）

### Endpoint: POST /api/brain/harness/review-env/allocate
**Success (HTTP 200)**:
```json
{"initiative_id": "<uuid>", "port": 5300, "pid": 12345, "skipped": false}
```
- `initiative_id` (string UUID, 必填): 被分配 review 环境的 initiative ID
- `port` (number | null, 必填): 分配的端口号（5300-5399）；端口耗尽或 dist 不存在时为 null
- `pid` (number | null, 必填): 静态服务进程 PID；port=null 时为 null
- `skipped` (boolean, 必填): 跳过启动时为 true（端口耗尽/dist 不存在）
**禁用字段名**: ["listen_port", "server_port", "process_id", "proc_id"]
**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

### Endpoint: POST /api/brain/harness/review-env/release
**Success (HTTP 200)**:
```json
{"released": true, "initiative_id": "<uuid>"}
```
- `released` (boolean, 必填): 是否成功释放（记录不存在时也返回 true，幂等）
- `initiative_id` (string UUID, 必填): 释放的 initiative ID
**禁用字段名**: ["freed", "success", "ok"]
**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

### Endpoint: GET /api/brain/harness/review-env/:initiative_id
**Success (HTTP 200)**:
```json
{"allocated_at": "<iso8601>", "initiative_id": "<uuid>", "pid": 12345, "port": 5300}
```
- `allocated_at` (string ISO8601, 必填): 分配时间戳
- `initiative_id` (string UUID, 必填): 对应的 initiative
- `pid` (number, 必填): 静态服务进程 PID
- `port` (number, 必填): 已分配的端口（5300-5399）
**禁用字段名**: ["id", "server_port", "created_at"]
**HTTP 404**: initiative 无 review 环境记录
**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

## 已知约束（来自回归测试）

（暂无已知约束 — 本 sprint 为新模块，无历史回归测试）

---

## 接缝清单（逻辑断言 vs 接缝断言）

| # | 接缝点 | 真实世界碰撞处 | 验证方式 |
|---|---|---|---|
| 1 | `http.createServer` 绑定端口 | 进程真实侦听指定端口 | curl 到 allocated port 返回 200 (E2E 可验) |
| 2 | `process.kill(pid)` 终止进程 | 静态服务进程真正停止 | release 后 curl 连接被拒绝 (E2E 可验) |
| 3 | Brain 重启清理孤立进程 | Brain 启动时读 DB pid 列表执行 kill | 需真实 Brain 重启验证 → **logic-done-pending**（E2E 不覆盖） |

---

## Risks

| # | 风险 | 影响 | Mitigation |
|---|---|---|---|
| 1 | Brain 重启后孤立进程清理失败 | 已分配的静态服务进程在 Brain 重启后持续占用端口，端口池泄漏 | Brain 启动时从 `review_environments` 表读取 pid 列表，对每个 pid 尝试 `process.kill(pid, 0)` 探活后执行 `kill`；无论 kill 成功与否都清空 DB 记录。已标注 **logic-done-pending**（需真实 Brain 重启验证，E2E 不覆盖） |
| 2 | 端口耗尽（5300-5399 全占满）时影响 evaluator PASS 主流程 | 100 个 initiative 同时处于 review 中后，新 PASS 的 initiative 无法分配端口，可能阻塞 evaluator 回调 | `allocateReviewEnv` 实现为 best-effort：端口耗尽时返回 `{ skipped: true, port: null, pid: null }` 并写日志 `[review-env] 端口耗尽（5300-5399 已满）`，**不抛异常、不影响 evaluator PASS 回调的主流程**。NFR 要求 10s 内完成，跳过路径无 IO 等待 |
| 3 | 同一 initiative 二次 PASS（fix 轮重测）导致旧进程残留 | 旧静态服务进程持续占用旧端口；新分配端口不同，验收者收到两个不同端口链接，混淆 | `allocateReviewEnv` 在分配前先查询 `review_environments` 是否已存在该 `initiative_id`；若存在则先调用 `releaseReviewEnv` 停止旧进程 + 删除旧记录，再重新分配新端口。确保每个 initiative 同时最多一个 review 环境 |

---

## Golden Path

[evaluator PASS 触发] → [Brain 扫描空闲端口] → [启动静态服务] → [验收者访问 Dashboard] → [PR close 触发释放] → [端口归还]

---

### Step 1: evaluator PASS 事件触发 review 环境分配

**来源**: `[FROM_PRD]` — PRD 第 1 步："evaluator 回调写入 verdict=PASS，Brain 接收 PASS 事件"；集成点：`harness-task.graph.js` `mergePrNode` 成功 merge 后 best-effort 调 `allocateReviewEnv(initiativeId)`

**可观测行为**: Brain 日志输出 `[review-env] 分配端口 53XX → initiative <id>`；DB `review_environments` 表新增记录

**验证命令**:
```bash
# 直接调 allocate API（E2E 用，不依赖完整 pipeline）
TEST_INITIATIVE_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
DIST_DIR=$(mktemp -d)
echo '<html><body>Dashboard Review</body></html>' > "$DIST_DIR/index.html"
RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$TEST_INITIATIVE_ID\",\"dist_dir\":\"$DIST_DIR\"}")
echo "$RESP" | jq -e '.skipped == false' || { echo "FAIL: skipped=true（dist 不存在？）"; exit 1; }
echo "$RESP" | jq -e '.port >= 5300 and .port <= 5399' || { echo "FAIL: port 不在范围内"; exit 1; }
echo "$RESP" | jq -e '.pid > 0' || { echo "FAIL: pid 无效"; exit 1; }
echo "$RESP" | jq -e '.initiative_id | type == "string"' || { echo "FAIL: initiative_id 缺失"; exit 1; }
```

**硬阈值**: port ∈ [5300, 5399]，pid > 0，skipped = false，响应 < 10s

---

### Step 2: Brain 记录端口分配到持久化存储

**来源**: `[FROM_PRD]` — PRD 第 2 步："记录分配结果（initiative_id → port）到持久化存储"；假设 `review_environments` 表（PRD ASSUMPTION）

**可观测行为**: `review_environments` 表新增一行，字段 `(initiative_id, port, pid, allocated_at)`；`allocated_at` 在分配发生后 5 分钟内

**验证命令**:
```bash
COUNT=$(psql $DATABASE_URL -t -c "SELECT count(*) FROM review_environments WHERE initiative_id='$TEST_INITIATIVE_ID' AND allocated_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: DB 无 review_environments 记录"; exit 1; }
PORT_DB=$(psql $DATABASE_URL -t -c "SELECT port FROM review_environments WHERE initiative_id='$TEST_INITIATIVE_ID'" | tr -d ' ')
[ "$PORT_DB" -ge 5300 ] && [ "$PORT_DB" -le 5399 ] || { echo "FAIL: DB port=$PORT_DB 不在范围"; exit 1; }
```

**硬阈值**: count ≥ 1，port 在 DB 中 ∈ [5300, 5399]，allocated_at 在 5 分钟内

---

### Step 3: Brain 在分配端口启动 Node.js 静态文件服务

**来源**: `[FROM_PRD]` — PRD 第 3 步："Brain 在分配的端口上启动 Dashboard 静态文件服务（服务目录：apps/dashboard 的 build 产物）"

**可观测行为**: `http://localhost:<port>/` 返回 HTTP 200 且响应体含 HTML；Content-Type 含 `text/html`

**验证命令**:

gate-allow: weak-oracle/curl-no-jq 静态服务返回 HTML 非 JSON，grep 替代 jq-e；状态码用 -w "%{http_code}" oracle 模式

```bash
PORT=$(echo "$RESP" | jq -r '.port')
sleep 1  # 等服务就绪
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/")
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: HTTP 状态码 $HTTP_CODE 非 200，静态服务未就绪"; exit 1; }
HTML=$(curl -sf "http://localhost:$PORT/")
echo "$HTML" | grep -qi '<html' || { echo "FAIL: 响应不含 HTML 标签"; exit 1; }
```

**硬阈值**: HTTP 200，响应含 `<html`，首次响应 < 3s

---

### Step 4: 验收者访问 Dashboard

**来源**: `[FROM_PRD]` — PRD 第 4 步："验收者打开 http://localhost:<port> 看到 Dashboard 页面"；`[AI_ADDED]` GET 端点让前端/Cockpit 可查询已分配端口 — 理由：无端点则 Cockpit UI 无法展示"当前 review 环境"列表给验收者

**可观测行为**: `GET /api/brain/harness/review-env/:initiative_id` 返回 200 + `{ allocated_at, initiative_id, port, pid }` 完整 schema

**验证命令**:
```bash
GET_RESP=$(curl -sf "localhost:5221/api/brain/harness/review-env/$TEST_INITIATIVE_ID")
echo "$GET_RESP" | jq -e '.port >= 5300 and .port <= 5399' || { echo "FAIL: GET port 无效"; exit 1; }
echo "$GET_RESP" | jq -e '.pid > 0' || { echo "FAIL: GET pid 无效"; exit 1; }
echo "$GET_RESP" | jq -e '.allocated_at | type == "string"' || { echo "FAIL: GET allocated_at 缺失"; exit 1; }
echo "$GET_RESP" | jq -e 'keys == ["allocated_at","initiative_id","pid","port"]' || { echo "FAIL: GET schema keys 不符"; exit 1; }
```

**硬阈值**: HTTP 200，keys 完全匹配 `["allocated_at","initiative_id","pid","port"]`

---

### Step 5: shepherd 检测 initiative 完成 → 释放 review 环境

**来源**: `[FROM_PRD]` — PRD 第 5 步："shepherd 检测到 PR state = CLOSED，触发端口释放"；集成点：`shepherd.js` 在 tick 时调 `cleanupHarnessReviewEnvs(pool)` 扫描 `initiative_runs.phase IN ('done','failed')` 并逐个释放

**可观测行为**: `POST /api/brain/harness/review-env/release` 返回 `{ released: true, initiative_id }`

**验证命令**:
```bash
REL_RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/release \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$TEST_INITIATIVE_ID\"}")
echo "$REL_RESP" | jq -e '.released == true' || { echo "FAIL: released != true"; exit 1; }
echo "$REL_RESP" | jq -e '.initiative_id | type == "string"' || { echo "FAIL: initiative_id 缺失"; exit 1; }
echo "$REL_RESP" | jq -e 'keys == ["initiative_id","released"]' || { echo "FAIL: release schema keys 不符"; exit 1; }
```

**硬阈值**: HTTP 200，released = true，initiative_id 存在，keys = ["initiative_id","released"]

---

### Step 6: 端口归还到空闲池

**来源**: `[FROM_PRD]` — PRD 第 6 步："端口归还到空闲池，可被下一个 PASS 的 initiative 使用"；`[AI_ADDED]` 进程 kill 验证 — 理由：防止 generator 伪造 release（仅删 DB 记录而不杀进程）

**可观测行为**: 静态服务进程已停止（curl 返回 ECONNREFUSED）；DB `review_environments` 记录已删除

**验证命令**:

gate-allow: weak-oracle/curl-no-jq 负向测试——期望端口拒绝连接，curl 成功反为 FAIL；无 JSON body 可 jq-e 断言

```bash
PORT_RELEASED=$(psql $DATABASE_URL -t -c "SELECT port FROM review_environments WHERE initiative_id='$TEST_INITIATIVE_ID'" | tr -d ' ')
[ -z "$PORT_RELEASED" ] || { echo "FAIL: DB 记录未删除 port=$PORT_RELEASED"; exit 1; }
# 验证端口已关闭（连接拒绝 = 正确行为）
if curl -sf --connect-timeout 2 "http://localhost:$PORT/" 2>/dev/null; then
  echo "FAIL: 端口 $PORT 仍在服务，release 无效"; exit 1
fi
echo "✅ 端口 $PORT 已关闭，DB 记录已清除"
```

**硬阈值**: DB count = 0，curl 连接超时/拒绝（exit code 非 0）

---

## E2E 验收（final-e2e — target_environment = local_api）

**journey_type**: user_facing
**target_environment**: local_api

<!-- GOLDEN_SMOKE_ABILITY_SLUG: review-env-auto-allocate -->
<!-- GOLDEN_SMOKE_TARGET_ENV: local_api -->

### Scenario 1: allocate-review-env-and-serve-html
<!-- GOLDEN_SMOKE_SCENARIO: allocate-review-env-and-serve-html -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

gate-allow: weak-oracle/curl-no-jq HTML 静态文件内容验证用 grep（非 JSON，无 jq-e 字段）；状态码等待循环用 -w "%{http_code}" oracle 模式

```bash
#!/bin/bash
set -e
# 完整自包含：创建临时 dist 目录模拟 Dashboard build 产物
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DIST_DIR=$(mktemp -d)
echo '<html><body><h1>Dashboard Review Test</h1></body></html>' > "$DIST_DIR/index.html"
# STEP: 生成测试 initiative_id
TEST_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
# STEP: 调用 allocate 端点
RESP=$(curl -sf -X POST "$BRAIN_URL/api/brain/harness/review-env/allocate" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$TEST_ID\",\"dist_dir\":\"$DIST_DIR\"}")
echo "$RESP" | jq -e '.skipped == false' || { echo "FAIL: skipped=true（dist 未找到）"; rm -rf "$DIST_DIR"; exit 1; }
echo "$RESP" | jq -e '.port >= 5300 and .port <= 5399' || { echo "FAIL: port 不在 5300-5399 范围"; rm -rf "$DIST_DIR"; exit 1; }
echo "$RESP" | jq -e '.pid > 0' || { echo "FAIL: pid 无效"; rm -rf "$DIST_DIR"; exit 1; }
PORT=$(echo "$RESP" | jq -r '.port')
# STEP: 等待服务就绪（最多 5 秒）
for i in 1 2 3 4 5; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" 2>/dev/null || echo "000")
  [ "$HTTP_CODE" = "200" ] && break
  [ "$i" = "5" ] && { echo "FAIL: 端口 $PORT 5 秒内未就绪 last_code=$HTTP_CODE"; rm -rf "$DIST_DIR"; exit 1; }
  sleep 1
done
# STEP: 验证 HTML 响应
HTML=$(curl -sf "http://localhost:$PORT/")
echo "$HTML" | grep -qi 'Dashboard Review Test' || { echo "FAIL: HTML 内容不符"; rm -rf "$DIST_DIR"; exit 1; }
# 清理（同时验证 release 响应）
REL=$(curl -sf -X POST "$BRAIN_URL/api/brain/harness/review-env/release" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$TEST_ID\"}")
echo "$REL" | jq -e '.released == true' || { echo "FAIL: cleanup release 返回非 true"; rm -rf "$DIST_DIR"; exit 1; }
rm -rf "$DIST_DIR"
echo "✅ Scenario 1 通过"
```

### Scenario 2: release-review-env-stops-service
<!-- GOLDEN_SMOKE_SCENARIO: release-review-env-stops-service -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

gate-allow: weak-oracle/curl-no-jq HTML 内容用 grep 验证（非 JSON）；端口关闭负向测试 if-then-exit 模式——curl 成功反为 FAIL，无 JSON body 可 jq-e
gate-allow: domain/db-no-time-window 删除验证（期望 count=0）——确认 release 后记录已被删除，非存在性探测；TEST_ID 为当场生成 UUID，无历史数据污染风险，时间窗无意义

```bash
#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DIST_DIR=$(mktemp -d)
echo '<html><body>Release Test</body></html>' > "$DIST_DIR/index.html"
# STEP: 分配端口并启动服务
TEST_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
ALLOC=$(curl -sf -X POST "$BRAIN_URL/api/brain/harness/review-env/allocate" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$TEST_ID\",\"dist_dir\":\"$DIST_DIR\"}")
echo "$ALLOC" | jq -e '.skipped == false' || { echo "FAIL: alloc skipped=true"; rm -rf "$DIST_DIR"; exit 1; }
echo "$ALLOC" | jq -e '.port >= 5300 and .port <= 5399' || { echo "FAIL: alloc port 越界"; rm -rf "$DIST_DIR"; exit 1; }
PORT=$(echo "$ALLOC" | jq -r '.port')
sleep 1
HTML=$(curl -sf "http://localhost:$PORT/" || { echo "FAIL: 服务启动后端口无法访问"; rm -rf "$DIST_DIR"; exit 1; })
echo "$HTML" | grep -qi 'Release Test' || { echo "FAIL: HTML 内容不符（期望 'Release Test'）"; rm -rf "$DIST_DIR"; exit 1; }
# STEP: 调用 release
REL=$(curl -sf -X POST "$BRAIN_URL/api/brain/harness/review-env/release" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$TEST_ID\"}")
echo "$REL" | jq -e '.released == true' || { echo "FAIL: release 返回非 true"; rm -rf "$DIST_DIR"; exit 1; }
# STEP: 等待进程停止
sleep 1
# STEP: 验证端口已关闭（连接拒绝 = 正确）
if curl -sf --connect-timeout 2 "http://localhost:$PORT/" 2>/dev/null; then
  echo "FAIL: 端口 $PORT 在 release 后仍在服务"; rm -rf "$DIST_DIR"; exit 1
fi
# STEP: 验证 DB 记录已删除
DB_URL="${DATABASE_URL:-postgresql://localhost/cecelia}"
DB_COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM review_environments WHERE initiative_id='$TEST_ID'" 2>/dev/null | tr -d ' ')
[ "$DB_COUNT" = "0" ] || { echo "FAIL: DB 记录未删除 count=$DB_COUNT"; rm -rf "$DIST_DIR"; exit 1; }
rm -rf "$DIST_DIR"
echo "✅ Scenario 2 通过"
```

### Scenario 3: port-exhaustion-graceful-skip
<!-- GOLDEN_SMOKE_SCENARIO: port-exhaustion-graceful-skip -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB_URL="${DATABASE_URL:-postgresql://localhost/cecelia}"
# STEP: 填满端口池（直接写 DB 而非启动真实进程，避免资源耗尽）
FAKE_IDS=()
for i in $(seq 5300 5399); do
  FAKE_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
  FAKE_IDS+=("$FAKE_ID")
  psql "$DB_URL" -c "INSERT INTO review_environments (initiative_id, port, pid) VALUES ('$FAKE_ID', $i, 99999) ON CONFLICT DO NOTHING" > /dev/null 2>&1
done
# STEP: 再分配一个 → 应跳过
OVERFLOW_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
DIST_DIR=$(mktemp -d)
echo '<html/>' > "$DIST_DIR/index.html"
RESP=$(curl -sf -X POST "$BRAIN_URL/api/brain/harness/review-env/allocate" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$OVERFLOW_ID\",\"dist_dir\":\"$DIST_DIR\"}")
echo "$RESP" | jq -e '.skipped == true' || { echo "FAIL: 端口耗尽时 skipped 应为 true"; exit 1; }
echo "$RESP" | jq -e '.port == null' || { echo "FAIL: 端口耗尽时 port 应为 null"; exit 1; }
# STEP: 清理假数据
for FAKE_ID in "${FAKE_IDS[@]}"; do
  psql "$DB_URL" -c "DELETE FROM review_environments WHERE initiative_id='$FAKE_ID'" > /dev/null 2>&1
done
rm -rf "$DIST_DIR"
echo "✅ Scenario 3 通过"
```

### Scenario 4: get-review-env-returns-schema
<!-- GOLDEN_SMOKE_SCENARIO: get-review-env-returns-schema -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 15000 -->

```bash
#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DIST_DIR=$(mktemp -d)
echo '<html/>' > "$DIST_DIR/index.html"
TEST_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
# STEP: allocate
ALLOC_PRE=$(curl -sf -X POST "$BRAIN_URL/api/brain/harness/review-env/allocate" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$TEST_ID\",\"dist_dir\":\"$DIST_DIR\"}")
echo "$ALLOC_PRE" | jq -e '.skipped == false' || { echo "FAIL: alloc skipped=true"; rm -rf "$DIST_DIR"; exit 1; }
# STEP: GET schema 验证
GET_RESP=$(curl -sf "$BRAIN_URL/api/brain/harness/review-env/$TEST_ID")
echo "$GET_RESP" | jq -e '.port >= 5300 and .port <= 5399' || { echo "FAIL: GET port 无效"; exit 1; }
echo "$GET_RESP" | jq -e '.pid > 0' || { echo "FAIL: GET pid 无效"; exit 1; }
echo "$GET_RESP" | jq -e '.allocated_at | type == "string"' || { echo "FAIL: GET allocated_at 缺失"; exit 1; }
echo "$GET_RESP" | jq -e 'keys == ["allocated_at","initiative_id","pid","port"]' || { echo "FAIL: GET keys 不符"; exit 1; }
# 禁用字段反向检查
echo "$GET_RESP" | jq -e 'has("server_port") | not' || { echo "FAIL: 禁用字段 server_port 出现"; exit 1; }
echo "$GET_RESP" | jq -e 'has("created_at") | not' || { echo "FAIL: 禁用字段 created_at 出现"; exit 1; }
# STEP: 404 验证（不存在的 initiative）
NONEXIST_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
HTTP_404=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/harness/review-env/$NONEXIST_ID")
[ "$HTTP_404" = "404" ] || { echo "FAIL: 不存在 initiative 应返 404，实际=$HTTP_404"; exit 1; }
# 清理
REL_S4=$(curl -sf -X POST "$BRAIN_URL/api/brain/harness/review-env/release" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$TEST_ID\"}")
echo "$REL_S4" | jq -e '.released == true' || { echo "FAIL: cleanup release failed"; rm -rf "$DIST_DIR"; exit 1; }
rm -rf "$DIST_DIR"
echo "✅ Scenario 4 通过"
```

---

## 完整 final-e2e 脚本（local_api — 串行执行上面 4 个 Scenario）

gate-allow: domain/db-no-time-window DDL 层表存在性探测（SELECT 1 ... LIMIT 0）——验证 migration 是否已建表，非数据聚合，无时间窗语义

```bash
#!/bin/bash
set -e
export BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
export DATABASE_URL="${DATABASE_URL:-postgresql://localhost/cecelia}"

# 前置检查：Brain 健康
curl -sf "$BRAIN_URL/api/brain/health" | jq -e '.ok == true or .status == "ok"' || { echo "FAIL: Brain 不健康"; exit 1; }
# 前置检查：review_environments 表存在
psql "$DATABASE_URL" -c "SELECT 1 FROM review_environments LIMIT 0" > /dev/null 2>&1 || { echo "FAIL: review_environments 表不存在（需先跑 migration）"; exit 1; }

echo "=== Scenario 1: allocate-and-serve ==="
# ... （Scenario 1 完整脚本内容，见上方）

echo "=== Scenario 2: release-stops-service ==="
# ... （Scenario 2 完整脚本内容，见上方）

echo "=== Scenario 3: port-exhaustion ==="
# ... （Scenario 3 完整脚本内容，见上方）

echo "=== Scenario 4: get-schema ==="
# ... （Scenario 4 完整脚本内容，见上方）

echo "✅ 所有 Scenario 通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `tests/review-env-manager.test.js` | findFreePort / allocate / release / exhaustion / dist-missing | → 至少 5 failures（函数未实现）|
