#!/usr/bin/env bash
# Smoke: script-executor-dispatch — executor=script 派发/收割接线与远端 runner 真跑（任务 5cdbd52a，链 bf5088a3 棒3 PR B）
# 验证：
#   1. 接线：executor 的 script_run 分支 / dispatcher 专用出口 / scheduler script-reaper / 注册表 tick_dispatchable=true
#   2. 远端 runner 真跑：用本机 sh（HOME=临时目录，不发 ssh）执行 buildRunnerScript 的产物，
#      验证 exit 收割、stdout/stderr 分离、ALREADY 幂等、超时杀进程组标 124
#   3. 传输安全：runner 里没有 cmd / env 值明文（只有 base64）
#   4. （可选）SCRIPT_SMOKE_DB_URL：真库里 script_run/script 可写（471/472 已应用）
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[script-executor-dispatch-smoke] 1. 接线检查"
node -e "
const fs = require('fs');
const checks = [
  ['src/executor.js', [\"task.task_type === 'script_run'\", 'triggerScriptRun(task)']],
  ['src/dispatcher.js', ['dispatchScriptTask(candidate', 'isScriptSurface(nextTask.task_type)', \"reason === 'script_payload_invalid'\"]],
  ['src/scheduler-jobs.js', [\"name: 'script-reaper'\", 'reapScriptRuns(pool)']],
  ['src/openclaw-agent-executor.js', [\"from './lib/ssh-exec.js'\"]],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('executor 分支 / dispatcher 出口 / 收割 job / 共享 ssh 原语 全部接线 ✓');
"
node --input-type=module -e "
import { getTaskType, TICK_DISPATCH_EXCLUDED } from './src/lib/task-type-registry.js';
if (!getTaskType('script_run').tick_dispatchable || TICK_DISPATCH_EXCLUDED.includes('script_run')) { console.error('FAIL script_run 未放开 tick 派发'); process.exit(1); }
console.log('script_run tick_dispatchable=true ✓');
"

echo "[script-executor-dispatch-smoke] 2-3. 远端 runner 真跑（本机 sh，不发 ssh）"
node --input-type=module -e "
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildJobScript, buildRunnerScript, scriptRunIdFor } from './src/script-executor.js';
const home = mkdtempSync(join(tmpdir(), 'script-smoke-'));
const run = (rid, job, t = 20) => spawnSync('sh', ['-s'], { input: buildRunnerScript({ runId: rid, timeoutSec: t, jobScript: buildJobScript(job) }), env: { ...process.env, HOME: home }, encoding: 'utf8' });
const wait = async (rid, ms = 15000) => { const f = join(home, 'brain-runs', rid + '.exit'); const end = Date.now() + ms; while (Date.now() < end) { if (existsSync(f)) return Number(readFileSync(f, 'utf8').trim()); await new Promise((r) => setTimeout(r, 100)); } throw new Error('等 exit 超时 ' + rid); };
const rd = (rid, ext) => readFileSync(join(home, 'brain-runs', rid + '.' + ext), 'utf8');
try {
  const T = '00000000-0000-0000-0000-00000000000';
  const secret = 'SMOKE_SECRET_VALUE';
  const ok = scriptRunIdFor(T + '1', 1);
  const runnerText = buildRunnerScript({ runId: ok, timeoutSec: 20, jobScript: buildJobScript({ cmd: 'echo out-\$SCRIPT_K; echo err1 >&2', cwd: null, env: { SCRIPT_K: secret } }) });
  if (runnerText.includes(secret) || runnerText.includes('echo out-')) throw new Error('runner 里出现 cmd/env 明文');
  const r1 = run(ok, { cmd: 'echo out-\$SCRIPT_K; echo err1 >&2', cwd: null, env: { SCRIPT_K: secret } });
  if (r1.stdout.trim() !== 'DISPATCHED') throw new Error('未回 DISPATCHED: ' + r1.stdout);
  if (await wait(ok) !== 0 || rd(ok, 'out').trim() !== 'out-' + secret || rd(ok, 'err').trim() !== 'err1') throw new Error('成功路径收割不对');
  const again = run(ok, { cmd: 'echo x', cwd: null, env: {} });
  if (again.stdout.trim() !== 'ALREADY') throw new Error('幂等未命中: ' + again.stdout);
  const bad = scriptRunIdFor(T + '2', 1);
  run(bad, { cmd: 'exit 7', cwd: null, env: {} });
  if (await wait(bad) !== 7) throw new Error('失败 exit 未如实收割');
  const slow = scriptRunIdFor(T + '3', 1);
  run(slow, { cmd: 'sleep 30', cwd: null, env: {} }, 1);
  if (await wait(slow, 20000) !== 124 || !existsSync(join(home, 'brain-runs', slow + '.timedout'))) throw new Error('超时未杀进程标 124');
  console.log('runner 真跑：成功/失败 exit/ALREADY 幂等/超时 124 全部符合，runner 无明文 ✓');
} finally { rmSync(home, { recursive: true, force: true }); }
"

if [ -n "${SCRIPT_SMOKE_DB_URL:-}" ]; then
  echo "[script-executor-dispatch-smoke] 4. 真库：script_run/script 可写"
  ID=$(psql "$SCRIPT_SMOKE_DB_URL" -qAtc "INSERT INTO tasks (title, task_type, status, executor_kind, payload) VALUES ('script smoke '||gen_random_uuid(), 'script_run', 'cancelled', 'script', '{}'::jsonb) RETURNING id")
  [ -n "$ID" ] || { echo "FAIL 真库写 script_run 失败"; exit 1; }
  psql "$SCRIPT_SMOKE_DB_URL" -Atc "DELETE FROM tasks WHERE id = '$ID'" >/dev/null
  echo "真库 script_run/script 可写 ✓"
else
  echo "[script-executor-dispatch-smoke] 4. 跳过真库检查（未设 SCRIPT_SMOKE_DB_URL）"
fi

echo "[script-executor-dispatch-smoke] ALL PASS"
