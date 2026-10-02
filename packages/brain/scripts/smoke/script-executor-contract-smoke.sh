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
const extension = readFileSync('migrations/502_preview_owned_cache_janitor.sql', 'utf8');
for (const [constraint,column,value] of [['tasks_executor_kind_check','executor_kind','preview-janitor'],['tasks_task_type_check','task_type','janitor']]) {
  const tuple = '(' + [constraint,column,value].map(x => String.fromCharCode(39) + x + String.fromCharCode(39)).join(',') + ')';
  if (!extension.includes(tuple)) { console.error('FAIL 502 缺精确合同增量'); process.exit(1); }
}
const appServer = readFileSync('migrations/504_app_server_generations.sql', 'utf8');
for (const [constraint,column,value] of [['tasks_executor_kind_check','executor_kind','app-server-controller'],['tasks_task_type_check','task_type','app_server_run']]) {
  const tuple = '(' + [constraint,column,value].map(x => String.fromCharCode(39) + x + String.fromCharCode(39)).join(',') + ')';
  if (!appServer.includes(tuple)) { console.error('FAIL 504 缺精确合同增量'); process.exit(1); }
}
const phone = readFileSync('migrations/508_phone_dispatches.sql', 'utf8');
const phoneTuple = '(' + ['tasks_executor_kind_check','executor_kind','phone-ssh-controller'].map(x => String.fromCharCode(39) + x + String.fromCharCode(39)).join(',') + ')';
if (!phone.includes(phoneTuple)) { console.error('FAIL 508 缺精确手机合同增量'); process.exit(1); }
const imageJanitor = readFileSync('migrations/510_us_brain_image_retention.sql', 'utf8');
if (!imageJanitor.includes('CHECK ((%s) OR executor_kind=%L)') || !imageJanitor.includes(String.fromCharCode(39) + 'image-janitor' + String.fromCharCode(39))) { console.error('FAIL 510 缺镜像清理执行器精确增量'); process.exit(1); }
const linuxController = readFileSync('migrations/512_linux_pool_controller.sql','utf8');
if (!linuxController.includes('CHECK ((%s) OR executor_kind=%L)') || !linuxController.includes(String.fromCharCode(39) + 'linux-pool-controller' + String.fromCharCode(39))) throw Error('FAIL 512 Linux controller');
ek.push('linux-pool-controller','preview-janitor','app-server-controller','image-janitor','phone-ssh-controller'); ek.sort(); tt.push('janitor','app_server_run'); tt.sort();
