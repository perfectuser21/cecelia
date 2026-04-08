# 合同草案（第 2 轮）

**Proposer**: sprint-contract-proposer  
**时间**: 2026-04-08  
**Sprint**: Sprint 3 — 执行成本追踪（token/cost 写入 DB）  
**修改说明**: 根据 R1 Review 反馈修改，解决 3 个必须修改项

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
# Happy path: 创建测试任务，发送 execution-callback，验证 tasks.result 包含 5 个指标字段
# 同时将 taskId 存入 /tmp/sprint3-test-taskid，供 Feature B 集成测试复用（不清理）
node -e "
const http = require('http');
const { execSync } = require('child_process');
const taskId = require('crypto').randomUUID();
require('fs').writeFileSync('/tmp/sprint3-test-taskid', taskId);

execSync(\`psql cecelia -c \"INSERT INTO tasks (id, title, status, task_type) VALUES ('\${taskId}', 'cost-test', 'in_progress', 'dev');\"\`);

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
  hostname: 'localhost', port: 5221,
  path: '/api/brain/execution-callback',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
}, res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    setTimeout(() => {
      const raw = execSync(\`psql cecelia -t -c \"SELECT result FROM tasks WHERE id = '\${taskId}';\"\`).toString().trim();
      let result;
      try { result = JSON.parse(raw); } catch(e) {
        console.error('FAIL: tasks.result 不是有效 JSON:', raw); process.exit(1);
      }
      const keys = ['duration_ms','total_cost_usd','num_turns','input_tokens','output_tokens'];
      const missing = keys.filter(k => !(k in result));
      if (missing.length > 0) { console.error('FAIL: tasks.result 缺少字段:', missing); process.exit(1); }
      if (result.input_tokens !== 1000) { console.error('FAIL: input_tokens 期望 1000，实际', result.input_tokens); process.exit(1); }
      if (result.output_tokens !== 500) { console.error('FAIL: output_tokens 期望 500，实际', result.output_tokens); process.exit(1); }
      console.log('PASS: tasks.result 包含全部 5 个指标，token 字段正确，taskId 已存入 /tmp/sprint3-test-taskid');
    }, 200);
  });
});
req.on('error', e => { console.error('FAIL:', e.message); process.exit(1); });
req.write(payload);
req.end();
"

# 边界情况：watchdog 已将任务移出 in_progress，cost 仍需写入
node -e "
const http = require('http');
const { execSync } = require('child_process');
const taskId = require('crypto').randomUUID();
execSync(\`psql cecelia -c \"INSERT INTO tasks (id, title, status, task_type) VALUES ('\${taskId}', 'watchdog-cost-test', 'failed', 'dev');\"\`);

const payload = JSON.stringify({
  task_id: taskId, run_id: 'wd-run-' + Date.now(), status: 'AI Done', duration_ms: 5000,
  result: {
    type: 'result', duration_ms: 5000, num_turns: 3, total_cost_usd: 0.05,
    usage: { input_tokens: 300, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  }
});
const req = http.request({
  hostname: 'localhost', port: 5221,
  path: '/api/brain/execution-callback',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    setTimeout(() => {
      const raw = execSync(\`psql cecelia -t -c \"SELECT result FROM tasks WHERE id = '\${taskId}';\"\`).toString().trim();
      try {
        const r = JSON.parse(raw);
        if (typeof r.duration_ms === 'number') {
          console.log('PASS: watchdog 路径下 cost 仍成功写入 tasks.result');
        } else {
          console.error('FAIL: watchdog 路径下 tasks.result 缺少 duration_ms'); process.exit(1);
        }
      } catch(e) { console.error('FAIL: tasks.result 不是有效 JSON:', raw); process.exit(1); }
      execSync(\`psql cecelia -c \"DELETE FROM tasks WHERE id = '\${taskId}';\"\`);
    }, 200);
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
# [A→B 集成验证] 复用 Feature A 写入的任务，验证 /metrics 端点能正确读取（全链路）
node -e "
const http = require('http');
const { execSync } = require('child_process');
const taskId = require('fs').readFileSync('/tmp/sprint3-test-taskid', 'utf8').trim();
if (!taskId) { console.error('FAIL: /tmp/sprint3-test-taskid 为空，请先运行 Feature A 测试'); process.exit(1); }

http.get('http://localhost:5221/api/brain/tasks/' + taskId + '/metrics', res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('FAIL: 期望 200，实际', res.statusCode, data); process.exit(1);
    }
    let r;
    try { r = JSON.parse(data); } catch(e) { console.error('FAIL: 响应不是 JSON:', data); process.exit(1); }
    const required = ['task_id','duration_ms','total_cost_usd','num_turns','input_tokens','output_tokens','source'];
    const missing = required.filter(k => !(k in r));
    if (missing.length > 0) { console.error('FAIL: 缺少字段:', missing); process.exit(1); }
    if (Math.abs(r.total_cost_usd - 0.123456) > 0.000001) {
      console.error('FAIL: total_cost_usd 期望 0.123456，实际', r.total_cost_usd); process.exit(1);
    }
    const validSources = ['task_run_metrics', 'tasks.result', 'not_found'];
    if (!validSources.includes(r.source)) {
      console.error('FAIL: source 无效值:', r.source); process.exit(1);
    }
    console.log('PASS: /metrics 返回正确，A→B 集成链路通，source=' + r.source + ' cost=' + r.total_cost_usd);
    execSync(\"psql cecelia -c \\\"DELETE FROM tasks WHERE id = '\" + taskId + \"';\\\"\");
  });
}).on('error', e => { console.error('FAIL:', e.message); process.exit(1); });
"

# [source="tasks.result" fallback 路径] 创建只有 tasks.result 的任务，无 task_run_metrics 记录
node -e "
const http = require('http');
const { execSync } = require('child_process');
const taskId = require('crypto').randomUUID();
// 直接写入带 result 指标的已完成任务（绕过 execution-callback，模拟 fallback 场景）
const resultJson = JSON.stringify({duration_ms:9999,total_cost_usd:0.077,num_turns:2,input_tokens:400,output_tokens:150});
execSync(\`psql cecelia -c \"INSERT INTO tasks (id, title, status, task_type, result) VALUES ('\${taskId}', 'fallback-test', 'completed', 'dev', '\${resultJson}'::jsonb);\"\`);

http.get('http://localhost:5221/api/brain/tasks/' + taskId + '/metrics', res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('FAIL: 期望 200，实际', res.statusCode, data); process.exit(1);
    }
    const r = JSON.parse(data);
    if (r.source !== 'tasks.result') {
      console.error('FAIL: 期望 source=tasks.result，实际', r.source); process.exit(1);
    }
    if (r.duration_ms !== 9999) {
      console.error('FAIL: duration_ms 期望 9999，实际', r.duration_ms); process.exit(1);
    }
    console.log('PASS: fallback 路径正确返回，source=tasks.result，数据值匹配');
    execSync(\"psql cecelia -c \\\"DELETE FROM tasks WHERE id = '\" + taskId + \"';\\\"\");
  });
}).on('error', e => { console.error('FAIL:', e.message); process.exit(1); });
"

# 边界情况：不存在的 task → 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000000/metrics")
[ "$STATUS" = "404" ] && echo "PASS: 不存在任务返回 404" || (echo "FAIL: 期望 404，实际 $STATUS"; exit 1)
```

---

## A→B 集成验证顺序

> **关键**：Feature A 的 happy path 测试负责写入数据并保存 taskId，Feature B 集成测试必须在 Feature A 之后运行，读取同一 taskId 验证链路。

```
Feature A happy path（写入 + 保存 taskId）
  ↓
Feature A watchdog path（独立任务，自行清理）
  ↓
Feature B A→B 集成验证（读取 Feature A 的 taskId）
  ↓  [自动清理 Feature A 测试任务]
Feature B fallback 路径（独立任务，自行清理）
  ↓
Feature B 404 边界（无状态）
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
- 无论来源，统一响应格式，`source` 字段标明数据来源

---

## 不在本次范围内

- 成本汇总 API（跨任务聚合）
- Dashboard 可视化
- 历史数据回填（仅修复新写入路径）
- task_execution_metrics 表的现有逻辑
