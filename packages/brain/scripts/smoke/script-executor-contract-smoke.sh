#!/usr/bin/env bash
# Smoke: script-executor-contract — executor=script 一等任务类型的契约与安全闸（任务 5cdbd52a，链 bf5088a3 棒3，决策 105a5868）
# 验证：
#   1. 注册表：script_run 声明为 kind=agent / executor=script / surface=script，进 DB 白名单
#   2. 迁移 471/472：两条约束 NOT VALID 登记 + 472 VALIDATE；名单与 lib 真身对齐
#   3. payload 契约：合法通过；us-vps / 回环 / 未注册 host、换行 cmd、非白名单 env 键、缺失/超限 timeout 全部被拒
#   4. 建单入口：work-routing-store 与 routes/task-tasks 接了 script_payload_invalid
#   5. 活性合同 script + 重试策略 script_exec 已登记
#   6. （可选）SCRIPT_SMOKE_DB_URL 指向已跑完迁移的库：约束 validated、script_run/script 可写
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[script-executor-contract-smoke] 1. 注册表声明"
node --input-type=module -e "
import * as R from './src/lib/task-type-registry.js';
const e = R.getTaskType('script_run');
if (!e || e.kind !== 'agent' || e.executor !== 'script' || e.surface !== 'script' || !e.db) { console.error('FAIL script_run 声明不对', e); process.exit(1); }
if (!R.DB_WHITELISTED_TASK_TYPES.includes('script_run')) { console.error('FAIL script_run 不在 DB 白名单'); process.exit(1); }
console.log('script_run: kind=' + e.kind + ' executor=' + e.executor + ' surface=' + e.surface + ' ✓');
"

echo "[script-executor-contract-smoke] 2. 迁移 471/472 结构 + 名单对齐"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import * as R from './src/lib/task-type-registry.js';
import { VALID_EXECUTOR_KINDS } from './src/executor-contracts.js';
const up = readFileSync('migrations/471_script_executor_kind_and_task_type.sql', 'utf8').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
if ((up.match(/NOT VALID/g) || []).length !== 2 || /VALIDATE CONSTRAINT/.test(up)) { console.error('FAIL 471 必须两条都 NOT VALID 且不含 VALIDATE'); process.exit(1); }
const list = (name) => { const m = up.match(new RegExp(name + '\\\\s+CHECK\\\\s*\\\\(([\\\\s\\\\S]*?)\\\\)\\\\s*NOT VALID')); return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : []; };
const ek = list('tasks_executor_kind_check'), tt = list('tasks_task_type_check');
if (JSON.stringify(ek) !== JSON.stringify([...VALID_EXECUTOR_KINDS].sort())) { console.error('FAIL executor_kind 名单 != VALID_EXECUTOR_KINDS'); process.exit(1); }
if (JSON.stringify(tt) !== JSON.stringify([...R.DB_WHITELISTED_TASK_TYPES].sort())) { console.error('FAIL task_type 名单 != 注册表 DB 白名单'); process.exit(1); }
const v = readFileSync('migrations/472_validate_script_executor_constraints.sql', 'utf8');
for (const c of ['tasks_executor_kind_check', 'tasks_task_type_check']) if (!v.includes('VALIDATE CONSTRAINT ' + c)) { console.error('FAIL 472 缺 VALIDATE ' + c); process.exit(1); }
console.log('471/472 结构正确，名单与 lib 真身一致 ✓');
"

echo "[script-executor-contract-smoke] 3. payload 契约：合法通过 / 违规被拒"
node --input-type=module -e "
import { validateScriptPayload, isScriptPayloadError } from './src/lib/script-task-spec.js';
const ok = { host: 'xian-m4', cmd: 'echo hi', timeout_sec: 30 };
validateScriptPayload(ok);
const bad = [
  [{ ...ok, host: 'us-vps' }, 'us-vps'],
  [{ ...ok, host: 'localhost' }, 'localhost'],
  [{ ...ok, host: 'no-such-box' }, '未注册 host'],
  [{ ...ok, cmd: 'echo a\nid' }, '换行 cmd'],
  [{ ...ok, env: { PATH: '/tmp' } }, '非白名单 env 键'],
  [{ ...ok, timeout_sec: undefined }, '缺 timeout'],
  [{ ...ok, timeout_sec: 99999 }, '超限 timeout'],
];
for (const [p, d] of bad) {
  let err; try { validateScriptPayload(p); } catch (e) { err = e; }
  if (!isScriptPayloadError(err)) { console.error('FAIL 未拒绝: ' + d); process.exit(1); }
}
console.log('合法通过，' + bad.length + ' 类违规输入全部被拒 ✓');
"

echo "[script-executor-contract-smoke] 4-5. 建单入口 / 活性合同 / 重试策略接线"
node -e "
const fs = require('fs');
const checks = [
  ['src/work-routing-store.js', ['assertScriptPayloadForType(decision.canonical_task_type, payload)']],
  ['src/routes/task-tasks.js', [\"err.code === 'script_payload_invalid'\", \"code: 'INVALID_SCRIPT_PAYLOAD'\"]],
  ['src/executor-contracts.js', ['[SCRIPT_EXECUTOR_KIND]: {']],
  ['src/lib/retry-policy.js', ['script_exec:']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('建单拒绝 / 400 映射 / 活性合同 / 重试策略 全部接线 ✓');
"

if [ -n "${SCRIPT_SMOKE_DB_URL:-}" ]; then
  echo "[script-executor-contract-smoke] 6. 真库：约束 validated"
  N=$(psql "$SCRIPT_SMOKE_DB_URL" -Atc "SELECT count(*) FROM pg_constraint WHERE conname IN ('tasks_executor_kind_check','tasks_task_type_check') AND convalidated")
  [ "$N" = "2" ] || { echo "FAIL 两条约束未全部 validated（$N/2）"; exit 1; }
  echo "真库约束 validated ✓"
else
  echo "[script-executor-contract-smoke] 6. 跳过真库检查（未设 SCRIPT_SMOKE_DB_URL）"
fi

echo "[script-executor-contract-smoke] ALL PASS"
