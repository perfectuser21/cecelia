import { afterEach, expect, it } from 'vitest';
import { parse } from 'acorn';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';
import serverSource from '../../../server.js?raw';
import releaseWorkflowSource from '../../../../../.github/workflows/pilot-release-verification.yml?raw';
import { createWorkflowCommanderRouter } from '../../routes/workflow-commander.js';
import { TASK_CREATION_INVENTORY } from '../../task-creation-inventory.js';
import { prepareCommander } from '../../lib/commander-v2-dispatch.js';
import { createRelease, recordReleaseObservation } from '../../lib/release-index.js';
import { releaseEvidenceDatabase } from '../fixtures/release-evidence-db.js';

let fixture;
const roots = [], originalToken = process.env.CECELIA_INTERNAL_TOKEN;
afterEach(async () => {
  await fixture?.close(); fixture = null;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (originalToken === undefined) delete process.env.CECELIA_INTERNAL_TOKEN;
  else process.env.CECELIA_INTERNAL_TOKEN = originalToken;
});
function mountedEndpoint() {
  const ast = parse(serverSource, { ecmaVersion: 'latest', sourceType: 'module' });
  const source = ast.body.find(node => node.type === 'ImportDeclaration' && node.source.value === './src/routes/workflow-commander.js');
  const builder = source?.specifiers.find(node => node.imported?.name === 'createWorkflowCommanderRouter')?.local.name;
  expect(builder).toBeTruthy();
  const mounts = ast.body.filter(node => node.type === 'ExpressionStatement').map(node => node.expression)
    .filter(node => node.type === 'CallExpression' && node.callee.object?.name === 'app' && node.callee.property?.name === 'use'
      && node.arguments[1]?.type === 'CallExpression' && node.arguments[1].callee.name === builder);
  expect(mounts).toHaveLength(1);
  expect(mounts[0].arguments[1].arguments.map(node => node.name)).toEqual(['pool']);
  expect(mounts[0].arguments[0].value).toBe('/api/brain/workflow-commander');
  return mounts[0].arguments[0].value;
}
it('正式server挂载的HTTP回调鉴权后写真实运行事件，重放不重复，旧owner零写入', async () => {
  fixture = await releaseEvidenceDatabase(); const db = fixture.db;
  await db.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result jsonb,ADD COLUMN IF NOT EXISTS task_type text,ADD COLUMN IF NOT EXISTS claimed_by text,ADD COLUMN IF NOT EXISTS claimed_at timestamptz,ADD COLUMN IF NOT EXISTS executor_kind text');
  await db.query(readFileSync(new URL('../../../migrations/268_task_events.sql', import.meta.url), 'utf8'));
  const release = (await createRelease(db, fixture.releaseInput)).release;
  const observation = (await recordReleaseObservation(db, release.id, fixture.observationInput, { trustedCollector: 'fixture-collector' })).observation;
  const definition = fixture.runInput(release, observation); delete definition.source_kind; delete definition.external_origin;
  const contract = { key: 'report', input_schema: { type: 'object' }, resources: {}, recovery: { max_attempts: 1, total_timeout_sec: 1200, cleanup_timeout_sec: 60, retry_safe: false } };
  const id = randomUUID();
  await db.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,'报告正式回调','queued','workflow_dispatch',$2)", [id, { commander_protocol: 'commander-v2', workflow_key: 'report', workflow_input: {}, workflow_definition: definition }]);
  await prepareCommander(db, id, { frozenContract: async () => ({ definition, contract }), ready: async envelope => ({ protocol: 'commander-v2', ready: true, ...envelope.definition }) });
  const row = (await db.query('SELECT result FROM tasks WHERE id=$1', [id])).rows[0];
  const envelope = row.result.workflow_control.envelope;
  const event = { protocol: envelope.protocol, run_id: envelope.run_id, attempt: envelope.attempt, owner_epoch: envelope.owner_epoch, seq: 1, type: 'started', data: { session: 'http-child' } };
  process.env.CECELIA_INTERNAL_TOKEN = 'fixture-http-only';
  const app = express(), mount = mountedEndpoint(); app.use(mount, createWorkflowCommanderRouter(db));
  const endpoint = `${mount}/tasks/${id}/events`;
  const events = async () => (await db.query("SELECT payload FROM task_events WHERE task_id=$1 AND event_type='commander_feedback'", [id])).rows;
  expect((await request(app).post(endpoint).send(event)).status).toBe(401);
  expect(await events()).toHaveLength(0);
  const send = body => request(app).post(endpoint).set('X-Internal-Token', 'fixture-http-only').send(body);
  expect((await send(event)).status).toBe(200);
  expect((await send(event)).body.duplicate).toBe(true);
  expect(await events()).toHaveLength(1);
  expect((await db.query('SELECT result FROM tasks WHERE id=$1', [id])).rows[0].result.workflow_control.last_seq).toBe(1);
  expect((await send({ ...event, seq: 2, owner_epoch: 0 })).status).toBe(409);
  expect(await events()).toHaveLength(1);
  expect(TASK_CREATION_INVENTORY.filter(item => item.module === 'lib/commander-v2-control.js')).toEqual([
    { module: 'lib/commander-v2-control.js', source: 'scheduler', creates_executable_task: true, migration_status: 'routed' },
  ]);
});
it('实际发布workflow前置脚本接受登记scope，拒绝跨仓、未知scope和非当前main', () => {
  const workflow = yaml.load(releaseWorkflowSource), job = workflow.jobs.snapshot;
  expect(job.if).toBe("github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')");
  expect(workflow.jobs.verify.needs).toBe('snapshot');
  const root = mkdtempSync(join(tmpdir(), 'commander-pilot-guard-')); roots.push(root);
  writeFileSync(join(root, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$FIXTURE_MAIN"\n', { mode: 0o700 });
  const sha = 'a'.repeat(40), repo = 'perfectuser21/zenithjoy-workspace';
  const run = extra => spawnSync('bash', ['-c', job.steps[0].run], { env: { PATH: `${root}:/usr/bin:/bin`, SOURCE_REPO: repo, CALLER_REPO: repo, HEAD: sha, CALLER_SHA: sha, MAP_SCOPE: 'commander-generic', FIXTURE_MAIN: sha, ...extra }, encoding: 'utf8' });
  expect(run({}).status).toBe(0);
  for (const extra of [{ MAP_SCOPE: 'unregistered' }, { CALLER_REPO: 'elsewhere/repo' }, { CALLER_SHA: 'b'.repeat(40) }, { FIXTURE_MAIN: 'b'.repeat(40) }]) expect(run(extra).status).not.toBe(0);
});
