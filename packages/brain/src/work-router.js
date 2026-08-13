export const CHANGE_KINDS = Object.freeze(['new_capability', 'capability_change', 'bugfix', 'parameter_only']);
export const ROUTER_VERSION = 'work-router-v1';
const SOURCES = new Set(['inbox', 'conversation', 'api', 'thalamus', 'discovery', 'scheduler', 'child']);
const MUTATIONS = new Set(['write', 'read_only', 'none', 'unknown']);
const PROFILES = Object.freeze({
  new_capability: 'new-capability-v1',
  capability_change: 'capability-change-v1',
  bugfix: 'hotfix-v1',
  parameter_only: 'parameter-only-v1',
});
const PROFILE_STRENGTH = Object.freeze({
  'parameter-only-v1': 0,
  'hotfix-v1': 0,
  'capability-change-v1': 1,
  'new-capability-v1': 2,
});
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;

function normalizeRepoHint(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const github = trimmed.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
  );
  return github?.[1] ?? trimmed;
}

export function normalizeWorkRequest(input = {}) {
  const request = { ...input };
  if (!SOURCES.has(request.source)) throw new Error('invalid_source');
  if (!request.source_id || !request.title) throw new Error('work_request_required_fields');
  if (!MUTATIONS.has(request.mutation_intent)) throw new Error('invalid_mutation_intent');
  if (request.declared_change_kind != null && !CHANGE_KINDS.includes(request.declared_change_kind)) throw new Error('invalid_change_kind');
  if (request.base_sha != null && !GIT_SHA_PATTERN.test(request.base_sha)) {
    throw new Error('invalid_base_sha');
  }
  if (request.decided_at != null && !Number.isFinite(Date.parse(request.decided_at))) {
    throw new Error('invalid_decided_at');
  }
  if (request.map_scope_hint != null && (
    !Array.isArray(request.map_scope_hint)
    || request.map_scope_hint.some((item) => typeof item !== 'string' || item.trim().length === 0)
  )) {
    throw new Error('invalid_map_scope');
  }
  request.map_scope_hint = [...new Set((request.map_scope_hint ?? []).map((item) => item.trim()))].sort();
  request.repo_hint = normalizeRepoHint(request.repo_hint);
  return request;
}

export function classifyWork(request) {
  if (request.mutation_intent === 'write' || request.mutation_intent === 'unknown') return 'coding_mutation';
  if (request.declared_domain === 'content') return 'content_creation';
  if (request.declared_domain === 'research') return 'research';
  if (request.declared_domain === 'operations') return 'operations';
  return 'coding_review';
}

export function resolveRepo(request, repositoryFacts = []) {
  const hint = normalizeRepoHint(request.repo_hint);
  const matches = repositoryFacts.filter((fact) => (
    fact.repo === hint
    || fact.path === hint
    || fact.aliases?.includes(hint)
  ));
  if (matches.length !== 1) throw new Error('repo_unknown');
  return matches[0].repo;
}

export function selectPipeline(input) {
  if (input.work_kind === 'coding_mutation') {
    if (!input.change_kind) throw new Error('change_kind_required');
    if (!CHANGE_KINDS.includes(input.change_kind)) throw new Error('invalid_change_kind');
    const defaultProfile = PROFILES[input.change_kind];
    const override = input.execution_profile_override_request ?? null;
    if (override != null) {
      if (!(override in PROFILE_STRENGTH)) throw new Error('invalid_execution_profile_override');
      if (PROFILE_STRENGTH[override] < PROFILE_STRENGTH[defaultProfile]) {
        throw new Error('execution_profile_downgrade_forbidden');
      }
    }
    return { work_kind: input.work_kind, change_kind: input.change_kind, pipeline: 'harness', canonical_task_type: 'harness_initiative', default_execution_profile: defaultProfile, execution_profile_override: override, impact_contract_required: true, orchestrator: 'kernel-harness-v2' };
  }
  const nonCoding = {
    content_creation: ['content', 'content-pipeline'],
    research: ['research', 'research'],
    coding_review: ['code_review', 'code_review'],
    operations: ['operations', 'data'],
  }[input.work_kind];
  if (!nonCoding) throw new Error('unsupported_work_kind');
  const requestedTaskType = input.requested_task_type;
  if (requestedTaskType != null && !/^[a-z][a-z0-9_-]*$/.test(requestedTaskType)) {
    throw new Error('invalid_requested_task_type');
  }
  return { work_kind: input.work_kind, change_kind: null, pipeline: nonCoding[0], canonical_task_type: requestedTaskType ?? nonCoding[1], default_execution_profile: null, impact_contract_required: false, orchestrator: nonCoding[0] };
}

export function routeWork(input, repositoryFacts = []) {
  const request = normalizeWorkRequest(input);
  const work_kind = classifyWork(request);
  const repo = work_kind === 'coding_mutation' ? resolveRepo(request, repositoryFacts) : null;
  return {
    ...selectPipeline({
      work_kind,
      change_kind: request.declared_change_kind,
      requested_task_type: request.requested_task_type,
      execution_profile_override_request: request.execution_profile_override_request,
    }),
    repo,
    map_scope: request.map_scope_hint || [],
    router_version: ROUTER_VERSION,
    route_reason: `mutation_intent:${request.mutation_intent}`,
    evidence: {
      source: request.source,
      ...(request.branch ? { branch: request.branch } : {}),
      ...(request.base_sha ? { base_sha: request.base_sha } : {}),
    },
    decided_at: new Date(request.decided_at ?? Date.now()).toISOString(),
  };
}
