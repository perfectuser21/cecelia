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

export function normalizeWorkRequest(input = {}) {
  const request = { ...input };
  if (!SOURCES.has(request.source)) throw new Error('invalid_source');
  if (!request.source_id || !request.title) throw new Error('work_request_required_fields');
  if (!MUTATIONS.has(request.mutation_intent)) throw new Error('invalid_mutation_intent');
  if (request.declared_change_kind != null && !CHANGE_KINDS.includes(request.declared_change_kind)) throw new Error('invalid_change_kind');
  return request;
}

export function classifyWork(request) {
  if (request.mutation_intent === 'write' || request.mutation_intent === 'unknown') return 'coding_mutation';
  return request.declared_domain === 'content' ? 'content_creation' : request.declared_domain === 'research' ? 'research' : 'coding_review';
}

export function resolveRepo(request, repositoryFacts = []) {
  const hint = request.repo_hint;
  const matches = repositoryFacts.filter(f => f.repo === hint || f.path === hint);
  if (hint && matches.length === 0 && repositoryFacts.length === 0 && /^[\w.-]+\/[\w.-]+$/.test(hint)) return hint;
  if (matches.length !== 1) throw new Error('repo_unknown');
  return matches[0].repo;
}

export function selectPipeline(input) {
  if (input.work_kind === 'coding_mutation') {
    if (!input.change_kind) throw new Error('change_kind_required');
    if (!CHANGE_KINDS.includes(input.change_kind)) throw new Error('invalid_change_kind');
    return { work_kind: input.work_kind, change_kind: input.change_kind, pipeline: 'harness', canonical_task_type: 'harness_initiative', default_execution_profile: PROFILES[input.change_kind], impact_contract_required: true, orchestrator: 'kernel-harness-v2' };
  }
  const nonCoding = { content_creation: ['content', 'content_publish'], research: ['research', 'research'], coding_review: ['code_review', 'code_review'] }[input.work_kind];
  if (!nonCoding) throw new Error('unsupported_work_kind');
  return { work_kind: input.work_kind, change_kind: null, pipeline: nonCoding[0], canonical_task_type: nonCoding[1], default_execution_profile: null, impact_contract_required: false, orchestrator: nonCoding[0] };
}

export function routeWork(input, repositoryFacts = []) {
  const request = normalizeWorkRequest(input);
  const work_kind = classifyWork(request);
  const repo = work_kind === 'coding_mutation' ? resolveRepo(request, repositoryFacts) : null;
  return { ...selectPipeline({ work_kind, change_kind: request.declared_change_kind }), repo, map_scope: request.map_scope_hint || [], router_version: ROUTER_VERSION, route_reason: `mutation_intent:${request.mutation_intent}`, evidence: { source: request.source } };
}
