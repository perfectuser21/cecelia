import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import pg from 'pg';

// 无默认连接、无skip；本机只能scratch，CI也必须隔离scratch数据库。
const connectionString = process.env.ACTIVITY_EVENT_DATABASE_URL;
assert.ok(connectionString, 'ACTIVITY_EVENT_DATABASE_URL_required');
const address = new URL(connectionString);
assert.ok(['', 'localhost', '127.0.0.1', '[::1]'].includes(address.hostname), 'local_scratch_host_required');
assert.ok(address.pathname === '/cecelia_scratch'
  || (process.env.CI === 'true' && /^\/cecelia_activity_event_scratch$/.test(address.pathname)), 'scratch_database_required');
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 3000 });
const schema = 'activity_event_' + randomUUID().replaceAll('-', '');
const cwd = await mkdtemp(join(tmpdir(), 'activity-event-ledger-'));
const cli = fileURLToPath(new URL('../../../scripts/activity-contract-run.js', import.meta.url));
const fixture = new URL('./fixtures/activity-runtime/activity.mjs', import.meta.url);
const migration = await readFile(new URL('../../../migrations/367_harness_commander_phase1.sql', import.meta.url), 'utf8');
const eventTable = migration.match(/CREATE TABLE IF NOT EXISTS harness_run_events \([\s\S]*?\n\);/)[0];
const appendFunction = migration.match(/CREATE OR REPLACE FUNCTION append_harness_run_event\([\s\S]*?\n\$\$;/)[0];
const failure = { empty_ok: [], retryable: ['transient'], fatal: ['invalid'], needs_human: { cases: [] } };
const make = (key, order, phase = 'batch_end') => ({ key, order, failure,
  budget: { max_duration_s: 15, heartbeat_s: 1 }, runtime: { protocol: 'json-stdio-v1',
    entry: 'activity.mjs', argv: [key], phase, on_failure: 'continue' } });
const dbUrl = new URL(connectionString);
dbUrl.searchParams.set('options', '-csearch_path=' + schema + ',public');
const childEnv = { ...process.env, ACTIVITY_EVENT_DATABASE_URL: dbUrl.href };
let db;

async function run(runId, sourceId, activities, extra = {}, args = []) {
  const runTag = extra.run_tag || 'ledger-smoke';
  const trace = join(cwd, randomUUID() + '.jsonl');
  const receiptPath = trace + '.receipt';
  const envelope = { contract: { workflow: 'ledger-smoke', activities },
    input: { run_tag: runTag, trace, fragments: [], ...extra } };
  const child = spawn(process.execPath, [cli, '--cwd', cwd, '--receipt', receiptPath,
    '--event-db', '--brain-run-id', runId, '--event-source-id', sourceId, ...args],
  { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(envelope));
  const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
  const code = await new Promise(resolve => child.on('close', resolve));
  clearTimeout(timer);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.deepEqual(JSON.parse(await readFile(receiptPath, 'utf8')), result);
  let traceRows = [];
  try { traceRows = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse); } catch {}
  return { code, result, traceRows };
}
async function newRun() {
  const runId = randomUUID();
  await db.query('INSERT INTO initiative_runs(id,initiative_id) VALUES($1,$2)', [runId, randomUUID()]);
  return runId;
}
async function events(runId, sourceId) {
  const { rows } = await db.query('SELECT * FROM harness_run_events WHERE run_id=$1 AND source_id=$2 ORDER BY cursor', [runId, sourceId]);
  return rows;
}

try {
  db = await pool.connect();
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, address.pathname.slice(1));
  await db.query('CREATE SCHEMA ' + schema);
  await db.query('SET search_path TO ' + schema + ',public');
  // 最小隔离fixture，事件表/函数直接使用永久migration，不更改public或生产schema。
  await db.query('CREATE TABLE initiative_runs(id uuid PRIMARY KEY, initiative_id uuid NOT NULL)');
  await db.query(eventTable);
  await db.query(appendFunction);
  await copyFile(fixture, join(cwd, 'activity.mjs'));
  const runId = await newRun(), sourceId = randomUUID();
  await db.query("SELECT append_harness_run_event($1,'PREEXISTING','fixture',$2,1,'{}')", [runId, randomUUID()]);
  const good = await run(runId, sourceId, [make('partial', 1), make('deliver', 2), make('finalize', 3, 'finalize')]);
  assert.equal(good.code, 2, JSON.stringify(good.result));
  assert.equal(good.result.status, 'partial');
  assert.deepEqual(good.result.outputs.delivered, [{ id: 'retained', owner: 'partial' }]);
  assert.equal(good.result.outputs.cleanup, true);
  const stored = await events(runId, sourceId);
  assert.equal(stored.filter(row => row.event_type !== 'ACTIVITY_HEARTBEAT').length, 8);
  assert.equal(stored[0].event_type, 'WF_RUN_STARTED');
  assert.equal(stored.at(-1).event_type, 'WF_RUN_FINALIZED');
  assert.equal(Number(stored[0].cursor), 2);
  assert.equal(stored[0].payload.local_cursor, 1);
  assert.deepEqual(good.result.event_ledger.events, stored.map(row => ({
    cursor: Number(row.cursor), local_cursor: row.payload.local_cursor, event_type: row.event_type })));
  const { event_ledger, ...receipt } = good.result;
  assert.deepEqual(stored.at(-1).payload.receipt, receipt);
  assert.equal(event_ledger.run_id, runId);
  assert.equal(event_ledger.source_id, sourceId);
  assert.equal(stored.at(-1).payload.receipt.metrics.deliver.delivered, 1);
  assert.equal(stored.at(-1).payload.receipt.evidence.length, 3);
  console.log(`PASS 真实CLI/Postgres完整结果读回：${stored.length}事件，DB cursor=2..${Number(stored.at(-1).cursor)}/local cursor=1..${stored.length}，partial产物/指标/证据/finalize回执一致`);

  const replay = await run(runId, sourceId, [make('partial', 1), make('finalize', 2, 'finalize')]);
  assert.equal(replay.code, 1);
  assert.equal(replay.result.detail, 'activity_source_already_used');
  assert.equal(replay.traceRows.length, 0);
  assert.deepEqual(await events(runId, sourceId), stored);
  const fresh = await run(runId, randomUUID(), [make('deliver', 1)]);
  assert.equal(fresh.code, 0, JSON.stringify(fresh.result));
  assert.ok(fresh.result.event_ledger.cursor > event_ledger.cursor);
  const rebound = await run(await newRun(), sourceId, [make('deliver', 1)]);
  assert.equal(rebound.result.detail, 'activity_source_already_used');
  assert.equal(rebound.traceRows.length, 0);
  const absentOptional = await run(runId, randomUUID(), [make('unclassified_complete', 1)]);
  assert.equal(absentOptional.code, 0, JSON.stringify(absentOptional.result));
  for (const [badRun, badSource, detail] of [
    [randomUUID(), randomUUID(), 'activity_run_not_found'],
    ['invalid', randomUUID(), 'activity_run_id_invalid'],
    [runId, 'invalid', 'activity_source_id_invalid'],
  ]) {
    const invalid = await run(badRun, badSource, [make('partial', 1), make('finalize', 2, 'finalize')]);
    assert.equal(invalid.result.detail, detail);
    assert.equal(invalid.traceRows.length, 0);
  }
  console.log('PASS 已注册run/唯一source校验：复用拒绝、另一次调用独立追加，非法身份无活动副作用');

  await writeFile(join(cwd, 'auth-result.mjs'), `
    let text = ''; for await (const chunk of process.stdin) text += chunk;
    const input = JSON.parse(text);
    process.stdout.write(JSON.stringify({ schema_version: 1, run_tag: input.run_tag,
      status: 'completed', outputs: { auth_failed: process.argv[2] === 'boolean' ? true : 'opaque-private-review-marker' },
      metrics: {}, evidence: [] }));
  `);
  const authActivity = kind => { const activity = make('result_fixture', 1);
    activity.runtime.entry = 'auth-result.mjs'; activity.runtime.argv = [kind]; return activity; };
  const authRun = await newRun(), authSource = randomUUID();
  const unsafeAuth = await run(authRun, authSource, [authActivity('string'), make('finalize', 2, 'finalize')]);
  assert.equal(unsafeAuth.result.reason_code, 'event_sink_failed');
  assert.equal(unsafeAuth.result.outputs.cleanup, true);
  assert.equal(unsafeAuth.result.outputs.auth_failed, '[redacted]');
  assert.ok(!JSON.stringify(unsafeAuth.result).includes('opaque-private-review-marker'));
  assert.ok(!JSON.stringify(await events(authRun, authSource)).includes('opaque-private-review-marker'));
  const safeAuthRun = await newRun(), safeAuthSource = randomUUID();
  const safeAuth = await run(safeAuthRun, safeAuthSource, [authActivity('boolean')]);
  assert.equal(safeAuth.code, 0, JSON.stringify(safeAuth.result));
  assert.equal(safeAuth.result.outputs.auth_failed, true);
  assert.equal((await events(safeAuthRun, safeAuthSource)).at(-1).payload.receipt.outputs.auth_failed, true);
  console.log('PASS auth_failed仅布尔值安全豁免，字符串拒账且最终stdout/receipt脱敏，全部finalize保留');

  const { createActivityEventSink, runActivityContractWithEventStore } = await import('../activity-event-sink.js');
  const correctionPool = new pg.Pool({ connectionString: dbUrl.href, connectionTimeoutMillis: 3000 });
  try {
    const correctedRun = await newRun(), correctedSource = randomUUID();
    const corrected = await runActivityContractWithEventStore({ workflow: 'ledger-smoke', activities: [make('deliver', 1),
      { ...make('deliver', 2, 'finalize'), key: 'deliver_final' }, make('finalize', 3, 'finalize')] },
    { run_tag: 'ledger-smoke', trace: join(cwd, 'corrected.jsonl'), fragments: [{ id: 'retained', owner: 'partial' }] },
    { cwd, pool: correctionPool, runId: correctedRun, sourceId: correctedSource, onEvent: async event => {
      const rows = await events(correctedRun, correctedSource);
      assert.equal(rows.at(-1).payload.local_cursor, event.cursor, 'external_callback_requires_committed_event');
      if (event.event_type === 'WF_RUN_FINALIZED') throw new Error('private_terminal_callback_failure');
    } });
    const rows = await events(correctedRun, correctedSource);
    assert.equal(rows.at(-1).event_type, 'WF_RUN_FINALIZATION_CORRECTED');
    const { event_ledger: correctedLedger, ...correctedReceipt } = corrected;
    assert.deepEqual(rows.at(-1).payload.receipt, correctedReceipt);
    assert.equal(correctedLedger.cursor, Number(rows.at(-1).cursor));
    assert.deepEqual(corrected.outputs.delivered, [{ id: 'retained', owner: 'partial' }]);
    assert.equal(corrected.outputs.cleanup, true);
    assert.equal(corrected.reason_code, 'event_sink_failed');
    assert.equal(corrected.status, 'partial');
    assert.ok(!JSON.stringify(corrected).includes('private_terminal_callback_failure'));
    assert.equal(rows.find(row => row.event_type === 'WF_RUN_FINALIZED').payload.receipt.status, 'completed');
    console.log('PASS 终态外部回调失败追加明确correction，保留原事件，DB最新安全快照与返回结果及确认游标一致');

    await db.query(`CREATE FUNCTION reject_terminal_correction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type='WF_RUN_FINALIZATION_CORRECTED'
        THEN RAISE EXCEPTION 'private_correction_database_failure'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER reject_terminal_correction BEFORE INSERT ON harness_run_events FOR EACH ROW EXECUTE FUNCTION reject_terminal_correction()');
    try {
      const rejectedRun = await newRun(), rejectedSource = randomUUID();
      const rejected = await runActivityContractWithEventStore({ workflow: 'ledger-smoke', activities: [make('deliver', 1),
        make('finalize', 2, 'finalize')] },
      { run_tag: 'ledger-smoke', trace: join(cwd, 'correction-rejected.jsonl'), fragments: [{ id: 'preserved' }] },
      { cwd, pool: correctionPool, runId: rejectedRun, sourceId: rejectedSource, onEvent: async event => {
        if (event.event_type === 'WF_RUN_FINALIZED') throw new Error('private_terminal_callback_failure');
      } });
      const rejectedRows = await events(rejectedRun, rejectedSource);
      assert.equal(rejected.status, 'partial');
      assert.deepEqual(rejected.outputs.delivered, [{ id: 'preserved' }]);
      assert.equal(rejected.outputs.cleanup, true);
      assert.equal(rejected.event_failures.at(-1).event_type, 'WF_RUN_FINALIZATION_CORRECTED');
      assert.equal(rejected.event_ledger.cursor, Number(rejectedRows.at(-1).cursor));
      assert.equal(rejectedRows.at(-1).event_type, 'WF_RUN_FINALIZED');
      assert.ok(!JSON.stringify(rejected).includes('private_correction_database_failure'));
      console.log('PASS correction真实拒写仍保产物/cleanup，新增明确event_failures且不伪报DB确认游标');
    } finally { await db.query('DROP TRIGGER reject_terminal_correction ON harness_run_events'); }
  } finally { await correctionPool.end(); }

  const failRun = await newRun(), failSource = randomUUID();
  await db.query(`CREATE FUNCTION reject_activity_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event_type='ACTIVITY_FINISHED' AND NEW.payload->'event'->>'activity'='partial'
      THEN RAISE EXCEPTION 'deliberate_private_database_failure'; END IF; RETURN NEW; END $$`);
  await db.query('CREATE TRIGGER reject_activity_event BEFORE INSERT ON harness_run_events FOR EACH ROW EXECUTE FUNCTION reject_activity_event()');
  const failed = await run(failRun, failSource, [make('partial', 1), make('deliver', 2),
    { ...make('deliver', 3, 'finalize'), key: 'deliver_final' }, { ...make('finalize', 4, 'finalize'), key: 'cleanup' }]);
  assert.equal(failed.code, 2, JSON.stringify(failed.result));
  assert.equal(failed.result.reason_code, 'event_sink_failed');
  assert.equal(failed.result.outputs.cleanup, true);
  assert.deepEqual(failed.result.outputs.delivered, [{ id: 'retained', owner: 'partial' }]);
  assert.deepEqual(failed.traceRows.map(row => row.action), ['partial', 'deliver', 'finalize']);
  const failureRows = await events(failRun, failSource);
  assert.ok(!failureRows.some(row => row.event_type === 'ACTIVITY_FINISHED' && row.payload.event.activity === 'partial'));
  assert.equal(failureRows.at(-1).event_type, 'WF_RUN_FINALIZED');
  const { event_ledger: failureLedger, ...failedReceipt } = failed.result;
  assert.deepEqual(failureRows.at(-1).payload.receipt, failedReceipt);
  assert.equal(failureLedger.events.length, failureRows.length);
  assert.ok(!JSON.stringify(failed.result).includes('deliberate_private_database_failure'));
  await db.query('DROP TRIGGER reject_activity_event ON harness_run_events');
  console.log('PASS 真实数据库拒写ACTIVITY_FINISHED：主链停止，产物经finalize配送，全部收尾完成，WF_RUN_FINALIZED读回完整失败结果');

  await db.query(`CREATE FUNCTION reject_activity_start() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event_type='WF_RUN_STARTED' OR (NEW.event_type='ACTIVITY_STARTED' AND NEW.payload->'event'->>'activity'='partial')
      THEN RAISE EXCEPTION 'private_start_failure'; END IF; RETURN NEW; END $$`);
  await db.query('CREATE TRIGGER reject_activity_start BEFORE INSERT ON harness_run_events FOR EACH ROW EXECUTE FUNCTION reject_activity_start()');
  const startRun = await newRun(), startSource = randomUUID();
  const startFailed = await run(startRun, startSource, [make('partial', 1), make('finalize', 2, 'finalize')]);
  assert.equal(startFailed.result.reason_code, 'event_sink_failed');
  assert.deepEqual(startFailed.traceRows.map(row => row.action), ['finalize']);
  assert.equal(startFailed.result.outputs.cleanup, true);
  assert.equal((await events(startRun, startSource)).at(-1).event_type, 'WF_RUN_FINALIZED');
  await db.query('DROP TRIGGER reject_activity_start ON harness_run_events');
  console.log('PASS 开始事件真实拒写阻止主链副作用，既有finalize清理策略保持');

  const servicePool = new pg.Pool({ connectionString: dbUrl.href, connectionTimeoutMillis: 3000 });
  try {
    const serviceRun = await newRun(), serviceSource = randomUUID();
    const sink = await createActivityEventSink({ pool: servicePool, runId: serviceRun, sourceId: serviceSource, runTag: 'ledger-smoke' });
    try {
      await assert.rejects(createActivityEventSink({ pool: servicePool, runId: serviceRun, sourceId: serviceSource, runTag: 'ledger-smoke' }), /activity_source_busy/);
      await assert.rejects(sink.onEvent({ cursor: 1, event_type: 'WF_RUN_STARTED', run_tag: 'foreign' }, {}), /activity_run_identity_mismatch/);
      await assert.rejects(sink.onEvent({ cursor: 1, event_type: 'WF_RUN_STARTED', run_tag: 'ledger-smoke' }, { run_tag: 'ledger-smoke', api_key: 'private' }), /secret_material_forbidden/);
      assert.equal((await events(serviceRun, serviceSource)).length, 0);
    } finally { await sink.close(); }
    const timeout = make('timeout', 1); timeout.budget.max_duration_s = 5;
    const service = await runActivityContractWithEventStore({ workflow: 'ledger-smoke', activities: [timeout, make('finalize', 2, 'finalize')] },
      { run_tag: 'ledger-smoke', trace: join(cwd, 'heartbeat.jsonl') },
      { cwd, pool: servicePool, runId: serviceRun, sourceId: serviceSource });
    const heartbeatRows = await events(serviceRun, serviceSource);
    assert.ok(heartbeatRows.some(row => row.event_type === 'ACTIVITY_HEARTBEAT'));
    assert.equal(service.status, 'partial');
    assert.equal(service.outputs.cleanup, true);
    assert.deepEqual(heartbeatRows.at(-1).payload.receipt.outputs, service.outputs);
    console.log('PASS 服务调用真实心跳/超时/finalize落账、同source并发拒绝、错误run_tag与secret拒写');
  } finally { await servicePool.end(); }

  const dyingRun = await newRun(), dyingSource = randomUUID(), applicationName = 'activity-disconnect-' + randomUUID();
  const dyingPool = new pg.Pool({ connectionString: dbUrl.href, max: 1, application_name: applicationName });
  try {
    const disconnected = await runActivityContractWithEventStore({ workflow: 'ledger-smoke', activities: [make('partial', 1),
      { ...make('deliver', 2, 'finalize'), key: 'deliver_final' }, make('finalize', 3, 'finalize')] },
    { run_tag: 'ledger-smoke', trace: join(cwd, 'disconnected.jsonl'), fragments: [] },
    { cwd, pool: dyingPool, runId: dyingRun, sourceId: dyingSource, onEvent: async event => {
      if (event.event_type === 'ACTIVITY_FINISHED' && event.activity === 'partial') {
        await db.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1', [applicationName]);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } });
    assert.equal(disconnected.status, 'partial');
    assert.equal(disconnected.reason_code, 'event_sink_failed');
    assert.deepEqual(disconnected.outputs.delivered, [{ id: 'retained', owner: 'partial' }]);
    assert.equal(disconnected.outputs.cleanup, true);
    assert.ok(disconnected.event_failures.length > 0);
    assert.equal(disconnected.event_ledger.events.length, (await events(dyingRun, dyingSource)).length);
    console.log('PASS 真Postgres连接中断仍保留partial产物/全部finalize，已确认游标与数据库实际事件数一致');
  } finally { await dyingPool.end(); }
} finally {
  if (db) {
    await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    db.release();
  }
  await pool.end();
  await rm(cwd, { recursive: true, force: true });
}
