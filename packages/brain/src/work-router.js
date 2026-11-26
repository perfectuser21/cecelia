import {assertActiveDevelopmentTask} from './lib/task-type-registry.js';
import {assertLinuxPoolAuthority} from './linux-pool/task-authority.js';
import {assertAppServerAuthority} from './app-server/task-authority.js';
import { assertJanitorAuthority } from './janitor-authority.js';
import { isHeadedManual } from './lib/dispatch-route.js';
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

export function normalizeRepoHint(value) {
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

// ── 四格路由两轴(Crystal 件1,决策 ca9f3d7b/28ca1f69)────────────────────
// 轴1 artifact_kind:code(交付=PR)| execution(交付=run)。
// 案卷:09-05/06 execution/meta 类工作被塞进 kernel 线,遭三种确定性杀手绞杀 0/7。
export const ARTIFACT_KINDS = Object.freeze(['code', 'execution']);
const EXECUTION_MARKERS = Object.freeze(['tenant_id', 'device_id', 'canvas', 'workflow']);
const EXPLORE_WORDS = /(探索|调研|不知道|先跑|看看再|spike)/i;

export function classifyArtifactKind(request = {}) {
  if (request.artifact_kind != null) {
    if (!ARTIFACT_KINDS.includes(request.artifact_kind)) throw new Error('invalid_artifact_kind');
    return request.artifact_kind; // 显式声明优先
  }
  const payload = request.payload ?? {};
  // intake 会给所有任务默认注入 tenant_id:'default'(30 任务回放实证),
  // 只有"真租户"才是执行标记;device/canvas/workflow 无默认注入,存在即标记。
  const marked = (k) => {
    const v = payload[k] ?? request[k];
    if (v == null) return false;
    if (k === 'tenant_id' && v === 'default') return false;
    return true;
  };
  if (EXECUTION_MARKERS.some(marked)) return 'execution';
  return 'code'; // repo/分支标记与默认都归 code(左列老路)
}

// 轴2 answer_known:答案现在说得出来吗?显式 > change_kind 语义 > 探索词 > 默认 true。
// (LLM 一次调用判定留给后续增量——intake 是同步热路径,不加外呼。)
export function classifyAnswerKnown(request = {}) {
  if (typeof request.answer_known === 'boolean') return request.answer_known;
  const kind = request.declared_change_kind ?? request.change_kind;
  if (kind === 'bugfix' || kind === 'parameter_only') return true; // 已诊断/机械改
  const text = `${request.description ?? ''} ${request.title ?? ''}`;
  if (EXPLORE_WORDS.test(text)) return false;
  return true;
}

export function classifyWork(request) {
  if (request.mutation_intent === 'write' || request.mutation_intent === 'unknown') return 'coding_mutation';
  // 业务实现由外部owner执行；这里只保留统一工作单入口，不恢复内容引擎。
  if (request.requested_task_type === 'content-pipeline') return 'operations';
  if (request.declared_domain === 'content') throw new Error('unsupported_work_kind');
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

// 有头开发记账交当前会话；其余用户开发请求交普通Codex Agent。
const HEADLESS_ENTRY_STATUSES = new Set(['queued', 'blocked']);

export function isHeadedLedgerRequest(request = {}) {
  const payload = { ...(request.metadata || {}), ...(request.task?.payload || {}) };
  if (isHeadedManual(payload)) return true;
  if (!HEADLESS_ENTRY_STATUSES.has(request.task?.status ?? 'queued')) return true;
  return request.task?.executor_kind === 'headed-session';
}

const AGENT_DEVELOPMENT_REPOS = new Set(['cecelia', 'perfectuser21/cecelia', 'zenithjoy-workspace', 'perfectuser21/zenithjoy-workspace']);

export function selectPipeline(input) {
  const axes = {
    artifact_kind: input.artifact_kind ?? 'code',
    answer_known: input.answer_known ?? true,
  };
  // 【核心回归防线】execution 类永不进 kernel-harness-v2(meta 三杀手案卷):
  // 交付物是一次 run 而非 PR,impact 锚/验证钟/装配层对它全是错的尺子。
  // v1 落点:pipeline=canvas,canonical=exploratory(既有枚举,语义=先跑),
  // 无自动执行体认领 → 停在 queued 供画布线/人工 claim,胜于确定性绞杀。
  if (input.work_kind === 'coding_mutation' && axes.artifact_kind === 'execution') {
    return {
      work_kind: input.work_kind,
      change_kind: input.change_kind ?? null,
      pipeline: 'canvas',
      canonical_task_type: 'exploratory',
      default_execution_profile: null,
      execution_profile_override: null,
      impact_contract_required: false,
      orchestrator: 'canvas-v4',
      ...axes,
    };
  }
  if (input.work_kind === 'coding_mutation') {
    if (!input.change_kind) throw new Error('change_kind_required');
    if (!CHANGE_KINDS.includes(input.change_kind)) throw new Error('invalid_change_kind');
    const defaultProfile = PROFILES[input.change_kind];
    const override = input.execution_profile_override_request ?? null;
    if (override != null) {
      if (!(override in PROFILE_STRENGTH)) throw new Error('invalid_execution_profile_override');
      if (
        override !== defaultProfile
        && PROFILE_STRENGTH[override] <= PROFILE_STRENGTH[defaultProfile]
      ) {
        throw new Error('execution_profile_downgrade_forbidden');
      }
    }
    if (input.headed === true) {
      // 有头开发由当前会话执行，使用通用dev账本，不交给Runner或旧编排器。
      return { work_kind: input.work_kind, change_kind: input.change_kind, pipeline: 'headed_development', canonical_task_type: 'dev', default_execution_profile: defaultProfile, execution_profile_override: override, impact_contract_required: true, orchestrator: 'headed-session', ...axes };
    }
    // 用户开发请求由现役Codex Agent执行，不再进入旧自主开发编排。
    return { work_kind: input.work_kind, change_kind: input.change_kind, pipeline: 'agent_development', canonical_task_type: 'codex_dev', default_execution_profile: defaultProfile, execution_profile_override: override, impact_contract_required: false, orchestrator: 'codex-bridge', ...axes };
  }
  const nonCoding = {
    research: ['research', 'research'],
    coding_review: ['code_review', 'code_review'],
    operations: ['operations', 'data'],
  }[input.work_kind];
  if (!nonCoding) throw new Error('unsupported_work_kind');
  const requestedTaskType = input.requested_task_type;
  if (requestedTaskType != null && !/^[a-z][a-z0-9_-]*$/.test(requestedTaskType)) {
    throw new Error('invalid_requested_task_type');
  }
  return { work_kind: input.work_kind, change_kind: null, pipeline: nonCoding[0], canonical_task_type: requestedTaskType ?? nonCoding[1], default_execution_profile: null, impact_contract_required: false, orchestrator: nonCoding[0], ...axes };
}

export function routeWork(input, repositoryFacts = [], context = {}) {
  assertActiveDevelopmentTask({kernel_continuation: input.kernel_continuation, task_type: input.requested_task_type ?? input.task?.task_type, payload:{...(input.metadata || {}), ...(input.task?.payload || {})}});
  const previewCache = assertLinuxPoolAuthority(input, context) || assertJanitorAuthority(input, context) || assertAppServerAuthority(input, context);
  const request = normalizeWorkRequest(input);
  const work_kind = previewCache ? 'operations' : classifyWork(request);
  const artifact_kind = previewCache ? 'execution' : classifyArtifactKind(request);
  const answer_known = classifyAnswerKnown(request);
  // execution 类交付物是 run,不强制解析 repo(map/impact 尺子不适用)
  const codingCode = work_kind === 'coding_mutation' && artifact_kind === 'code';
  const repo = codingCode ? resolveRepo(request, repositoryFacts) : null;
  const headed = codingCode && isHeadedLedgerRequest(input);
  if (codingCode && !headed && !AGENT_DEVELOPMENT_REPOS.has(repo)) {
    const error = new Error('agent_repo_unsupported');
    error.code = 'agent_repo_unsupported';error.repo = repo;throw error;
  }
  return {
    ...selectPipeline({
      work_kind,
      artifact_kind,
      answer_known,
      headed,
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
