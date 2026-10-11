#!/usr/bin/env bash
# factory-ledger-smoke — 技能工厂台账（迁移 547，任务 1c589b13，决策 cc008b7e / 2bb08a99）真库真代码火：
# 两张表与只追加触发器齐全；新业务进厂默认阶段 1 并记进厂事件；rule 跳级被拒、相邻推进落事件；
# human 任意跳留痕；人工关口卡住时 rule 不能动；滑窗计数按 window_k 截尾；真容器里台账接口已挂载。
# 全程一个事务内跑，结束回滚（阶段事件只追加，不能靠 DELETE 清理）。
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  exit 0
fi

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

(cd "$BRAIN_DIR" && "$NODE" --input-type=module - <<'NODE'
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createLedger, transitionLedger, patchLedger, recordRun, getLedger } from './src/lib/factory-ledger.js';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
const rejects = async (p) => p.then(() => null, (e) => e);
await client.connect();
try {
  await client.query('BEGIN');
  for (const t of ['factory_ledger', 'factory_stage_events'])
    if (!(await client.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS ok`)).rows[0].ok) die(`${t} 不存在（迁移 547 未跑？）`);
  ok('迁移 547：台账与阶段事件两张表齐全');

  const tag = `fl-smoke-${randomUUID().slice(0, 8)}`;
  const vs = randomUUID(), cap = randomUUID(), wf = randomUUID();
  await client.query('INSERT INTO value_streams (id, name) VALUES ($1, $2)', [vs, `${tag}-vs`]);
  await client.query("INSERT INTO capabilities (id, name, status, parent_journey_id) VALUES ($1, $2, 'active', $3)", [cap, `${tag}-cap`, vs]);
  await client.query("INSERT INTO workflows (id, capability_id, key, name, channel) VALUES ($1, $2, $3, $3, 'douyin')", [wf, cap, tag]);

  const { ledger } = await createLedger(client, { workflow_id: wf });
  if (ledger.stage !== 1 || ledger.validation_mode !== 'use_while_validate') die(`进厂默认值不对: ${JSON.stringify(ledger)}`);
  ok('新业务进厂：默认阶段 1（试跑）、边用边验');

  const skip = await rejects(transitionLedger(client, ledger.id, { to_stage: 3, actor: 'rule', reason: 'smoke 跳级' }));
  if (skip?.status !== 400 || skip.code !== 'ILLEGAL_TRANSITION') die(`rule 跳级应 400: ${skip?.code}`);
  await transitionLedger(client, ledger.id, { to_stage: 2, actor: 'rule', reason: 'smoke 推进', evidence_run_ids: ['smoke-run-1'] });
  ok('rule 跳级 400；相邻推进 1→2 成功');

  await patchLedger(client, ledger.id, { blocked_kind: 'human_gate', blocked_reason: 'smoke 人工关口' });
  const blocked = await rejects(transitionLedger(client, ledger.id, { to_stage: 3, actor: 'rule', reason: 'smoke' }));
  if (blocked?.code !== 'BLOCKED_NEEDS_HUMAN') die(`人工关口下 rule 应被拒: ${blocked?.code}`);
  await transitionLedger(client, ledger.id, { to_stage: 5, actor: 'human', reason: 'smoke 人工跳级' });
  ok('人工关口下 rule 409；human 2→5 跳级成功');

  await patchLedger(client, ledger.id, { window_k: 2 });
  for (const [r, p] of [['a', true], ['b', false], ['c', true]]) await recordRun(client, ledger.id, { run_id: `${tag}-${r}`, pass: p });
  const got = await getLedger(client, ledger.id);
  if (got.ledger.recent_total !== 2 || got.ledger.recent_pass !== 1 || got.ledger.total_runs !== 3) die(`滑窗不对: ${JSON.stringify(got.ledger)}`);
  if (got.events.map((e) => `${e.from_stage ?? '-'}>${e.to_stage}:${e.actor}`).join(',') !== '->1:human,1>2:rule,2>5:human') die(`事件链不对: ${JSON.stringify(got.events)}`);
  ok('滑窗按 window_k=2 截尾（最近 1/2 通过，累计 3 次）；事件链 进厂→rule 推进→human 跳级');

  await client.query('SAVEPOINT a');
  const upd = await rejects(client.query('UPDATE factory_stage_events SET reason = $1 WHERE ledger_id = $2', ['x', ledger.id]));
  await client.query('ROLLBACK TO SAVEPOINT a');
  if (!/只追加/.test(upd?.message || '')) die('阶段事件 UPDATE 没被拒');
  ok('阶段事件只追加：UPDATE 被触发器拒绝');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
NODE
) || fail "真函数段失败"

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
if curl -q -sf -m 5 "$BRAIN_URL/api/brain/health" >/dev/null 2>&1; then
  RID="00000000-0000-4000-8000-000000000547"
  CODE="$(curl -q -s -o /dev/null -w '%{http_code}' -m 10 "$BRAIN_URL/api/brain/factory/ledger")"
  [[ "$CODE" == "200" ]] || fail "GET factory/ledger 期望 200，实际 $CODE"
  CODE="$(curl -q -s -o /dev/null -w '%{http_code}' -m 10 "$BRAIN_URL/api/brain/factory/ledger/$RID")"
  [[ "$CODE" == "404" ]] || fail "GET factory/ledger/:id 期望 404（不存在），实际 $CODE"
  CODE="$(curl -q -s -o /dev/null -w '%{http_code}' -m 10 "$BRAIN_URL/api/brain/factory/ledger?stage=9")"
  [[ "$CODE" == "400" ]] || fail "GET factory/ledger?stage=9 期望 400，实际 $CODE"
  pass "真容器：台账接口已挂载（列表 200 / 单行 404 / 越界 400）"
elif [[ "${CI:-}" == "true" ]]; then
  fail "CI 下 Brain 容器不可达: $BRAIN_URL"
fi

echo "factory-ledger-smoke: all passed"
