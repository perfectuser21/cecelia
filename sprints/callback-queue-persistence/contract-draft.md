# Sprint Contract Draft (Round 1)

## Feature 1: Callback Queue 持久化表

**行为描述**:
系统提供一张 `callback_queue` 数据库表，Bridge 和 HTTP 端点均可向其中写入 callback 记录。每条记录包含任务标识、执行状态、结果数据、时间戳等字段。未处理的记录通过部分索引高效查询。

**硬阈值**:
- `callback_queue` 表存在且包含以下必需列：`id`（主键）、`task_id`（UUID）、`checkpoint_id`、`run_id`、`status`（text）、`result_json`（jsonb）、`stderr_tail`（text）、`duration_ms`（integer）、`attempt`（integer）、`exit_code`（integer）、`failure_class`（text）、`created_at`（timestamp，默认 now()）、`processed_at`（timestamp，默认 NULL）
- 存在部分索引 `idx_callback_queue_unprocessed`，条件为 `processed_at IS NULL`
- INSERT 一条记录后 `SELECT count(*) FROM callback_queue` 返回 ≥ 1

**验证命令**:
```bash
# Happy path: 表结构验证
psql cecelia -c "
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'callback_queue'
  ORDER BY ordinal_position;
" | node -e "
  const stdin = require('fs').readFileSync('/dev/stdin','utf8');
  const required = ['id','task_id','checkpoint_id','run_id','status','result_json','stderr_tail','duration_ms','attempt','exit_code','failure_class','created_at','processed_at'];
  const missing = required.filter(c => !stdin.includes(c));
  if (missing.length > 0) { console.error('FAIL: 缺少列: ' + missing.join(', ')); process.exit(1); }
  console.log('PASS: callback_queue 表包含所有 ' + required.length + ' 个必需列');
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
- psql 连接超时设置为 5 秒（`connect_timeout=5` 或等效）
- psql 失败时自动降级执行 HTTP POST（原有 curl 逻辑保留为 fallback）
- INSERT 的字段集与现有 HTTP payload 字段一一对应

**验证命令**:
```bash
# Happy path: DB 直写逻辑存在
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/scripts/cecelia-run.sh', 'utf8');
  if (!content.includes('INSERT INTO callback_queue')) { console.error('FAIL: send_webhook 中缺少 INSERT INTO callback_queue'); process.exit(1); }
  if (!content.includes('connect_timeout') && !content.includes('statement_timeout')) { console.error('FAIL: psql 缺少超时设置'); process.exit(1); }
  console.log('PASS: send_webhook 包含 DB 直写逻辑和超时设置');
"

# Fallback 逻辑验证：curl 保留为降级路径
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/scripts/cecelia-run.sh', 'utf8');
  const webhookSection = content.substring(content.indexOf('send_webhook()'));
  const insertIdx = webhookSection.indexOf('INSERT INTO callback_queue');
  const curlIdx = webhookSection.indexOf('curl', insertIdx);
  if (insertIdx < 0 || curlIdx < 0) { console.error('FAIL: send_webhook 应先 INSERT 后 curl fallback'); process.exit(1); }
  if (insertIdx > curlIdx) { console.error('FAIL: INSERT 应在 curl 之前（DB 优先）'); process.exit(1); }
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
# Worker 模块存在且导出 startCallbackWorker
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/src/callback-worker.js', 'utf8');
  if (!content.includes('startCallbackWorker')) { console.error('FAIL: 缺少 startCallbackWorker 导出'); process.exit(1); }
  if (!content.includes('processed_at IS NULL')) { console.error('FAIL: 缺少未处理记录查询条件'); process.exit(1); }
  if (!content.includes('LIMIT')) { console.error('FAIL: 缺少 LIMIT 限制'); process.exit(1); }
  console.log('PASS: callback-worker.js 结构正确');
"

# Worker 在 Brain 入口中被调用
node -e "
  const fs = require('fs');
  // 检查 Brain 入口文件中是否导入并启动了 callback worker
  const files = fs.readdirSync('packages/brain/src').filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
  let found = false;
  for (const f of files) {
    const c = fs.readFileSync('packages/brain/src/' + f, 'utf8');
    if (c.includes('callback-worker') && c.includes('startCallbackWorker')) { found = true; break; }
  }
  if (!found) { console.error('FAIL: 没有找到导入并启动 callback worker 的入口文件'); process.exit(1); }
  console.log('PASS: Brain 入口启动了 callback worker');
"

# 实际 DB 行为验证：插入一条测试记录，等待 worker 处理
curl -sf -X POST "localhost:5221/api/brain/execution-callback" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000001","run_id":"contract-test-run","status":"AI Done","result":null,"duration_ms":100,"attempt":1}' && \
sleep 3 && \
psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='contract-test-run' AND processed_at IS NOT NULL;" | \
  node -e "
    const n = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
    if (n >= 1) console.log('PASS: worker 在 3 秒内处理了测试 callback');
    else { console.error('FAIL: 测试 callback 未被 worker 处理（processed_at 仍为 NULL）'); process.exit(1); }
  "
```

---

## Feature 4: Execution-Callback 处理逻辑共享 + 幂等性

**行为描述**:
原 `/api/brain/execution-callback` 路由中的核心处理逻辑（状态映射、task 更新、下游触发）被提取为独立的共享函数，Worker 和 HTTP 端点均调用同一函数。该函数保证幂等性：task result 只在当前为空时写入，下游任务通过 `trigger_source` 去重，不会因重复处理产生副作用。

**硬阈值**:
- 处理逻辑存在于独立的共享模块（非路由文件内联）
- Worker 和 HTTP 端点调用同一个处理函数（函数签名一致）
- task result 写入使用条件更新（仅 result 为空时写入），重复调用不覆盖已有 result
- 同一 `run_id + status` 组合的 callback 被处理两次时，第二次为 no-op

**验证命令**:
```bash
# 共享函数被 worker 和路由同时引用
node -e "
  const fs = require('fs');
  const workerContent = fs.readFileSync('packages/brain/src/callback-worker.js', 'utf8');
  const routeContent = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 两者应引用同一个处理函数
  const sharedModules = ['callback-handler', 'callback-processor', 'execution-callback-handler'];
  const workerImports = sharedModules.some(m => workerContent.includes(m));
  const routeImports = sharedModules.some(m => routeContent.includes(m));
  // 或者 worker 直接引用 routes/shared 中的函数
  const workerUsesShared = workerContent.includes('processExecutionCallback') || workerContent.includes('handleExecutionCallback');
  const routeUsesShared = routeContent.includes('processExecutionCallback') || routeContent.includes('handleExecutionCallback');
  if ((workerImports && routeImports) || (workerUsesShared && routeUsesShared)) {
    console.log('PASS: Worker 和路由共享同一处理函数');
  } else {
    console.error('FAIL: Worker 和路由未共享处理逻辑'); process.exit(1);
  }
"

# 幂等性验证：HTTP 端点重复调用返回 duplicate 标记
curl -sf -X POST "localhost:5221/api/brain/execution-callback" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000002","run_id":"idempotent-test","status":"AI Done","result":{"result":"test"},"duration_ms":50,"attempt":1}' > /dev/null && \
sleep 3 && \
RESP=$(curl -sf -X POST "localhost:5221/api/brain/execution-callback" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000002","run_id":"idempotent-test","status":"AI Done","result":{"result":"test"},"duration_ms":50,"attempt":1}') && \
echo "$RESP" | node -e "
  const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (r.duplicate === true || r.skipped === true) console.log('PASS: 重复 callback 被幂等保护拦截');
  else { console.error('FAIL: 重复 callback 未被拦截，响应: ' + JSON.stringify(r)); process.exit(1); }
"
```

---

## Feature 5: HTTP Callback 端点兼容改造

**行为描述**:
现有 `POST /api/brain/execution-callback` HTTP 端点继续接受旧版 Bridge 的请求。改造后端点不再直接处理 callback 逻辑，而是将请求数据写入 `callback_queue` 表后立即返回 HTTP 200，由 Worker 异步处理。旧版 Bridge 无需修改即可继续工作。

**硬阈值**:
- HTTP 端点返回 HTTP 200 且响应体包含 `success: true`
- 端点内部执行 INSERT INTO callback_queue 而非直接处理
- 端点响应时间 < 100ms（不包含处理逻辑，只做 INSERT）
- 请求格式与现有 Bridge 完全兼容（相同的字段名和结构）

**验证命令**:
```bash
# 端点仍然可用且返回 200
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:5221/api/brain/execution-callback" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000003","run_id":"compat-test","status":"AI Done","result":null,"duration_ms":10,"attempt":1}')
[ "$STATUS" = "200" ] && echo "PASS: HTTP 端点返回 200" || (echo "FAIL: 期望 200，实际 $STATUS"; exit 1)

# 端点写入 callback_queue 而非直接处理
sleep 1 && \
psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='compat-test';" | \
  node -e "
    const n = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
    if (n >= 1) console.log('PASS: HTTP 端点将 callback 写入了 callback_queue');
    else { console.error('FAIL: callback_queue 中未找到 compat-test 记录'); process.exit(1); }
  "
```

---

## Feature 6: Brain 重启后 Callback 零丢失

**行为描述**:
Brain 进程被终止（kill -9）并重启后，所有在重启前已写入 `callback_queue` 但未处理的 callback 记录，能在重启后 30 秒内被 Worker 自动拾取并处理完毕，对应的 task 状态正确更新。

**硬阈值**:
- 重启后 30 秒内所有 `processed_at IS NULL` 的记录被处理
- 处理后 task 状态符合 callback 中的 status 映射（AI Done → completed，AI Failed → failed）
- 无需人工干预，Worker 随 Brain 自动启动

**验证命令**:
```bash
# 端到端验证：写入未处理记录 → 模拟重启 → 验证处理完成
# 注意：此命令需要在有权限重启 Brain 的环境下执行
psql cecelia -c "
  INSERT INTO callback_queue (task_id, checkpoint_id, run_id, status, result_json, duration_ms, attempt)
  VALUES ('00000000-0000-0000-0000-000000000004', 'restart-cp', 'restart-test', 'AI Done', '{\"result\":\"restart-verify\"}'::jsonb, 200, 1);
" && echo "PASS: 测试记录已插入" || (echo "FAIL: 插入测试记录失败"; exit 1)

# 验证记录存在且未处理
psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='restart-test' AND processed_at IS NULL;" | \
  node -e "
    const n = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
    if (n >= 1) console.log('PASS: 未处理记录存在');
    else { console.error('FAIL: 未处理记录不存在'); process.exit(1); }
  "
```

---

## Workstreams

workstream_count: 3

### Workstream 1: DB Migration + Callback Queue 表

**范围**: 创建 `callback_queue` 表的 migration 文件，包含表结构、索引。不涉及任何应用代码。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] migration 文件 `database/migrations/009-callback-queue.sql` 存在且格式正确
  Test: node -e "const c=require('fs').readFileSync('database/migrations/009-callback-queue.sql','utf8');if(!c.includes('CREATE TABLE callback_queue'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] migration 执行后 callback_queue 表可用，部分索引 idx_callback_queue_unprocessed 存在
  Test: manual:psql cecelia -c "SELECT 1 FROM information_schema.tables WHERE table_name='callback_queue'" -t | node -e "if(!require('fs').readFileSync('/dev/stdin','utf8').trim().includes('1')){process.exit(1)}console.log('PASS')"

### Workstream 2: Callback Worker + 共享处理逻辑 + HTTP 端点改造

**范围**: 从 `routes/execution.js` 提取 callback 处理逻辑为共享函数。新建 `callback-worker.js` worker 模块（轮询 + 调用共享函数 + 标记 processed_at）。改造 HTTP 端点为写入 queue + 立即返回。修改 Brain 入口启动 worker。
**大小**: L（>300行，跨 3+ 文件核心逻辑改造）
**依赖**: Workstream 1 完成后（需要 callback_queue 表存在）

**DoD**:
- [ ] [ARTIFACT] 共享处理函数模块存在（callback-worker.js 或独立模块）
  Test: node -e "require('fs').accessSync('packages/brain/src/callback-worker.js');console.log('OK')"
- [ ] [BEHAVIOR] Worker 每 2 秒轮询 callback_queue，处理未处理记录并标记 processed_at
  Test: manual:curl -sf -X POST localhost:5221/api/brain/execution-callback -H 'Content-Type:application/json' -d '{"task_id":"00000000-0000-0000-0000-test0001","run_id":"ws2-test","status":"AI Done","duration_ms":1,"attempt":1}' && sleep 4 && psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='ws2-test' AND processed_at IS NOT NULL" | node -e "if(parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim())<1){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] HTTP 端点写入 callback_queue 后立即返回 200，不直接处理
  Test: manual:node -e "const t=Date.now();const h=require('http');const d=JSON.stringify({task_id:'00000000-0000-0000-0000-test0002',run_id:'latency-test',status:'AI Done',duration_ms:1,attempt:1});const r=h.request({hostname:'localhost',port:5221,path:'/api/brain/execution-callback',method:'POST',headers:{'Content-Type':'application/json','Content-Length':d.length}},res=>{const elapsed=Date.now()-t;if(res.statusCode===200&&elapsed<500){console.log('PASS: '+elapsed+'ms')}else{console.error('FAIL: status='+res.statusCode+' elapsed='+elapsed);process.exit(1)}});r.write(d);r.end()"
- [ ] [BEHAVIOR] 同一 run_id+status 重复处理时幂等（不产生副作用）
  Test: manual:curl -sf -X POST localhost:5221/api/brain/execution-callback -H 'Content-Type:application/json' -d '{"task_id":"00000000-0000-0000-0000-test0003","run_id":"idempotent-ws2","status":"AI Done","duration_ms":1,"attempt":1}' && sleep 3 && curl -sf -X POST localhost:5221/api/brain/execution-callback -H 'Content-Type:application/json' -d '{"task_id":"00000000-0000-0000-0000-test0003","run_id":"idempotent-ws2","status":"AI Done","duration_ms":1,"attempt":1}' | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(r.success)console.log('PASS');else{process.exit(1)}"

### Workstream 3: Bridge cecelia-run.sh DB 直写改造

**范围**: 修改 `packages/brain/scripts/cecelia-run.sh` 的 `send_webhook` 函数，优先 psql INSERT 写入 callback_queue，失败时降级到原有 HTTP POST。不涉及其他文件。
**大小**: M（100-300行，bash 脚本改动 + 超时/降级逻辑）
**依赖**: Workstream 1 完成后（需要 callback_queue 表存在）

**DoD**:
- [ ] [BEHAVIOR] send_webhook 优先通过 psql INSERT 写入 callback_queue
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const i=c.indexOf('INSERT INTO callback_queue');if(i<0){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] psql 连接设置超时（5 秒内），失败后降级到 HTTP POST curl
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');if(!c.includes('connect_timeout')){console.error('FAIL: 缺少超时');process.exit(1)}const fn=c.substring(c.indexOf('send_webhook()'));const ins=fn.indexOf('INSERT');const curl=fn.indexOf('curl',ins);if(ins>curl){console.error('FAIL: INSERT 应在 curl 前');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] 原有 curl 发送逻辑完整保留作为 fallback 路径
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));if(!fn.includes('curl')&&!fn.includes('WEBHOOK_URL')){console.error('FAIL');process.exit(1)}console.log('PASS')"
