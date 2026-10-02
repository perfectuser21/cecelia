import {PHONE_TASK_AUTHORITY} from '../phone-dispatch/task-authority.js';
import {randomUUID} from 'node:crypto';
import pool from '../db.js';
import {broadcastTaskState} from '../task-updater.js';
import {detectDomain} from '../domain-detector.js';
import {getDomainRole} from '../role-registry.js';
import {createRoutedTask} from '../work-routing-store.js';
import {CONTENT_TASK_TYPES as _C,RESEARCH_TASK_TYPES as _R,REVIEW_TASK_TYPES as _V,CODING_TASK_TYPES as _K,NO_GOAL_TASK_TYPES,LAYER_RETIRED_TASK_TYPES} from './task-type-registry.js';

/**
 * Check if a task type is a system/internal task that doesn't require goal_id
 * @param {string} task_type - Task type
 * @param {string} trigger_source - Trigger source
 * @returns {boolean} - True if system task
 */
function isSystemTask(task_type, trigger_source) {
  // System task types that don't need goal association — 名单见 lib/task-type-registry.js（NO_GOAL_TASK_TYPES）。

  // System trigger sources that don't need goal association
  const systemSources = ['manual', 'test', 'watchdog', 'circuit_breaker', 'cortex', 'self_drive', 'auto_fix', 'execution_callback_harness', 'harness_watcher'];

  return NO_GOAL_TASK_TYPES.includes(task_type) || systemSources.includes(trigger_source);
}

// 名单见 lib/task-type-registry.js（CONTENT_TASK_TYPES / RESEARCH_TASK_TYPES / REVIEW_TASK_TYPES / CODING_TASK_TYPES）。
const CONTENT_TASK_TYPES = new Set(_C);
const RESEARCH_TASK_TYPES = new Set(_R);
const REVIEW_TASK_TYPES = new Set(_V);
const CODING_TASK_TYPES = new Set(_K);

function routeSource(triggerSource, explicitSource) {
  if (explicitSource) return explicitSource;
  if (['manual', 'chat', 'chat_thalamus', 'user_headed'].includes(triggerSource)) return 'conversation';
  if (triggerSource?.includes('scheduler')) return 'scheduler';
  if (['proposal', 'child', 'execution_callback_harness'].includes(triggerSource)) return 'child';
  return 'discovery';
}

function legacyWorkContract({ taskType, mutationIntent, workDomain }) {
  if (mutationIntent) return { mutation_intent: mutationIntent, declared_domain: workDomain };
  if (CODING_TASK_TYPES.has(taskType)) return { mutation_intent: 'write', declared_domain: 'coding' };
  if (CONTENT_TASK_TYPES.has(taskType)) return { mutation_intent: 'none', declared_domain: 'content' };
  if (RESEARCH_TASK_TYPES.has(taskType)) return { mutation_intent: 'none', declared_domain: 'research' };
  if (REVIEW_TASK_TYPES.has(taskType)) return { mutation_intent: 'read_only', declared_domain: 'coding' };
  return { mutation_intent: 'none', declared_domain: 'operations' };
}

/**
 * Create a new task
 * @param {Object} params
 * @param {string} params.title - Task title
 * @param {string} params.description - Task description
 * @param {string} params.priority - P0/P1/P2
 * @param {string} params.project_id - Feature ID (not Project!)
 * @param {string} params.goal_id - KR ID (required for most tasks)
 * @param {string[]} params.tags - Tags
 * @param {string} params.task_type - dev/talk/review
 * @param {string} params.context - Legacy description field
 * @param {string} params.prd_content - PRD content (秋米写的)
 * @param {string} params.execution_profile - US_CLAUDE_OPUS/US_CLAUDE_SONNET/etc
 * @param {Object} params.payload - Additional payload (initiative_id, kr_goal)
 * @param {string} params.domain - Business domain (coding/quality/agent_ops/...)
 * @param {string} params.owner_role - Role owning this task (auto-inferred from domain if omitted)
 * @param {string} [params.dedupe_key] - DB 级幂等键，≤255 字符；超长调用方自行 hash（超长会抛错）
 * @param {number} [params.dedupe_ttl_sec] - dedupe_key 的存活时长（秒），默认 3600
 */
export async function createTask({ title, description, priority, project_id, area_id, goal_id, okr_initiative_id, ability_id, blocked_at, tags, task_type, status, location, context, prd_content, execution_profile, payload, trigger_source, domain: domainInput, owner_role: ownerRoleInput, delivery_type, created_by, dept, phase, executor_kind, journey_id, dedupe_key, dedupe_ttl_sec, source, source_id, mutation_intent, declared_domain, declared_change_kind, execution_profile_override_request, repo_hint, map_scope_hint, branch, base_sha, parent_task_id, sequence_no = null, allow_unscoped = false, db = pool }, internal = {}) {
  if(executor_kind === 'phone-ssh-controller' && internal.phoneTaskAuthority !== PHONE_TASK_AUTHORITY)throw Error('phone_task_authority_required');
  const requestedTaskType = task_type || 'dev';

  // scope/initiative 层退役（决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）：这几个
  // headless 拆解 task_type 的目标层已冻结，建单在这里统一拒绝，不让请求打到
  // 一个必然失败的下游（registry 行本身保留，见 lib/task-type-registry.js）。
  if (LAYER_RETIRED_TASK_TYPES.includes(requestedTaskType)) {
    const error = `layer_retired: task_type="${requestedTaskType}" 所属层已退役（决策 ee4842a6），不再接受建单`;
    console.error(`[Action] ${error}`);
    return { success: false, error: 'layer_retired', decision: 'ee4842a6', message: error };
  }

  // Validate goal_id (required for most tasks except system tasks)
  if (!goal_id && !allow_unscoped && !isSystemTask(requestedTaskType, trigger_source)) {
    const error = `goal_id is required for task_type="${requestedTaskType}" trigger_source="${trigger_source}"`;
    console.error(`[Action] Validation failed: ${error}`);
    throw new Error(error);
  }

  // Dedup: skip if queued/in_progress, or completed within 24 h
  // For system-generated tasks (rumination/cortex/auto_fix), also skip failed within 72 h
  // to prevent self-reinforcing loops where a failed task triggers its own re-creation
  if (!source || !source_id) {
    const SYSTEM_TRIGGER_SOURCES = ['rumination', 'cortex', 'auto_fix'];
    const isSystemTrigger = SYSTEM_TRIGGER_SOURCES.includes(trigger_source);
    const dedupResult = await db.query(`
      SELECT * FROM tasks
      WHERE title = $1
        AND (goal_id IS NOT DISTINCT FROM $2)
        AND (project_id IS NOT DISTINCT FROM $3)
        AND (
          status IN ('queued', 'in_progress')
          OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours')
          OR ($4 AND status = 'failed' AND updated_at > NOW() - INTERVAL '72 hours')
        )
      LIMIT 1
    `, [title, goal_id || null, project_id || null, isSystemTrigger]);

    if (dedupResult.rows.length > 0) {
      const existing = dedupResult.rows[0];
      console.log(`[Action] Dedup: task "${title}" already exists (id: ${existing.id}, status: ${existing.status})`);
      return { success: true, task: existing, deduplicated: true };
    }
  }

  // 协议卫生包：DB 级 dedupe_key 幂等（可选，跨 Brain 重启持久）
  let _dedupeClaimed = false;
  if (dedupe_key) {
    const { claimDedupeKey } = await import('./dedupe.js');
    const claim = await claimDedupeKey('create_task', dedupe_key, dedupe_ttl_sec || 3600, db);
    if (!claim.claimed) {
      console.log(`[Action] Dedup (dedupe_key): task "${title}" skipped (key=${dedupe_key})`);
      return { success: true, deduplicated: true, dedupe_key_hit: true };
    }
    _dedupeClaimed = !claim.degraded;
  }

  try {
    const effectivePayload = journey_id ? { ...(payload ?? {}), journey_id } : payload;
    const detected = detectDomain(`${title} ${description || context || ''}`);
    const taskDomain = domainInput ?? (detected.confidence > 0 ? detected.domain : null);
    const ownerRole = ownerRoleInput ?? (taskDomain ? getDomainRole(taskDomain) : null);
    const workContract = legacyWorkContract({
      taskType: requestedTaskType,
      mutationIntent: mutation_intent,
      workDomain: declared_domain,
    });
    const routed = await createRoutedTask(db, {
      source: routeSource(trigger_source, source),
      source_id: source_id ?? dedupe_key ?? randomUUID(),
      title,
      description: description || context || '',
      requested_task_type: requestedTaskType,
      declared_change_kind,
      execution_profile_override_request,
      declared_domain: workContract.declared_domain,
      mutation_intent: workContract.mutation_intent,
      repo_hint,
      map_scope_hint,
      parent_task_id,
      branch,
      base_sha,
      metadata: effectivePayload ?? {},
      task: {
        priority: priority || 'P1',
        project_id: project_id || null,
        area_id: area_id || null,
        goal_id: goal_id || null,
        okr_initiative_id: okr_initiative_id || null,
        ability_id: ability_id || null,
        blocked_at: blocked_at || null,
        status: status || 'queued',
        location: location || 'us',
        tags: tags || [],
        prd_content: prd_content || null,
        execution_profile: execution_profile || null,
        trigger_source: trigger_source || 'brain_auto',
        domain: taskDomain,
        owner_role: ownerRole,
        delivery_type: delivery_type || 'code-only',
        created_by: created_by || null,
        dept: dept || null,
        phase: phase || 'dev',
        executor_kind: executor_kind || null,
        ...(internal.phoneTaskAuthority === PHONE_TASK_AUTHORITY ? {kind: 'agent'} : {}),
        parent_task_id: parent_task_id || null,
        sequence_no: sequence_no ?? null,
      },
    }, null, typeof db.connect === 'function' && db.constructor?.name !== 'Client'
      ? { previewCacheAuthority: internal.previewCacheAuthority, appServerAuthority: internal.appServerAuthority, phoneTaskAuthority: internal.phoneTaskAuthority }
      : { transaction: 'existing', previewCacheAuthority: internal.previewCacheAuthority, appServerAuthority: internal.appServerAuthority, phoneTaskAuthority: internal.phoneTaskAuthority });

    const task = routed.task;
    console.log(`[Action] Created task: ${task.id} - ${title} (type: ${task.task_type})`);

    // Broadcast task creation to WebSocket clients
    if (db === pool) await broadcastTaskState(task.id);

    return { success: true, task };
  } catch (err) {
    if (_dedupeClaimed) {
      const { releaseDedupeKey } = await import('./dedupe.js');
      await releaseDedupeKey('create_task', dedupe_key, db);
    }
    throw err;
  }
}

