import { afterEach, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { normalizeSpan, writeSpans } from '../../lib/span-ingestion.js';
import { DB_DEFAULTS } from '../../db-config.js';
const require = createRequire(import.meta.url);
const { createWorkflowRunner, profileDigest } = require('../../../scripts/fleet-worker/workflow-runner.cjs');
const { createFleetWorkerServer } = require('../../../scripts/fleet-worker/fleet-worker.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const resources = [];
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const migration = name => fs.readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8');
afterEach(async () => { for (const cleanup of resources.splice(0).reverse()) await cleanup(); });

async function isolatedDatabase() {
  // 与集成套件共用连接配置；本机只准scratch，CI才允许cecelia_test，绝不自动跳过。
  if (DB_DEFAULTS.database !== 'cecelia_scratch' && !(process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) {
    throw Error(`common runner integration requires cecelia_scratch (CI may use cecelia_test), got ${DB_DEFAULTS.database}`);
  }
  const config = { ...DB_DEFAULTS, connectionTimeoutMillis: 2000, max: 3 };
  const admin = new pg.Pool(config);
  expect((await admin.query('SELECT current_database() AS db')).rows[0].db).toBe(config.database);
  const schema = `common_runner_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ ...config, options: `-c search_path=${schema},public` });
  resources.push(async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); });
  await pool.query(`
    CREATE TABLE schema_version(version varchar(10) PRIMARY KEY,description text);
    CREATE TABLE journeys(id uuid PRIMARY KEY);
    CREATE TABLE workflows(id uuid PRIMARY KEY);
    CREATE TABLE journey_steps(id uuid PRIMARY KEY,activity_key text,journey_id uuid,workflow_id uuid);
    CREATE TABLE steps(id uuid PRIMARY KEY);
    CREATE TABLE enablers(id uuid PRIMARY KEY);
    CREATE TABLE task_runs(id uuid PRIMARY KEY);
  `);
  await pool.query(migration('495_vs_model_spans.sql'));
  await pool.query(migration('514_span_occurrences.sql'));
  return pool;
}

async function centralHttp(pool) {
  let dropNext = true;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/api/brain/spans') {
        let text = ''; for await (const chunk of req) text += chunk;
        const result = await writeSpans(pool, [normalizeSpan(JSON.parse(text), 0)]);
        // 数据已经COMMIT，但调用端不知道：不得重跑业务，只能重传同一发生位置。
        if (dropNext) { dropNext = false; req.socket.destroy(); return; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
      }
      const url = new URL(req.url, 'http://local');
      if (req.method === 'GET' && url.pathname === '/api/brain/spans') {
        const { rows } = await pool.query('SELECT * FROM spans WHERE run_id=$1 ORDER BY occurrence_key', [url.searchParams.get('run_id')]);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ spans: rows, total: rows.length })); return;
      }
      res.writeHead(404).end();
    } catch (error) { res.writeHead(error.status ?? 500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
  });
  const url = await listen(server); resources.push(() => new Promise(resolve => server.close(resolve))); return url;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'common-recorder-pg-'));
  resources.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const activityId = randomUUID();
  const code = `import fs from 'node:fs';let t='';for await(const c of process.stdin)t+=c;const x=JSON.parse(t);fs.appendFileSync('effects','x');console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{answer:42,steps:[{action:'write one effect',evidence:['effects'],on_failure:'stop',executor:'code',side_effect:'one append'}]},metrics:{},evidence:['effects']}));`;
  const validator = `import fs from 'node:fs';let t='';for await(const c of process.stdin)t+=c;const x=JSON.parse(t);const actual=fs.readFileSync('effects','utf8');console.log(JSON.stringify({verdict:actual==='x'?'pass':'fail',acceptance_ref:x.acceptance.ref,evidence:[{path:'effects',actual}]}));`;
  fs.writeFileSync(path.join(root, 'work.mjs'), code); fs.writeFileSync(path.join(root, 'check.mjs'), validator);
  const questions = Object.fromEntries(['A1','A2','A3','A4','A5','A6','B1','C1','C2','C3'].map(key => [key, { ref: `contract:${key}`, version: 'v1', declared: { target: key } }]));
  const profile = { cwd: root, files: { 'work.mjs': hash(code), 'check.mjs': hash(validator) },
    contract: { workflow: 'pg-integration', activities: [{ key: 'work', order: 1, budget: { max_duration_s: 5, heartbeat_s: 1 },
      failure: { empty_ok: [], retryable: [], fatal: ['invalid'], needs_human: { cases: [] } },
      runtime: { protocol: 'json-stdio-v1', phase: 'source', entry: 'work.mjs' } }] },
    metadata: { work: { activity_id: activityId, executor_kind: 'code', questions } },
    validators: { workflow: { entry: 'check.mjs', acceptance: { ref: 'whole' } },
      work: { entry: 'check.mjs', acceptance: { ref: 'contract:A4' } } } };
  return { root, profile, identity: { run_id: randomUUID(), task_id: randomUUID(), profile: 'demo', mode: 'exploration',
    profile_sha256: profileDigest(profile), input: { run_tag: 'pg-integration', query: 'actual-input' } } };
}

test('真Fleet HTTP→Runner→Activity/独立验收→Recorder→真PG；断ACK重启补发不重做业务', async () => {
  const pool = await isolatedDatabase(), brainUrl = await centralHttp(pool), f = fixture();
  await pool.query('INSERT INTO journey_steps(id,activity_key) VALUES($1,$2)', [f.profile.metadata.work.activity_id, 'work']);
  const options = { stateRoot: path.join(f.root, 'state'), machineId: 'scratch-worker', profiles: { demo: f.profile }, brainUrl,
    assertCanLaunch: () => {}, assertLocalResources: async () => {} };
  let runner = createWorkflowRunner(options); resources.push(() => runner.close());
  const token = 'scratch-only-transport-token-12345';
  const worker = createFleetWorkerServer({ attemptToken: token, workflowRunner: runner });
  const workerUrl = await listen(worker); resources.push(() => new Promise(resolve => worker.close(resolve)));
  const call = async action => {
    const response = await fetch(`${workerUrl}/workflows/${f.identity.run_id}/${action}`, { method: 'POST',
      headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ ...f.identity, request_nonce: randomUUID() }) });
    expect(response.status).toBe(200); return (await response.json()).receipt;
  };
  await call('start'); await call('start');
  let terminal;
  for (let i = 0; i < 200; i++) {
    terminal = await runner.inspect(f.identity);
    if (!['starting','running','validating'].includes(terminal.status)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(terminal.status).toBe('completed');
  expect(terminal.writeback.pending).toBe(1); expect(terminal.writeback.acked).toBe(1);
  expect((await pool.query('SELECT count(*)::int AS n FROM spans')).rows[0].n).toBe(2);
  runner.close(); runner = createWorkflowRunner(options); resources.push(() => runner.close());
  const recovered = await runner.flush({ run_id: f.identity.run_id, task_id: f.identity.task_id });
  expect(recovered.writeback).toMatchObject({ total: 2, acked: 2, pending: 0, blocked: 0 });
  await runner.start(f.identity); await runner.flushPending();
  expect(fs.readFileSync(path.join(f.root, 'effects'), 'utf8')).toBe('x');
  const readback = await (await fetch(`${brainUrl}/api/brain/spans?run_id=${f.identity.run_id}`)).json();
  expect(readback.total).toBe(2);
  const execution = readback.spans.find(s => s.evidence.kind === 'execution'), validation = readback.spans.find(s => s.evidence.kind === 'validation');
  expect(Object.keys(execution.evidence.questions)).toHaveLength(10);
  expect(execution.evidence.questions.A2.actual.input.query).toBe('actual-input');
  expect(execution.evidence.questions.A3.actual.outputs.answer).toBe(42);
  expect(execution.evidence.questions.C1.status).toBe('unknown'); expect(execution.evidence.questions.A4.status).toBe('unknown');
  expect(validation.evidence.questions.A4.actual.verdict).toBe('pass');
  expect(validation.evidence.questions.C2.actual.executor.sha256).toBe(f.profile.files['check.mjs']);
  expect(execution.evidence.steps.reported[0].self_reported).toBe(true);
  expect(readback.spans.every(s => s.outcome === 'unknown')).toBe(true);
  const manifest = readback.spans.map(s => ({ occurrence_key: s.occurrence_key, payload_sha256: s.payload_sha256 }))
    .sort((a,b) => a.occurrence_key < b.occurrence_key ? -1 : a.occurrence_key > b.occurrence_key ? 1 : 0);
  expect(recovered.writeback.manifest_sha256).toBe(hash(JSON.stringify(manifest)));
}, 15000);

test('取消后finalize失败必须保留unknown占用，不能把请求取消当清场完成', async () => {
  const f = fixture();
  const work = `import fs from 'node:fs';let t='';for await(const c of process.stdin)t+=c;fs.appendFileSync('effects','x');setInterval(()=>{},1000);`;
  const cleanup = `let t='';for await(const c of process.stdin)t+=c;const x=JSON.parse(t);console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'failed',failure_class:'fatal',reason_code:'cleanup_unconfirmed',outputs:{},metrics:{},evidence:[]}));`;
  fs.writeFileSync(path.join(f.root, 'work.mjs'), work); fs.writeFileSync(path.join(f.root, 'cleanup.mjs'), cleanup);
  f.profile.files['work.mjs'] = hash(work); f.profile.files['cleanup.mjs'] = hash(cleanup);
  f.profile.contract.activities.push({ key: 'cleanup', order: 2, budget: { max_duration_s: 2, heartbeat_s: 1 },
    failure: { empty_ok: [], retryable: [], fatal: ['cleanup_unconfirmed'], needs_human: { cases: [] } },
    runtime: { protocol: 'json-stdio-v1', phase: 'finalize', entry: 'cleanup.mjs' } });
  f.profile.metadata.cleanup = { activity_id: randomUUID(), executor_kind: 'code', questions: {} };
  f.identity.profile_sha256 = profileDigest(f.profile);
  const runner = createWorkflowRunner({ stateRoot: path.join(f.root, 'state'), machineId: 'scratch-worker', profiles: { demo: f.profile },
    assertCanLaunch: () => {}, assertLocalResources: async () => {} });
  resources.push(() => runner.close());
  await runner.start(f.identity);
  for (let i = 0; i < 100 && !fs.existsSync(path.join(f.root, 'effects')); i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(fs.existsSync(path.join(f.root, 'effects'))).toBe(true);
  await runner.cancel(f.identity);
  let terminal;
  for (let i = 0; i < 200; i++) {
    terminal = await runner.inspect(f.identity);
    if (!['starting','running','validating'].includes(terminal.status)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(terminal.status).toBe('unknown'); expect((await runner.maintenance()).pending).toBe(1);
  expect(fs.existsSync(path.join(f.root, 'state', 'execution.lock'))).toBe(true);
}, 15000);

test('取消后所有finalize完成且独立cleanup证据pass才释放占用', async () => {
  const f = fixture();
  const work = `import fs from 'node:fs';let t='';for await(const c of process.stdin)t+=c;fs.appendFileSync('effects','x');setInterval(()=>{},1000);`;
  const cleanup = `import fs from 'node:fs';let t='';for await(const c of process.stdin)t+=c;const x=JSON.parse(t);fs.writeFileSync('cleanup-proof','safe');console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{cleaned:true},metrics:{},evidence:['cleanup-proof']}));`;
  const checker = `import fs from 'node:fs';let t='';for await(const c of process.stdin)t+=c;const x=JSON.parse(t);const proof=fs.readFileSync('cleanup-proof','utf8');console.log(JSON.stringify({verdict:proof==='safe'?'pass':'fail',acceptance_ref:x.acceptance.ref,evidence:[{path:'cleanup-proof',actual:proof}]}));`;
  for (const [entry, bytes] of Object.entries({ 'work.mjs': work, 'cleanup.mjs': cleanup, 'cleanup-check.mjs': checker })) {
    fs.writeFileSync(path.join(f.root, entry), bytes); f.profile.files[entry] = hash(bytes);
  }
  f.profile.contract.activities.push({ key: 'cleanup', order: 2, budget: { max_duration_s: 2, heartbeat_s: 1 },
    failure: { empty_ok: [], retryable: [], fatal: ['cleanup_failed'], needs_human: { cases: [] } },
    runtime: { protocol: 'json-stdio-v1', phase: 'finalize', entry: 'cleanup.mjs' } });
  f.profile.metadata.cleanup = { activity_id: randomUUID(), executor_kind: 'code', questions: {} };
  f.profile.validators.cleanup = { entry: 'cleanup-check.mjs', acceptance: { ref: 'cleanup-safe@1' } };
  f.identity.profile_sha256 = profileDigest(f.profile);
  const runner = createWorkflowRunner({ stateRoot: path.join(f.root, 'state'), machineId: 'scratch-worker', profiles: { demo: f.profile },
    assertCanLaunch: () => {}, assertLocalResources: async () => {} }); resources.push(() => runner.close());
  await runner.start(f.identity);
  for (let i = 0; i < 100 && !fs.existsSync(path.join(f.root, 'effects')); i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(fs.existsSync(path.join(f.root, 'effects'))).toBe(true); await runner.cancel(f.identity);
  let terminal;
  for (let i = 0; i < 200; i++) {
    terminal = await runner.inspect(f.identity);
    if (!['starting','running','validating'].includes(terminal.status)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(terminal.status).toBe('cancelled'); expect(terminal.validation.cleanup.verdict).toBe('pass');
  expect(terminal.validation.workflow.verdict).toBe('unknown');
  expect((await runner.maintenance()).pending).toBe(0);
  expect(fs.existsSync(path.join(f.root, 'state', 'execution.lock'))).toBe(false);
}, 15000);

test('输入映射预检失败也进中央错误账，不冒充已调用实现', async () => {
  const pool = await isolatedDatabase(), brainUrl = await centralHttp(pool), f = fixture();
  await pool.query('INSERT INTO journey_steps(id,activity_key) VALUES($1,$2)', [f.profile.metadata.work.activity_id, 'work']);
  f.profile.contract.activities[0].runtime.input = { query: '$.missing' };
  f.identity.profile_sha256 = profileDigest(f.profile);
  const runner = createWorkflowRunner({ stateRoot: path.join(f.root, 'state'), machineId: 'scratch-worker', profiles: { demo: f.profile }, brainUrl,
    assertCanLaunch: () => {}, assertLocalResources: async () => {} }); resources.push(() => runner.close());
  await runner.start(f.identity);
  for (let i = 0; i < 100; i++) {
    const state = await runner.inspect(f.identity);
    if (!['starting','running','validating'].includes(state.status)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await runner.flush(f.identity);
  const rows = (await pool.query('SELECT evidence FROM spans WHERE run_id=$1', [f.identity.run_id])).rows;
  const failure = rows.find(s => s.evidence.kind === 'execution')?.evidence;
  expect(failure).toBeDefined(); expect(failure.execution_invoked).toBe(false); expect(failure.start_known).toBe(false);
  expect(failure.timing_semantics).toBe('preflight_failure_observed');
  expect(failure.raw_result.reason_code).toBe('activity_input_path_missing');
  expect(failure.questions.A2.status).toBe('unknown'); expect(failure.questions.B1.status).toBe('unknown');
  expect(fs.existsSync(path.join(f.root, 'effects'))).toBe(false);
}, 15000);
