#!/usr/bin/env bash
# coding-workflow-route-smoke — 编码单改投 coding_workflow runner（车道 A2，任务 eb9094ee）真库真代码火：
# 真 tasks / work_routing_receipts / 地图投影表上经真 createRoutedTask 建单：
#   ① 无头 coding_mutation（cecelia）→ coding_workflow，payload.coding_workflow=true、无 kernel-v1 标记，
#      runner plan.mjs pickCandidates 选中，tick 排除名单含该类型
#   ② 有头账本行（headed_manual 字符串 "true"）→ 仍是 harness_initiative，runner 不认领
#   ③ runner 不支持的仓库无头建单 → runner_repo_unsupported，不落行
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
import { randomUUID } from 'node:crypto';
import { createRoutedTask } from './src/work-routing-store.js';
import { TICK_DISPATCH_EXCLUDED } from './src/lib/task-type-registry.js';
import { pickCandidates } from './scripts/coding-workflow/runner/lib/plan.mjs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
const hex = () => randomUUID().replaceAll('-', '');
const FACTS = [
  { scope_key: 'cecelia', repo: 'cecelia', path: null, aliases: ['perfectuser21/cecelia'] },
  { scope_key: 'unsupported-sample', repo: 'zenithjoy-miniapp', path: null, aliases: [] },
];
const req = (over = {}) => ({
  source: 'api', source_id: `coding-route-smoke-${hex()}`, title: `coding-route-smoke-${hex().slice(0, 8)}`, description: 'smoke',
  mutation_intent: 'write', declared_change_kind: 'bugfix', repo_hint: 'cecelia', map_scope_hint: ['F1'],
  branch: `cp-coding-route-smoke-${hex().slice(0, 8)}`, base_sha: 'a'.repeat(40), metadata: {}, task: { priority: 'P2' },
  ...over,
});
const create = (over) => createRoutedTask(client, req(over), FACTS, { transaction: 'existing' });

// 事务内补一张 active 的 cecelia 地图投影（含 F1 能力节点）；已有就复用，结束整体回滚
async function seedActiveF1() {
  let runId = (await client.query("SELECT id FROM map_projection_runs WHERE scope_key='cecelia' AND status='active'")).rows[0]?.id;
  if (!runId) {
    let manifest = (await client.query("SELECT id,digest FROM map_manifest_versions WHERE scope_key='cecelia' AND status='active'")).rows[0];
    if (!manifest) {
      const decisionId = randomUUID();
      const manifestId = randomUUID();
      const digest = hex() + hex();
      const version = (await client.query("SELECT COALESCE(MAX(version),0)+1 AS v FROM map_manifest_versions WHERE scope_key='cecelia'")).rows[0].v;
      await client.query("INSERT INTO decisions(id,category,topic,decision) VALUES($1,'testing','coding route smoke','active F1')", [decisionId]);
      await client.query(
        `INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at)
         VALUES($1,'cecelia',$2,$3,$4::jsonb,$5,'active',NOW())`,
        [manifestId, version, decisionId, JSON.stringify({ scope_key: 'cecelia', schema_version: 1, source_decision_id: decisionId }), digest],
      );
      manifest = { id: manifestId, digest };
    }
    runId = randomUUID();
    await client.query(
      `INSERT INTO map_projection_runs(id,scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at)
       VALUES($1,'cecelia',$2,$3,'{}','smoke-v1',$4,'active',NOW())`,
      [runId, manifest.id, manifest.digest, hex() + hex()],
    );
  }
  await client.query(
    `INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name)
     SELECT $1,$2,'capability','F1','Factory F1'
      WHERE NOT EXISTS (SELECT 1 FROM map_projection_nodes WHERE run_id=$1 AND node_key='F1')`,
    [runId, hex() + hex()],
  );
}

await client.connect();
try {
  await client.query('BEGIN');
  await seedActiveF1();

  const headless = await create();
  const hrow = (await client.query('SELECT id, task_type, status, claimed_by, created_at, payload FROM tasks WHERE id = $1', [headless.task_id])).rows[0];
  if (hrow.task_type !== 'coding_workflow') die(`无头编码单没改投 coding_workflow: ${hrow.task_type}`);
  if (hrow.payload.coding_workflow !== true || hrow.payload.harness_runtime) die(`payload 形状不对: ${JSON.stringify(hrow.payload)}`);
  if (pickCandidates([hrow]).length !== 1) die('runner pickCandidates 不认改投后的单');
  if (!TICK_DISPATCH_EXCLUDED.includes('coding_workflow')) die('coding_workflow 不在 tick 排除名单');
  ok('① 无头 coding_mutation → coding_workflow（runner 认领、tick 不派）');

  const headed = await create({ metadata: { headed_manual: 'true' } });
  const drow = (await client.query('SELECT id, task_type, status, claimed_by, created_at, payload FROM tasks WHERE id = $1', [headed.task_id])).rows[0];
  if (drow.task_type !== 'harness_initiative' || drow.payload.headed_manual !== 'true') die(`有头账本行被改投: ${drow.task_type}`);
  if (pickCandidates([drow]).length !== 0) die('runner 认领了有头账本行');
  ok('② 有头账本行（headed_manual="true"）仍是 harness_initiative，runner 不认领');

  await client.query('SAVEPOINT unsupported');
  let err = null;
  const title = `coding-route-smoke-unsupported-${hex().slice(0, 8)}`;
  try { await create({ repo_hint: 'zenithjoy-miniapp', title }); } catch (e) { err = e; }
  await client.query('ROLLBACK TO SAVEPOINT unsupported');
  if (err?.code !== 'runner_repo_unsupported') die(`非 runner 仓库应拒，实际: ${err?.code || 'created'} ${err?.message || ''}`);
  const leaked = await client.query('SELECT count(*)::int AS n FROM tasks WHERE title = $1', [title]);
  if (leaked.rows[0].n !== 0) die('被拒的单落了行');
  ok('③ runner 不支持的仓库无头建单 → runner_repo_unsupported，不落行');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
NODE
)
