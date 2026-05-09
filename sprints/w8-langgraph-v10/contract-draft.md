# Sprint Contract Draft (Round 2)

## Round 2 修订摘要（响应 Reviewer 反馈）

1. **抽取 `lib/get-logical-id.sh`**：Step 5/6/7/8 与 E2E 验收脚本统一通过 `LOGICAL=$(bash sprints/.../lib/get-logical-id.sh "$INITIATIVE_ID")` 取 logical_task_id；后续若 schema 字段名变更只改 1 处，杜绝 4 处漏改。
2. **抽取 `lib/assert-final-state.cjs`**：Step 8 三段最终断言（顶层 completed / 无 in_progress 子任务 / 无 NULL logical_task_id 子任务）合并到一个 Node CLI；Step 8 与 E2E 验收脚本调用同一行命令。
3. **新增红证据采集器 `scripts/collect-red-evidence.sh`**：Test Contract 表后追加一行总命令，三个 ws 红证据 JSON 一次性聚合判定（exit 0 = 全部合法红，与 Test Contract 表声明的 WS1=2 / WS2=3 / WS3=2 一致）。
4. **测试文件改用 `beforeAll + 动态 import` 红规约**：未实现时 numFailedTests 等于 it() 数（不是 suite-level fail），Reviewer 可机检 `numFailedTests == 期望值`；实现后切绿无变化。
5. **WS2 lib 拆出 `parse-task-row.cjs`**：让 `parseTaskRow` 单独成模块（解决 Round 1 Reviewer `parse-task-row.cjs` 找不到的 MODULE_NOT_FOUND）；`pg-task-query.cjs` 仍负责 fetch / wait 系列，可 re-export `parseTaskRow`。

---

## Golden Path

[健康预检] → [注入 harness_initiative] → [Brain tick 派发] → [Planner success] → [Contract GAN 收敛] → [Generator 全 ws success] → [Evaluator success] → [顶层 status=completed] → [产出 verification-report.md]

---

### Step 1: 验证环境健康预检

**可观测行为**: Brain 服务 5221 端口存活；PostgreSQL 可写入 `brain_tasks` 表；远端 agent bridge 健康端点返回 200。预检失败立刻 exit 1，不进入正式验证。

**验证命令**:
```bash
# Brain 健康
curl -fsS localhost:5221/api/brain/health | jq -e '.ok == true'

# PG 可读写（含表结构兜底）
psql "$DB_URL" -c "SELECT 1" >/dev/null
psql "$DB_URL" -c "SELECT count(*) FROM information_schema.tables WHERE table_name='brain_tasks'" -t | grep -q '1'

# 远端 bridge 健康（agent_remote 路径必备）
curl -fsS localhost:5221/api/brain/agents/health | jq -e '.bridge_ok == true'
```

**硬阈值**: 三条命令全部 exit 0；任一失败立刻终止验证流程。

---

### Step 2: 注入最小可信 harness_initiative 任务

**可观测行为**: 执行 `scripts/inject-initiative.sh` 后，brain_tasks 表立刻新增一条 task_type=`harness_initiative`、status=`pending` 的记录，payload 来自 `fixtures/initiative-payload.json`，记录 id 输出到 `/tmp/harness-initiative-id`。

**验证命令**:
```bash
# 注入并捕获 id
INITIATIVE_ID=$(bash sprints/w8-langgraph-v10/scripts/inject-initiative.sh)
echo "$INITIATIVE_ID" > /tmp/harness-initiative-id
test -n "$INITIATIVE_ID"

# 校验记录确实落库（含时间窗口防造假，5 分钟内）
psql "$DB_URL" -t -c "SELECT count(*) FROM brain_tasks WHERE id='$INITIATIVE_ID' AND task_type='harness_initiative' AND status='pending' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ' | grep -q '^1$'
```

**硬阈值**: $INITIATIVE_ID 是合法 UUID；count = 1；created_at 在过去 5 分钟内。

---

### Step 3: Brain tick 派发并启动 LangGraph orchestrator

**可观测行为**: 注入后 ≤ 60 秒内，brain_tasks 中该 initiative 的 status 由 `pending` 转为 `in_progress`，且开始出现 logical_task_id 链路上的子任务记录。

**验证命令**:
```bash
INITIATIVE_ID=$(cat /tmp/harness-initiative-id)

# 等待派发（最多 60s 轮询，每 5s 一次）
node sprints/w8-langgraph-v10/lib/wait-for-status.cjs "$INITIATIVE_ID" in_progress 60

# 校验：当前 status=in_progress，logical_task_id 不为 null
psql "$DB_URL" -t -c "SELECT count(*) FROM brain_tasks WHERE id='$INITIATIVE_ID' AND status='in_progress' AND logical_task_id IS NOT NULL" | tr -d ' ' | grep -q '^1$'
```

**硬阈值**: 60 秒内观测到 status 转换；logical_task_id 非 null（W8 修复点直接验证）。

---

### Step 4: Planner 阶段 success

**可观测行为**: 出现一条 task_type=`harness_planner`、parent=$INITIATIVE_ID、status=`success` 的子任务；其产出的 sprint-prd.md 文件存在且非空。

**验证命令**:
```bash
INITIATIVE_ID=$(cat /tmp/harness-initiative-id)

# 等 Planner 子任务出现并 success（最多 20 分钟）
node sprints/w8-langgraph-v10/lib/wait-for-substep.cjs "$INITIATIVE_ID" harness_planner success 1200

# 严格校验：恰好一条 success 的 planner 子任务，且 logical_task_id 与父任务一致
psql "$DB_URL" -t -c "
  SELECT count(*) FROM brain_tasks
  WHERE parent_task_id='$INITIATIVE_ID'
    AND task_type='harness_planner'
    AND status='success'
    AND logical_task_id = (SELECT logical_task_id FROM brain_tasks WHERE id='$INITIATIVE_ID')
    AND completed_at > NOW() - interval '30 minutes'
" | tr -d ' ' | grep -q '^1$'
```

**硬阈值**: count=1；logical_task_id 一致；completed_at 在 30 分钟窗口内。

---

### Step 5: Contract GAN 收敛 success

**可观测行为**: 出现至少 1 对 harness_contract_proposer + harness_contract_reviewer 子任务，最终一对 status=`success`；GAN 收敛轮数 ≤ 3；产出 sprint-contract.md + task-plan.json。

**验证命令**:
```bash
INITIATIVE_ID=$(cat /tmp/harness-initiative-id)
LOGICAL=$(bash sprints/w8-langgraph-v10/lib/get-logical-id.sh "$INITIATIVE_ID")

# 等 contract GAN 终态
node sprints/w8-langgraph-v10/lib/wait-for-substep.cjs "$INITIATIVE_ID" harness_contract_reviewer success 1800

# proposer 和 reviewer 子任务都至少出现一次 success；总轮数 ≤ 3
PROPOSE_OK=$(psql "$DB_URL" -t -c "SELECT count(*) FROM brain_tasks WHERE logical_task_id='$LOGICAL' AND task_type='harness_contract_proposer' AND status='success'" | tr -d ' ')
REVIEW_OK=$(psql "$DB_URL" -t -c "SELECT count(*) FROM brain_tasks WHERE logical_task_id='$LOGICAL' AND task_type='harness_contract_reviewer' AND status='success'" | tr -d ' ')
TOTAL_ROUNDS=$(psql "$DB_URL" -t -c "SELECT count(*) FROM brain_tasks WHERE logical_task_id='$LOGICAL' AND task_type IN ('harness_contract_proposer','harness_contract_reviewer')" | tr -d ' ')

[ "$PROPOSE_OK" -ge 1 ] && [ "$REVIEW_OK" -ge 1 ] && [ "$TOTAL_ROUNDS" -le 6 ]
```

**硬阈值**: proposer success ≥ 1；reviewer success ≥ 1；GAN 总记录 ≤ 6（3 轮 ×2）。

---

### Step 6: Generator 全部 ws 子任务 success

**可观测行为**: 按 task-plan.json 拆出的 ws-N 子任务依次 spawn-and-interrupt（W8 修复点）；全部 status=`success`；无残留 `in_progress` 或 `failed`。

**验证命令**:
```bash
INITIATIVE_ID=$(cat /tmp/harness-initiative-id)
LOGICAL=$(bash sprints/w8-langgraph-v10/lib/get-logical-id.sh "$INITIATIVE_ID")

# 等所有 generator ws 子任务跑完（最多 60 分钟）
node sprints/w8-langgraph-v10/lib/wait-generator-all.cjs "$INITIATIVE_ID" 3600

# 严格断言：generator 子任务全部 success，零 failed/in_progress
psql "$DB_URL" -t -c "
  SELECT count(*) FROM brain_tasks
  WHERE logical_task_id='$LOGICAL'
    AND task_type='harness_generator'
    AND status NOT IN ('success')
" | tr -d ' ' | grep -q '^0$'

# 至少有一个 generator 子任务存在
psql "$DB_URL" -t -c "
  SELECT count(*) FROM brain_tasks
  WHERE logical_task_id='$LOGICAL'
    AND task_type='harness_generator'
    AND status='success'
    AND completed_at > NOW() - interval '90 minutes'
" | tr -d ' ' | awk '$1 >= 1'
```

**硬阈值**: 非 success 的 generator 子任务数 = 0；success 数 ≥ 1；completed_at 在 90 分钟窗口内。

---

### Step 7: Evaluator success

**可观测行为**: 出现一条 task_type=`harness_evaluator`、status=`success` 的子任务；其结果包含合同验证命令的 PASS 输出。

**验证命令**:
```bash
INITIATIVE_ID=$(cat /tmp/harness-initiative-id)
LOGICAL=$(bash sprints/w8-langgraph-v10/lib/get-logical-id.sh "$INITIATIVE_ID")

node sprints/w8-langgraph-v10/lib/wait-for-substep.cjs "$INITIATIVE_ID" harness_evaluator success 1800

psql "$DB_URL" -t -c "
  SELECT count(*) FROM brain_tasks
  WHERE logical_task_id='$LOGICAL'
    AND task_type='harness_evaluator'
    AND status='success'
    AND completed_at > NOW() - interval '120 minutes'
" | tr -d ' ' | awk '$1 >= 1'
```

**硬阈值**: evaluator success 子任务 ≥ 1；completed_at 在 120 分钟窗口内。

---

### Step 8: 顶层 brain_tasks.status = completed

**可观测行为**: Evaluator success 后 ≤ 60 秒内，顶层 $INITIATIVE_ID 行 status 由 `in_progress` 转为 `completed`；completed_at 落值；无任何子任务残留 `in_progress`；所有子任务都带 logical_task_id（W8 修复点）。

**验证命令**:
```bash
INITIATIVE_ID=$(cat /tmp/harness-initiative-id)

# 等顶层 completed
node sprints/w8-langgraph-v10/lib/wait-for-status.cjs "$INITIATIVE_ID" completed 120

# Round 2：三段断言（顶层 completed / 无 in_progress 子任务 / 无 NULL logical_task_id 子任务）合并到一个 CLI
# Step 8 与 E2E 验收脚本共用同一行命令，避免 4 处漏改
node sprints/w8-langgraph-v10/lib/assert-final-state.cjs "$INITIATIVE_ID"
```

**硬阈值**: `assert-final-state.cjs` exit 0（其内部分别断言 PRD 终态 SQL 返回 1 行 + 无残留 in_progress 子任务 + 无 NULL logical_task_id 子任务，任一失败 exit 非 0 并打印失败原因）。

---

### Step 9: 产出 verification-report.md（出口）

**可观测行为**: 运行 `scripts/render-report.sh "$INITIATIVE_ID"` 后，`sprints/w8-langgraph-v10/verification-report.md` 文件存在；包含运行起止时间、各阶段耗时、子任务列表表格、最终 SQL 输出原文。

**验证命令**:
```bash
INITIATIVE_ID=$(cat /tmp/harness-initiative-id)
bash sprints/w8-langgraph-v10/scripts/render-report.sh "$INITIATIVE_ID"

# 文件存在且非空
test -s sprints/w8-langgraph-v10/verification-report.md

# 必须含起止时间字段
grep -q "^- 起始时间:" sprints/w8-langgraph-v10/verification-report.md
grep -q "^- 结束时间:" sprints/w8-langgraph-v10/verification-report.md

# 必须含各阶段耗时表
grep -q "| Planner " sprints/w8-langgraph-v10/verification-report.md
grep -q "| Contract GAN " sprints/w8-langgraph-v10/verification-report.md
grep -q "| Generator " sprints/w8-langgraph-v10/verification-report.md
grep -q "| Evaluator " sprints/w8-langgraph-v10/verification-report.md

# 必须含最终 SQL 输出原文（含 INITIATIVE_ID 与 completed 字符串）
grep -q "$INITIATIVE_ID" sprints/w8-langgraph-v10/verification-report.md
grep -q "completed" sprints/w8-langgraph-v10/verification-report.md
```

**硬阈值**: 所有 grep 全部 exit 0；文件大小 > 0。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

export DB_URL="${DB_URL:-postgresql://localhost/cecelia}"

# Step 1: 健康预检
curl -fsS localhost:5221/api/brain/health | jq -e '.ok == true'
psql "$DB_URL" -c "SELECT 1" >/dev/null
psql "$DB_URL" -c "SELECT count(*) FROM information_schema.tables WHERE table_name='brain_tasks'" -t | grep -q '1'
curl -fsS localhost:5221/api/brain/agents/health | jq -e '.bridge_ok == true'

# Step 2: 注入
INITIATIVE_ID=$(bash sprints/w8-langgraph-v10/scripts/inject-initiative.sh)
echo "$INITIATIVE_ID" > /tmp/harness-initiative-id
[ -n "$INITIATIVE_ID" ]
psql "$DB_URL" -t -c "SELECT count(*) FROM brain_tasks WHERE id='$INITIATIVE_ID' AND task_type='harness_initiative' AND status='pending' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ' | grep -q '^1$'

# Step 3-7: 各阶段顺序等待 + 校验（脚本封装）
node sprints/w8-langgraph-v10/lib/wait-for-status.cjs "$INITIATIVE_ID" in_progress 60
node sprints/w8-langgraph-v10/lib/wait-for-substep.cjs "$INITIATIVE_ID" harness_planner success 1200
node sprints/w8-langgraph-v10/lib/wait-for-substep.cjs "$INITIATIVE_ID" harness_contract_reviewer success 1800
node sprints/w8-langgraph-v10/lib/wait-generator-all.cjs "$INITIATIVE_ID" 3600
node sprints/w8-langgraph-v10/lib/wait-for-substep.cjs "$INITIATIVE_ID" harness_evaluator success 1800

# Step 8: 顶层 completed + 边界（与 Step 8 共用同一行命令）
node sprints/w8-langgraph-v10/lib/wait-for-status.cjs "$INITIATIVE_ID" completed 120
node sprints/w8-langgraph-v10/lib/assert-final-state.cjs "$INITIATIVE_ID"

# Step 9: 报告产出
bash sprints/w8-langgraph-v10/scripts/render-report.sh "$INITIATIVE_ID"
test -s sprints/w8-langgraph-v10/verification-report.md
grep -q "^- 起始时间:" sprints/w8-langgraph-v10/verification-report.md
grep -q "^- 结束时间:" sprints/w8-langgraph-v10/verification-report.md
grep -q "| Planner " sprints/w8-langgraph-v10/verification-report.md
grep -q "| Contract GAN " sprints/w8-langgraph-v10/verification-report.md
grep -q "| Generator " sprints/w8-langgraph-v10/verification-report.md
grep -q "| Evaluator " sprints/w8-langgraph-v10/verification-report.md
grep -q "$INITIATIVE_ID" sprints/w8-langgraph-v10/verification-report.md
grep -q "completed" sprints/w8-langgraph-v10/verification-report.md

echo "✅ Golden Path 端到端验证通过"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 3

### Workstream 1: 入口 fixture + 注入脚本

**范围**: 提供最小可信 harness_initiative payload 与一键注入脚本，覆盖 Step 2。
**大小**: S（< 100 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/inject-initiative.test.ts`

---

### Workstream 2: 监控 / 断言 lib + 健康预检

**范围**: 提供 Node.js polling lib（wait-for-status / wait-for-substep / wait-generator-all / parse-task-row / pg-task-query）+ 共享 helper（`lib/get-logical-id.sh` / `lib/assert-final-state.cjs`），覆盖 Step 1、Step 3–8 全部等待与断言逻辑。Round 2 拆分：`parse-task-row.cjs` 单独成模块，`pg-task-query.cjs` 负责 fetch / wait 系列；`get-logical-id.sh` 与 `assert-final-state.cjs` 让 Step 5–8 与 E2E 验收共用一处实现。
**大小**: M（100–300 行）
**依赖**: Workstream 1 完成后（共享 fixture 路径与 INITIATIVE_ID 协议）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/wait-lib.test.ts`

---

### Workstream 3: 验证报告渲染器

**范围**: 实现 `scripts/render-report.sh` + 阶段耗时聚合 lib，从 brain_tasks 抽取数据填充 markdown 模板，覆盖 Step 9。
**大小**: S（< 100 行）
**依赖**: Workstream 2 完成后（复用 PG 查询 lib）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/render-report.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/inject-initiative.test.ts` | injectInitiative() 用 fake pgClient 插入并返回 UUID；缺 requirement / payload 文件不存在抛 ValidationError | numFailedTests=2 / numPassedTests=0 / success=false |
| WS2 | `tests/ws2/wait-lib.test.ts` | parseTaskRow() 把 PG 行解析成驼峰；waitForStatus() 立即 resolve / 超时抛 TimeoutError | numFailedTests=3 / numPassedTests=0 / success=false |
| WS3 | `tests/ws3/render-report.test.ts` | aggregatePhaseDurations() 按 task_type 分桶；renderMarkdown() 含起止时间块 + 4 行阶段表 + 最终 SQL 输出 + N/A 兜底 | numFailedTests=2 / numPassedTests=0 / success=false |

**Round 2 红证据采集（Reviewer 一行命令机检）**:

```bash
bash sprints/w8-langgraph-v10/scripts/collect-red-evidence.sh
# exit 0 = 三个 ws 全部"合法红"（数量与上表一致）；任一不符 exit 1
```

**单 ws 红证据明细命令**（Generator 实现前可独立运行）：

```bash
# WS1：期望 2 红
npx vitest run sprints/w8-langgraph-v10/tests/ws1/inject-initiative.test.ts --reporter=json > /tmp/ws1-red.json 2>/dev/null
jq -e '.success == false and .numFailedTests == 2 and .numPassedTests == 0' /tmp/ws1-red.json

# WS2：期望 3 红
npx vitest run sprints/w8-langgraph-v10/tests/ws2/wait-lib.test.ts --reporter=json > /tmp/ws2-red.json 2>/dev/null
jq -e '.success == false and .numFailedTests == 3 and .numPassedTests == 0' /tmp/ws2-red.json

# WS3：期望 2 红
npx vitest run sprints/w8-langgraph-v10/tests/ws3/render-report.test.ts --reporter=json > /tmp/ws3-red.json 2>/dev/null
jq -e '.success == false and .numFailedTests == 2 and .numPassedTests == 0' /tmp/ws3-red.json
```

**红 → 绿切换**：Generator 实现 lib 后，三组 jq 断言会失败（数量从 N → 0）；届时 CI 校验切换为 `numFailedTests == 0 and numPassedTests >= N and success == true`，由 Generator 仓库内 vitest 默认机制覆盖，本合同不再额外维护"绿命令"。
