import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import express from 'express';
import request from 'supertest';

import pool from '../../src/db.js';
import { pushCapture } from '../../src/capture-inbox.js';
import { parseAndCreate } from '../../src/intent.js';
import { activateMapManifest, submitMapManifest } from '../../src/lib/map-manifest-store.js';
import { projectMapManifest } from '../../src/lib/map-projection-store.js';
import { createKernelRun } from '../../src/orchestrator/kernel-run-store.js';
import captureAtomsRouter from '../../src/routes/capture-atoms.js';
import taskTasksRouter from '../../src/routes/task-tasks.js';
import { createSmokeIdentity } from './unified-work-router-smoke-identity.mjs';

const repoRoot = new URL('../../../..', import.meta.url).pathname.replace(/\/$/, '');
const sourceRevision = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const branch = execFileSync('git', ['-C', repoRoot, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const mapScope = ['F0'];
const { titlePrefix, sourceNamespace } = createSmokeIdentity(sourceRevision);
const assertionRef = 'packages/brain/src/orchestrator/preflight/map-impact-contract.test.js';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureScratchAssertionAnchor() {
  const fixtureIds = {
    step: '0f000000-0000-4000-8000-000000000002',
    feature: '0f000000-0000-4000-8000-000000000003',
    link: '0f000000-0000-4000-8000-000000000004',
  };
  const journeyResult = await pool.query(
    `SELECT id FROM journeys
      WHERE biz_area='cecelia' AND capability_code='F0'`,
  );
  const journeyId = journeyResult.rows[0]?.id;
  invariant(journeyId, 'scratch F0 authoritative Journey is absent');
  await pool.query(
    `INSERT INTO journey_steps (id,journey_id,name,step_number,status)
     VALUES ($1,$2,'route coding through Harness',1,'planned')
     ON CONFLICT (id) DO UPDATE
       SET journey_id=EXCLUDED.journey_id,name=EXCLUDED.name,
           step_number=EXCLUDED.step_number,status=EXCLUDED.status`,
    [fixtureIds.step, journeyId],
  );
  await pool.query(
    `INSERT INTO journey_features
      (id,journey_id,step_id,name,unit_test_path,status)
     VALUES ($1,$2,$3,'Unified Work Router F0 assertion',$4,'working')
     ON CONFLICT (id) DO UPDATE
       SET journey_id=EXCLUDED.journey_id,step_id=EXCLUDED.step_id,
           name=EXCLUDED.name,unit_test_path=EXCLUDED.unit_test_path,
           status=EXCLUDED.status`,
    [fixtureIds.feature, journeyId, fixtureIds.step, assertionRef],
  );
  await pool.query(
    `INSERT INTO journey_step_links
      (id,journey_id,step_id,feature_id,cell_kind,cell_key,
       assertion_ref,assertion_revision,notion_synced_at)
     VALUES ($1,$2,$3,$4,'capability','F0',$5,1,NOW())
     ON CONFLICT (id) DO UPDATE
       SET journey_id=EXCLUDED.journey_id,step_id=EXCLUDED.step_id,
           feature_id=EXCLUDED.feature_id,cell_kind=EXCLUDED.cell_kind,
           cell_key=EXCLUDED.cell_key,assertion_ref=EXCLUDED.assertion_ref,
           assertion_revision=EXCLUDED.assertion_revision,
           notion_synced_at=EXCLUDED.notion_synced_at`,
    [fixtureIds.link, journeyId, fixtureIds.step, fixtureIds.feature, assertionRef],
  );
  const target = await pool.query(
    `SELECT count(*)::int AS count FROM test_registry
      WHERE repo='cecelia' AND file_path=$1 AND source_revision=$2`,
    [assertionRef, sourceRevision],
  );
  invariant(target.rows[0].count === 1,
    `scratch assertion target is absent at ${sourceRevision}: ${assertionRef}`);
}

async function rebuildCeceliaProjection() {
  const manifest = JSON.parse(await readFile(
    new URL('../../config/map-manifests/cecelia.v1.json', import.meta.url),
    'utf8',
  ));
  await pool.query(
    `INSERT INTO decisions
      (id,category,topic,decision,reason,status,author,made_by,priority)
     VALUES ($1,'architecture','universal-map','activate cecelia manifest',
       'Unified Work Router scratch authority','active','cecelia','system','P1')
     ON CONFLICT (id) DO NOTHING`,
    [manifest.source_decision_id],
  );
  const submitted = await submitMapManifest(pool, manifest);
  if (submitted.manifest_version.status === 'draft') {
    await activateMapManifest(pool, submitted.manifest_version.id);
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await projectMapManifest({
      client,
      manifestVersion: submitted.manifest_version,
      mode: 'rebuild',
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createHttpApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/tasks', taskTasksRouter);
  app.use('/api/brain/capture-atoms', captureAtomsRouter);
  return app;
}

async function createApiTask(app, body) {
  const response = await request(app).post('/api/brain/tasks').send(body);
  invariant(response.status === 200 || response.status === 201,
    `task API failed ${response.status}: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function createCaptureTask(app) {
  const routingMetadata = {
    repo: 'cecelia', change_kind: 'bugfix', map_scope: mapScope,
    branch, base_sha: sourceRevision,
  };
  const pushed = await pushCapture(pool, {
    content: `${titlePrefix} Capture coding mutation`,
    source: 'smoke',
    dedupeKey: `${sourceNamespace}:capture`,
    targetType: 'task',
    targetSubtype: 'bugfix',
    routingMetadata,
  });
  invariant(pushed?.captureId, 'capture ingress did not return an envelope');
  const atomResult = await pool.query(
    `SELECT id FROM capture_atoms WHERE capture_id=$1 AND target_type='task'`,
    [pushed.captureId],
  );
  const atomId = atomResult.rows[0]?.id;
  invariant(atomId, 'capture ingress did not persist a task atom');
  await pool.query(
    `UPDATE capture_atoms
        SET status='pending_review', routed_to_table=NULL, routed_to_id=NULL,
            metadata=$2::jsonb, updated_at=NOW()
      WHERE id=$1`,
    [atomId, JSON.stringify(routingMetadata)],
  );
  const response = await request(app)
    .patch(`/api/brain/capture-atoms/${atomId}`)
    .send({ action: 'confirm' });
  invariant(response.status === 200,
    `capture route failed ${response.status}: ${JSON.stringify(response.body)}`);
  const task = await pool.query('SELECT * FROM tasks WHERE id=$1', [response.body.routed_to_id]);
  invariant(task.rows[0], 'capture route did not persist its routed task');
  return task.rows[0];
}

async function assertRoutedCodingTasks(tasks, expectedSources) {
  const ids = tasks.map((task) => task.id);
  const result = await pool.query(
    `SELECT task.id AS task_id,task.task_type,receipt.source,receipt.pipeline,
            receipt.repo,receipt.change_kind,receipt.map_scope,
            receipt.impact_contract_required,receipt.evidence
       FROM tasks task
       JOIN work_routing_receipts receipt ON receipt.task_id=task.id
      WHERE task.id=ANY($1::uuid[])
      ORDER BY receipt.source,task.id`,
    [ids],
  );
  invariant(result.rows.length === tasks.length,
    `coding receipt coverage ${result.rows.length}/${tasks.length}`);
  for (const row of result.rows) {
    invariant(row.task_type === 'harness_initiative', `${row.task_id} is not harness_initiative`);
    invariant(row.pipeline === 'harness' && row.impact_contract_required === true,
      `${row.task_id} is not governed by Harness`);
    invariant(row.repo === 'cecelia' && row.change_kind === 'bugfix',
      `${row.task_id} route identity mismatch`);
    invariant(row.evidence?.branch === branch && row.evidence?.base_sha === sourceRevision,
      `${row.task_id} baseline mismatch`);
  }
  invariant(expectedSources.every((source) => result.rows.some((row) => row.source === source)),
    `missing coding sources: ${expectedSources.join(',')}`);
}

async function ensureKernelRuns(tasks) {
  for (const task of tasks) {
    const run = await createKernelRun(pool, {
      taskId: task.id,
      initiativeId: task.id,
      phase: 'generate',
      journeyId: null,
      abilityId: null,
      host: 'uwr-scratch-smoke',
      deadlineHours: 1,
      createdSource: 'kernel_dispatch',
    });
    invariant(run.run.impact_contract_policy === 'required', `${task.id} run is not required`);
  }
  const result = await pool.query(
    `SELECT count(DISTINCT run.current_task_id)::int AS run_count,
            count(DISTINCT contract.task_id)::int AS contract_count,
            count(*) FILTER (WHERE run.impact_contract_policy='legacy_exempt')::int AS legacy_count
       FROM initiative_runs run
       LEFT JOIN harness_impact_contracts contract
         ON contract.task_id=run.current_task_id AND contract.status='active'
      WHERE run.current_task_id=ANY($1::uuid[])
        AND run.phase NOT IN ('done','failed')`,
    [tasks.map((task) => task.id)],
  );
  const evidence = result.rows[0];
  invariant(evidence.run_count === tasks.length, `Harness run coverage ${evidence.run_count}/${tasks.length}`);
  invariant(evidence.contract_count === tasks.length,
    `Impact Contract coverage ${evidence.contract_count}/${tasks.length}`);
  invariant(evidence.legacy_count === 0, `legacy_exempt=${evidence.legacy_count}`);
}

async function assertNonCodingControls(app) {
  const controls = [
    { key: 'content', mutation_intent: 'none', domain: 'content', task_type: 'content_publish', pipeline: 'content' },
    { key: 'research', mutation_intent: 'none', domain: 'research', task_type: 'research', pipeline: 'research' },
    { key: 'review', mutation_intent: 'read_only', domain: 'coding', task_type: 'code_review', pipeline: 'code_review' },
  ];
  for (const control of controls) {
    const task = await createApiTask(app, {
      title: `${titlePrefix} ${control.key} control`,
      source_id: `${sourceNamespace}:control:${control.key}`,
      mutation_intent: control.mutation_intent,
      domain: control.domain,
      task_type: control.task_type,
    });
    const receipt = await pool.query(
      'SELECT pipeline,impact_contract_required FROM work_routing_receipts WHERE task_id=$1',
      [task.id],
    );
    invariant(receipt.rows[0]?.pipeline === control.pipeline,
      `${control.key} misrouted to ${receipt.rows[0]?.pipeline}`);
    invariant(receipt.rows[0].impact_contract_required === false,
      `${control.key} unexpectedly requires Impact Contract`);
    const run = await pool.query('SELECT count(*)::int AS count FROM initiative_runs WHERE current_task_id=$1', [task.id]);
    invariant(run.rows[0].count === 0, `${control.key} unexpectedly entered Harness`);
  }
}

async function staleAndResume(app) {
  const task = await createApiTask(app, {
    title: `${titlePrefix} stale resume coding mutation`,
    source_id: `${sourceNamespace}:stale-resume`,
    mutation_intent: 'write',
    change_kind: 'bugfix',
    repo_hint: 'cecelia', map_scope_hint: mapScope, branch, base_sha: sourceRevision,
  });
  await pool.query(
    `UPDATE fact_snapshot_headers SET scanned_at=NOW()-INTERVAL '16 minutes' WHERE repo='cecelia'`,
  );
  let blockedReason = null;
  try {
    await createKernelRun(pool, {
      taskId: task.id, initiativeId: task.id, phase: 'generate', journeyId: null,
      abilityId: null, host: 'uwr-scratch-smoke', deadlineHours: 1,
      createdSource: 'kernel_dispatch',
    });
  } catch (error) {
    blockedReason = error.message;
  }
  invariant(blockedReason === 'map_stale', `stale Map did not fail closed: ${blockedReason}`);
  const absent = await pool.query('SELECT count(*)::int AS count FROM initiative_runs WHERE current_task_id=$1', [task.id]);
  invariant(absent.rows[0].count === 0, 'stale Map created a Kernel run');

  execFileSync('/bin/bash', ['scripts/scan/run-all-scans.sh'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: process.env.DB_URL,
      REPO_ROOT_CECELIA: repoRoot,
      REPO_ROOT_ZJ_WORKSPACE: '/nonexistent/uwr-smoke-zj-workspace',
      REPO_ROOT_ZJ_SKILLS: '/nonexistent/uwr-smoke-zj-skills',
      GRAPH_REPOS: 'cecelia',
      SKIP_GIT_PULL: '1',
      MAP_REBUILD_DISABLED: '1',
      FACT_SNAPSHOT_TEST_MODE: '1',
    },
  });
  await rebuildCeceliaProjection();
  await ensureKernelRuns([task]);
}

try {
  const currentDatabase = await pool.query('SELECT current_database() AS name');
  invariant(currentDatabase.rows[0].name.endsWith('_scratch'), 'driver requires a scratch database');
  await ensureScratchAssertionAnchor();
  await rebuildCeceliaProjection();
  const app = createHttpApp();

  const apiTask = await createApiTask(app, {
    title: `${titlePrefix} API coding mutation`,
    source_id: `${sourceNamespace}:api`,
    mutation_intent: 'write', change_kind: 'bugfix',
    repo_hint: 'cecelia', map_scope_hint: mapScope, branch, base_sha: sourceRevision,
  });
  const intent = await parseAndCreate('修复 Unified Work Router smoke bug', {
    createProject: false,
    createTasks: true,
    changeKind: 'bugfix',
    mapScope,
    repoHint: 'cecelia',
    repoRoot,
    sourceIdPrefix: `${sourceNamespace}:intent`,
    taskTitlePrefix: titlePrefix,
  });
  invariant(intent.created.tasks.length > 0, 'Intent did not create coding tasks');
  const captureTask = await createCaptureTask(app);
  const codingTasks = [apiTask, ...intent.created.tasks, captureTask];

  await assertRoutedCodingTasks(codingTasks, ['api', 'conversation', 'inbox']);
  await ensureKernelRuns(codingTasks);
  await assertNonCodingControls(app);
  await staleAndResume(app);

  process.stdout.write(JSON.stringify({
    status: 'PASS',
    source_revision: sourceRevision,
    branch,
    coding_tasks: codingTasks.length,
    entry_sources: ['api', 'conversation', 'inbox'],
    noncoding_controls: ['content', 'research', 'review'],
    stale_resume: true,
    impact_contract_policy: 'required',
    legacy_exempt: 0,
  }, null, 2));
  process.stdout.write('\n');
} finally {
  await pool.end();
}
