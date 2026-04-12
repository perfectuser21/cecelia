# Contract Review Feedback (Round 2)

## 必须修改项

### 1. [命令太弱] Feature 1 — Test 3 / DoD 3 与 Test 2 逻辑完全相同，无法验证"其他 harness 类型不计入"

**原始命令**:
```bash
API_VAL=$(curl -sf localhost:5221/api/brain/health | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).active_pipelines))")
PLANNER_ONLY=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='harness_planner' AND status='in_progress'")
[ "$API_VAL" = "$PLANNER_ONLY" ] && echo "PASS" || { echo "FAIL"; exit 1; }
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：统计所有 harness_* 类型（不只是 harness_planner）
const result = await pool.query(
  "SELECT count(*) FROM tasks WHERE task_type LIKE 'harness_%' AND status='in_progress'"
);
res.json({ ...healthData, active_pipelines: parseInt(result.rows[0].count) });

// 当 DB 中恰好没有 harness_generator/harness_evaluator 等非 planner 类型处于 in_progress 时，
// harness_% count === harness_planner count → Test 3 PASS
// 但实现是错的 — 一旦有其他 harness 类型 in_progress 就会多计
```

**建议修复命令**:
```bash
# 对比 ALL harness_* count 和 harness_planner only count，证明 API 值等于后者
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

**DoD 3 的 Test 字段也需要同步修改为上述逻辑。**

## 可选改进

- 性能阈值（<50ms 增量）在合同硬阈值中提及，但无验证命令。可用 `time curl` 或 `node` 计时对比加入前后响应时间，但这对 CI 环境波动敏感，理解不强制。
- 错误处理（DB 查询异常时 health 仍返回 200）无验证命令。需要模拟 DB 故障，实现成本高，理解不强制。
