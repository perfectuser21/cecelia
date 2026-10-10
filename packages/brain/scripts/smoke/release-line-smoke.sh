#!/usr/bin/env bash
# release-line-smoke — 发布线（迁移 541，决策 de6dff5d 五块模型第 3 步，任务 37568378）真库真代码火：
# 构建登记到内容版本：同内容新 commit 不出新版本；生产版从未收敛 → 新内容 bootstrap（reason=bootstrap_no_converged_baseline）；
# 命中已存在旧构建不拨回指针；发布时把关默认关 → 无缺口；版本/事件只追加；真容器里发布线查询接口已挂载。
# 全程一个事务内跑，结束回滚（版本/事件只追加、定义构建不可变，不能靠 DELETE 清理）。
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
import { registerActivityBuild, releaseLineGapsForRelease, getPointer } from './src/lib/release-line.js';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
await client.connect();
try {
  await client.query('BEGIN');
  for (const t of ['activity_versions', 'activity_version_builds', 'activity_release_state', 'activity_release_events', 'workflow_production_recipes'])
    if (!(await client.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS ok`)).rows[0].ok) die(`${t} 不存在（迁移 541 未跑？）`);
  ok('迁移 541：版本、构建映射、生产指针、事件、流程配方五张表齐全');

  const tag = `rl-smoke-${randomUUID().slice(0, 8)}`;
  const act = (await client.query('INSERT INTO activities(name) VALUES($1) RETURNING id', [tag])).rows[0].id;
  let n = 0;
  const build = async (note) => {
    n += 1;
    const commit = String(n).repeat(40).slice(0, 40);
    return (await client.query(
      `INSERT INTO activity_definition_versions(activity_id, payload, contract_sha256, payload_sha256, source_repo, source_path, source_commit)
       VALUES($1,$2::jsonb,$3,$4,'smoke/repo','smoke/contracts.json',$5) RETURNING id`,
      [act, JSON.stringify({ activity_id: act, contract: { note }, implementation_bindings: [{ kind: 'code', revision: commit }] }),
        'c'.repeat(64), String(n).repeat(64).slice(0, 64), commit])).rows[0].id;
  };
  const noAlert = async () => null;
  const reg = (b, inserted = true) => registerActivityBuild(client, { activityId: act, buildId: b, inserted }, { env: {}, alert: noAlert });
  const b1 = await build('v1'), b2 = await build('v1'), b3 = await build('v2');
  const r1 = await reg(b1), r2 = await reg(b2), r3 = await reg(b3);
  if (r1.action !== 'initial' || r2.action !== 'unchanged' || r3.action !== 'bootstrap') die(`冷启动动作不对: ${JSON.stringify([r1, r2, r3])}`);
  const versions = (await client.query('SELECT version_no FROM activity_versions WHERE activity_id=$1 ORDER BY version_no', [act])).rows.map(r => r.version_no);
  if (versions.join(',') !== '1,2') die(`同内容不同 commit 应只出一个版本: ${versions}`);
  const boot = (await client.query("SELECT reason FROM activity_release_events WHERE activity_id=$1 AND kind='bootstrap'", [act])).rows;
  if (boot.length !== 1 || boot[0].reason !== 'bootstrap_no_converged_baseline') die(`bootstrap 事件不对: ${JSON.stringify(boot)}`);
  ok('同内容新 commit 不出新版本；生产版从未收敛 → 新内容直接成为生产版（bootstrap_no_converged_baseline）');

  const before = (await getPointer(client, act)).production_version_id;
  const back = await reg(b1, false);
  if (back.action !== 'existing_build_no_move' || (await getPointer(client, act)).production_version_id !== before) die('重同步旧构建把指针拨回去了');
  ok('命中已存在的旧构建（CI 重跑旧 commit）只补映射，不拨回生产指针');

  const gaps = await releaseLineGapsForRelease(client, 'production', [{ id: b1, activity_id: act }]);
  if (gaps.length) die(`发布时把关默认应关闭: ${JSON.stringify(gaps)}`);
  ok('发布时把关默认关（RELEASE_LINE_ENFORCE_RELEASE 未设）→ 无缺口，今天部署不受影响');

  await client.query('SAVEPOINT a');
  try { await client.query('UPDATE activity_versions SET version_no=99 WHERE activity_id=$1', [act]); die('UPDATE 没被拒'); }
  catch (e) { if (!/只追加/.test(e.message)) throw e; await client.query('ROLLBACK TO SAVEPOINT a'); }
  ok('版本只追加：UPDATE 被触发器拒绝');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
NODE
) || fail "真函数段失败"

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
if curl -q -sf -m 5 "$BRAIN_URL/api/brain/health" >/dev/null 2>&1; then
  RID="00000000-0000-4000-8000-000000000541"
  CODE="$(curl -q -s -o /dev/null -w '%{http_code}' -m 10 "$BRAIN_URL/api/brain/activities/$RID/release")"
  [[ "$CODE" == "404" ]] || fail "GET activities/:id/release 期望 404（不存在的 Activity），实际 $CODE"
  CODE="$(curl -q -s -o /dev/null -w '%{http_code}' -m 10 "$BRAIN_URL/api/brain/activities/$RID/content-versions")"
  [[ "$CODE" == "200" ]] || fail "GET content-versions 期望 200，实际 $CODE"
  CODE="$(curl -q -s -o /dev/null -w '%{http_code}' -m 10 "$BRAIN_URL/api/brain/workflows/$RID/production-recipe")"
  [[ "$CODE" == "404" ]] || fail "GET production-recipe 期望 404（没有配方），实际 $CODE"
  pass "真容器：发布线查询接口已挂载（release 404 / content-versions 200 / production-recipe 404）"
elif [[ "${CI:-}" == "true" ]]; then
  fail "CI 下 Brain 容器不可达: $BRAIN_URL"
fi

echo "release-line-smoke: all passed"
