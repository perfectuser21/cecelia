# 合同草案（第 1 轮）

**Proposer**: sprint-contract-proposer  
**时间**: 2026-04-08  
**Sprint**: Sprint 3 — 执行成本追踪（token/cost 写入 DB）

---

## 本次实现的功能

- Feature A: 修复 execution-callback 中 cost/token 写入 `tasks.result` 的可靠性
- Feature B: 新增 `GET /api/brain/tasks/:id/metrics` 查询端点

---

## 验收标准（DoD）

### Feature A: 修复 cost 写入路径

**行为描述**：任务执行完成后（无论经过正常路径还是 watchdog rescue 路径），`tasks.result` 中必须包含 `duration_ms`、`total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens` 这 5 个执行指标字段。

**硬阈值**：
- 5 个字段全部写入（缺失的 fallback 为 0，而非 null）
- `input_tokens` / `output_tokens` 从 `result.usage` 路径读取（修复当前从顶层读的 bug）
- cost 写入 SQL 不依赖 `WHERE status = 'in_progress'` 约束

**验证命令**：
```bash
# Happy path: 验证 callback 写入 tasks.result 正确包含 5 个指标字段
# 构造一个模拟 callback payload（模拟 cecelia-run 输出格式）
node -e "
const http = require('http');
const taskId = process.env.TEST_TASK_ID || require('crypto').randomUUID();

// 先在 DB 中创建一个 in_progress 测试任务
const { execSync } = require('child_process');
const insertResult = execSync(
  \`psql cecelia -t -c \"INSERT INTO tasks (id, title, status, task_type) VALUES ('\${taskId}', 'cost-test', 'in_progress', 'dev') RETURNING id;\"\`
).toString().trim();
console.log('inserted task:', insertResult);

// 发送 execution-callback
const payload = JSON.stringify({
  task_id: taskId,
  run_id: 'test-run-' + Date.now(),
  status: 'AI Done',
  duration_ms: 12345,
  result: {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 12345,
    num_turns: 5,
    total_cost_usd: 0.123456,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 100
    }
  }
});

const req = http.request({
  hostname: 'localhost', port: 5221, path: '/api/brain/execution-callback',
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    console.log('callback response:', data);
    // 验证 tasks.result 包含 5 个字段
    const { execSync: es } = require('child_process');
    const result = JSON.parse(es(\`psql cecelia -t -c \"SELECT result FROM tasks WHERE id = '\${taskId}' LIMIT 1;\"\`).toString().trim());
    const keys = ['duration_ms', 'total_cost_usd', 'num_turns', 'input_tokens', 'output_tokens'];
    const missing = keys.filter(k => !(k in result));
    if (missing.length > 0) {
      console.error('FAIL: tasks.result 缺少字段:', missing);
      process.exit(1);
    }
    if (result.input_tokens !== 1000) {
      console.error('FAIL: input_tokens 期望 1000，实际', result.input_tokens);
      process.exit(1);
    }
    if (result.output_tokens !== 500) {
      console.error('FAIL: output_tokens 期望 500，实际', result.output_tokens);
      process.exit(1);
    }
    console.log('PASS: tasks.result 包含全部 5 个指标，token 字段正确');
    // 清理测试数据
    es(\`psql cecelia -c \"DELETE FROM tasks WHERE id = '\${taskId}';\"\`);
  });
});
req.on('error', e => { console.error('FAIL:', e.message); process.exit(1); });
req.write(payload);
req.end();
"

# 边界情况：watchdog 已将任务移出 in_progress，cost 仍需写入
node -e "
const { execSync } = require('child_process');
const taskId = require('crypto').randomUUID();
// 插入一个已被 watchdog 标记为 failed 的任务（status != in_progress）
execSync(\`psql cecelia -c \"INSERT INTO tasks (id, title, status, task_type) VALUES ('\${taskId}', 'watchdog-cost-test', 'failed', 'dev');\"\`);

const http = require('http');
const payload = JSON.stringify({
  task_id: taskId, run_id: 'wd-run-' + Date.now(),
  status: 'AI Done', duration_ms: 5000,
  result: {
    type: 'result', duration_ms: 5000, num_turns: 3, total_cost_usd: 0.05,
    usage: { input_tokens: 300, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  }
});
const req = http.request({
  hostname: 'localhost', port: 5221, path: '/api/brain/execution-callback',
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const { execSync: es } = require('child_process');
    const raw = es(\`psql cecelia -t -c \"SELECT result FROM tasks WHERE id = '\${taskId}';\"\`).toString().trim();
    try {
      const r = JSON.parse(raw);
      if (typeof r.duration_ms === 'number') {
        console.log('PASS: watchdog 路径下 cost 仍成功写入 tasks.result');
      } else {
        console.error('FAIL: watchdog 路径下 tasks.result 缺少 duration_ms');
        process.exit(1);
      }
    } catch(e) {
      console.error('FAIL: tasks.result 不是有效 JSON:', raw);
      process.exit(1);
    }
    es(\`psql cecelia -c \"DELETE FROM tasks WHERE id = '\${taskId}';\"\`);
  });
});
req.on('error', e => { console.error('FAIL:', e.message); process.exit(1); });
req.write(payload); req.end();
"
```

---

### Feature B: GET /api/brain/tasks/:id/metrics 端点

**行为描述**：通过 task_id 查询该任务的执行指标，优先读 `task_run_metrics` 表，fallback 读 `tasks.result`。

**硬阈值**：
- 存在的 task → 200 + JSON，含 `task_id`, `duration_ms`, `total_cost_usd`, `num_turns`, `input_tokens`, `output_tokens`, `source`
- 不存在的 task → 404
- `source` 字段标明数据来源（`"task_run_metrics"` 或 `"tasks.result"` 或 `"not_found"`）

**验证命令**：
```bash
# Happy path: 查询已有 task_run_metrics 记录的任务
TASK_ID=$(psql cecelia -t -c "SELECT task_id FROM task_run_metrics WHERE cost_usd IS NOT NULL LIMIT 1;" | tr -d ' \n')
echo "Testing with task_id: $TASK_ID"
curl -sf "localhost:5221/api/brain/tasks/${TASK_ID}/metrics" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const required = ['task_id','duration_ms','total_cost_usd','num_turns','input_tokens','output_tokens','source'];
    const missing = required.filter(k => !(k in d));
    if (missing.length > 0) { console.error('FAIL: 缺少字段:', missing); process.exit(1); }
    if (d.total_cost_usd === undefined || d.total_cost_usd === null) {
      console.error('FAIL: total_cost_usd 为 null'); process.exit(1);
    }
    console.log('PASS: metrics 端点返回正确，source=' + d.source + ' cost=' + d.total_cost_usd);
  "

# 边界情况：不存在的 task → 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000000/metrics")
[ "$STATUS" = "404" ] && echo "PASS: 不存在任务返回 404" || (echo "FAIL: 期望 404，实际 $STATUS"; exit 1)

# 验证 source 字段标明数据来源
curl -sf "localhost:5221/api/brain/tasks/${TASK_ID}/metrics" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const validSources = ['task_run_metrics', 'tasks.result', 'not_found'];
    if (!validSources.includes(d.source)) {
      console.error('FAIL: source 无效值:', d.source); process.exit(1);
    }
    console.log('PASS: source 字段有效:', d.source);
  "
```

---

## 技术实现方向（高层）

**Feature A（routes/execution.js）**：
1. 将 `execMetaJson` 构建中 `input_tokens`/`output_tokens` 的读取从 `result[k]` 改为 `result.usage?.input_tokens`
2. 将 cost 写入 SQL 从主事务中的条件更新（`WHERE status='in_progress'`）拆出，作为独立的无条件 UPDATE（`WHERE id = $1`），在主事务提交后执行
3. task_run_metrics 的 token 解析同步修复（已在同一代码路径）

**Feature B**：
- 新增 `GET /tasks/:id/metrics` 路由
- 先 JOIN 查 `task_run_metrics`，再 fallback 读 `tasks.result` 中的 5 个字段
- 无论来源，统一响应格式

---

## 不在本次范围内

- 成本汇总 API（跨任务聚合）
- Dashboard 可视化
- 历史数据回填（仅修复新写入路径）
- task_execution_metrics 表的现有逻辑
