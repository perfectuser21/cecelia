import { createRoutedTask as persistRoutedTask, loadRepositoryFacts } from './work-routing-store.js';
import { ROUTER_VERSION } from './work-router.js';
import { extractJsonObject } from './json-utils.js';
import { normalizeIntakeInput, candidatePrompt, validateCandidate,
  buildRoutingRequest, intakeError } from './task-intake-validation.js';

export async function loadIntakeFacts(db) {
  const repositories = await loadRepositoryFacts(db);
  const { rows } = await db.query(`SELECT DISTINCT mapping.repo, node.node_key, node.name
    FROM map_scope_repositories mapping
    JOIN map_projection_runs run ON run.scope_key=mapping.scope_key AND run.status='active'
    JOIN map_projection_nodes node ON node.run_id=run.id
    WHERE node.node_type IN ('value_stream','capability','crosscut','prerequisite','backbone','feature')
    ORDER BY mapping.repo, node.node_key`);
  return { repositories, mapNodes: rows };
}

export function createTaskIntakeList({ db }) {
  return async (query = {}, { tenantId = 'default' } = {}) => {
    const rawLimit = query.limit === undefined ? '20' : query.limit;
    if (Object.keys(query).some((key) => key !== 'limit') || typeof rawLimit !== 'string'
      || !/^[1-9][0-9]?$/.test(rawLimit) || Number(rawLimit) > 50) {
      return intakeError(400, 'invalid_intake_query');
    }
    try {
      const { rows } = await db.query(`SELECT t.id,
          COALESCE(t.payload->'intake'->>'title',t.title) AS title,
          t.status,t.created_at,t.updated_at,t.completed_at
        FROM tasks t
        WHERE t.payload->>'tenant_id'=$1 AND t.payload->'intake'->>'source'='dashboard'
          AND EXISTS (SELECT 1 FROM work_routing_receipts r WHERE r.task_id=t.id
            AND r.source='api' AND r.source_id LIKE 'dashboard:%')
        ORDER BY t.created_at DESC,t.id DESC LIMIT $2`, [tenantId, Number(rawLimit)]);
      return { status: 200, body: { tasks: rows } };
    } catch { return intakeError(503, 'intake_storage_unavailable'); }
  };
}

async function existingReceipt(db, input) {
  const { rows } = await db.query(`SELECT t.id, t.title, t.status, t.payload
    FROM work_routing_receipts r JOIN tasks t ON t.id=r.task_id
    WHERE r.source=$1 AND r.source_id=$2
      AND t.payload->>'tenant_id'=$3
    ORDER BY r.anchor_generation DESC, r.created_at DESC LIMIT 1`,
  ['api', input.routingSourceId, input.tenantId]);
  if (!rows[0]) return null;
  if (rows[0].payload?.intake?.fingerprint !== input.fingerprint) return intakeError(409, 'source_id_conflict');
  return createdResponse(rows[0], input.source_id, true);
}

function createdResponse(task, sourceId, deduplicated) {
  return { status: deduplicated ? 200 : 201, body: {
    outcome: 'created', source_id: sourceId, task_id: task.id,
    task: { id: task.id, title: task.payload?.intake?.title ?? task.title, status: task.status }, deduplicated,
  } };
}

export function createTaskIntake({ db, callLLM, loadFacts = loadIntakeFacts,
  createRoutedTask = persistRoutedTask }) {
  return async function taskIntake(body, { tenantId = 'default' } = {}) {
    const input = normalizeIntakeInput(body, tenantId);
    if (!input) return intakeError(400, 'invalid_intake_request');
    let facts;
    try {
      const existing = await existingReceipt(db, input);
      if (existing) return existing;
      facts = await loadFacts(db);
    } catch { return intakeError(503, 'intake_storage_unavailable'); }

    let output;
    try {
      output = await callLLM('thalamus', candidatePrompt(input, facts), { timeout: 30000, maxTokens: 2000 });
    } catch { return intakeError(503, 'model_unavailable'); }
    const candidate = typeof output?.text === 'string' ? extractJsonObject(output.text) : null;
    const validation = validateCandidate(candidate, input, facts);
    if (validation.error) return intakeError(502, validation.error);
    if (validation.unsupported) return intakeError(422, 'unsupported_execution');
    if (validation.clarify) return { status: 200, body: {
      outcome: 'clarification_required', source_id: input.source_id, task_id: null,
      questions: validation.questions,
    } };

    let client;
    let transactionStarted = false;
    let releaseError;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      transactionStarted = true;
      // 与 createRoutedTask 的事务锁完全一致，模型调用不占数据库事务。
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`work-route:api:${input.routingSourceId}:${ROUTER_VERSION}`]);
      const existing = await existingReceipt(client, input);
      if (existing) {
        await client.query('COMMIT');
        return existing;
      }
      const result = await createRoutedTask(client, buildRoutingRequest(validation.candidate, input),
        facts.repositories, { transaction: 'existing' });
      if (!result.task_id || !result.routing_receipt_id || result.task?.id !== result.task_id) {
        throw new Error('intake_receipt_missing');
      }
      await client.query('COMMIT');
      return createdResponse(result.task, input.source_id, Boolean(result.deduplicated));
    } catch {
      if (transactionStarted) {
        try { await client.query('ROLLBACK'); } catch (error) { releaseError = error; }
      }
      return intakeError(503, 'intake_storage_unavailable');
    } finally { client?.release(releaseError); }
  };
}
