#!/usr/bin/env bash
# activity-judgments-smoke — 裁判接线（迁移 538，决策 de6dff5d 五块模型第 2 步，任务 add0acfc）真库真代码火：
# span 入库 → 经 Step 找到归属 Activity → 收敛对账结果只追加落 activity_judgments（readback 格同时翻色）；
# 跑到一半的运行（还有 Step 没上报、在静默期内）推迟裁判不落库不翻红；改/删裁判行被拒；最新裁判可查；新旧版本对比在样本不足时给 insufficient_data、版本错配给 404；
# 真容器里三个 GET 接口已挂载。全程一个事务内跑，结束回滚（裁判表只追加、定义版本不可变，不能靠 DELETE 清理）。
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
import { flushJudgments, getLatestJudgment } from './src/lib/activity-judge.js';
import { compareActivityVersions } from './src/lib/activity-version-compare.js';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
await client.connect();
try {
  await client.query('BEGIN');
  const reg = (await client.query("SELECT to_regclass('public.activity_judgments') IS NOT NULL AS ok")).rows[0].ok;
  if (!reg) die('activity_judgments 表不存在（迁移 538 未跑？）');
  ok('迁移 538：activity_judgments 表存在');

  const tag = `judge-smoke-${randomUUID().slice(0, 8)}`;
  const act = (await client.query('INSERT INTO activities(name) VALUES($1) RETURNING id', [tag])).rows[0].id;
  const step = async (k, order, readback) => (await client.query(
    'INSERT INTO steps(activity_id, step_order, key, activity_key, readback) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id',
    [act, order, `${tag}.${k}`, tag, JSON.stringify(readback)])).rows[0].id;
  const s1 = await step('open', 1, { type: 'metric', expect: { op: '==', value: 1 } });
  const s2 = await step('save', 2, { type: 'metric', expect: { op: '>=', value: 1 } });
  const ids = [];
  let sec = 0;
  for (const run of ['r1', 'r2']) for (const [s, observed] of [[s1, 1], [s2, 3]]) {
    ids.push((await client.query(
      `INSERT INTO spans(run_id, step_id, started_at, ended_at, executor_kind, outcome, evidence)
       VALUES($1,$2,$3,$3,'code','pass',$4::jsonb) RETURNING id`,
      [`${tag}-${run}`, s, new Date(Date.UTC(2020, 0, 1, 0, 0, sec++)).toISOString(), JSON.stringify({ observed })])).rows[0].id);
  }
  const out = await flushJudgments(client, ids);
  if (out.length !== 1 || out[0].activity_id !== act || out[0].verdict !== 'converging' || !out[0].judgment_id) die(`自动裁判结果不对: ${JSON.stringify(out)}`);
  const latest = await getLatestJudgment(client, act);
  if (latest?.verdict !== 'converging' || latest.consecutive_green !== 2 || latest.trigger_kind !== 'auto' || latest.trigger_ref !== `${tag}-r2`) die(`最新裁判不对: ${JSON.stringify(latest)}`);
  ok('Step 级 span 经 steps 找到 Activity，对账结果只追加落库，最新裁判可查（连续绿 2、触发运行 r2）');

  const half = (await client.query(
    `INSERT INTO spans(run_id, step_id, started_at, ended_at, executor_kind, outcome, evidence)
     VALUES($1,$2,now(),now(),'code','pass',$3::jsonb) RETURNING id`, [`${tag}-r3`, s1, JSON.stringify({ observed: 1 })])).rows[0].id;
  const partial = await flushJudgments(client, [half]);
  const count = Number((await client.query('SELECT count(*) FROM activity_judgments WHERE activity_id=$1', [act])).rows[0].count);
  if (partial[0]?.deferred !== true || count !== 1) die(`跑到一半的运行不该落库: ${JSON.stringify(partial)} count=${count}`);
  const cell = (await client.query(
    "SELECT cell_status FROM activity_cells WHERE step_id=$1 AND cell_key='readback' AND parent_cell_key IS NULL", [act])).rows[0]?.cell_status;
  if (cell === 'red') die('跑到一半的运行把 readback 格翻红了');
  ok('运行只报了第 1 步（静默期内）→ 推迟裁判：不落库、readback 不翻红');

  await client.query('SAVEPOINT a');
  try { await client.query('UPDATE activity_judgments SET verdict=$1 WHERE activity_id=$2', ['converged', act]); die('UPDATE 没被拒'); }
  catch (e) { if (!/只追加/.test(e.message)) throw e; await client.query('ROLLBACK TO SAVEPOINT a'); }
  ok('改裁判行被只追加触发器拒绝');

  const sha = 'a'.repeat(64), commit = 'b'.repeat(40);
  const ver = async (n) => (await client.query(
    `INSERT INTO activity_definition_versions(activity_id, payload, contract_sha256, payload_sha256, source_repo, source_path, source_commit)
     VALUES($1,$2::jsonb,$3,$4,'smoke/repo',$5,$6) RETURNING id`,
    [act, JSON.stringify({ activity_id: act, contract: {} }), sha, String(n).repeat(64).slice(0, 64), `smoke/${n}.json`, commit])).rows[0].id;
  const v1 = await ver(1), v2 = await ver(2);
  const cmp = await compareActivityVersions(client, act, { candidateVersionId: v2, baselineVersionId: v1 });
  if (cmp.verdict !== 'insufficient_data' || cmp.sample.min_runs !== 5) die(`无样本时应 insufficient_data: ${JSON.stringify(cmp)}`);
  try { await compareActivityVersions(client, act, { candidateVersionId: randomUUID(), baselineVersionId: v1 }); die('错配版本没报 404'); }
  catch (e) { if (e.status !== 404) throw e; }
  ok('新旧版本对比：无样本 → insufficient_data（下限 5），版本不属于该 Activity → 404');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
NODE
) || fail "真函数段失败"

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
if curl -q -sf -m 5 "$BRAIN_URL/api/brain/health" >/dev/null 2>&1; then
  RID="00000000-0000-4000-8000-000000000538"
  CODE="$(curl -q -s -o /dev/null -w '%{http_code}' -m 10 "$BRAIN_URL/api/brain/activities/$RID/judgments/latest")"
  [[ "$CODE" == "404" ]] || fail "GET judgments/latest 期望 404（无裁判），实际 $CODE"
  CODE="$(curl -q -s -o /dev/null -w '%{http_code}' -m 10 "$BRAIN_URL/api/brain/activities/$RID/judgments")"
  [[ "$CODE" == "200" ]] || fail "GET judgments 期望 200，实际 $CODE"
  CODE="$(curl -q -s -o /dev/null -w '%{http_code}' -m 10 "$BRAIN_URL/api/brain/activities/$RID/version-compare")"
  [[ "$CODE" == "400" ]] || fail "GET version-compare 缺候选期望 400，实际 $CODE"
  pass "真容器：三个裁判查询接口已挂载（latest 404 / 历史 200 / 对比缺参 400）"
elif [[ "${CI:-}" == "true" ]]; then
  fail "CI 下 Brain 容器不可达: $BRAIN_URL"
fi

echo "activity-judgments-smoke: all passed"
