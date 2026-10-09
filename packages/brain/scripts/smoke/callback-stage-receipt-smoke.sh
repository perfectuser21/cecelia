#!/usr/bin/env bash
# Smoke: callback-stage-receipt — execution-callback 回执保 stage/metrics + internal token 鉴权（链 bf5088a3 棒1，任务 15346e6c）
# 验证（假 pool 跑真逻辑 + 真 HTTP 打真中间件 + readFileSync 查接线，不连库不发 ssh）：
#   1. recordRunFromCallback 终态回执：result.{stage,stage_status,metrics,evidence,probes} 合进 task_runs.result，
#      evidence/probes 只留引用形态（大 blob 不落），artifacts + pr_url 原样保留；非终态只 startRun
#   2. 真 express + internalAuthOrLoopback：CECELIA_INTERNAL_TOKEN 配置后 curl 缺头 401 / 错 token 401 / Bearer 200
#   3. 接线：execution.js 路由挂中间件；cecelia-run.sh / flush-callback-queue.sh / executor.js / cecelia-bridge.js 带 Bearer 或透传 token
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[callback-stage-receipt-smoke] 1. 回执 → task_runs.result 保 stage/metrics（假 pool）"
node --input-type=module -e "
import { recordRunFromCallback } from './src/lib/task-run.js';
const calls = [];
const pool = { query: async (sql, params) => { calls.push({ sql: String(sql), params }); return { rows: [{ id: 'row-1' }] }; } };
await recordRunFromCallback({
  taskId: 't1', runId: 'r1', status: 'completed', exitCode: 0,
  result: { stage: 'publish', stage_status: 'ok', metrics: { posts: 3 }, artifacts: ['a:1'],
            evidence: [{ path: '/tmp/a.png', blob: 'x'.repeat(4000) }, '/var/log/x.json', 42], summary: 'noise' },
  prUrl: 'https://github.com/o/r/pull/9',
}, { pool });
// finishRun 的 UPDATE 以 ended_at = NOW() 识别（单一写口守卫扫描 scripts/ 里的字面写语句，此处不写表名）
const upd = calls.find((c) => /ended_at = NOW\(\)/i.test(c.sql));
if (!upd) { console.error('FAIL 终态回执未 finishRun'); process.exit(1); }
const r = JSON.parse(upd.params[2]);
const want = { stage: 'publish', stage_status: 'ok', metrics: { posts: 3 }, exit_code: 0, artifacts: ['a:1', 'https://github.com/o/r/pull/9'], evidence: [{ path: '/tmp/a.png' }, '/var/log/x.json'] };
for (const k of Object.keys(want)) {
  if (JSON.stringify(r[k]) !== JSON.stringify(want[k])) { console.error('FAIL result.' + k + ' =', JSON.stringify(r[k]), 'want', JSON.stringify(want[k])); process.exit(1); }
}
if ('summary' in r || JSON.stringify(r).includes('xxxx')) { console.error('FAIL 非账本键/大 blob 泄入 result'); process.exit(1); }
const running = [];
await recordRunFromCallback({ taskId: 't1', runId: 'r2', status: 'in_progress', result: { stage: 'x' } },
  { pool: { query: async (sql) => { running.push(String(sql)); return { rows: [{ id: 1 }] }; } } });
if (running.some((s) => /ended_at = NOW\(\)/i.test(s))) { console.error('FAIL 非终态回执不应 finishRun'); process.exit(1); }
console.log('stage/metrics/evidence 入账 ✓ 非终态只 startRun ✓');
"

echo "[callback-stage-receipt-smoke] 2. 真 HTTP 打 internalAuthOrLoopback：缺头 401 / 错 token 401 / Bearer 200"
PORT=$((20000 + RANDOM % 20000))
TOKEN="smoke-token-$$"
CECELIA_INTERNAL_TOKEN="$TOKEN" node --input-type=module -e "
import express from 'express';
import { internalAuthOrLoopback } from './src/middleware/internal-auth.js';
const app = express();
app.use(express.json());
app.post('/api/brain/execution-callback', internalAuthOrLoopback, (req, res) => res.json({ success: true, echo: req.body.task_id }));
const srv = app.listen($PORT, '127.0.0.1');
setTimeout(() => { srv.close(); process.exit(0); }, 8000).unref();
" &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break; sleep 0.1; done
BODY='{"task_id":"t-smoke","run_id":"r","status":"completed"}'
c1="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/brain/execution-callback" -H 'Content-Type: application/json' -d "$BODY")"
c2="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/brain/execution-callback" -H 'Content-Type: application/json' -H 'Authorization: Bearer wrong' -d "$BODY")"
c3="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/brain/execution-callback" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d "$BODY")"
[ "$c1" = "401" ] || { echo "FAIL 缺头应 401，得 $c1"; exit 1; }
[ "$c2" = "401" ] || { echo "FAIL 错 token 应 401，得 $c2"; exit 1; }
[ "$c3" = "200" ] || { echo "FAIL Bearer 应 200，得 $c3"; exit 1; }
kill "$SRV_PID" 2>/dev/null || true
echo "缺头 401 ✓ 错 token 401 ✓ Bearer 200 ✓"

echo "[callback-stage-receipt-smoke] 3. 接线"
node -e "
const fs = require('fs');
const ex = fs.readFileSync('src/routes/execution.js', 'utf8');
if (!/router\.post\('\/execution-callback',\s*executionCallbackRateLimit,\s*internalAuthOrLoopback,/.test(ex)) { console.error('FAIL execution.js 路由未挂 限流+internalAuthOrLoopback'); process.exit(1); }
for (const f of ['scripts/cecelia-run.sh', 'scripts/flush-callback-queue.sh']) {
  if (!/Authorization: Bearer \\\$\{?CECELIA_INTERNAL_TOKEN\}?/.test(fs.readFileSync(f, 'utf8'))) { console.error('FAIL ' + f + ' 回执 curl 缺 Bearer 头'); process.exit(1); }
}
const exe = fs.readFileSync('src/executor.js', 'utf8');
const i = exe.indexOf('const dockerEnv = {');
if (i < 0 || !exe.slice(i, i + 1200).includes('CECELIA_INTERNAL_TOKEN')) { console.error('FAIL executor.js dockerEnv 未透传 CECELIA_INTERNAL_TOKEN'); process.exit(1); }
if ((exe.match(/execution-callback\`, \{\s*method: 'POST',\s*headers: internalServiceHeaders\(/g) || []).length !== 2) { console.error('FAIL executor.js codex review fetch 未用 internalServiceHeaders'); process.exit(1); }
if (!fs.readFileSync('scripts/cecelia-bridge.js', 'utf8').includes('CECELIA_INTERNAL_TOKEN')) { console.error('FAIL cecelia-bridge.js 未透传 token'); process.exit(1); }
console.log('路由中间件 ✓ run.sh/flush Bearer ✓ executor docker env + fetch ✓ bridge 透传 ✓');
"

echo "[callback-stage-receipt-smoke] PASS"
