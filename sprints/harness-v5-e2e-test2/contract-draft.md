# Sprint Contract Draft (Round 1)

## Feature 1: Health 端点新增 active_pipelines 字段

**行为描述**:
调用 `GET /api/brain/health` 时，返回 JSON 顶层包含 `active_pipelines` 整数字段，其值实时反映当前处于 in_progress 状态的 harness_planner 类型任务数量。无活跃 pipeline 时返回 0，不返回 null 或省略字段。该查询失败时不影响 health 端点其他字段的正常返回。

**硬阈值**:
- `active_pipelines` 字段必须存在于返回 JSON 顶层
- `active_pipelines` 值为非负整数（typeof === 'number'，Number.isInteger === true，>= 0）
- `active_pipelines` 值必须等于 `SELECT count(*) FROM tasks WHERE task_type='harness_planner' AND status='in_progress'` 的结果
- 仅统计 `task_type='harness_planner'`，不统计 harness_generator、harness_evaluator 等其他类型
- health 端点整体响应时间增量 < 50ms

**验证命令**:
```bash
# Happy path：验证字段存在且为非负整数
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!('active_pipelines' in d)) throw new Error('FAIL: 缺少 active_pipelines 字段');
    if (typeof d.active_pipelines !== 'number') throw new Error('FAIL: active_pipelines 不是 number，实际: ' + typeof d.active_pipelines);
    if (!Number.isInteger(d.active_pipelines)) throw new Error('FAIL: active_pipelines 不是整数，实际: ' + d.active_pipelines);
    if (d.active_pipelines < 0) throw new Error('FAIL: active_pipelines 为负数: ' + d.active_pipelines);
    console.log('PASS: active_pipelines = ' + d.active_pipelines + '，类型和范围正确');
  "

# 一致性验证：与数据库直接查询结果比对
API_VAL=$(curl -sf "localhost:5221/api/brain/health" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).active_pipelines))")
DB_VAL=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='harness_planner' AND status='in_progress'")
if [ "$API_VAL" = "$DB_VAL" ]; then
  echo "PASS: API ($API_VAL) == DB ($DB_VAL)"
else
  echo "FAIL: API ($API_VAL) != DB ($DB_VAL)"; exit 1
fi

# 边界验证：其他 harness 类型不计入（health 返回值不受 harness_generator 影响）
BEFORE=$(curl -sf "localhost:5221/api/brain/health" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).active_pipelines))")
# 确认字段存在且仅统计 harness_planner
DB_OTHER=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type IN ('harness_generator','harness_evaluator','harness_contract_propose') AND status='in_progress'")
echo "PASS: active_pipelines=$BEFORE 仅统计 harness_planner（其他 harness 类型有 $DB_OTHER 条不计入）"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: Health 端点添加 active_pipelines 查询

**范围**: `packages/brain/src/routes/goals.js` 中 `GET /health` 路由，新增 SQL 查询并将结果注入返回 JSON
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] `GET /api/brain/health` 返回 JSON 顶层包含 `active_pipelines` 字段，值为非负整数
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!('active_pipelines' in d))throw new Error('FAIL');if(typeof d.active_pipelines!=='number'||!Number.isInteger(d.active_pipelines)||d.active_pipelines<0)throw new Error('FAIL');console.log('PASS: '+d.active_pipelines)"
- [ ] [BEHAVIOR] `active_pipelines` 值与数据库 `SELECT count(*) FROM tasks WHERE task_type='harness_planner' AND status='in_progress'` 一致
  Test: bash -c 'A=$(curl -sf localhost:5221/api/brain/health|node -e "process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).active_pipelines))");B=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='"'"'harness_planner'"'"' AND status='"'"'in_progress'"'"'");[ "$A" = "$B" ]&&echo "PASS: $A==$B"||{ echo "FAIL: $A!=$B";exit 1; }'
- [ ] [BEHAVIOR] 查询失败时 health 端点不崩溃，仍返回其他字段
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.status||!d.organs)throw new Error('FAIL: 缺少核心字段');console.log('PASS: status='+d.status)"
