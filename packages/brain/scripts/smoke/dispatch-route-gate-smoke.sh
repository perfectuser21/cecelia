#!/usr/bin/env bash
# dispatch-route-gate-smoke — 派发只认路由表（派发总闸 F，任务 0a70684f）真库真代码火：
# 真 tasks / work_routing_receipts 表上经真 createRoutedTask 建单：
#   ① trigger_backup 以 queued 建 → 抛 no_executor_for_task_type，不落行
#   ② workflow_run 以 in_progress 入账（外部镜像）照常
#   ③ 旧借壳形状 research+factory_dispatch → 落 skill_factory_run（迁移 550 约束放行）
#   ④ 旧借壳形状 data+coding_workflow → 落 coding_workflow，kind=workflow
#   ⑤ 两个新类型都在 tick 排除名单、派发器 / runner 认得新类型
# 全程一个事务内跑，结束回滚；不碰真机、不连生产库。
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  exit 0
fi

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

(cd "$BRAIN_DIR" && "$NODE" --input-type=module - <<'NODE'
import pg from 'pg';
import { createRoutedTask } from './src/work-routing-store.js';
import { TICK_DISPATCH_EXCLUDED } from './src/lib/task-type-registry.js';
import { isFactoryTask } from './scripts/factory-dispatcher/factory-dispatcher.js';
import { isSwitched } from './scripts/coding-workflow/runner/lib/plan.mjs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
const sid = () => `dispatch-gate-smoke-${Math.random().toString(36).slice(2)}`;
const req = (over) => ({
  source: 'scheduler', source_id: sid(), title: `dispatch-gate-smoke ${over.requested_task_type}`, description: 'smoke',
  mutation_intent: 'none', declared_domain: 'operations', metadata: {}, task: { priority: 'P2' }, ...over,
});
const create = (over) => createRoutedTask(client, req(over), null, { transaction: 'existing' });
await client.connect();
try {
  await client.query('BEGIN');

  await client.query('SAVEPOINT gate');
  let err = null;
  try { await create({ requested_task_type: 'trigger_backup' }); } catch (e) { err = e; }
  await client.query('ROLLBACK TO SAVEPOINT gate');
  if (err?.code !== 'no_executor_for_task_type') die(`trigger_backup queued 应被拒，实际: ${err?.code || 'created'} ${err?.message || ''}`);
  const leaked = await client.query(`SELECT count(*)::int AS n FROM tasks WHERE title = 'dispatch-gate-smoke trigger_backup'`);
  if (leaked.rows[0].n !== 0) die('被拒的单落了行');
  ok('① trigger_backup 以 queued 建 → no_executor_for_task_type，不落行');

  const mirror = await create({ requested_task_type: 'workflow_run', task: { priority: 'P2', status: 'in_progress' } });
  if (mirror.task.task_type !== 'workflow_run') die(`workflow_run 镜像入账不对: ${mirror.task.task_type}`);
  ok('② workflow_run 以 in_progress 入账照常');

  const factory = await create({
    requested_task_type: 'research', declared_domain: 'research',
    metadata: { factory_dispatch: true, factory: { stage: '3', agent: 'skill-factory', skill: 's', workflow_key: 'w', device: { node: 'n', profile: 'p', serial: 'S' } } },
  });
  const frow = (await client.query('SELECT task_type, kind, status, payload FROM tasks WHERE id = $1', [factory.task_id])).rows[0];
  if (frow.task_type !== 'skill_factory_run' || frow.status !== 'queued') die(`工厂单没落新类型: ${JSON.stringify(frow)}`);
  if (!isFactoryTask({ ...frow, status: 'queued' })) die('factory-dispatcher 不认新类型');
  ok('③ research+factory_dispatch → skill_factory_run（迁移 550 约束放行，派发器认得）');

  const coding = await create({ requested_task_type: 'data', mutation_intent: 'read_only', declared_domain: undefined, metadata: { coding_workflow: true, repo: 'cecelia' } });
  const crow = (await client.query('SELECT task_type, kind, payload FROM tasks WHERE id = $1', [coding.task_id])).rows[0];
  if (crow.task_type !== 'coding_workflow' || crow.kind !== 'workflow') die(`编码单没落新类型: ${JSON.stringify(crow)}`);
  if (!isSwitched(crow)) die('coding-workflow-runner 不认新类型');
  ok('④ data+coding_workflow → coding_workflow（kind=workflow，runner 认得）');

  for (const t of ['skill_factory_run', 'coding_workflow']) if (!TICK_DISPATCH_EXCLUDED.includes(t)) die(`${t} 不在 tick 排除名单`);
  ok('⑤ 两个新类型都按类型排除出 tick 主派发');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
NODE
)
