/**
 * Project locate + 一步建单（链 2afa6d69 棒3，任务 8a40825a）
 *
 * POST /locate    — 一句话归位：判断用户描述该挂哪个现存 project（attach），还是该新建一个（create）。
 * POST /:id/tasks — 该 project 下第 N 棒一步建单：自动填 project_id / sequence_no（max+1）/
 *                   payload.multi_task=true / payload.depends_on（默认依赖该 project 下最后一个
 *                   非终态任务；显式传 depends_on:[] 声明并行）。内部走 createRoutedTask 同一条
 *                   建单路径（POST /tasks 也调它），不绕过建单闸 / 依赖单一写口。
 *
 * 挂载于 task-projects.js（router.use('/', projectLocateRoutes)），独立成文件是因为
 * task-projects.js 本体已接近 500 行单文件拆分线（CLAUDE.md 代码规范）。
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import pool from '../db.js';
import { createRoutedTask } from '../work-routing-store.js';
import { normalizeDependsOn, assertDependsOnExist } from '../lib/task-dependencies.js';
import { assertProjectRootForMultiTask } from '../lib/project-root-gate.js';
import { governanceErrorResponse } from '../lib/governance-errors.js';
import { normalizeChangeKind, CHANGE_KINDS } from '../impact-contract/change-kind.js';
import { CODING_MUTATION_TASK_TYPES as _CM } from '../lib/task-type-registry.js';
import { detectDomain } from '../domain-detector.js';
import { scoreProjectCandidates, resolveProjectLocateThreshold } from '../project-locate.js';

const router = Router();
const CODING_MUTATION_TASK_TYPES = new Set(_CM);

// POST /locate — 必须在 /:id 之前挂载（task-projects.js 里已保证），否则 "locate" 会被当 UUID 拦截。
router.post('/locate', async (req, res) => {
  try {
    const { text, kr_id = null, limit = 3 } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    const topK = Math.min(Math.max(parseInt(limit, 10) || 3, 1), 20);
    // inactive = okr_projects 迁移带来的历史休眠项目（生产 176 条），不是归位目标（任务 912c1143）
    const conditions = [`status NOT IN ('completed', 'cancelled', 'archived', 'inactive')`];
    const params = [];
    if (kr_id) {
      params.push(kr_id);
      conditions.push(`kr_id = $${params.length}`);
    }

    const { rows: projects } = await pool.query(
      `SELECT p.id, p.name, p.description, p.status, p.kr_id, p.brief, p.updated_at,
              COALESCE(oc.open_count, 0)::int AS open_task_count,
              GREATEST(p.updated_at, oc.last_task_activity) AS last_activity_at
         FROM projects p
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE status NOT IN ('completed', 'cancelled')) AS open_count,
                  max(updated_at) AS last_task_activity
             FROM tasks WHERE project_id = p.id AND task_type <> 'project'
         ) oc ON true
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.updated_at DESC
        LIMIT 200`,
      params
    );

    if (projects.length === 0) {
      return res.json({ candidates: [], suggestion: 'create', threshold: resolveProjectLocateThreshold() });
    }

    const { method, scored } = await scoreProjectCandidates(text, projects);
    // 语义与关键词量纲不同，阈值随打分方式取（任务 912c1143）
    const threshold = resolveProjectLocateThreshold(process.env, method);
    const reason = method === 'embedding' ? 'embedding_cosine' : 'keyword_bigram_coverage';
    const candidates = scored
      .map((p) => ({
        project_id: p.id,
        name: p.name,
        status: p.status,
        kr_id: p.kr_id,
        score: Number((p.score ?? 0).toFixed(4)),
        reason,
        open_task_count: p.open_task_count,
        last_activity_at: p.last_activity_at,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const suggestion = candidates.length > 0 && candidates[0].score >= threshold ? 'attach' : 'create';
    res.json({ candidates, suggestion, threshold });
  } catch (err) {
    res.status(500).json({ error: 'Failed to locate project', details: err.message });
  }
});

// POST /:id/tasks — project 下第 N 棒一步建单
router.post('/:id/tasks', async (req, res) => {
  const { id: projectId } = req.params;
  try {
    const {
      title,
      description = null,
      task_type = 'dev',
      priority = 'P2',
      change_kind: changeKindInput = null,
      repo_hint: repoHintInput = null,
      map_scope_hint: mapScopeHintInput = null,
      payload: payloadInput = null,
      depends_on: dependsOnInput,
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    let resolvedChangeKind;
    try {
      resolvedChangeKind = normalizeChangeKind(changeKindInput);
    } catch (ckErr) {
      return res.status(400).json({
        error: 'invalid_change_kind',
        details: ckErr.message,
        allowed: [...CHANGE_KINDS],
      });
    }
    const codingMutationRequested = resolvedChangeKind !== null || CODING_MUTATION_TASK_TYPES.has(task_type);
    if (codingMutationRequested && resolvedChangeKind === null) {
      return res.status(400).json({
        error: 'change_kind_required',
        reason_code: 'change_kind_required',
        allowed: [...CHANGE_KINDS],
      });
    }

    const projectCheck = await pool.query('SELECT id FROM projects WHERE id = $1', [projectId]);
    if (!projectCheck.rows.length) {
      return res.status(404).json({ error: 'project not found', id: projectId });
    }

    const seqResult = await pool.query(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS n FROM tasks WHERE project_id = $1`,
      [projectId]
    );
    const sequenceNo = Number(seqResult.rows[0]?.n ?? 1);

    // depends_on：未声明该键 → 默认依赖该 project 下最后一个非终态任务（接力棒串行）；
    // 显式传 []（或其他任务 uuid 数组）→ 照用户声明走（[] = 刻意并行）。
    let dependsOn;
    if (dependsOnInput !== undefined) {
      dependsOn = normalizeDependsOn(dependsOnInput) ?? [];
    } else {
      const lastTask = await pool.query(
        `SELECT id FROM tasks
          WHERE project_id = $1 AND task_type <> 'project' AND status NOT IN ('completed', 'cancelled')
          ORDER BY sequence_no DESC NULLS LAST, created_at DESC LIMIT 1`,
        [projectId]
      );
      dependsOn = lastTask.rows[0] ? [lastTask.rows[0].id] : [];
    }
    await assertDependsOnExist(pool, dependsOn);
    await assertProjectRootForMultiTask(pool, {
      taskType: task_type,
      parentTaskId: null,
      dependsOn,
      payload: { multi_task: true },
      projectId,
    });

    const domain = detectDomain(`${title} ${description ?? ''}`).domain;
    const finalPayload = {
      ...(payloadInput && typeof payloadInput === 'object' ? payloadInput : {}),
      multi_task: true,
      depends_on: dependsOn,
    };
    if (resolvedChangeKind !== null) finalPayload.change_kind = resolvedChangeKind;

    const routed = await createRoutedTask(pool, {
      source: 'api',
      source_id: `project-task:${randomUUID()}`,
      title: title.trim(),
      description,
      requested_task_type: task_type,
      declared_change_kind: resolvedChangeKind,
      declared_domain: domain,
      mutation_intent: resolvedChangeKind !== null ? 'write' : 'read_only',
      repo_hint: repoHintInput ?? payloadInput?.base_repo ?? payloadInput?.repo ?? null,
      map_scope_hint: mapScopeHintInput ?? payloadInput?.map_scope ?? [],
      branch: payloadInput?.branch ?? null,
      base_sha: payloadInput?.base_sha ?? null,
      metadata: finalPayload,
      task: {
        priority,
        status: 'queued',
        project_id: projectId,
        sequence_no: sequenceNo,
      },
    });

    res.status(201).json(routed.task);
  } catch (err) {
    const governance = governanceErrorResponse(err);
    if (governance) return res.status(governance.status).json(governance.body);
    if ([
      'repo_unknown',
      'change_kind_required',
      'invalid_base_sha',
      'invalid_execution_profile_override',
      'execution_profile_downgrade_forbidden',
    ].includes(err.message)) {
      return res.status(400).json({ error: err.message, reason_code: err.message });
    }
    res.status(500).json({ error: 'Failed to create project task', details: err.message });
  }
});

export default router;
