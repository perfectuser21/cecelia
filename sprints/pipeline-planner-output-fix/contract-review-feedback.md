# Contract Review Feedback (Round 1)

## 必须修改项

### 1. [缺失边界] Feature 1 — JSONB merge 保留性未验证

**原始命令**:
```bash
# Feature 1 的两条验证命令都只检查 result.branch 存在和格式
# 没有任何命令验证 "JSONB merge 不覆盖已有字段" 这一硬阈值
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：直接覆盖整个 result 字段，丢失所有已有数据
await db.query(
  `UPDATE tasks SET result = $1 WHERE id = $2`,
  [JSON.stringify({ branch: plannerBranch }), taskId]
);
// 原来 result 里的 {verdict: "...", summary: "..."} 全部丢失
// 但 Feature 1 的所有验证命令仍然 PASS（只检查 branch 字段）
```

**建议修复命令**:
```bash
# 验证 JSONB merge 保留性：completed planner 的 result 应同时含 branch 和其他字段
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_planner&status=completed&limit=5" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const withBranch = tasks.filter(t => t.result && t.result.branch);
    if (withBranch.length === 0) throw new Error('FAIL: 无 planner 含 branch');
    const hasOtherKeys = withBranch.filter(t => Object.keys(t.result).length > 1);
    if (hasOtherKeys.length === 0) {
      console.log('WARN: 所有 planner result 只含 branch（无法验证 merge 保留性），检查 result 键数');
      withBranch.forEach(t => console.log('  ' + t.id + ' keys: ' + JSON.stringify(Object.keys(t.result))));
    } else {
      console.log('PASS: ' + hasOtherKeys.length + '/' + withBranch.length + ' 个 planner result 含 branch + 其他字段（merge 保留）');
    }
  "
```

### 2. [命令太弱] Feature 2 边界 — 无效 ID 只查 HTTP 状态码，不验证响应体

**原始命令**:
```bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000")
[ "$STATUS" = "200" ] || [ "$STATUS" = "404" ] && echo "PASS: 无效 ID 返回 $STATUS" || (echo "FAIL: 期望 200 或 404，实际 $STATUS"; exit 1)
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：无效 ID 触发未捕获异常，但全局错误中间件返回 200 + 空体
app.use((err, req, res, next) => {
  res.status(200).json({}); // 吞掉所有错误
});
// 命令只检查 HTTP 200，完全无法区分 "正常降级" 和 "错误被吞"
```

**建议修复命令**:
```bash
# 无效 ID：验证 HTTP 状态 + 响应体是合法 JSON 且含 steps 字段（即使为空数组）
curl -s "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000" | \
  node -e "
    const raw = require('fs').readFileSync('/dev/stdin','utf8');
    let data;
    try { data = JSON.parse(raw); } catch(e) { throw new Error('FAIL: 响应非合法 JSON'); }
    if (data.error) { console.log('PASS: 返回错误信息 — ' + data.error); process.exit(0); }
    if (!Array.isArray(data.steps)) throw new Error('FAIL: 响应缺少 steps 数组');
    console.log('PASS: 无效 ID 返回合法 JSON，steps 长度 ' + data.steps.length);
  "
```

## 可选改进

- Feature 2 Happy Path 的 `includes('Sprint PRD') || includes('PRD')` 可以再加 `output_content.length > 50` 长度门槛，避免极短占位符通过
- Feature 3 Edge Case 的硬编码 task ID `e14860e3-...` 建议改为动态查询一个无 branch 的 planner 任务，避免因数据变化导致测试失效
- DoD 4 的 `curl -sf` 中 `-f` flag 在 404 时返回非零 exit code，虽然 pipe 到 node 仍可工作，但建议去掉 `-f` 用 `-s` 即可，更稳健
