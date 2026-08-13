import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { routeWork } from './work-router.js';
import { isCanonicalTaskBranch } from './orchestrator/workspace-spec.js';

const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function repositoryRoot(repo, repositoryFacts) {
  const fact = repositoryFacts.find((candidate) => candidate.repo === repo);
  if (repo === 'cecelia' && process.env.REPO_ROOT) return process.env.REPO_ROOT;
  if (repo === 'zenithjoy-workspace' && process.env.REPO_ROOT_ZENITHJOY) {
    return process.env.REPO_ROOT_ZENITHJOY;
  }
  return fact?.path || process.cwd();
}

export async function resolveCanonicalRoutingEvidence(request, repositoryFacts) {
  const branch = request.branch ?? [
    'cp-route',
    request.source,
    createHash('sha256')
      .update(`${request.source}:${request.source_id}`)
      .digest('hex')
      .slice(0, 8),
  ].join('-');
  let baseSha = request.base_sha ?? null;
  if (!baseSha) {
    try {
      baseSha = execFileSync(
        'git',
        ['rev-parse', '--verify', 'origin/main^{commit}'],
        {
          cwd: repositoryRoot(request.repo, repositoryFacts),
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        },
      ).trim();
    } catch {
      const error = new Error('routing_evidence_unavailable');
      error.code = 'routing_evidence_unavailable';
      throw error;
    }
  }
  if (!isCanonicalTaskBranch(branch) || !GIT_SHA_PATTERN.test(baseSha)) {
    const error = new Error('routing_evidence_invalid');
    error.code = 'routing_evidence_invalid';
    throw error;
  }
  return Object.freeze({ branch, base_sha: baseSha });
}

async function loadRepositoryFacts(client) {
  const result = await client.query(
    `SELECT scope_key, repo, adapter_config
       FROM map_scope_repositories
      ORDER BY scope_key, repo`,
  );
  return result.rows.map((row) => ({
    scope_key: row.scope_key,
    repo: row.repo,
    path: row.adapter_config?.path ?? null,
    aliases: Array.isArray(row.adapter_config?.aliases) ? row.adapter_config.aliases : [],
  }));
}

export async function createRoutedTask(db, request, repositoryFacts = null, options = {}) {
  const ownsTransaction = options.transaction !== 'existing';
  const client = ownsTransaction && typeof db.connect === 'function'
    ? await db.connect()
    : db;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    const facts = repositoryFacts ?? await loadRepositoryFacts(client);
    let routedRequest = request;
    let decision = routeWork(routedRequest, facts);
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`work-route:${request.source}:${request.source_id}:${decision.router_version}`],
    );
    const existing = await client.query(
      `SELECT r.id AS routing_receipt_id, r.task_id,
              to_jsonb(r) AS persisted_receipt, t.*
         FROM work_routing_receipts r
         JOIN tasks t ON t.id = r.task_id
        WHERE r.source=$1 AND r.source_id=$2 AND r.router_version=$3`,
      [request.source, request.source_id, decision.router_version],
    );
    if (
      decision.work_kind === 'coding_mutation'
      && (!decision.evidence.branch || !decision.evidence.base_sha)
    ) {
      const persistedEvidence = existing.rows[0]?.persisted_receipt?.evidence;
      const evidence = persistedEvidence
        ? {
            branch: request.branch ?? persistedEvidence.branch,
            base_sha: request.base_sha ?? persistedEvidence.base_sha,
          }
        : await (options.resolveRoutingEvidence ?? resolveCanonicalRoutingEvidence)(
          { ...routedRequest, repo: decision.repo },
          facts,
        );
      routedRequest = { ...routedRequest, ...evidence };
      decision = routeWork(routedRequest, facts);
    }
    if (
      decision.work_kind === 'coding_mutation'
      && (
        !isCanonicalTaskBranch(decision.evidence.branch)
        || !GIT_SHA_PATTERN.test(decision.evidence.base_sha ?? '')
      )
    ) {
      const error = new Error('routing_evidence_invalid');
      error.code = 'routing_evidence_invalid';
      throw error;
    }
    const task = request.task ?? {};
    const payload = {
      ...(request.metadata || {}),
      ...(task.payload || {}),
      work_kind: decision.work_kind,
      change_kind: decision.change_kind,
      requested_task_type: request.requested_task_type ?? task.task_type ?? null,
      default_execution_profile: decision.default_execution_profile,
      execution_profile_override: decision.execution_profile_override ?? null,
      repo: decision.repo,
      map_scope: decision.map_scope,
      impact_contract_required: decision.impact_contract_required,
      ...(decision.evidence.branch ? { branch: decision.evidence.branch } : {}),
      ...(decision.evidence.base_sha ? { base_sha: decision.evidence.base_sha } : {}),
      ...(decision.pipeline === 'harness' ? {
        orchestrator: 'skill-relay',
        harness_runtime: 'kernel-v1',
      } : {}),
    };
    if (existing.rows[0]) {
      const persisted = existing.rows[0].persisted_receipt;
      const sameRoute = persisted.work_kind === decision.work_kind
        && persisted.change_kind === decision.change_kind
        && persisted.pipeline === decision.pipeline
        && persisted.canonical_task_type === decision.canonical_task_type
        && persisted.default_execution_profile === decision.default_execution_profile
        && (persisted.execution_profile_override ?? null)
          === (decision.execution_profile_override ?? null)
        && persisted.repo === decision.repo
        && JSON.stringify(persisted.map_scope) === JSON.stringify(decision.map_scope)
        && persisted.impact_contract_required === decision.impact_contract_required
        && persisted.orchestrator === decision.orchestrator
        && JSON.stringify(canonicalJson(persisted.evidence))
          === JSON.stringify(canonicalJson(decision.evidence));
      if (!sameRoute) {
        const conflict = new Error('work_route_idempotency_conflict');
        conflict.code = 'work_route_idempotency_conflict';
        throw conflict;
      }
      const persistedDecision = {
        work_kind: persisted.work_kind,
        change_kind: persisted.change_kind,
        pipeline: persisted.pipeline,
        canonical_task_type: persisted.canonical_task_type,
        default_execution_profile: persisted.default_execution_profile,
        execution_profile_override: persisted.execution_profile_override ?? null,
        repo: persisted.repo,
        map_scope: persisted.map_scope,
        impact_contract_required: persisted.impact_contract_required,
        orchestrator: persisted.orchestrator,
        router_version: persisted.router_version,
        route_reason: persisted.route_reason,
        evidence: persisted.evidence,
        decided_at: persisted.created_at,
      };
      if (ownsTransaction) await client.query('COMMIT');
      return {
        task_id: existing.rows[0].task_id,
        routing_receipt_id: existing.rows[0].routing_receipt_id,
        task: existing.rows[0],
        decision: persistedDecision,
        deduplicated: true,
      };
    }
    const taskResult = await client.query(
      `INSERT INTO tasks (
         title, description, priority, task_type, status,
         project_id, area_id, goal_id, location, payload, trigger_source,
         domain, okr_initiative_id, ability_id, blocked_at,
         tags, prd_content, execution_profile, owner_role, delivery_type,
         created_by, dept, phase, executor_kind
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,
         $16,$17,$18,$19,$20,$21,$22,$23,$24
       ) RETURNING *`,
      [
        request.title,
        request.description || null,
        task.priority ?? 'P2',
        decision.canonical_task_type,
        task.status ?? 'queued',
        task.project_id ?? null,
        task.area_id ?? null,
        task.goal_id ?? null,
        task.location ?? 'us',
        JSON.stringify(payload),
        task.trigger_source ?? request.source,
        task.domain ?? request.declared_domain ?? null,
        task.okr_initiative_id ?? null,
        task.ability_id ?? null,
        task.blocked_at ?? null,
        task.tags ?? [],
        task.prd_content ?? null,
        task.execution_profile ?? null,
        task.owner_role ?? null,
        task.delivery_type ?? 'code-only',
        task.created_by ?? null,
        task.dept ?? null,
        task.phase ?? 'dev',
        task.executor_kind ?? null,
      ],
    );
    const taskId = taskResult.rows[0].id;
    const receiptResult = await client.query(
      `INSERT INTO work_routing_receipts (task_id,source,source_id,work_kind,change_kind,pipeline,canonical_task_type,default_execution_profile,execution_profile_override,repo,map_scope,impact_contract_required,orchestrator,router_version,route_reason,evidence,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [taskId, request.source, request.source_id, decision.work_kind, decision.change_kind, decision.pipeline, decision.canonical_task_type, decision.default_execution_profile, decision.execution_profile_override ?? null, decision.repo, JSON.stringify(decision.map_scope), decision.impact_contract_required, decision.orchestrator, decision.router_version, decision.route_reason, JSON.stringify(decision.evidence), decision.decided_at],
    );
    const receiptId = receiptResult.rows[0].id;
    await client.query('UPDATE tasks SET payload = payload || $2::jsonb WHERE id=$1', [taskId, JSON.stringify({ routing_receipt_id: receiptId })]);
    await client.query(
      `INSERT INTO cecelia_events (event_type,source,payload)
       VALUES ($1,'work-router',$2::jsonb)`,
      ['work_routed', JSON.stringify({
        task_id: taskId,
        routing_receipt_id: receiptId,
        source: request.source,
        work_kind: decision.work_kind,
        change_kind: decision.change_kind,
        pipeline: decision.pipeline,
        repo: decision.repo,
        route_reason: decision.route_reason,
      })],
    );
    if (ownsTransaction) await client.query('COMMIT');
    return {
      task_id: taskId,
      routing_receipt_id: receiptId,
      task: {
        ...taskResult.rows[0],
        payload: { ...payload, routing_receipt_id: receiptId },
      },
      decision,
    };
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK');
    if (ownsTransaction) {
      try {
        await client.query(
          `INSERT INTO cecelia_events (event_type,source,payload)
           VALUES ($1,'work-router',$2::jsonb)`,
          ['work_route_blocked', JSON.stringify({
            source: request?.source ?? null,
            source_id: request?.source_id ?? null,
            reason_code: error?.code ?? error?.message ?? 'work_route_blocked',
          })],
        );
      } catch { /* 路由原错误保持权威，事件写入不得覆盖它。 */ }
    }
    throw error;
  } finally {
    if (ownsTransaction && typeof client.release === 'function') client.release();
  }
}
