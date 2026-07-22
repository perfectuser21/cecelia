# Contract DoD — fix-markdispatched-null-payload

Sprint: 07220725-fix-markdispatched-null-payload
Task ID: 2faafa72-9358-4057-b1e6-6f5a67133ed7
日期: 2026-07-22

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] markDispatched 能向 NULL payload 任务写入防重标记

**类型**: data-write-assertion
**文件**: `packages/brain/src/nightly-orchestrator.js`（第 159-171 行 `markDispatched` 函数）

**前提**:
- 数据库中存在一条 `status='queued'`、`payload IS NULL` 的任务

**触发**:
- 调用 `markDispatched(taskId)`（修复后使用 `COALESCE(payload, '{}'::jsonb) || $1::jsonb`）

**断言**:
- `SELECT payload->>'dispatched_by_orchestrator' FROM tasks WHERE id = $1` 返回 `'true'`（字符串，非 NULL）
- `SELECT payload->>'dispatched_orchestrator_date' FROM tasks WHERE id = $1` 返回今日日期（`YYYY-MM-DD` 格式）
- 任务 `status` 字段保持 `'queued'`（不得被 markDispatched 改变）

**验收命令** (`manual:bash`):
```bash
# 设置测试数据库连接（使用 brain 测试环境）
export DATABASE_URL="${TEST_DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia_test}"

# 插入 payload=NULL 的测试任务
TASK_ID=$(psql "$DATABASE_URL" -tAc "
  INSERT INTO tasks (id, title, task_type, status, priority, payload)
  VALUES (gen_random_uuid(), 'NULL-payload-test', 'dev', 'queued', 'P2', NULL)
  RETURNING id
")
echo "测试任务 ID: $TASK_ID"

# 调用 markDispatched（通过 Brain API 或直接执行 SQL 等效）
TODAY=$(date +%Y-%m-%d)
psql "$DATABASE_URL" -c "
  UPDATE tasks
  SET payload = COALESCE(payload, '{}'::jsonb) || '{\"dispatched_by_orchestrator\": true, \"dispatched_orchestrator_date\": \"$TODAY\"}'::jsonb,
      updated_at = NOW()
  WHERE id = '$TASK_ID'
"

# 断言 DB 写入正确
RESULT=$(psql "$DATABASE_URL" -tAc "SELECT payload->>'dispatched_by_orchestrator' FROM tasks WHERE id = '$TASK_ID'")
echo "dispatched_by_orchestrator = $RESULT"
[ "$RESULT" = "true" ] && echo "PASS: BEHAVIOR-1 通过" || { echo "FAIL: BEHAVIOR-1 失败，期望 'true' 实际 '$RESULT'"; exit 1; }
```

---

### [BEHAVIOR-2] markDispatched 后任务不再出现于 getPendingBacklog

**类型**: data-write-assertion + filtering-correctness
**文件**: `packages/brain/src/nightly-orchestrator.js`（`getPendingBacklog` + `markDispatched`）

**前提**:
- 同一条 `payload=NULL`、`status='queued'` 的任务已存在于数据库
- 第一次调用 `getPendingBacklog()` 返回该任务

**触发**:
- 调用 `markDispatched(taskId)`
- 再次调用 `getPendingBacklog()`

**断言**:
- 第二次调用结果中**不含**该 `taskId`（防重派生效）

**验收命令** (`manual:bash`):
```bash
export DATABASE_URL="${TEST_DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia_test}"
TODAY=$(date +%Y-%m-%d)

# 插入任务
TASK_ID=$(psql "$DATABASE_URL" -tAc "
  INSERT INTO tasks (id, title, task_type, status, priority, payload, created_at)
  VALUES (gen_random_uuid(), 'NULL-payload-backlog-test', 'dev', 'queued', 'P1', NULL, NOW())
  RETURNING id
")

# 验证第一轮 getPendingBacklog 包含该任务
FOUND=$(psql "$DATABASE_URL" -tAc "
  SELECT id FROM tasks
  WHERE status = 'queued'
    AND (payload->>'dispatched_by_orchestrator' IS NULL OR payload->>'dispatched_orchestrator_date' < '$TODAY')
    AND task_type NOT IN ('harness_planner','harness_contract_propose','harness_contract_review','harness_generate','harness_evaluate','harness_fix','harness_report','sprint_planner','sprint_generate','sprint_evaluate')
    AND id = '$TASK_ID'
")
[ -n "$FOUND" ] && echo "OK: 第一轮包含目标任务" || { echo "SETUP FAIL: 任务未出现在初始 backlog"; exit 1; }

# 执行 markDispatched
psql "$DATABASE_URL" -c "
  UPDATE tasks
  SET payload = COALESCE(payload, '{}'::jsonb) || '{\"dispatched_by_orchestrator\": true, \"dispatched_orchestrator_date\": \"$TODAY\"}'::jsonb,
      updated_at = NOW()
  WHERE id = '$TASK_ID'
" > /dev/null

# 验证第二轮不再包含
FOUND2=$(psql "$DATABASE_URL" -tAc "
  SELECT id FROM tasks
  WHERE status = 'queued'
    AND (payload->>'dispatched_by_orchestrator' IS NULL OR payload->>'dispatched_orchestrator_date' < '$TODAY')
    AND task_type NOT IN ('harness_planner','harness_contract_propose','harness_contract_review','harness_generate','harness_evaluate','harness_fix','harness_report','sprint_planner','sprint_generate','sprint_evaluate')
    AND id = '$TASK_ID'
")
[ -z "$FOUND2" ] && echo "PASS: BEHAVIOR-2 通过，第二轮不含目标任务" || { echo "FAIL: BEHAVIOR-2 失败，任务仍在 backlog"; exit 1; }
```

---

### [BEHAVIOR-3] 向后兼容：已有 payload 的任务内容不丢失

**类型**: backward-compatibility
**文件**: `packages/brain/src/nightly-orchestrator.js`（`markDispatched`）

**前提**:
- 任务 `payload = '{"existing_key": "existing_value", "other_field": 42}'`（非 NULL）

**触发**:
- 调用修复后的 `markDispatched(taskId)`

**断言**:
- `payload->>'existing_key'` 仍为 `'existing_value'`
- `payload->>'dispatched_by_orchestrator'` 为 `'true'`（新增字段成功合并）
- COALESCE 在 payload 非 NULL 时无副作用

**验收命令** (`manual:bash`):
```bash
export DATABASE_URL="${TEST_DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia_test}"
TODAY=$(date +%Y-%m-%d)

TASK_ID=$(psql "$DATABASE_URL" -tAc "
  INSERT INTO tasks (id, title, task_type, status, priority, payload)
  VALUES (gen_random_uuid(), 'existing-payload-test', 'dev', 'queued', 'P2', '{\"existing_key\": \"existing_value\", \"other_field\": 42}'::jsonb)
  RETURNING id
")

psql "$DATABASE_URL" -c "
  UPDATE tasks
  SET payload = COALESCE(payload, '{}'::jsonb) || '{\"dispatched_by_orchestrator\": true, \"dispatched_orchestrator_date\": \"$TODAY\"}'::jsonb,
      updated_at = NOW()
  WHERE id = '$TASK_ID'
" > /dev/null

EXISTING=$(psql "$DATABASE_URL" -tAc "SELECT payload->>'existing_key' FROM tasks WHERE id = '$TASK_ID'")
DISPATCHED=$(psql "$DATABASE_URL" -tAc "SELECT payload->>'dispatched_by_orchestrator' FROM tasks WHERE id = '$TASK_ID'")

[ "$EXISTING" = "existing_value" ] && [ "$DISPATCHED" = "true" ] \
  && echo "PASS: BEHAVIOR-3 通过，原有字段保留，新字段写入成功" \
  || { echo "FAIL: BEHAVIOR-3 失败。existing_key=$EXISTING dispatched=$DISPATCHED"; exit 1; }
```

---

### [BEHAVIOR-4] 三处同款 NULL 陷阱全部修复（无裸写）

**类型**: code-invariant / static-scan
**文件**:
- `packages/brain/src/post-publish-data-collector.js`（writeBackToPublishTask + completeScraperTask）
- `packages/brain/src/routes/content-library.js`（content-pipeline review patch）

**断言**:
- 上述三个文件中，所有 `payload = payload || $N::jsonb` 模式已改为 `COALESCE` 防御写法
- `grep` 扫描无命中

**验收命令** (`manual:bash`):
```bash
# 静态扫描：四个文件中不存在裸 NULL 陷阱写法
RESULT=$(grep -rn "payload = payload || \$\|result = result || \$" \
  /workspace/packages/brain/src/nightly-orchestrator.js \
  /workspace/packages/brain/src/post-publish-data-collector.js \
  /workspace/packages/brain/src/routes/content-library.js \
  2>/dev/null)

if [ -z "$RESULT" ]; then
  echo "PASS: BEHAVIOR-4 通过，无裸 NULL 陷阱写法"
else
  echo "FAIL: BEHAVIOR-4 失败，发现裸写法:"
  echo "$RESULT"
  exit 1
fi
```

---

### [BEHAVIOR-5] TDD 回归测试永久留存于 CI

**类型**: test-coverage / ci-permanence
**文件**: `packages/brain/src/__tests__/nightly-orchestrator.integration.test.js`（新增）

**断言**:
- 新增集成测试文件存在且包含至少 2 个测试用例（BEHAVIOR-1 + BEHAVIOR-2 对应）
- `packages/brain` 全量测试通过（含新增用例）
- 测试使用真实 PostgreSQL 连接（不可仅用 vi.mock 替代 pool.query）

**验收命令** (`manual:bash`):
```bash
# 检查集成测试文件存在
[ -f "/workspace/packages/brain/src/__tests__/nightly-orchestrator.integration.test.js" ] \
  && echo "OK: 集成测试文件存在" \
  || { echo "FAIL: 集成测试文件缺失"; exit 1; }

# 运行全量测试（包含新增用例）
cd /workspace/packages/brain && npx vitest run 2>&1 | tail -20
```

---

## 总体验收检查单

```bash
# 一键运行全量验收（手动执行，需真实 Postgres）
cd /workspace

echo "=== 静态扫描 NULL 陷阱 ==="
SCAN=$(grep -rn "payload = payload || \$\|result = result || \$" \
  packages/brain/src/nightly-orchestrator.js \
  packages/brain/src/post-publish-data-collector.js \
  packages/brain/src/routes/content-library.js 2>/dev/null)
[ -z "$SCAN" ] && echo "PASS" || { echo "FAIL: $SCAN"; exit 1; }

echo "=== 运行 Brain 全量测试 ==="
cd packages/brain && npx vitest run
echo "DONE"
```

---

## 不变量守卫

| 编号 | 约束 | 检测方式 |
|------|------|---------|
| INV-1 | 禁止裸写 `payload = payload \|\| $x::jsonb` | BEHAVIOR-4 静态扫描 |
| INV-2 | markDispatched 不得改变任务 status | BEHAVIOR-1 断言中验证 status 仍为 queued |
| INV-3 | getPendingBacklog 过滤逻辑不修改 | 代码 review：第 75-108 行无变更 |
| INV-4 | 集成测试连接真实 Postgres | BEHAVIOR-5 断言测试文件不使用纯 mock |
| INV-5 | 回归测试永久留存 CI | BEHAVIOR-5 + CI workflow 配置检查 |
