# Contract Review Feedback (Round 1)

## 必须修改项

### 1. [命令太弱] Feature 4 — 幂等性测试被现有代码直接通过，不验证新系统

**原始命令**:
```bash
curl -sf -X POST "localhost:5221/api/brain/execution-callback" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000002","run_id":"idempotent-test","status":"AI Done","result":{"result":"test"},"duration_ms":50,"attempt":1}' > /dev/null && \
sleep 3 && \
RESP=$(curl -sf -X POST "localhost:5221/api/brain/execution-callback" ...) && \
echo "$RESP" | node -e "... if (r.duplicate === true || r.skipped === true) ..."
```

**假实现片段**（proof-of-falsification）:
```javascript
// 完全不改代码。现有 routes/execution.js 第 56-68 行已有 decision_log 去重逻辑：
// SELECT id FROM decision_log WHERE trigger='execution-callback' AND run_id=$1 AND status=$2
// 第二次调用直接返回 { success: true, duplicate: true }
// 不需要 callback_queue 也能 100% 通过此测试
const dupCheck = await pool.query(
  `SELECT id FROM decision_log WHERE trigger = 'execution-callback'
   AND llm_output_json->>'run_id' = $1 AND llm_output_json->>'status' = $2`,
  [run_id, status]
);
if (dupCheck.rows.length > 0) return res.json({ success: true, duplicate: true });
```

**建议修复命令**:
```bash
# 幂等性验证：通过 callback_queue 直接验证（绕过 decision_log 旧逻辑）
# 1. 直接插入两条相同 run_id 的 callback_queue 记录
# 2. 等待 worker 处理
# 3. 验证 task result 没被覆盖（只写入一次）
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
  if (n !== 2) { console.error('FAIL: 两条记录应都标记 processed_at（worker 应处理而非跳过队列记录），实际=' + n); process.exit(1); }
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

### 2. [缺失边界] Feature 6 — 重启零丢失验证命令没有实际重启 Brain

**原始命令**:
```bash
psql cecelia -c "INSERT INTO callback_queue (...) VALUES (...);" && \
psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='restart-test' AND processed_at IS NULL;" | node -e "..."
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：不启动 worker，只要表存在就能通过
// 命令只做了 INSERT + SELECT count，完全没有重启步骤
// 一个没有 callback-worker 的 Brain 也能通过（记录永远 processed_at IS NULL = count >= 1）
// 这个测试验证的是"记录存在"而非"重启后被处理"
```

**建议修复命令**:
```bash
# 端到端重启验证（PRD 场景 1 直接映射）
# 1. 确保 Brain 正在运行
# 2. 插入一条未处理记录
# 3. kill Brain
# 4. 重启 Brain
# 5. 等待 30 秒内 worker 处理该记录
psql cecelia -c "
  INSERT INTO tasks (id, title, status, task_type)
  VALUES ('00000000-0000-0000-0000-restart00001', 'restart-contract-test', 'in_progress', 'dev')
  ON CONFLICT (id) DO UPDATE SET status = 'in_progress';
" && \
psql cecelia -c "
  INSERT INTO callback_queue (task_id, checkpoint_id, run_id, status, result_json, duration_ms, attempt)
  VALUES ('00000000-0000-0000-0000-restart00001', 'restart-cp', 'restart-verify-run', 'AI Done', '{\"result\":\"survived-restart\"}'::jsonb, 200, 1);
" && \
BRAIN_PID=$(pgrep -f 'packages/brain/server.js' | head -1) && \
kill -9 "$BRAIN_PID" && sleep 2 && \
launchctl kickstart -k gui/$(id -u)/com.cecelia.brain 2>/dev/null || node packages/brain/server.js &
sleep 10 && \
psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='restart-verify-run' AND processed_at IS NOT NULL;" | \
  node -e "
    const n = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
    if (n >= 1) console.log('PASS: 重启后 worker 处理了存留 callback');
    else { console.error('FAIL: 重启后 callback 未被处理'); process.exit(1); }
  "
```

---

### 3. [命令太弱] Feature 1 — 表结构验证不检查数据类型

**原始命令**:
```bash
psql cecelia -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'callback_queue' ..." | \
  node -e "... const missing = required.filter(c => !stdin.includes(c)); ..."
```

**假实现片段**（proof-of-falsification）:
```sql
-- 所有列定义为 TEXT，测试仍通过（只检查列名存在于输出中）
CREATE TABLE callback_queue (
  id TEXT, task_id TEXT, result_json TEXT, -- 应为 UUID/JSONB
  duration_ms TEXT, attempt TEXT, exit_code TEXT, -- 应为 INTEGER
  created_at TEXT, processed_at TEXT -- 应为 TIMESTAMPTZ
);
```

**建议修复命令**:
```bash
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
  const lines = stdin.split('\\n');
  const errors = [];
  for (const [col, expectedType] of Object.entries(checks)) {
    const line = lines.find(l => l.includes(col));
    if (!line) { errors.push('缺少列: ' + col); continue; }
    if (!line.toLowerCase().includes(expectedType)) {
      errors.push(col + ' 类型错误: 期望含 ' + expectedType + ', 实际行: ' + line.trim());
    }
  }
  if (errors.length > 0) { console.error('FAIL:\\n' + errors.join('\\n')); process.exit(1); }
  console.log('PASS: callback_queue 列名和关键类型均正确');
"
```

---

### 4. [命令太弱] Feature 5 Command 1 — 只检查 HTTP 200 不验证响应体

**原始命令**:
```bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:5221/api/brain/execution-callback" ...)
[ "$STATUS" = "200" ] && echo "PASS" || (echo "FAIL"; exit 1)
```

**假实现片段**（proof-of-falsification）:
```javascript
// 完全不改代码。现有端点已经返回 200 + { success: true }
// 即使不写入 callback_queue（直接处理），此命令也通过
router.post('/execution-callback', async (req, res) => {
  // ... 直接处理逻辑 ...
  res.json({ success: true });
});
```

**建议修复命令**:
```bash
# 验证响应体包含 success:true + 端点写入 queue 而非直接处理
# 合并到 Feature 5 Command 2（已有 DB 验证），删除此弱命令
# 或改为同时验证响应体：
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
      if (j.success !== true) { console.error('FAIL: success 不为 true'); process.exit(1); }
      if (elapsed > 500) { console.error('FAIL: 响应过慢 ' + elapsed + 'ms（应 <500ms）'); process.exit(1); }
      console.log('PASS: HTTP 200 + success:true + ' + elapsed + 'ms');
    });
  });
  r.write(d); r.end();
"
```

---

### 5. [命令太弱] Feature 2 — 两条命令都是静态字符串匹配，注释即可通过

**原始命令**:
```bash
node -e "
  const content = fs.readFileSync('packages/brain/scripts/cecelia-run.sh', 'utf8');
  if (!content.includes('INSERT INTO callback_queue')) { ... }
  if (!content.includes('connect_timeout') && !content.includes('statement_timeout')) { ... }
"
```

**假实现片段**（proof-of-falsification）:
```bash
send_webhook() {
  # 改造计划：INSERT INTO callback_queue with connect_timeout=5
  # 以上待实现，当前仍用 curl
  curl -sS -X POST -H "Content-Type: application/json" -d "$payload" "$WEBHOOK_URL"
}
```

**建议修复命令**:
```bash
# 验证 INSERT 不在注释行中（以 # 开头的行）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/scripts/cecelia-run.sh', 'utf8');
  const fn = content.substring(content.indexOf('send_webhook()'));
  const fnEnd = fn.indexOf('\\n}');
  const fnBody = fn.substring(0, fnEnd > 0 ? fnEnd : fn.length);
  // 找到非注释行中的 INSERT
  const lines = fnBody.split('\\n');
  const insertLine = lines.find(l => l.includes('INSERT INTO callback_queue') && !l.trim().startsWith('#'));
  if (!insertLine) { console.error('FAIL: send_webhook 函数体中没有非注释的 INSERT INTO callback_queue'); process.exit(1); }
  const timeoutLine = lines.find(l => (l.includes('connect_timeout') || l.includes('PGCONNECT_TIMEOUT')) && !l.trim().startsWith('#'));
  if (!timeoutLine) { console.error('FAIL: 缺少非注释的超时设置'); process.exit(1); }
  console.log('PASS: send_webhook 含 DB 直写（非注释）+ 超时设置');
"
```

---

### 6. [前置条件] Feature 3 Command 3 — 测试 task_id 不在 tasks 表中

**原始命令**:
```bash
curl -sf -X POST "localhost:5221/api/brain/execution-callback" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000001",...}' && sleep 3 && \
psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='contract-test-run' AND processed_at IS NOT NULL;"
```

**假实现片段**（proof-of-falsification）:
```javascript
// task_id 00000000-0000-0000-0000-000000000001 大概率不在 tasks 表中
// worker 处理时 UPDATE tasks SET status=... WHERE id=$1 AND status='in_progress' 匹配 0 行
// 但 worker 可能仍标记 processed_at（处理了但没效果）
// 或者 worker 抛异常，processed_at 保持 NULL → 测试 FAIL（误报）
// 两种情况都不能真正验证"callback 被正确处理"
```

**建议修复命令**:
```bash
# 先创建测试 task，再发送 callback，确保处理逻辑有目标 task
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
```

---

### 7. [PRD 遗漏] 场景 5（Worker 批量顺序处理）没有专门验证命令

PRD 场景 5 要求"3 条记录按 created_at 顺序依次处理"。Feature 3 只验证了单条处理，没有验证批量 + 顺序。建议增加：
```bash
# 插入 3 条测试记录（不同 created_at），验证按序处理
psql cecelia -c "
  INSERT INTO tasks (id, title, status, task_type) VALUES
    ('00000000-0000-0000-0000-batch0000001', 'batch-test-1', 'in_progress', 'dev'),
    ('00000000-0000-0000-0000-batch0000002', 'batch-test-2', 'in_progress', 'dev'),
    ('00000000-0000-0000-0000-batch0000003', 'batch-test-3', 'in_progress', 'dev')
  ON CONFLICT (id) DO UPDATE SET status = 'in_progress';
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

## 可选改进

- Workstream 2 DoD 的幂等性测试（第 4 条）也受 Issue #1 影响 — 现有 `decision_log` 去重使测试自动通过。建议改为通过 `callback_queue` 直插两条相同记录来验证。
- Feature 3 Command 1 同样是静态字符串匹配，建议加 `!l.trim().startsWith('//')` 排除注释行（与 Issue #5 同类问题）。
- 考虑增加清理逻辑：每次测试结束后 DELETE 测试数据（WHERE task_id LIKE '00000000-%'），避免测试数据污染。
