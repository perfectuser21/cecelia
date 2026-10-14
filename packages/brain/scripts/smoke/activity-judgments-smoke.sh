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
import { randomUUID, createHash } from 'node:crypto';
import { judgeActivity, flushJudgments, getLatestJudgment } from './src/lib/activity-judge.js';
import { compareActivityVersions } from './src/lib/activity-version-compare.js';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const die = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const ok = (m) => console.log(`PASS: ${m}`);
await client.connect();
try {
  await client.query('BEGIN');
  const reg = (await client.query("SELECT to_regclass('activity_judgments') IS NOT NULL AS ok")).rows[0].ok;
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
  if (latest?.verdict !== 'converging' || latest.consecutive_green !== 1 || latest.runs_considered !== 1
    || latest.report.evidence_scope !== null || latest.report.promotion_eligible !== false
    || latest.trigger_kind !== 'auto' || latest.trigger_ref !== `${tag}-r2`) die(`最新裁判不对: ${JSON.stringify(latest)}`);
  ok('旧协议仅诊断：连续绿 1、不晋级');

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
    [act, JSON.stringify({ activity_id: act, contract: { smoke_version: n } }), sha, String(n).repeat(64).slice(0, 64), `smoke/${n}.json`, commit])).rows[0].id;
  const v1 = await ver(1), v2 = await ver(2);
  const cmp = await compareActivityVersions(client, act, { candidateVersionId: v2, baselineVersionId: v1 });
  if (cmp.verdict !== 'insufficient_data' || cmp.sample.min_runs !== 5) die(`无样本时应 insufficient_data: ${JSON.stringify(cmp)}`);
  try { await compareActivityVersions(client, act, { candidateVersionId: randomUUID(), baselineVersionId: v1 }); die('错配版本没报 404'); }
  catch (e) { if (e.status !== 404) throw e; }
  ok('新旧版本对比：无样本 → insufficient_data（下限 5），版本不属于该 Activity → 404');

  // 完整冻结主运行 + 独立核验，测试两次窗口；下面的证据均为事务内 Smoke fixture。
  const json = value => JSON.stringify(value);
  const hash = value => createHash('sha256').update(json(value)).digest('hex');
  const insert = async (sql, args) => (await client.query(sql, args)).rows[0].id;
  const environment = { id: 'smoke-scratch', fingerprint: hash({ tag, host: 'scratch' }) };
  const implementation = { kind: 'skill', id: 'smoke-fixture', version: '1', digest: hash({ tag, fixture: 'skill' }) };
  const path = 'smoke/fixture/SKILL.md';
  const payload = { activity_id: act, contract: {}, steps: [s1, s2].map((step_id, i) => ({ step_id,
    locator: { step_key: `${tag}.${i ? 'save' : 'open'}` },
    contract: { readback: { type: 'metric', expect: { op: i ? '>=' : '==', value: 1 } } } })),
    commander_implementation: { implementation, path },
    implementation_bindings: [{ kind: 'skill', status: 'verified', validation_scope: 'reference_only', path,
      version: '1', digest: `sha256:${implementation.digest}` }] };
  const version = await insert(`INSERT INTO activity_definition_versions(activity_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit)
    VALUES($1,$2::jsonb,$3,$4,'smoke/repo','smoke/frozen.json',$5) RETURNING id`, [act,json(payload),hash(payload.contract),hash(payload),commit]);
  const stream = await insert('INSERT INTO value_streams(name) VALUES($1) RETURNING id', [tag]);
  const capability = await insert('INSERT INTO capabilities(name,parent_journey_id) VALUES($1,$2) RETURNING id', [tag,stream]);
  const workflow = await insert('INSERT INTO workflows(capability_id,key,name,channel) VALUES($1,$2,$2,\'smoke\') RETURNING id', [capability,tag]);
  const wfPayload = { workflow_id: workflow, contract: { environment }, activities: [{ activity_id: act, activity_version_id: version }] };
  const wfVersion = await insert(`INSERT INTO workflow_definition_versions(workflow_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit)
    VALUES($1,$2::jsonb,$3,$4,'smoke/repo','smoke/workflow.json',$5) RETURNING id`, [workflow,json(wfPayload),hash(wfPayload.contract),hash(wfPayload),commit]);
  const release = await insert(`INSERT INTO release_versions(release_key,manifest_sha256,request_sha256,environment,target,actor,payload)
    VALUES($1,$2,$2,'scratch','smoke','smoke',$3::jsonb) RETURNING id`, [tag,hash(wfPayload),json(wfPayload)]);
  const observation = await insert(`INSERT INTO release_observations(release_id,event_key,attempt_key,payload_sha256,payload,collector,evidence_ref,observed_at)
    VALUES($1,$2,$2,$3,$4::jsonb,'smoke','transaction-fixture',now()) RETURNING id`, [release,tag,hash(wfPayload),json(wfPayload)]);
  const reference = randomUUID();
  const expectedPath = [s1,s2].map(step_id => ({ reference_id: reference, activity_id: act, activity_definition_version_id: version, step_id }));
  async function frozenRun(number, actualEnvironment = environment) {
    const run = `${tag}-frozen-${number}`, attempt = `${run}:1`, task = randomUUID(), verify = randomUUID();
    const binding = await insert(`INSERT INTO run_definition_bindings(run_id,release_id,observation_id,workflow_id,workflow_definition_version_id,
      snapshot_sha256,expected_path,source_kind,external_origin,attempt_key,actor,payload_sha256,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'external','smoke-fixture',$8,'smoke',$6,$9::jsonb) RETURNING id`,
      [run,release,observation,workflow,wfVersion,hash(wfPayload),json(expectedPath),attempt,json(wfPayload)]);
    const evidenceIds = [];
    for (const [step_id,observed] of [[s1,1],[s2,3]]) {
      evidenceIds.push(await insert(`INSERT INTO spans(run_id,workflow_id,activity_id,step_id,started_at,ended_at,executor_kind,outcome,evidence,
        activity_definition_version_id,workflow_definition_version_id,identity_protocol,run_binding_id,reference_id,attempt_key,occurrence_key,payload_sha256)
        VALUES($1,$2,$3,$4,$5,$5,'agent','pass',$6::jsonb,$7,$8,2,$9,$12,$10,$11,$13) RETURNING id`,
        [run,workflow,act,step_id,new Date(Date.UTC(2020,0,2,0,0,number*2 + (step_id===s2 ? 1:0))).toISOString(),
          json({ observed,implementation,environment:actualEnvironment,execution_role:'primary' }),version,wfVersion,binding,attempt,step_id,reference,hash({run,step_id,observed,environment:actualEnvironment})]));
    }
    const envelope = { run_id: run, attempt: 1, definition: { snapshot_sha256: hash(wfPayload) }, contract: { environment } };
    const proof = { task_id: task,run_id:run,attempt:1,definition_sha256:hash(wfPayload),verdict:'PASS',
      assertions:[{name:'activity-readback',pass:true},{name:'cleanup',pass:true}],evidence:evidenceIds };
    await client.query(`INSERT INTO tasks(id,title,status,task_type,payload,result) VALUES($1,$2,'completed','research',$3::jsonb,$4::jsonb),
      ($5,$2,'completed','research',$6::jsonb,$7::jsonb)`, [task,tag,json({}),json({workflow_control:{phase:'final',verdict:'PASS',verify_task_id:verify,envelope}}),
      verify,json({verification_transport:'openclaw-agent-v1',run_id:`verify-${run}`}),json({workflow_verification:proof,
        receipt:{verification_runtime:{provider:'openai',model:'gpt-6.1-sol',logical_run_id:`verify-${run}`,official_run_id:`official-${run}`,rerouted:false}}})]);
    return evidenceIds;
  }
  await frozenRun(1); const frozenIds = await frozenRun(2);
  const [frozen] = await flushJudgments(client,frozenIds,{ judge:(db,id,options) => judgeActivity(db,id,{...options,requiredGreen:2}) });
  const storedFrozen = await getLatestJudgment(client,act);
  if (frozen?.consecutive_green!==2 || frozen.verdict!=='converged' || frozen.promotion_eligible!==true
    || storedFrozen?.consecutive_green!==2 || storedFrozen.verdict!=='converged' || storedFrozen.report.promotion_eligible!==true
    || storedFrozen.report.evidence_scope?.implementation.kind!=='skill' || storedFrozen.activity_definition_version_id!==version) die(`冻结范围裁判不对: ${json(frozen)}`);
  ok('冻结范围：连续绿 2、正式独立核验通过');
  const wrongIds = await frozenRun(3,{...environment,fingerprint:hash({tag,host:'other'})});
  const [wrong] = await flushJudgments(client,wrongIds,{judge:(db,id,options) => judgeActivity(db,id,{...options,requiredGreen:2})});
  const storedWrong = await getLatestJudgment(client,act);
  if (wrong?.consecutive_green!==1 || wrong.verdict!=='converging' || wrong.promotion_eligible!==false
    || storedWrong?.consecutive_green!==1 || storedWrong.report.promotion_eligible!==false || wrong.runs.length!==1
    || wrong.evidence_scope?.environment.fingerprint===environment.fingerprint) die(`错范围借到了旧绿: ${json(wrong)}`);
  ok('错环境范围：连续绿 1、不晋级');
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
