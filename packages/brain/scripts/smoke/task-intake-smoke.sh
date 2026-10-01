#!/usr/bin/env bash
# 真HTTP+真实PostgreSQL+原生WorkRouter；只注入确定候选，不调用生产模型。
set -euo pipefail
cd "$(dirname "$0")/../.."
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createIntakeTestDatabase } from './src/__tests__/fixtures/task-intake-db.js';
import { createTaskIntake } from './src/task-intake.js';
import { createTaskIntakeRouter } from './src/routes/task-intake.js';
const fixture = await createIntakeTestDatabase();
let server;
try {
  const text = '修复 Cecelia 接单重复创建任务的问题';
  const source_id = `smoke-${randomUUID()}`;
  const intake = createTaskIntake({ db: fixture.pool, callLLM: async () => ({ text: JSON.stringify({
    intent: 'coding_change', title: '修复接单重复创建', objective: text, mutation_intent: 'write',
    change_kind: 'bugfix', repo: 'cecelia', map_scope: ['F1'], confidence: 0.98, evidence: [text], questions: [],
  }) }) });
  const app = express().use(express.json()).use('/api/brain/task-intake', createTaskIntakeRouter({ intake }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const endpoint = `http://127.0.0.1:${server.address().port}/api/brain/task-intake`;
  const post = () => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source_id }) });
  const first = await post();
  assert.equal(first.status, 201);
  const created = await first.json();
  const persisted = (await fixture.pool.query(`SELECT t.id,t.task_type,t.payload,r.id AS receipt_id,
    r.map_scope,r.work_kind FROM tasks t JOIN work_routing_receipts r ON r.task_id=t.id WHERE t.id=$1`,
  [created.task_id])).rows[0];
  assert.equal(persisted.task_type, 'harness_initiative');
  assert.equal(persisted.payload.routing_receipt_id, persisted.receipt_id);
  assert.deepEqual(persisted.map_scope, ['F1']);
  const second = await post();
  assert.equal(second.status, 200);
  assert.equal((await second.json()).task_id, persisted.id);
  console.log(JSON.stringify({ ok: true, database: fixture.database, schema: fixture.schema,
    task_id: persisted.id, routing_receipt_id: persisted.receipt_id, task_type: persisted.task_type }));
} finally {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fixture.close();
}
NODE
