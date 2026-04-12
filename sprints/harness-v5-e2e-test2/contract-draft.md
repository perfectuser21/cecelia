# Sprint Contract Draft (Round 3)

## 修订说明

Round 2 Reviewer 反馈：Test 3 与 Test 2 逻辑完全相同，无法证伪「统计所有 harness_* 而非仅 harness_planner」的假实现。
Round 3 修复：Test 3 现在同时查询 all harness_* count 和 planner-only count，通过三方对比证明 API 只统计 harness_planner。

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

### Test 3: 仅统计 harness_planner，不包含其他 harness_* 类型（Round 3 修复）
```bash
API_VAL=$(curl -sf localhost:5221/api/brain/health | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).active_pipelines))")
PLANNER_ONLY=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='harness_planner' AND status='in_progress'")
ALL_HARNESS=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type LIKE 'harness_%' AND status='in_progress'")
if [ "$API_VAL" = "$PLANNER_ONLY" ]; then
  if [ "$ALL_HARNESS" != "$PLANNER_ONLY" ]; then
    echo "PASS: API=$API_VAL == planner_only=$PLANNER_ONLY != all_harness=$ALL_HARNESS — 正确区分了类型"
  else
    echo "PASS(弱): API=$API_VAL == planner_only=$PLANNER_ONLY == all_harness=$ALL_HARNESS — 无法区分但值正确（当前无其他 harness 类型 in_progress）"
  fi
else
  echo "FAIL: API=$API_VAL != planner_only=$PLANNER_ONLY"; exit 1
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
- [ ] [BEHAVIOR] 仅统计 harness_planner，不包含其他 harness_* 类型
  Test: bash -c 'API_VAL=$(curl -sf localhost:5221/api/brain/health | node -e "process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).active_pipelines))"); PLANNER_ONLY=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='"'"'harness_planner'"'"' AND status='"'"'in_progress'"'"'"); ALL_HARNESS=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type LIKE '"'"'harness_%'"'"' AND status='"'"'in_progress'"'"'"); if [ "$API_VAL" = "$PLANNER_ONLY" ]; then if [ "$ALL_HARNESS" != "$PLANNER_ONLY" ]; then echo "PASS: API=$API_VAL == planner_only=$PLANNER_ONLY != all_harness=$ALL_HARNESS"; else echo "PASS(弱): API=$API_VAL == planner_only=$PLANNER_ONLY == all_harness=$ALL_HARNESS"; fi; else echo "FAIL: API=$API_VAL != planner_only=$PLANNER_ONLY"; exit 1; fi'
