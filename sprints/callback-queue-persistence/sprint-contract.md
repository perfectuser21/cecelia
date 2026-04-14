# Sprint Contract Draft (Round 2)

> Round 1 Review 反馈修复：7 个必须修改项全部采纳。
> 核心变更：(1) 表结构验证增加数据类型检查 (2) 幂等性验证绕过旧 decision_log 去重 (3) 重启验证加入真实 kill+restart (4) 静态字符串匹配排除注释行 (5) HTTP 端点验证包含响应体 (6) 测试前置创建 task (7) 新增批量顺序处理验证

---

## Feature 1: Callback Queue 持久化表

**行为描述**:
系统提供一张 `callback_queue` 数据库表，Bridge 和 HTTP 端点均可向其中写入 callback 记录。每条记录包含任务标识（UUID）、执行状态、结果数据（JSONB）、整数型时间/尝试次数字段、时间戳。未处理的记录通过部分索引高效查询。

**硬阈值**:
- `callback_queue` 表存在且包含以下必需列，**类型正确**：
  - `id` (uuid 主键)、`task_id` (uuid)、`checkpoint_id` (text)、`run_id` (text)
  - `status` (text)、`result_json` (jsonb)、`stderr_tail` (text)
  - `duration_ms` (integer)、`attempt` (integer)、`exit_code` (integer)
  - `failure_class` (text)、`created_at` (timestamptz, 默认 now())、`processed_at` (timestamptz, 默认 NULL)
- 存在部分索引 `idx_callback_queue_unprocessed`，条件为 `processed_at IS NULL`
- INSERT 一条记录后可查询到

**验证命令**:
```bash
# Happy path: 表结构 + 数据类型验证（修复 R1#3：增加类型检查）
psql cecelia -c "
  SELECT column_name, data_type, udt_name FROM information_schema.columns
  WHERE table_name = 'callback_queue' ORDER BY ordinal_position;
" | node -e "
  const stdin = require('fs').readFileSync('/dev/stdin','utf8');
  const checks = {
    'task_id': 'uuid',
    'result_json': 'jsonb',
    'duration_ms': 'int',
    'attempt': 'int',
    'exit_code': 'int',
    'created_at': 'timestamp',
    'processed_at': 'timestamp',
  };
  const lines = stdin.split('\n');
  const errors = [];
  for (const [col, expectedType] of Object.entries(checks)) {
    const line = lines.find(l => l.includes(col));
    if (!line) { errors.push('缺少列: ' + col); continue; }
    if (!line.toLowerCase().includes(expectedType)) {
      errors.push(col + ' 类型错误: 期望含 ' + expectedType + ', 实际行: ' + line.trim());
    }
  }
  const requiredCols = ['id','task_id','checkpoint_id','run_id','status','result_json','stderr_tail','duration_ms','attempt','exit_code','failure_class','created_at','processed_at'];
  const missingCols = requiredCols.filter(c => !stdin.includes(c));
  if (missingCols.length > 0) errors.push('缺少列: ' + missingCols.join(', '));
  if (errors.length > 0) { console.error('FAIL:\n' + errors.join('\n')); process.exit(1); }
  console.log('PASS: callback_queue 表包含所有 ' + requiredCols.length + ' 个必需列且类型正确');
"

# 部分索引验证
psql cecelia -c "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_callback_queue_unprocessed';" | \
  node -e "
    const s = require('fs').readFileSync('/dev/stdin','utf8');
    if (!s.includes('processed_at IS NULL')) { console.error('FAIL: 部分索引缺少 processed_at IS NULL 条件'); process.exit(1); }
    console.log('PASS: 部分索引 idx_callback_queue_unprocessed 存在且条件正确');
  "
```

---

## Feature 2: Bridge DB 直写 + HTTP Fallback

**行为描述**:
Bridge 脚本（cecelia-run.sh）的 `send_webhook` 函数优先通过 `psql INSERT` 将 callback 数据直接写入 `callback_queue` 表。当 DB 连接不可达（psql 命令执行失败或超时 5 秒）时，自动降级到现有的 HTTP POST 方式发送 callback，确保数据不丢失。

**硬阈值**:
- `send_webhook` 函数在 psql 可用时执行 INSERT 而非 curl
- psql 连接超时设置为 5 秒（`connect_timeout=5` 或 `PGCONNECT_TIMEOUT`）
- psql 失败时自动降级执行 HTTP POST（原有 curl 逻辑保留为 fallback）
- INSERT 的字段集与现有 HTTP payload 字段一一对应

**验证命令**:
```bash
# Happy path: DB 直写逻辑存在且非注释（修复 R1#5：排除注释行）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/scripts/cecelia-run.sh', 'utf8');
  const fn = content.substring(content.indexOf('send_webhook()'));
  const fnEnd = fn.indexOf('\n}');
  const fnBody = fn.substring(0, fnEnd > 0 ? fnEnd : fn.length);
  const lines = fnBody.split('\n');
  const insertLine = lines.find(l => l.includes('INSERT INTO callback_queue') && !l.trim().startsWith('#'));
  if (!insertLine) { console.error('FAIL: send_webhook 函数体中没有非注释的 INSERT INTO callback_queue'); process.exit(1); }
  const timeoutLine = lines.find(l => (l.includes('connect_timeout') || l.includes('PGCONNECT_TIMEOUT')) && !l.trim().startsWith('#'));
  if (!timeoutLine) { console.error('FAIL: 缺少非注释的超时设置'); process.exit(1); }
  console.log('PASS: send_webhook 含 DB 直写（非注释）+ 超时设置');
"

# Fallback 顺序验证：INSERT 在 curl 之前（非注释行）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/scripts/cecelia-run.sh', 'utf8');
  const fn = content.substring(content.indexOf('send_webhook()'));
  const lines = fn.split('\n');
  let insertLineNum = -1, curlLineNum = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('#')) continue;
    if (insertLineNum < 0 && l.includes('INSERT INTO callback_queue')) insertLineNum = i;
    if (curlLineNum < 0 && insertLineNum >= 0 && l.includes('curl') && l.includes('WEBHOOK_URL')) curlLineNum = i;
  }
  if (insertLineNum < 0) { console.error('FAIL: 缺少 INSERT'); process.exit(1); }
  if (curlLineNum < 0) { console.error('FAIL: 缺少 curl fallback'); process.exit(1); }
  if (insertLineNum > curlLineNum) { console.error('FAIL: INSERT(行' + insertLineNum + ') 应在 curl(行' + curlLineNum + ') 之前'); process.exit(1); }
  console.log('PASS: send_webhook 先 DB 直写，失败后降级到 curl');
"
```

---

## Feature 3: Callback Worker 后台轮询处理

**行为描述**:
Brain 启动时自动启动一个 callback worker，每 2 秒轮询 `callback_queue` 表中 `processed_at IS NULL` 的记录（每次最多 10 条，按 `created_at` 升序），调用共享的 callback 处理逻辑处理每条记录。处理成功后将 `processed_at` 标记为当前时间。处理失败的记录保留 `processed_at` 为 NULL，等待下次轮询重试。

**硬阈值**:
- Worker 轮询间隔为 2000ms（±500ms 容忍）
- 每次查询 LIMIT 10，ORDER BY created_at ASC
- 处理成功后 `processed_at` 被设置为非 NULL 时间戳
- 处理失败的记录 `processed_at` 保持 NULL
- Worker 导出 `startCallbackWorker` 函数供 Brain 入口调用

**验证命令**:
```bash
# Worker 模块结构验证（修复 R1#类似#5：排除注释行中的关键字）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/src/callback-worker.js', 'utf8');
  const activeLines = content.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const active = activeLines.join('\n');
  if (!active.includes('startCallbackWorker')) { console.error('FAIL: 缺少 startCallbackWorker 导出'); process.exit(1); }
  if (!active.includes('processed_at IS NULL')) { console.error('FAIL: 缺少未处理记录查询条件'); process.exit(1); }
  if (!active.includes('LIMIT')) { console.error('FAIL: 缺少 LIMIT 限制'); process.exit(1); }
  if (!active.includes('ORDER BY') || !active.includes('created_at')) { console.error('FAIL: 缺少 ORDER BY created_at'); process.exit(1); }
  console.log('PASS: callback-worker.js 结构正确');
"

# Worker 在 Brain 入口中被调用
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/src/server.js', 'utf8');
  const activeLines = content.split('\n').filter(l => !l.trim().startsWith('//'));
  const active = activeLines.join('\n');
  if (!active.includes('callback-worker') || !active.includes('startCallbackWorker')) {
    console.error('FAIL: server.js 未导入并启动 callback worker');
    process.exit(1);
  }
  console.log('PASS: Brain 入口启动了 callback worker');
"

# 实际 DB 行为验证（修复 R1#6：先创建 task 确保 worker 有处理目标）
psql cecelia -c "
  INSERT INTO tasks (id, title, status, task_type)
  VALUES ('00000000-0000-0000-0000-000000000001', 'contract-test-task', 'in_progress', 'dev')
  ON CONFLICT (id) DO UPDATE SET status = 'in_progress', result = NULL;
" && \
curl -sf -X POST "localhost:5221/api/brain/execution-callback" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000001","run_id":"contract-test-run","status":"AI Done","result":{"result":"contract-verified"},"duration_ms":100,"attempt":1}' && \
sleep 4 && \
psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='contract-test-run' AND processed_at IS NOT NULL;" | \
  node -e "
    const n = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
    if (n >= 1) console.log('PASS: worker 处理了测试 callback');
    else { console.error('FAIL: callback 未被处理'); process.exit(1); }
  " && \
psql cecelia -t -c "SELECT status FROM tasks WHERE id = '00000000-0000-0000-0000-000000000001';" | \
  node -e "
    const s = require('fs').readFileSync('/dev/stdin','utf8').trim();
    if (s === 'completed') console.log('PASS: task 状态已更新为 completed');
    else { console.error('FAIL: task 状态未更新，当前=' + s); process.exit(1); }
  "

# 批量顺序处理验证（修复 R1#7：新增 PRD 场景 5 覆盖）
psql cecelia -c "
  INSERT INTO tasks (id, title, status, task_type) VALUES
    ('00000000-0000-0000-0000-batch0000001', 'batch-test-1', 'in_progress', 'dev'),
    ('00000000-0000-0000-0000-batch0000002', 'batch-test-2', 'in_progress', 'dev'),
    ('00000000-0000-0000-0000-batch0000003', 'batch-test-3', 'in_progress', 'dev')
  ON CONFLICT (id) DO UPDATE SET status = 'in_progress', result = NULL;
" && \
psql cecelia -c "
  INSERT INTO callback_queue (task_id, run_id, status, result_json, duration_ms, attempt, created_at) VALUES
    ('00000000-0000-0000-0000-batch0000001', 'batch-run-1', 'AI Done', '{\"result\":\"b1\"}'::jsonb, 10, 1, NOW() - INTERVAL '3 seconds'),
    ('00000000-0000-0000-0000-batch0000002', 'batch-run-2', 'AI Done', '{\"result\":\"b2\"}'::jsonb, 10, 1, NOW() - INTERVAL '2 seconds'),
    ('00000000-0000-0000-0000-batch0000003', 'batch-run-3', 'AI Done', '{\"result\":\"b3\"}'::jsonb, 10, 1, NOW() - INTERVAL '1 second');
" && \
sleep 6 && \
psql cecelia -t -c "
  SELECT count(*) FROM callback_queue
  WHERE run_id IN ('batch-run-1','batch-run-2','batch-run-3') AND processed_at IS NOT NULL;
" | node -e "
  const n = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
  if (n === 3) console.log('PASS: 3 条 callback 全部被处理');
  else { console.error('FAIL: 期望 3 条处理完成，实际 ' + n); process.exit(1); }
"
```

---

## Feature 4: Execution-Callback 处理逻辑共享 + 幂等性

**行为描述**:
原 `/api/brain/execution-callback` 路由中的核心处理逻辑（状态映射、task 更新、下游触发）被提取为独立的共享函数，Worker 和 HTTP 端点均调用同一函数。该函数保证幂等性：task result 只在当前为空时写入（条件更新 `WHERE result IS NULL`），下游任务通过 `trigger_source` 去重，不会因重复处理产生副作用。

**硬阈值**:
- 处理逻辑存在于独立的共享模块（非路由文件内联）
- Worker 和 HTTP 端点调用同一个处理函数（函数签名一致）
- task result 写入使用条件更新（仅 result 为空时写入），重复调用不覆盖已有 result
- 同一 callback 被 worker 处理两次时，第二次为 no-op（task 状态不变）

**验证命令**:
```bash
# 共享函数被 worker 和路由同时引用（排除注释行）
node -e "
  const fs = require('fs');
  const filterComments = c => c.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const workerContent = filterComments(fs.readFileSync('packages/brain/src/callback-worker.js', 'utf8'));
  const routeContent = filterComments(fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8'));
  // 两者应引用同一个处理函数名
  const fnNames = ['processExecutionCallback', 'handleExecutionCallback', 'processCallback'];
  const workerFn = fnNames.find(n => workerContent.includes(n));
  const routeFn = fnNames.find(n => routeContent.includes(n));
  if (workerFn && routeFn) {
    console.log('PASS: Worker 和路由共享处理函数 (' + workerFn + '/' + routeFn + ')');
  } else {
    console.error('FAIL: Worker(' + (workerFn||'无') + ') 和路由(' + (routeFn||'无') + ') 未共享处理逻辑');
    process.exit(1);
  }
"

# 幂等性验证（修复 R1#1：绕过旧 decision_log 去重，直接通过 callback_queue 验证）
psql cecelia -c "
  INSERT INTO tasks (id, title, status, task_type)
  VALUES ('00000000-0000-0000-0000-idempotent01', 'idempotent-contract-test', 'in_progress', 'dev')
  ON CONFLICT (id) DO UPDATE SET status = 'in_progress', result = NULL;
" && \
psql cecelia -c "
  INSERT INTO callback_queue (task_id, run_id, status, result_json, duration_ms, attempt)
  VALUES ('00000000-0000-0000-0000-idempotent01', 'idemp-run-1', 'AI Done', '{\"result\":\"first\"}'::jsonb, 100, 1);
  INSERT INTO callback_queue (task_id, run_id, status, result_json, duration_ms, attempt)
  VALUES ('00000000-0000-0000-0000-idempotent01', 'idemp-run-1', 'AI Done', '{\"result\":\"second\"}'::jsonb, 100, 1);
" && \
sleep 5 && \
psql cecelia -t -c "
  SELECT count(*) FROM callback_queue
  WHERE task_id = '00000000-0000-0000-0000-idempotent01' AND processed_at IS NOT NULL;
" | node -e "
  const n = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
  if (n !== 2) { console.error('FAIL: 两条记录应都标记 processed_at（worker 处理而非跳过队列记录），实际=' + n); process.exit(1); }
  console.log('PASS: 两条记录均被 worker 处理');
" && \
psql cecelia -t -c "
  SELECT result->>'result' FROM tasks WHERE id = '00000000-0000-0000-0000-idempotent01';
" | node -e "
  const v = require('fs').readFileSync('/dev/stdin','utf8').trim();
  if (v === 'second') { console.error('FAIL: result 被第二次处理覆盖（期望 first，实际 ' + v + '）'); process.exit(1); }
  console.log('PASS: task result 未被重复覆盖，值=' + v);
"
```

---

## Feature 5: HTTP Callback 端点兼容改造

**行为描述**:
现有 `POST /api/brain/execution-callback` HTTP 端点继续接受旧版 Bridge 的请求。改造后端点不再直接处理 callback 逻辑，而是将请求数据写入 `callback_queue` 表后立即返回 HTTP 200，由 Worker 异步处理。旧版 Bridge 无需修改即可继续工作。

**硬阈值**:
- HTTP 端点返回 HTTP 200 且响应体包含 `success: true`
- 端点内部执行 INSERT INTO callback_queue 而非直接处理
- 端点响应时间 < 500ms（不包含处理逻辑，只做 INSERT）
- 请求格式与现有 Bridge 完全兼容（相同的字段名和结构）

**验证命令**:
```bash
# 端点返回 200 + success:true + 响应速度验证（修复 R1#4：同时验证响应体）
node -e "
  const http = require('http');
  const d = JSON.stringify({task_id:'00000000-0000-0000-0000-compat0001',run_id:'compat-body-test',status:'AI Done',duration_ms:10,attempt:1});
  const t = Date.now();
  const r = http.request({hostname:'localhost',port:5221,path:'/api/brain/execution-callback',method:'POST',headers:{'Content-Type':'application/json','Content-Length':d.length}}, res => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      const elapsed = Date.now() - t;
      const j = JSON.parse(body);
      if (res.statusCode !== 200) { console.error('FAIL: status=' + res.statusCode); process.exit(1); }
      if (j.success !== true) { console.error('FAIL: success 不为 true, body=' + body); process.exit(1); }
      if (elapsed > 500) { console.error('FAIL: 响应过慢 ' + elapsed + 'ms（应 <500ms）'); process.exit(1); }
      console.log('PASS: HTTP 200 + success:true + ' + elapsed + 'ms');
    });
  });
  r.write(d); r.end();
"

# 端点写入 callback_queue 验证
psql cecelia -c "
  INSERT INTO tasks (id, title, status, task_type)
  VALUES ('00000000-0000-0000-0000-compat0001', 'compat-test-task', 'in_progress', 'dev')
  ON CONFLICT (id) DO UPDATE SET status = 'in_progress';
" && \
curl -sf -X POST "localhost:5221/api/brain/execution-callback" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"00000000-0000-0000-0000-compat0001","run_id":"compat-queue-test","status":"AI Done","result":null,"duration_ms":10,"attempt":1}' > /dev/null && \
sleep 1 && \
psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='compat-queue-test';" | \
  node -e "
    const n = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
    if (n >= 1) console.log('PASS: HTTP 端点将 callback 写入了 callback_queue');
    else { console.error('FAIL: callback_queue 中未找到 compat-queue-test 记录'); process.exit(1); }
  "
```

---

## Feature 6: Brain 重启后 Callback 零丢失

**行为描述**:
Brain 进程被终止（kill -9）并重启后，所有在重启前已写入 `callback_queue` 但未处理的 callback 记录，能在重启后 30 秒内被 Worker 自动拾取并处理完毕，对应的 task 状态正确更新。

**硬阈值**:
- 重启后 30 秒内所有 `processed_at IS NULL` 的记录被处理
- 处理后 task 状态符合 callback 中的 status 映射（AI Done → completed）
- 无需人工干预，Worker 随 Brain 自动启动

**验证命令**:
```bash
# 端到端重启验证（修复 R1#2：加入真实 kill + restart 步骤）
# 1. 创建测试 task + 插入未处理 callback
psql cecelia -c "
  INSERT INTO tasks (id, title, status, task_type)
  VALUES ('00000000-0000-0000-0000-restart00001', 'restart-contract-test', 'in_progress', 'dev')
  ON CONFLICT (id) DO UPDATE SET status = 'in_progress', result = NULL;
" && \
psql cecelia -c "
  INSERT INTO callback_queue (task_id, checkpoint_id, run_id, status, result_json, duration_ms, attempt)
  VALUES ('00000000-0000-0000-0000-restart00001', 'restart-cp', 'restart-verify-run', 'AI Done', '{\"result\":\"survived-restart\"}'::jsonb, 200, 1);
" && \
# 2. Kill Brain 进程
BRAIN_PID=$(pgrep -f 'packages/brain' | head -1) && \
kill -9 "$BRAIN_PID" && sleep 2 && \
# 3. 重启 Brain（launchctl 或直接启动）
launchctl kickstart -k gui/$(id -u)/com.cecelia.brain 2>/dev/null || \
  (cd packages/brain && node src/server.js &) && \
# 4. 等待 worker 处理
sleep 15 && \
psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='restart-verify-run' AND processed_at IS NOT NULL;" | \
  node -e "
    const n = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
    if (n >= 1) console.log('PASS: 重启后 worker 处理了存留 callback');
    else { console.error('FAIL: 重启后 callback 未被处理'); process.exit(1); }
  " && \
psql cecelia -t -c "SELECT status FROM tasks WHERE id = '00000000-0000-0000-0000-restart00001';" | \
  node -e "
    const s = require('fs').readFileSync('/dev/stdin','utf8').trim();
    if (s === 'completed') console.log('PASS: 重启后 task 状态更新为 completed');
    else { console.error('FAIL: task 状态未更新，当前=' + s); process.exit(1); }
  "

# 验证未处理记录存在（重启前快照 — 可作为前置断言单独执行）
psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='restart-verify-run' AND processed_at IS NULL;" | \
  node -e "
    const n = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
    if (n >= 1) console.log('PASS: 未处理记录确认存在');
    else { console.error('FAIL: 未处理记录不存在（可能被其他 worker 提前消费）'); process.exit(1); }
  "
```

---

## Workstreams

workstream_count: 3

### Workstream 1: DB Migration + Callback Queue 表

**范围**: 创建 `callback_queue` 表的 migration 文件，包含表结构（正确数据类型）、部分索引。不涉及任何应用代码。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] migration 文件 `database/migrations/009-callback-queue.sql` 存在且格式正确
  Test: node -e "const c=require('fs').readFileSync('database/migrations/009-callback-queue.sql','utf8');if(!c.includes('CREATE TABLE callback_queue'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] migration 执行后 callback_queue 表可用，列类型正确（task_id=uuid, result_json=jsonb, duration_ms=integer, created_at=timestamptz）
  Test: manual:psql cecelia -c "SELECT column_name, udt_name FROM information_schema.columns WHERE table_name='callback_queue' ORDER BY ordinal_position" | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8');const checks={task_id:'uuid',result_json:'jsonb',duration_ms:'int4',created_at:'timestamptz'};const errs=Object.entries(checks).filter(([c,t])=>{const l=s.split('\n').find(x=>x.includes(c));return!l||!l.includes(t)}).map(([c,t])=>c+' missing or wrong type');if(errs.length){console.error('FAIL:'+errs.join(','));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 部分索引 idx_callback_queue_unprocessed 存在且条件为 processed_at IS NULL
  Test: manual:psql cecelia -c "SELECT indexdef FROM pg_indexes WHERE indexname='idx_callback_queue_unprocessed'" -t | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8');if(!s.includes('processed_at IS NULL')){console.error('FAIL');process.exit(1)}console.log('PASS')"

### Workstream 2: Callback Worker + 共享处理逻辑 + HTTP 端点改造

**范围**: 从 `routes/execution.js` 提取 callback 处理逻辑为共享函数。新建 `callback-worker.js` worker 模块（轮询 + 调用共享函数 + 标记 processed_at）。改造 HTTP 端点为写入 queue + 立即返回。修改 Brain 入口启动 worker。幂等性保证（result 条件写入 WHERE result IS NULL）。
**大小**: L（>300行，跨 3+ 文件核心逻辑改造）
**依赖**: Workstream 1 完成后（需要 callback_queue 表存在）

**DoD**:
- [ ] [ARTIFACT] 共享处理函数模块 callback-worker.js 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/callback-worker.js');console.log('OK')"
- [ ] [BEHAVIOR] Worker 每 2 秒轮询 callback_queue，处理未处理记录并标记 processed_at，task 状态正确更新
  Test: manual:psql cecelia -c "INSERT INTO tasks(id,title,status,task_type) VALUES('00000000-0000-0000-0000-ws2test0001','ws2-test','in_progress','dev') ON CONFLICT(id) DO UPDATE SET status='in_progress',result=NULL" && curl -sf -X POST localhost:5221/api/brain/execution-callback -H 'Content-Type:application/json' -d '{"task_id":"00000000-0000-0000-0000-ws2test0001","run_id":"ws2-test-run","status":"AI Done","result":{"r":"ok"},"duration_ms":1,"attempt":1}' && sleep 4 && psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='ws2-test-run' AND processed_at IS NOT NULL" | node -e "if(parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim())<1){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] HTTP 端点写入 callback_queue 后立即返回 200+success:true，响应 <500ms
  Test: manual:node -e "const t=Date.now();const h=require('http');const d=JSON.stringify({task_id:'00000000-0000-0000-0000-ws2test0002',run_id:'latency-test',status:'AI Done',duration_ms:1,attempt:1});const r=h.request({hostname:'localhost',port:5221,path:'/api/brain/execution-callback',method:'POST',headers:{'Content-Type':'application/json','Content-Length':d.length}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{const e=Date.now()-t;const j=JSON.parse(b);if(res.statusCode===200&&j.success===true&&e<500){console.log('PASS:'+e+'ms')}else{console.error('FAIL:status='+res.statusCode+' success='+j.success+' elapsed='+e);process.exit(1)}})});r.write(d);r.end()"
- [ ] [BEHAVIOR] 幂等性：同一 task 的两条 callback 均被 worker 处理，但 task result 不被第二次覆盖
  Test: manual:psql cecelia -c "INSERT INTO tasks(id,title,status,task_type) VALUES('00000000-0000-0000-0000-ws2idemp01','idemp-test','in_progress','dev') ON CONFLICT(id) DO UPDATE SET status='in_progress',result=NULL" && psql cecelia -c "INSERT INTO callback_queue(task_id,run_id,status,result_json,duration_ms,attempt) VALUES('00000000-0000-0000-0000-ws2idemp01','idemp-r1','AI Done','{\"result\":\"first\"}'::jsonb,1,1);INSERT INTO callback_queue(task_id,run_id,status,result_json,duration_ms,attempt) VALUES('00000000-0000-0000-0000-ws2idemp01','idemp-r1','AI Done','{\"result\":\"second\"}'::jsonb,1,1)" && sleep 5 && psql cecelia -t -c "SELECT result->>'result' FROM tasks WHERE id='00000000-0000-0000-0000-ws2idemp01'" | node -e "const v=require('fs').readFileSync('/dev/stdin','utf8').trim();if(v==='second'){console.error('FAIL:result被覆盖');process.exit(1)}console.log('PASS:result='+v)"
- [ ] [BEHAVIOR] Worker 和路由共享同一处理函数
  Test: node -e "const fs=require('fs');const f=s=>s.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');const w=f(fs.readFileSync('packages/brain/src/callback-worker.js','utf8'));const r=f(fs.readFileSync('packages/brain/src/routes/execution.js','utf8'));const fns=['processExecutionCallback','handleExecutionCallback','processCallback'];if(!fns.some(n=>w.includes(n)&&r.includes(n))){console.error('FAIL');process.exit(1)}console.log('PASS')"

### Workstream 3: Bridge cecelia-run.sh DB 直写改造

**范围**: 修改 `packages/brain/scripts/cecelia-run.sh` 的 `send_webhook` 函数，优先 psql INSERT 写入 callback_queue，失败时降级到原有 HTTP POST。不涉及其他文件。
**大小**: M（100-300行，bash 脚本改动 + 超时/降级逻辑）
**依赖**: Workstream 1 完成后（需要 callback_queue 表存在）

**DoD**:
- [ ] [BEHAVIOR] send_webhook 通过非注释代码执行 psql INSERT INTO callback_queue
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));const lines=fn.split('\n');const ok=lines.some(l=>l.includes('INSERT INTO callback_queue')&&!l.trim().startsWith('#'));if(!ok){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] psql 连接设置超时（connect_timeout 或 PGCONNECT_TIMEOUT），失败后降级到 HTTP POST curl
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));const lines=fn.split('\n').filter(l=>!l.trim().startsWith('#'));const hasTimeout=lines.some(l=>l.includes('connect_timeout')||l.includes('PGCONNECT_TIMEOUT'));const hasCurl=lines.some(l=>l.includes('curl'));if(!hasTimeout){console.error('FAIL:no timeout');process.exit(1)}if(!hasCurl){console.error('FAIL:no curl fallback');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] 原有 curl 发送逻辑完整保留作为 fallback 路径
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));if(!fn.includes('curl')&&!fn.includes('WEBHOOK_URL')){console.error('FAIL');process.exit(1)}console.log('PASS')"
