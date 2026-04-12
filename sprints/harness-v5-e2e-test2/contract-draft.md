# Sprint Contract Draft (Round 4)

## 修订说明

Round 3 Reviewer 判定 REVISION。
核心问题：Test 3 存在 `PASS(弱)` 路径——当 DB 中恰好没有其他 harness_* 类型 in_progress 时，planner_only == all_harness，测试无法证伪「统计所有 harness_* 而非仅 harness_planner」的假实现。
Round 4 修复：Test 3 改为**主动注入**一条 `harness_generator` + `in_progress` 临时记录，强制制造 planner_only ≠ all_harness 差异，验证后清理。消除弱通过路径。

---

## Feature 1: Health 端点返回 active_pipelines 字段

**行为描述**:
调用 `GET /api/brain/health` 时，返回的 JSON 中包含 `active_pipelines` 整数字段，值等于当前 tasks 表中 `task_type='harness_planner'` 且 `status='in_progress'` 的记录数。无符合记录时返回 0，不返回 null 或省略字段。

**硬阈值**:
- 响应 JSON 包含 `active_pipelines` 字段，类型为非负整数
- `active_pipelines` 值 = `SELECT count(*) FROM tasks WHERE task_type='harness_planner' AND status='in_progress'` 的结果
- 仅统计 `harness_planner` 类型，不包含 `harness_generator`、`harness_evaluator` 等其他 harness 相关类型
- health 端点响应时间增量 <50ms

**验证命令**:

### Test 1: active_pipelines 字段存在且为非负整数
```bash
curl -sf localhost:5221/api/brain/health | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const val = data.active_pipelines;
  if (val === undefined || val === null) { console.error('FAIL: active_pipelines 字段不存在'); process.exit(1); }
  if (!Number.isInteger(val) || val < 0) { console.error('FAIL: active_pipelines 不是非负整数，值=' + val); process.exit(1); }
  console.log('PASS: active_pipelines=' + val + '，类型正确');
"
```

### Test 2: active_pipelines 值与 DB 中 harness_planner in_progress 计数一致
```bash
API_VAL=$(curl -sf localhost:5221/api/brain/health | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).active_pipelines))")
DB_VAL=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='harness_planner' AND status='in_progress'")
if [ "$API_VAL" = "$DB_VAL" ]; then
  echo "PASS: API=$API_VAL == DB=$DB_VAL"
else
  echo "FAIL: API=$API_VAL != DB=$DB_VAL"; exit 1
fi
```

### Test 3: 仅统计 harness_planner，不包含其他 harness_* 类型（Round 4 — 强证伪）
```bash
# 1. 记录注入前的 API 值
BEFORE=$(curl -sf localhost:5221/api/brain/health | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).active_pipelines))")

# 2. 注入一条 harness_generator in_progress 临时记录
TEMP_ID=$(psql cecelia -t -A -c "INSERT INTO tasks (title, task_type, status, priority, description) VALUES ('__contract_test_probe__', 'harness_generator', 'in_progress', 'P3', 'temp probe for contract test 3') RETURNING id")

# 3. 再次查询 API
AFTER=$(curl -sf localhost:5221/api/brain/health | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).active_pipelines))")

# 4. 查 DB 两个维度
PLANNER_ONLY=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='harness_planner' AND status='in_progress'")
ALL_HARNESS=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type LIKE 'harness_%' AND status='in_progress'")

# 5. 清理临时记录
psql cecelia -c "DELETE FROM tasks WHERE id='$TEMP_ID'" > /dev/null

# 6. 判定
if [ "$BEFORE" = "$AFTER" ] && [ "$AFTER" = "$PLANNER_ONLY" ] && [ "$ALL_HARNESS" != "$PLANNER_ONLY" ]; then
  echo "PASS: API 注入前=$BEFORE 注入后=$AFTER == planner_only=$PLANNER_ONLY != all_harness=$ALL_HARNESS — 确认只统计 harness_planner"
else
  echo "FAIL: BEFORE=$BEFORE AFTER=$AFTER planner_only=$PLANNER_ONLY all_harness=$ALL_HARNESS"; exit 1
fi
```

---

## Workstreams

workstream_count: 1

### Workstream 1: Health 端点新增 active_pipelines 查询

**范围**: 在 `/api/brain/health` 路由处理函数中新增一条 SQL 查询，将结果作为 `active_pipelines` 字段加入响应 JSON
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] `GET /api/brain/health` 返回 JSON 包含 `active_pipelines` 非负整数字段
  Test: curl -sf localhost:5221/api/brain/health | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const v=d.active_pipelines;if(v===undefined||v===null){console.error('FAIL: 字段不存在');process.exit(1)}if(!Number.isInteger(v)||v<0){console.error('FAIL: 非法值='+v);process.exit(1)}console.log('PASS: active_pipelines='+v)"
- [ ] [BEHAVIOR] `active_pipelines` 值与 DB 中 harness_planner in_progress 计数一致
  Test: bash -c 'API_VAL=$(curl -sf localhost:5221/api/brain/health | node -e "process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).active_pipelines))"); DB_VAL=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='"'"'harness_planner'"'"' AND status='"'"'in_progress'"'"'"); [ "$API_VAL" = "$DB_VAL" ] && echo "PASS: API=$API_VAL == DB=$DB_VAL" || { echo "FAIL: API=$API_VAL != DB=$DB_VAL"; exit 1; }'
- [ ] [BEHAVIOR] 仅统计 harness_planner，注入 harness_generator 后 API 值不变
  Test: bash -c 'BEFORE=$(curl -sf localhost:5221/api/brain/health | node -e "process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).active_pipelines))"); TEMP_ID=$(psql cecelia -t -A -c "INSERT INTO tasks (title,task_type,status,priority,description) VALUES ('"'"'__contract_test_probe__'"'"','"'"'harness_generator'"'"','"'"'in_progress'"'"','"'"'P3'"'"','"'"'temp probe'"'"') RETURNING id"); AFTER=$(curl -sf localhost:5221/api/brain/health | node -e "process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).active_pipelines))"); PLANNER_ONLY=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='"'"'harness_planner'"'"' AND status='"'"'in_progress'"'"'"); ALL_HARNESS=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type LIKE '"'"'harness_%'"'"' AND status='"'"'in_progress'"'"'"); psql cecelia -c "DELETE FROM tasks WHERE id='"'"'$TEMP_ID'"'"'" > /dev/null; if [ "$BEFORE" = "$AFTER" ] && [ "$AFTER" = "$PLANNER_ONLY" ] && [ "$ALL_HARNESS" != "$PLANNER_ONLY" ]; then echo "PASS: API=$AFTER == planner=$PLANNER_ONLY != all_harness=$ALL_HARNESS"; else echo "FAIL: BEFORE=$BEFORE AFTER=$AFTER planner=$PLANNER_ONLY all=$ALL_HARNESS"; exit 1; fi'
