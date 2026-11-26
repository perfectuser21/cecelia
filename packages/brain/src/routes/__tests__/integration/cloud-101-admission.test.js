import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import express from 'express';
import pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { DB_DEFAULTS } from '../../../db-config.js';
import { evidenceHash } from '../../../lib/release-index.js';
import { createCloud101AdmissionRouter } from '../../cloud-101-admission.js';

const [runId, taskId, bindingId, releaseId, observationId, reviewId, devId, workflowId,
  versionId, taskRunId] = Array.from({ length: 10 }, () => randomUUID());
const originalId = '0874e3fc-b7c2-46a6-b97e-cdc1264a693c';
const source = 'a'.repeat(40);
const profileHash = 'b'.repeat(64);
const repo = 'perfectuser21/zenithjoy-workspace';
const device = '47.100.213.173:10001';
const profile = 'cloud-phone-test';
const token = 'fixture-internal-token';
const environment = `staging:${source}`;
const components = [{ kind: 'repo', repo, revision: source }];
const manifestHash = 'c'.repeat(64);
const observationHash = 'd'.repeat(64);
const activities = { open: { reference_id: randomUUID(), activity_id: randomUUID(), activity_definition_version_id: randomUUID() } };
const audit = { path: 'fixture:audit', sha256: 'e'.repeat(64), verdict: 'pass' };
const receipt = { protocol: 'cloud-101-epoch-source-compatibility/v1', business_run_id: runId,
  original_record_sha256: profileHash, actor: 'reviewer', serial: device, instance_id: 'mmv-cloud-epoch2',
  candidate_runtime_source: { commit: source }, release_id: releaseId, observation_id: observationId,
  candidate_manifest_sha256: profileHash, candidate_release_manifest_sha256: manifestHash, evidence_refs: [audit.path], private_receipt_data: 'omitted' };
const scope = { task_id: taskId, binding_id: bindingId, release_id: releaseId, observation_id: observationId,
  device_name: device, profile, profile_sha256: profileHash, source_commit: source,
  original_task_id: originalId, review_task_id: reviewId };
const schema = `cloud_101_${randomUUID().replaceAll('-', '')}`;
const options = process.env.TEST_DATABASE_URL ? { connectionString: process.env.TEST_DATABASE_URL } : DB_DEFAULTS;
let admin, pool, server, base;

function seedTask(id, status, type, parent, payload, result, claimedBy = null) {
  return pool.query('INSERT INTO tasks VALUES ($1,$2,$3,$4,$5,$6,$7,now())', [id, status, type, parent, payload, result, claimedBy]);
}

beforeAll(async () => {
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', token);
  admin = new pg.Pool(options);
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({ ...options, max: 8, options: `-c search_path=${schema}` });
  await pool.query(`CREATE TABLE schema_version(version text PRIMARY KEY, description text);
    CREATE TABLE tasks(id uuid PRIMARY KEY,status text,task_type text,parent_task_id uuid,payload jsonb,result jsonb,claimed_by text,claimed_at timestamptz);
    CREATE TABLE workflow_definition_versions(id uuid PRIMARY KEY,workflow_id uuid,payload jsonb,UNIQUE(workflow_id,id));
    CREATE TABLE task_runs(id uuid PRIMARY KEY,task_id uuid,run_id text,workflow_id uuid,status text,ended_at timestamptz);
    CREATE TABLE device_locks(device_name text PRIMARY KEY,locked_by text,locked_at timestamptz,expires_at timestamptz);`);
  await pool.query(readFileSync(new URL('../../../../migrations/515_release_definition_evidence.sql', import.meta.url), 'utf8'));
  await pool.query('INSERT INTO workflow_definition_versions VALUES ($1,$2,$3)', [versionId, workflowId, { key: 'douyin_video_discovery' }]);
  await pool.query("INSERT INTO task_runs VALUES ($1,$2,$3,$4,'running',NULL)", [taskRunId, taskId, runId, workflowId]);
  await pool.query("INSERT INTO device_locks VALUES ($1,$2,now(),now()+interval '5 minutes')", [device, taskId]);
  await seedTask(taskId, 'in_progress', 'automation', null, { profile, serial: device, source_commit: source }, {
    common_runner: { run_id: runId, task_id: taskId, mode: 'formal', machine_id: 'us-mac-m4', profile_sha256: profileHash,
      run_binding: { run_binding_id: bindingId, workflow_id: workflowId, workflow_definition_version_id: versionId,
        attempt_key: 'attempt-1', activities }, private_runner_data: 'omitted' },
  }, 'common-runner');
  await seedTask(originalId, 'blocked', 'automation', null, {}, { execution_stopped: false });
  await seedTask(devId, 'completed', 'dev', null, {}, { merge_sha: source, ship_candidate: {
    schema_version: 1, stage: 'candidate', task_id: devId, repo, head_sha: 'b'.repeat(40), actor: 'developer',
  } });
  await seedTask(reviewId, 'completed', 'research', devId, { work_kind: 'epoch_source_compatibility_review', reviewer: 'reviewer',
    business_run_id: runId, candidate_source_commit: source, original_record_sha256: profileHash, development_task_id: devId },
  { actor: 'reviewer', audit_evidence: audit, epoch_source_compatibility: receipt });
  await pool.query("INSERT INTO release_versions VALUES ($1,'release',$2,$2,$3,'mmv','fixture',$4,now())", [releaseId, manifestHash,
    environment, { verification: { status: 'verified', ci_status: 'verified' }, components, private_manifest_data: 'omitted' }]);
  await pool.query("INSERT INTO release_observations VALUES ($1,$2,'observation','attempt-1',$3,$4,'fixture','fixture:observation',now(),now())", [
    observationId, releaseId, observationHash, { environment, target: 'mmv', components, private_observation_data: 'omitted' }]);
  await pool.query(`INSERT INTO run_definition_bindings VALUES ($1,$2,$3,$4,$5,$6,$7,'[]','internal',$8,NULL,
    'attempt-1','fixture',$7,$9,now())`, [bindingId, runId, releaseId, observationId, workflowId, versionId, profileHash,
    taskRunId, { runtime_snapshot_sha256: profileHash }]);
  const app = express();
  app.use('/api/brain/cloud-101-admission', createCloud101AdmissionRouter({ pool }));
  app.use('/api/brain', (_req, res) => res.sendStatus(429));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/brain`;
}, 15000);

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool?.end();
  await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin?.end();
  vi.unstubAllEnvs();
});

function read(query = {}, { authenticated = true, run = runId, method = 'GET' } = {}) {
  const search = new URLSearchParams({ ...scope, ...query });
  return fetch(`${base}/cloud-101-admission/${run}?${search}`, { method,
    headers: authenticated ? { Authorization: `Bearer ${token}` } : {} });
}

it('authenticates before exposing the scope, with no loopback fallback or write method', async () => {
  expect((await read({ extra: 'bad' }, { authenticated: false })).status).toBe(401);
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', '');
  expect((await read()).status).toBe(503);
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', token);
  expect((await read({}, { method: 'POST' })).status).toBe(405);
  expect((await read({ extra: 'bad' })).status).toBe(400);
  expect((await read({ device_name: '127.0.0.1:5555' })).status).toBe(400);
  expect((await read({ original_task_id: randomUUID() })).status).toBe(400);
  expect((await read({}, { run: randomUUID() })).status).toBe(409);
  expect((await read({ observation_id: randomUUID() })).status).toBe(409);
});

it('returns compact authority and sees subsequent lease, TaskRun, review and deployment changes', async () => {
  const response = await read();
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(body).toMatchObject({ protocol: 'cloud-101-admission-snapshot/v1', task: { id: taskId, result: { common_runner: { run_binding: { activities } } } },
    binding: { id: bindingId }, links: { task_id: taskId, task_run_id: taskRunId }, taskRun: { status: 'running' },
    central: { device_name: device, locked_by: taskId, expired: false }, originalTask: { id: originalId },
    compatibilityReview: { id: reviewId, result: { epoch_source_compatibility_sha256: evidenceHash(receipt) } },
    compatibilityDevelopment: { id: devId }, compatibilityRelease: { release_id: releaseId, observation_id: observationId,
      manifest_sha256: manifestHash, observation_payload_sha256: observationHash, release_components_sha256: evidenceHash(components),
      observation_components_sha256: evidenceHash(components), gate: { deployed: true, actual_matches: true, gaps: [] } } });
  expect(JSON.stringify(body)).not.toContain('omitted');
  await pool.query("UPDATE device_locks SET expires_at=now()-interval '1 second'");
  expect((await read()).status).toBe(409);
  await pool.query("UPDATE device_locks SET expires_at=now()+interval '5 minutes'");
  const resumed = await (await read()).json();
  expect(resumed.central.lease_version).not.toBe(body.central.lease_version);
  await pool.query("UPDATE task_runs SET ended_at=now() WHERE id=$1", [taskRunId]);
  expect((await read()).status).toBe(409);
  await pool.query('UPDATE task_runs SET ended_at=NULL WHERE id=$1', [taskRunId]);
  await pool.query("UPDATE tasks SET status='blocked' WHERE id=$1", [reviewId]);
  expect((await read()).status).toBe(409);
  await pool.query("UPDATE tasks SET status='completed' WHERE id=$1", [reviewId]);
  await pool.query("UPDATE tasks SET result='{\"execution_stopped\":true}' WHERE id=$1", [originalId]);
  expect((await read()).status).toBe(409);
  await pool.query("UPDATE tasks SET result='{\"execution_stopped\":false}' WHERE id=$1", [originalId]);
});

it.skipIf(process.env.CLOUD_101_ADMISSION_LOAD !== '1')('serves 320 snapshots paced at 15 per second', async () => {
  await new Promise(resolve => setTimeout(resolve, 1100));
  const start = performance.now();
  const requests = Array.from({ length: 320 }, (_, index) => new Promise(resolve => {
    setTimeout(async () => {
      const sent = performance.now();
      try {
        const response = await read();
        const body = await response.text();
        resolve({ status: response.status, ms: performance.now() - sent, bytes: Buffer.byteLength(body) });
      } catch (error) {
        resolve({ error: error.code ?? error.message });
      }
    }, index * 1000 / 15);
  }));
  const results = await Promise.all(requests);
  expect(results.filter(result => result.status !== 200)).toEqual([]);
  const latencies = results.map(result => result.ms).sort((a, b) => a - b);
  console.log('Cloud 101 HTTP/PostgreSQL load', { requests: results.length, seconds: (performance.now() - start) / 1000,
    p95Ms: latencies[Math.ceil(results.length * 0.95) - 1], maxMs: latencies.at(-1), responseBytes: results[0].bytes });
}, 30000);

it('keeps ordinary traffic in its existing limiter and caps snapshot traffic separately', async () => {
  await new Promise(resolve => setTimeout(resolve, 1100));
  expect((await fetch(`${base}/normal`)).status).toBe(429);
  for (let n = 0; n < 20; n++) expect((await read({}, { authenticated: false })).status).toBe(401);
  for (let n = 0; n < 24; n++) expect((await read()).status).toBe(200);
  const limited = await read();
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: 'CLOUD_101_ADMISSION_RATE_LIMIT' });
  await pool.query("INSERT INTO release_observations VALUES ($1,$2,'new-observation','attempt-2',$3,$4,'fixture','fixture:drift',now(),now())", [
    randomUUID(), releaseId, observationHash, { environment, target: 'mmv', components }]);
  await new Promise(resolve => setTimeout(resolve, 1100));
  expect((await read()).status).toBe(409);
});

it('bounds attempts before authentication without sharing the authenticated capacity counter', async () => {
  await new Promise(resolve => setTimeout(resolve, 1100));
  for (let n = 0; n < 48; n++) expect((await read({}, { authenticated: false })).status).toBe(401);
  const limited = await read({}, { authenticated: false });
  expect(limited.status).toBe(429);
  expect(limited.headers.get('cache-control')).toBe('no-store');
  expect(await limited.json()).toEqual({ error: 'CLOUD_101_ADMISSION_AUTH_RATE_LIMIT' });
});
