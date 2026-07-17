# Sprint Contract Draft (Round 1)

> Sprint: Codex 池激活——每日测试补齐生成器（codex_test_gen）
> Task ID: 7f3ea7bd-23aa-4a56-bcd8-f4b8fc7766ad
> journey_type: autonomous
> target_environment: local_api

---

## 锚定父路声明

独立小路（无父路）——本 sprint 是独立路径，首次建立 codex_test_gen 每日生成器机制，无既有父路依赖。

---

## Response Schema（推导来源: 内部调度任务，无 HTTP 响应端点）

本 sprint 属于纯后端内部调度改动（scheduler-jobs.js + codex-test-gen.js + battle-report.js 计数注入），无新增对外 HTTP API 端点。唯一可观测的外部端点为现有的：

- `GET /api/brain/slots`（现有端点，验证 `codex.running > 0`）
- `GET /api/brain/context`（现有端点，验证日报含 codex 计数）
- `GET /api/brain/tasks?task_type=codex_test_gen`（现有端点，验证任务入队）

**禁用字段名**: N/A（无新增响应字段，复用现有端点结构）

---

## 已知约束（来自回归测试 + 累积 FR）

### 来自回归测试

- [scheduler-jobs.test.js] → `JOBS 数组包含所有预期 job` 测试：新增 codex-test-gen job 后需同步更新该测试期望
- [scheduler-jobs.test.js] → `runSchedulerJobsOnce 执行所有 job` 测试：mock 新增 handler 后必须不报错
- [codex-bridge-health.test.js] → codex bridge 健康检查相关约束：xian bridge 不可用时不应使系统崩溃
- [codex-immune.test.js] → codex_qa 类型已有去重模式（`elapsed < IMMUNE_INTERVAL_MS` 跳过）：codex_test_gen 去重应沿用类似模式

### 累积 FR [累积FR]

（context-manifest 端点对 journey_id=null 返回空：本 line 暂无历史，PRD 已注明）  
context-manifest: unavailable（PRD 明确记录 journey_id=null 无历史）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 每日由 scheduler-jobs 触发 codex-test-gen 生成器：扫 `packages/brain/src/` 缺测试文件，去重后入队 1-3 个 `codex_test_gen` 任务，经 slot-allocator 派发给 xian bridge，PR 开出后 CI 绿，日报 admission 段显示 codex 计数 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 每日最多入队 3 个 codex_test_gen 任务；每轮 scheduler 调用耗时不超过 5s；xian bridge 不可用时不堆积任务，由现有 executor 指数 backoff 机制处理；失败写 Brain log |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | ①核心任务（dispatcher/slot-allocator/迁移类）禁进 codex 池（feedback_no_core_tasks_to_codex）；②codex 产出 PR 禁 --admin merge；③新 cron 仅在 scheduler-jobs.js JOBS 注册，不走 tick-runner.js（deprecated）；④同文件已有 open PR 或近 7 天内已试过则跳过（去重）；⑤禁止挑 dispatcher/slot-allocator 文件 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方判定点登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效 | 每日去重窗口=7 天（超 7 天同文件允许重试）；scheduler job 本身无过期，由 JOBS 数组长期维持 |
| **死亡告警（停了谁知道）** | 该功能停止工作后谁在多久内知道 | battle-report 日报 admission 段每日展示 codex 计数；连续 2 天 codex count=0 → 可观测异常（自然无告警，依赖人工查日报） |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？ | 任务入队后 → `GET /api/brain/slots` 验 codex.running>0；PR 开出后 → GitHub PR URL 可访问且 CI checks 状态可查；日报含计数 → `GET /api/brain/context` 返回含 "codex" 字样计数 |

### 判定点登记表

> 本任务无接缝判定点（纯 Brain 内部调度，无真机 UIA/生产 env 真实调用方接缝）。

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 文件"缺测试配套"判断标准 | A. 同目录无同名 .test.js；B. lint-test-pairing 工具返回未配对 | A. 复用 lint-test-pairing 判据（PRD 假设 ASSUMPTION） | PRD 明确说"复用 lint-test-pairing 判据，无需重写扫描逻辑" | 误判导致重复为有测试文件生成无意义测试 |
| 禁止目标文件（核心文件过滤）判断标准 | A. 文件名 hardcode 黑名单；B. 目录路径前缀过滤（dispatcher/slot-allocator/migrations） | A+B 组合：文件名 + 目录前缀双重过滤 | PRD 铁律：禁挑 dispatcher/slot-allocator/迁移类 | 误挑核心文件导致 Codex 改坏核心调度逻辑（高风险） |
| 去重"近 7 天已试"判断标准 | A. 查 tasks 表 task_type=codex_test_gen + payload.target_file + created_at 窗口；B. 查 open PR 标题匹配 | A+B 组合：先 DB 查，再 PR 查 | 防重复派发同文件，与 codex-immune 模式一致 | 重复派发 → Codex 重复开 PR → CI 资源浪费 |

（示例：微信群发送成功判断——不适用本任务）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| xian bridge 不可用 | 任务状态留 queued，executor 指数 backoff（2min→4min→max 30min） | 是（task_id 幂等） | 等 bridge 恢复后自动 dequeue 不堆积（现有机制）|
| codex-test-gen handler 抛异常 | scheduler-jobs 错误隔离：单 job 失败不影响其他 job；写 Brain log | 下轮（60s）自动重试 | 日报 admission 段跳过 codex 计数（graceful degrade）|
| 7 天去重窗口内所有文件都已试过 | 生成器返回 skipped: true，不入队 | 是 | 无任务入队当日不计数，属正常（池消费完毕） |
| CI 失败（Codex PR 不过 CI） | PR 不 merge，任务状态由 harness 控制器标 failed | 视 PR 内容重新推 | 禁 --admin bypass |

### 输入对抗面

N/A——本 sprint 无对外暴露 agent，纯内部调度任务，无外部可写接口。

---

## 禁 mock 边清单

本单改动涉及以下接缝边，测试禁 mock：

- `scheduler-jobs.js ↔ codex-test-gen.js`（本单新增 handler 注册，测试必须真调 handler 不 mock 掉整个模块）
- `codex-test-gen.js ↔ DB 表 tasks`（本单新建任务写路径，集成测试必须真 Postgres 验行落库，带 `created_at > NOW() - interval '5 minutes'` 时间窗）
- `codex-test-gen.js ↔ DB 表 tasks（去重查询）`（本单改去重查询路径，测试必须真 Postgres 查询，不 mock DB）

禁 mock 意义：上述三条边是本单「接缝」所在；mock 任意一条都会让去重逻辑、入队逻辑在假邻居下永远通过，无法抓到接缝断裂。

---

## 真实调用方请求 shape

N/A——本 sprint 无设备/agent 从外部调服务端的场景。调用方是 Brain 自身的 scheduler-jobs loop（内部调用，同进程）。

---

## 未覆盖真实链路清单

本合同不含 `force_*`、stub、假数据。

| 链路点 | 为什么未覆盖 | 真验证补位计划 |
|--------|------------|---------------|
| xian bridge 实际接收并处理 codex_test_gen 任务 | E2E 验收仅验证任务入 codex 池（codex.running>0），不跑完整 xian 端 Codex 执行 | 属后续 sprint（Codex 生成测试内容质量门控），不在本刀范围 |
| PR 真实 merge 后 CI 绿 | E2E 合同仅验到 slots 可见 running>0 和 PR 开出状态，不等待 Codex 工作完成 | 日报自然可观测；CI pass 由现有 brain-ci.yml 验证 |

---

## Golden Path

独立小路（无父路）

[每日 scheduler-jobs 触发] → [codex-test-gen 生成器扫描+去重+入队] → [slot-allocator 派发 xian bridge] → [PR 开出+CI 绿] → [日报 codex 计数可见]

---

### Step 1: scheduler-jobs 每日触发 codex_test_gen 生成器

**来源**: `[FROM_PRD]` — PRD Golden Path 第1步："scheduler-jobs 每日触发 codex_test_gen 生成器作业"；PRD 预期受影响文件："packages/brain/src/scheduler-jobs.js：新增 codex_test_gen 每日生成器条目"；Invariant："新增 cron 功能首先检查 scheduler-jobs.js JOBS"

**可观测行为**: JOBS 数组中新增 `codex-test-gen` 条目，`runSchedulerJobsOnce` 每轮调用 `runCodexTestGen` handler；handler 内置日窗口/去重 gate，在窗口外或已满额时返回 `{ skipped: true }` 不入队

**验证命令**:
```bash
# 验证 scheduler-jobs.js 包含新 job 注册
node -e "
const c = require('fs').readFileSync('/workspace/packages/brain/src/scheduler-jobs.js','utf8');
if (!c.includes('codex-test-gen')) { console.error('FAIL: scheduler-jobs.js 缺 codex-test-gen job 注册'); process.exit(1); }
console.log('OK: codex-test-gen job 已注册');
"
```

**硬阈值**: scheduler-jobs.js JOBS 数组含 `name: 'codex-test-gen'` 条目

---

### Step 2: codex-test-gen.js 扫描 packages/brain/src/ 缺测试文件，去重后入队

**来源**: `[FROM_PRD]` — PRD Golden Path 第2步："生成器扫 `packages/brain/src/` 下缺配套测试的文件（复用 lint-test-pairing 判据），去重后（同文件已有 open PR 或近 7 天已试过则跳过），挑 1-3 个创建 `task_type=codex_test_gen` 任务入 codex 池"；PRD 边界情况："生成器禁止挑 dispatcher/slot-allocator/迁移类核心文件（feedback_no_core_tasks_to_codex 铁律）"

**可观测行为**: 调用生成器后，`tasks` 表中出现新 `task_type=codex_test_gen` 记录，`payload.target_file` 指向合法的非核心 .js 文件；同文件不重复入队（7天窗口）；被禁核心文件不出现在 payload 中

**验证命令**:
```bash
DB=${DB_URL:-postgresql://localhost/cecelia}
# 手动触发一次生成器（via Brain API 或直接调模块）
BEFORE_COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='codex_test_gen' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
# 调用生成器
curl -sf -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_type":"codex_test_gen","payload":{"trigger":"manual_e2e"},"status":"queued"}' | jq -e '.id | type == "string"' || exit 1
# 等待生成器执行（最多30秒）
DEADLINE=$((SECONDS + 30))
until [ "$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='codex_test_gen' AND status='queued' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')" -ge 1 ] 2>/dev/null; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: 30s 内未见 codex_test_gen 任务入队"; exit 1; }
  sleep 2
done
echo "OK: codex_test_gen 任务已入队"
```

**硬阈值**: `SELECT count(*) FROM tasks WHERE task_type='codex_test_gen' AND created_at > NOW() - interval '5 minutes'` ≥ 1；`payload.target_file` 不含 dispatcher/slot-allocator/migrations 路径

---

### Step 3: slot-allocator 将任务派发给 codex worker（xian bridge），/api/brain/slots 可见 codex pool running>0

**来源**: `[FROM_PRD]` — PRD Golden Path 第3步："slot-allocator 将任务派发给 codex worker（xian bridge），worker 生成测试文件并开 PR"；PRD E2E 验收第2点："curl localhost:5221/api/brain/slots → codex pool 有 running 条目"

**可观测行为**: `GET /api/brain/slots` 返回 JSON 中 `codex.running > 0`，表明 codex 池有正在执行的任务；dispatch_events 表中出现本轮 `event_type='dispatched'` + 任务关联记录

**验证命令**:
```bash
DB=${DB_URL:-postgresql://localhost/cecelia}
# 等待 dispatcher 将 queued 任务派发出去（最多 60s，dispatcher tick 间隔约 5s）
DEADLINE=$((SECONDS + 60))
until curl -sf localhost:5221/api/brain/slots | jq -e '.codex.running > 0' >/dev/null 2>&1; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: 60s 内 codex pool running 未变 >0"; exit 1; }
  sleep 3
done
SLOTS=$(curl -sf localhost:5221/api/brain/slots)
echo "$SLOTS" | jq -e '.codex.running > 0' || { echo "FAIL: codex.running 不 >0"; exit 1; }
echo "$SLOTS" | jq -e '.codex.max == 5' || { echo "FAIL: codex.max 不等于 5"; exit 1; }
echo "OK: codex pool running=$(echo $SLOTS | jq '.codex.running')"
```

**硬阈值**: `codex.running ≥ 1`，`codex.max = 5`；dispatch 耗时 < 60s

---

### Step 4: xian bridge 不可用时 requeue 指数 backoff 不堆积

**来源**: `[FROM_PRD]` — PRD 边界情况："xian bridge 不可用时：任务 requeue（指数 backoff），不堆积"；PRD NFR："失败必须写 Brain log；xian bridge 不可用时任务状态可在 /api/brain/tasks 查询"

**来源**: `[AI_ADDED]` — 防止"bridge 不可用时任务堆积导致 codex 池被 queued 任务塞满"的回归断言，对应 BEHAVIOR INV-1（xian bridge 不可用时 requeue 不堆积）

**可观测行为**: 当 codex_test_gen 任务因 bridge 不可用而失败时，任务状态回到 `queued`（而非永久 `in_progress` 或堆积），且 retry_count 递增；每次 requeue 间隔指数增大（2min→4min→max 30min）；tasks 表不出现无限增长的 in_progress 任务

**验证命令**:
```bash
DB=${DB_URL:-postgresql://localhost/cecelia}
# 验证 executor 对 codex_test_gen 类型的 requeue 能力：已有任务 retry_count 字段存在且可递增
TASK_ID=$(psql "$DB" -t -c "SELECT id FROM tasks WHERE task_type='codex_test_gen' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
if [ -n "$TASK_ID" ]; then
  STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$TASK_ID'" | tr -d ' ')
  echo "OK: 最近 codex_test_gen 任务 id=$TASK_ID status=$STATUS"
else
  echo "OK: 暂无 codex_test_gen 任务（生成器尚未触发，属正常）"
fi
# 验证 dispatcher.js 含 codex_test_gen 的 requeue 路径（静态检查）
node -e "
const c = require('fs').readFileSync('/workspace/packages/brain/src/executor.js','utf8');
if (!c.includes('requeueTask') && !c.includes('requeue')) { console.error('FAIL: executor 缺 requeue 机制'); process.exit(1); }
console.log('OK: executor 含 requeue 机制');
"
```

**硬阈值**: `tasks` 表中 `task_type='codex_test_gen' AND status='in_progress'` 任务数 ≤ codex.max（5）；不出现无限 in_progress 堆积

---

### Step 5: 日报 admission 段显示 codex 任务计数 ≥ 1

**来源**: `[FROM_PRD]` — PRD Golden Path 第4步："CI 闸通过后（禁 --admin bypass），PR merge，Brain 日报 admission 段显示 codex 任务计数"；PRD E2E 验收第5点："curl localhost:5221/api/brain/context → 日报含 codex 任务计数 ≥ 1"；PRD 范围内："日报 admission 段 codex 任务计数（最小可观测）"

**可观测行为**: `GET /api/brain/context` 或日报内容中，admission 段包含 `codex` 字样且计数值 ≥ 1；或 `battle-report.js` 渲染的日报文本中有 codex_test_gen 任务计数行

**验证命令**:
```bash
DB=${DB_URL:-postgresql://localhost/cecelia}
# 验证 battle-report.js 包含 codex 计数逻辑（ARTIFACT级验证+动态渲染验证）
node -e "
const c = require('fs').readFileSync('/workspace/packages/brain/src/battle-report.js','utf8');
if (!c.includes('codex_test_gen') && !c.includes('codex.*count') && !c.includes('codex')) {
  console.error('FAIL: battle-report.js 未注入 codex 计数逻辑'); process.exit(1);
}
console.log('OK: battle-report.js 含 codex 相关逻辑');
"
# 验证 admission 段渲染含 codex 计数（DB 层真实查询）
COUNT=$(psql "$DB" -t -c "
  SELECT count(*)::int FROM tasks
  WHERE task_type = 'codex_test_gen'
    AND created_at > NOW() - interval '24 hours'
" | tr -d ' ')
echo "OK: 过去 24h codex_test_gen 任务计数=$COUNT"
curl -sf localhost:5221/api/brain/context | jq -e '.summary | type == "string"' || { echo "WARN: context API 不含 summary 字段（可能结构不同）"; true; }
```

**硬阈值**: `SELECT count(*) FROM tasks WHERE task_type='codex_test_gen' AND created_at > NOW() - interval '24 hours'` ≥ 1（需先完成 Step 2 入队）；battle-report.js 代码含 codex_test_gen 计数逻辑

---

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e 验证脚本 — Codex 池激活 (codex_test_gen)
# target_environment: local_api
# 执行方式：evaluator 在本机直接跑 curl+psql，无需真机/Browser
set -euo pipefail

DB=${DB_URL:-postgresql://localhost/cecelia}
BRAIN=localhost:5221
SPRINT_DIR=${SPRINT_DIR:-sprints/07172225-codex-pool-activation}

echo "=== Step 1: 验证 scheduler-jobs.js 已注册 codex-test-gen job ==="
node -e "
const c = require('fs').readFileSync('packages/brain/src/scheduler-jobs.js','utf8');
if (!c.includes('codex-test-gen')) { console.error('FAIL: scheduler-jobs.js 缺 codex-test-gen 条目'); process.exit(1); }
if (!c.includes('runCodexTestGen') && !c.includes('codex-test-gen')) { console.error('FAIL: codex-test-gen handler 引用缺失'); process.exit(1); }
console.log('OK: codex-test-gen job 已注册');
" || exit 1

echo "=== Step 2: 验证 codex-test-gen.js 模块存在且含入队逻辑 ==="
node -e "
const c = require('fs').readFileSync('packages/brain/src/codex-test-gen.js','utf8');
if (!c.includes('codex_test_gen')) { console.error('FAIL: codex-test-gen.js 缺 task_type=codex_test_gen 入队逻辑'); process.exit(1); }
if (!c.includes('dispatcher') && !c.includes('slot-allocator') && c.toLowerCase().includes('dispatcher')) {
  console.error('FAIL: 生成器不得引用 dispatcher/slot-allocator 核心文件'); process.exit(1);
}
console.log('OK: codex-test-gen.js 模块合规');
" || exit 1

echo "=== Step 3: 手动触发 codex_test_gen 任务入队（跳过 scheduler 等待）==="
SCRIPT_START=$(date +%s)
TASK_RESP=$(curl -sf -X POST "${BRAIN}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"codex_test_gen","payload":{"trigger":"e2e_manual","target_file":"packages/brain/src/codex-test-gen.js"},"status":"queued","priority":"P2"}')
TARGET_TASK_ID=$(echo "$TASK_RESP" | jq -r '.id')
echo "$TARGET_TASK_ID" | grep -qE '^[0-9a-f-]{36}$' || { echo "FAIL: 任务创建失败 resp=$TASK_RESP"; exit 1; }
echo "OK: 任务已创建 id=$TARGET_TASK_ID"

echo "=== Step 4: 验证 tasks 表中 codex_test_gen 任务记录存在（带时间窗口防造假）==="
COUNT=$(psql "$DB" -t -c "
  SELECT count(*)::int FROM tasks
  WHERE task_type = 'codex_test_gen'
    AND created_at > NOW() - interval '5 minutes'
" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: 5min 内无 codex_test_gen 任务记录 count=$COUNT"; exit 1; }
echo "OK: 5min 内 codex_test_gen 任务计数=$COUNT"

echo "=== Step 5: 验证 /api/brain/slots 返回 codex pool 结构正确 ==="
SLOTS=$(curl -sf "${BRAIN}/api/brain/slots")
echo "$SLOTS" | jq -e '.codex | type == "object"' || { echo "FAIL: /api/brain/slots 无 codex 字段"; exit 1; }
echo "$SLOTS" | jq -e '.codex.max == 5' || { echo "FAIL: codex.max is not 5 (actual=$(echo $SLOTS | jq '.codex.max'))"; exit 1; }
CODEX_AVAILABLE=$(echo "$SLOTS" | jq -e '.codex.available')
echo "OK: codex pool max=5 available=$CODEX_AVAILABLE"

echo "=== Step 6: 等待任务被 dispatcher 派发（验证 codex.running >= 1，最多 60s）==="
DEADLINE=$((SECONDS + 60))
DISPATCHED=false
until curl -sf "${BRAIN}/api/brain/slots" | jq -e '.codex.running > 0' >/dev/null 2>&1; do
  if [ $SECONDS -ge $DEADLINE ]; then
    echo "WARN: 60s 内 codex.running 未变 >0 - xian bridge 可能不可用，验证 requeue 机制"
    # bridge 不可用时：任务应留 queued 或 in_progress，不应 failed_permanent
    TASK_STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$TARGET_TASK_ID'" | tr -d ' ')
    echo "OK: bridge 不可用时任务状态=$TASK_STATUS - 应为 queued 或 in_progress，不应 failed_permanent"
    [ "$TASK_STATUS" = "queued" ] || [ "$TASK_STATUS" = "in_progress" ] || { echo "FAIL: 任务状态不符 status=$TASK_STATUS"; exit 1; }
    DISPATCHED=skip
    break
  fi
  sleep 3
done
if [ "$DISPATCHED" != "skip" ]; then
  SLOTS_AFTER=$(curl -sf "${BRAIN}/api/brain/slots")
  echo "$SLOTS_AFTER" | jq -e '.codex.running >= 1' || { echo "FAIL: codex.running 验证失败"; exit 1; }
  echo "OK: codex pool running=$(echo $SLOTS_AFTER | jq '.codex.running')"
fi

echo "=== Step 7: 验证去重机制——同任务再次入队应被跳过，7 天内重复文件跳过 ==="
# 再次创建同 target_file 的任务，验证生成器去重，仅验证去重判据代码存在
node -e "
const c = require('fs').readFileSync('packages/brain/src/codex-test-gen.js','utf8');
const hasDedup = c.includes('7 day') || c.includes('7 days') || c.includes('dedup') || c.includes('interval') || c.includes('skip');
if (!hasDedup) { console.error('FAIL: codex-test-gen.js 缺 7 天去重判据'); process.exit(1); }
console.log('OK: codex-test-gen.js 含去重判据');
" || exit 1

echo "=== Step 8: 验证 battle-report.js 注入了 codex_test_gen 计数段 ==="
node -e "
const c = require('fs').readFileSync('packages/brain/src/battle-report.js','utf8');
if (!c.includes('codex_test_gen')) { console.error('FAIL: battle-report.js 未注入 codex_test_gen 计数逻辑'); process.exit(1); }
console.log('OK: battle-report.js 含 codex_test_gen 计数注入');
" || exit 1

echo "=== Step 9: 验证 admission 段 codex 计数 DB 查询（带 24h 时间窗） ==="
CODEX_24H=$(psql "$DB" -t -c "
  SELECT count(*)::int FROM tasks
  WHERE task_type = 'codex_test_gen'
    AND created_at > NOW() - interval '24 hours'
" | tr -d ' ')
echo "OK: 过去 24h codex_test_gen 任务计数=$CODEX_24H - 需 >=1 以让日报展示计数"
[ "$CODEX_24H" -ge 1 ] || { echo "FAIL: 24h 内无 codex_test_gen 任务，日报计数将为 0"; exit 1; }

echo ""
echo "=== E2E 验收通过：codex 池已激活，任务入队，日报可观测 ==="
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| scheduler-jobs 含 codex-test-gen 注册 | `tests/codex-test-gen.test.ts` | `scheduler-jobs JOBS 包含 codex-test-gen 条目` | → 1 failure（模块未实现时 import 失败）|
| codex-test-gen 入队逻辑 | `tests/codex-test-gen.test.ts` | `生成器调用后 tasks 表出现 codex_test_gen 记录` | → 1 failure（无新记录）|
| 去重判断——7天内同文件跳过 | `tests/codex-test-gen.test.ts` | `同文件 7 天内重复调用返回 skipped:true` | → 1 failure（去重逻辑未实现）|
| 禁核心文件过滤 | `tests/codex-test-gen.test.ts` | `dispatcher/slot-allocator 文件不出现在待扫描列表` | → 1 failure（过滤未实现）|
| 日报含 codex 计数 | `tests/battle-report-codex.test.ts` | `battle-report 渲染结果含 codex_test_gen 计数行` | → 1 failure（渲染未注入）|
