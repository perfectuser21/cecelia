/**
 * Harness 路由 — Pipeline 可视化 API
 *
 * GET /api/brain/harness/pipeline/:planner_task_id
 *   返回该 pipeline 所有 harness/sprint 任务，按创建时间升序排列
 *
 * GET /api/brain/harness/pipeline-detail
 *   全链路详情：阶段任务 + GAN 对抗轮次 + sprint 文件内容
 */

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { readFile, access, realpath } from 'fs/promises';
import { execSync } from 'child_process';
import { join, resolve, relative, isAbsolute, delimiter } from 'path';
import { homedir, tmpdir } from 'os';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { parseFailureStatsDays, buildFailureStats } from '../lib/harness-failure-stats.js';
import { runJudgeGate, runMechanicalPreflightChecks, checkJudgmentsWritten } from '../harness-judge.js';
import {
  DEFAULT_BASE_REPO,
  harnessTaskWorktreePath,
} from '../harness-worktree.js';

const router = Router();
const judgeRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// routes/harness.js → packages/brain/src/routes/ → 向上 4 级到仓库根
const REPO_ROOT = new URL('../../../..', import.meta.url).pathname;

// LangGraph Harness pipeline 架构图（静态，节点拓扑从 harness-graph.js 对应过来）
// 前端用 mermaid.render() 画成 SVG
const HARNESS_MERMAID = `graph LR
  Start([START]) --> Planner
  Planner --> Proposer
  Proposer --> Reviewer
  Reviewer -->|APPROVED| Generator
  Reviewer -->|REVISION| Proposer
  Generator --> Evaluator
  Evaluator -->|PASS| Report
  Evaluator -->|FAIL| Generator
  Report --> End([END])`;

/**
 * GET /initiative-runs/:id
 * 按 initiative_id 查最新 run，返回含 journey_id 字段
 * :id 必须是合法 UUID，否则返回 400
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isContainedPath(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function resolveStoredJudgeWorktree(candidate) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) {
    throw new Error('stored worktree 必须是绝对路径');
  }
  const configuredRoots = String(process.env.HARNESS_JUDGE_ALLOWED_ROOTS || '')
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  const roots = [
    process.env.REPO_ROOT || REPO_ROOT,
    DEFAULT_BASE_REPO,
    ...configuredRoots,
  ];
  if (process.env.NODE_ENV === 'test') roots.push(tmpdir());

  const canonical = await realpath(candidate);
  for (const root of roots) {
    try {
      const canonicalRoot = await realpath(resolve(root));
      if (isContainedPath(canonicalRoot, canonical)) return canonical;
    } catch {
      // 不存在的 allow-root 不是有效授权根。
    }
  }
  throw new Error('stored worktree 不在受控 Harness 根目录');
}

function normalizeJudgeSprintDir(candidate) {
  if (typeof candidate !== 'string' || isAbsolute(candidate)) {
    throw new Error('sprint_dir 必须是相对路径');
  }
  const parts = candidate.split('/');
  if (
    parts[0] !== 'sprints'
    || parts.length < 2
    || parts.some((part) => !part || part === '.' || part === '..'
      || !/^[a-zA-Z0-9._-]+$/.test(part))
  ) {
    throw new Error('sprint_dir 必须位于 sprints/ 且不得包含路径穿越');
  }
  return parts.join('/');
}

async function loadJudgeAuthority(requestPool, { runId, taskId }) {
  const exact = runId && UUID_RE.test(String(runId));
  if (runId && !exact) {
    const err = new Error('run_id 必须是 uuid');
    err.status = 400;
    throw err;
  }
  const { rows } = exact
    ? await requestPool.query(
      `SELECT r.id, r.current_task_id,
              t.payload->>'worktree_path' AS worktree_path,
              t.payload->>'sprint_dir' AS sprint_dir
         FROM initiative_runs r
         JOIN tasks t ON t.id = r.current_task_id
        WHERE r.id = $1
          AND r.orchestrator_version = 'v2'`,
      [runId],
    )
    : await requestPool.query(
      `SELECT r.id, r.current_task_id,
              t.payload->>'worktree_path' AS worktree_path,
              t.payload->>'sprint_dir' AS sprint_dir
         FROM initiative_runs r
         JOIN tasks t ON t.id = r.current_task_id
        WHERE r.current_task_id = $1
          AND r.orchestrator_version = 'v2'
          AND r.phase NOT IN ('done', 'failed')
        ORDER BY r.started_at DESC, r.id DESC
        LIMIT 2`,
      [taskId],
    );
  if (rows.length !== 1) {
    const err = new Error(
      rows.length === 0 ? 'judge run authority not found' : 'judge run authority ambiguous',
    );
    err.status = rows.length === 0 ? 404 : 409;
    throw err;
  }
  const authority = rows[0];
  if (String(authority.current_task_id) !== String(taskId)) {
    const err = new Error('run/task identity mismatch');
    err.status = 409;
    throw err;
  }
  return {
    runId: authority.id,
    taskId: authority.current_task_id,
    worktreePath: authority.worktree_path
      || harnessTaskWorktreePath(authority.current_task_id),
    sprintDir: authority.sprint_dir,
  };
}

router.get('/initiative-runs/:id', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid initiative_id: must be a UUID' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, initiative_id, contract_id, phase,
              journey_type, journey_id,
              deadline_at, completed_at, failure_reason,
              created_at, updated_at
       FROM initiative_runs
       WHERE initiative_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'initiative run not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[GET /harness/initiative-runs/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /runs
 * 返回最近 harness pipeline 运行列表
 * ?limit=N 默认 20，范围 1-100，按 started_at DESC
 */
router.get('/runs', async (req, res) => {
  const rawLimit = req.query.limit ?? '20';
  const limit = parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'limit must be an integer between 1 and 100' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, initiative_id, phase, journey_type,
              started_at, completed_at, failure_reason
       FROM initiative_runs
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /harness/runs]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /runs/:id
 * 按 run 自身 UUID 查单条 initiative_run 记录
 * id 非合法 UUID → 400，不存在 → 404
 */
router.get('/runs/:id', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid run id: must be a UUID' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, initiative_id, phase, journey_type,
              started_at, completed_at, failure_reason
       FROM initiative_runs
       WHERE id = $1::uuid`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'harness run not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[GET /harness/runs/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /runs/:id/progress — B52 Pipeline 进度百分比
 *
 * 从 initiative_run_events 读已完成节点，映射到固定百分比，返回当前进度。
 * phase=done → pct=100；phase=failed → pct+failed:true。
 */
const NODE_PCT_MAP = {
  prep: 5, planner: 15, parsePrd: 25, ganLoop: 40, dbUpsert: 50,
  generator: 65, evaluator: 80, merge: 90, report: 100,
};

router.get('/runs/:id/progress', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid id: must be a UUID' });
  }
  try {
    const [runResult, eventsResult] = await Promise.all([
      pool.query(
        `SELECT initiative_id, phase, started_at, completed_at, failure_reason
         FROM initiative_runs WHERE initiative_id = $1::uuid LIMIT 1`,
        [id]
      ),
      pool.query(
        `SELECT DISTINCT node FROM initiative_run_events
         WHERE initiative_id = $1::uuid AND status = 'completed'`,
        [id]
      ),
    ]);

    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'initiative run not found' });
    }

    const run = runResult.rows[0];
    const doneNodes = eventsResult.rows.map(r => r.node);

    let pct = 0;
    let current_node = null;
    for (const node of doneNodes) {
      const nodePct = NODE_PCT_MAP[node];
      if (nodePct !== undefined && nodePct > pct) {
        pct = nodePct;
        current_node = node;
      }
    }

    if (run.phase === 'done') { pct = 100; current_node = 'report'; }

    const elapsed_ms = run.started_at
      ? Date.now() - new Date(run.started_at).getTime()
      : null;

    const resp = {
      initiative_id: id,
      pct,
      current_node,
      phase: run.phase,
      elapsed_ms,
      started_at: run.started_at,
    };
    if (run.phase === 'failed') {
      resp.failed = true;
      resp.failure_reason = run.failure_reason;
    }
    res.json(resp);
  } catch (err) {
    console.error('[GET /harness/runs/:id/progress]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /initiative/:id/detail
 * 返回 initiative 详情：7 字段（initiative_id/prd_content/contract_content/gan_rounds/step_timing/screenshot_urls/report_content）
 * 来源：tasks + initiative_contracts + task_events + checkpoint_blobs
 * report_content 取自 tasks.result.report_content（reportNode 写入的 Sprint 产物契约 JSON，
 *   见 sprint-result-contract.js）——闭环边界「展示」读取者的唯一数据源。
 */
router.get('/initiative/:id/detail', async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: initRows } = await pool.query(
      `SELECT id, result FROM tasks WHERE id::text = $1 AND task_type = 'harness_initiative' LIMIT 1`,
      [id]
    );
    if (initRows.length === 0) {
      return res.status(404).json({ error: 'initiative not found' });
    }

    // Sprint 产物契约（reportNode 写入 result.report_content）。无则 null（前端走 NOT_REACHED 占位）。
    const report_content = initRows[0].result?.report_content ?? null;

    let prd_content = null;
    let contract_content = null;
    let gan_rounds = null;
    try {
      const { rows } = await pool.query(
        `SELECT prd_content, contract_content, review_rounds
         FROM initiative_contracts
         WHERE initiative_id = $1::uuid
         ORDER BY version DESC LIMIT 1`,
        [id]
      );
      if (rows.length > 0) {
        prd_content = rows[0].prd_content != null ? rows[0].prd_content : null;
        contract_content = rows[0].contract_content != null ? rows[0].contract_content : null;
        gan_rounds = rows[0].review_rounds != null ? rows[0].review_rounds : null;
      }
    } catch { /* initiative_contracts table may not exist */ }

    let step_timing = [];
    try {
      const { rows } = await pool.query(
        `SELECT payload, created_at
         FROM task_events
         WHERE task_id = $1::uuid AND event_type = 'graph_node_update'
         ORDER BY created_at ASC`,
        [id]
      );
      step_timing = rows.map(row => ({
        node: row.payload?.nodeName || null,
        ts: row.created_at,
        attempt: row.payload?.attemptN ?? null,
      }));
    } catch { /* ignore */ }

    let screenshot_urls = [];
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (channel) blob
         FROM checkpoint_blobs
         WHERE thread_id LIKE $1 AND channel = 'screenshot_urls' AND type = 'json'
         ORDER BY channel, version DESC`,
        [`harness-task:${id}:%`]
      );
      if (rows.length > 0 && rows[0].blob) {
        const parsed = JSON.parse(Buffer.from(rows[0].blob).toString('utf8'));
        if (Array.isArray(parsed)) screenshot_urls = parsed;
      }
    } catch { /* ignore */ }

    res.json({
      contract_content,
      gan_rounds,
      initiative_id: id,
      prd_content,
      report_content,
      screenshot_urls,
      step_timing,
    });
  } catch (err) {
    console.error('[GET /harness/initiative/:id/detail]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /initiative/:id/ws-progress
 * 返回该 initiative 下所有 WS 的进度状态
 * 从 checkpoint_blobs 表查询 thread_id LIKE 'harness-task:{id}:ws%' 的记录
 */
router.get('/initiative/:id/ws-progress', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify initiative exists in tasks table
    const { rows: initRows } = await pool.query(
      `SELECT id FROM tasks WHERE id::text = $1 AND task_type = 'harness_initiative' LIMIT 1`,
      [id]
    );
    if (initRows.length === 0) {
      return res.status(404).json({ error: 'initiative not found' });
    }

    // Find distinct WS thread_ids from checkpoint_blobs
    const { rows: threadRows } = await pool.query(
      `SELECT DISTINCT thread_id
       FROM checkpoint_blobs
       WHERE thread_id LIKE $1
       ORDER BY thread_id ASC`,
      [`harness-task:${id}:ws%`]
    );

    if (threadRows.length === 0) {
      return res.json({ initiative_id: id, workstreams: [] });
    }

    // Build workstream entries from checkpoint state
    const workstreams = await Promise.all(threadRows.map(async ({ thread_id }) => {
      const ws_id = thread_id.split(':').slice(2).join(':');

      let status = null;
      let evaluate_verdict = null;
      let pr_url = null;
      let fix_round = 0;
      let title = ws_id;
      let container_id = null;

      // Read state channels from checkpoint_blobs
      try {
        const { rows: blobRows } = await pool.query(
          `SELECT DISTINCT ON (channel) channel, type, blob
           FROM checkpoint_blobs
           WHERE thread_id = $1
             AND channel IN ('status', 'evaluate_verdict', 'pr_url', 'fix_round', 'containerId', 'task')
             AND type = 'json'
           ORDER BY channel, version DESC`,
          [thread_id]
        );

        for (const row of blobRows) {
          if (!row.blob) continue;
          let val;
          try {
            val = JSON.parse(Buffer.from(row.blob).toString('utf8'));
          } catch { continue; }

          switch (row.channel) {
            case 'status':           status = typeof val === 'string' ? val : null; break;
            case 'evaluate_verdict': evaluate_verdict = typeof val === 'string' ? val : null; break;
            case 'pr_url':           pr_url = typeof val === 'string' ? val : null; break;
            case 'fix_round':        fix_round = typeof val === 'number' ? val : 0; break;
            case 'containerId':      container_id = typeof val === 'string' ? val : null; break;
            case 'task':             title = (val && val.title) ? val.title : ws_id; break;
          }
        }
      } catch { /* use defaults on error */ }

      // Fallback: get container_id from thread_lookup if not in checkpoint state
      if (!container_id) {
        try {
          const { rows: luRows } = await pool.query(
            `SELECT container_id FROM walking_skeleton_thread_lookup
             WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [thread_id]
          );
          container_id = luRows[0]?.container_id || null;
        } catch { /* table may not exist */ }
      }

      return { ws_id, title, status, evaluate_verdict, pr_url, fix_round, container_id };
    }));

    res.json({ initiative_id: id, workstreams });
  } catch (err) {
    console.error('[GET /harness/initiative/ws-progress]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /pipeline/:planner_task_id
 * 返回该 planner 下所有 harness/sprint 任务（含 planner 自身）
 */
router.get('/pipeline/:planner_task_id', async (req, res) => {
  try {
    const { planner_task_id } = req.params;

    const { rows } = await pool.query(
      `SELECT
         id AS task_id,
         task_type,
         status,
         title,
         created_at,
         started_at,
         completed_at,
         payload
       FROM tasks
       WHERE
         (id::text = $1 OR payload->>'planner_task_id' = $1)
         AND (task_type LIKE 'harness_%' OR task_type LIKE 'sprint_%')
       ORDER BY created_at ASC`,
      [planner_task_id]
    );

    res.json({ tasks: rows });
  } catch (err) {
    console.error('[GET /harness/pipeline]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /pipeline-detail?planner_task_id=xxx
 * 全链路详情：阶段任务 + GAN 对抗轮次 + sprint 文件内容
 */
router.get('/pipeline-detail', async (req, res) => {
  try {
    const { planner_task_id } = req.query;
    if (!planner_task_id) {
      return res.status(400).json({ error: 'planner_task_id is required' });
    }

    // 1. 查询所有关联任务（含 planner 自身）
    const { rows: tasks } = await pool.query(
      `SELECT
         id AS task_id,
         task_type,
         status,
         title,
         description,
         created_at,
         started_at,
         completed_at,
         payload,
         result,
         error_message,
         pr_url
       FROM tasks
       WHERE
         (id::text = $1 OR payload->>'planner_task_id' = $1)
         AND (task_type LIKE 'harness_%' OR task_type LIKE 'sprint_%')
       ORDER BY created_at ASC`,
      [planner_task_id]
    );

    // 2. 提取 planner 信息（harness_planner 已退役 PR retire-harness-planner，仅保留 sprint_planner）
    // 新 LangGraph pipeline 入口类型为 harness_initiative，作为回退
    const planner = tasks.find(t => t.task_type === 'sprint_planner')
      || tasks.find(t => t.task_type === 'harness_initiative');
    const sprintDir = planner?.payload?.sprint_dir || tasks[0]?.payload?.sprint_dir || 'sprints';

    // 3. 构建 GAN 对抗轮次
    const ganRounds = buildGanRounds(tasks);

    // 4. 构建阶段列表
    const stages = buildStages(tasks);

    // 5. 读取 sprint 目录下的文件内容
    const fileContents = await readSprintFiles(sprintDir);

    // 6. 构建串行步骤列表（含 input/prompt/output）
    const steps = await buildSteps(tasks, sprintDir);

    // 7. LangGraph 路径：从 cecelia_events + checkpoints 重建节点时间轴
    const langgraph = await buildLangGraphInfo(planner_task_id);

    res.json({
      planner_task_id,
      title: planner?.title || '',
      description: planner?.description || planner?.payload?.description || '',
      user_input: planner?.payload?.user_input || planner?.payload?.description || planner?.description || '',
      sprint_dir: sprintDir,
      status: planner?.status || 'not_started',
      created_at: planner?.created_at || null,
      stages,
      gan_rounds: ganRounds,
      file_contents: fileContents,
      steps,
      langgraph,
    });
  } catch (err) {
    console.error('[GET /harness/pipeline-detail]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 将 propose/review 任务配对成 GAN 轮次
 */
function buildGanRounds(tasks) {
  const proposes = tasks.filter(t =>
    t.task_type === 'harness_contract_propose' || t.task_type === 'sprint_contract_propose'
  );
  const reviews = tasks.filter(t =>
    t.task_type === 'harness_contract_review' || t.task_type === 'sprint_contract_review'
  );

  const rounds = [];
  for (let i = 0; i < Math.max(proposes.length, reviews.length); i++) {
    const propose = proposes[i] || null;
    const review = reviews[i] || null;
    rounds.push({
      round: i + 1,
      propose: propose ? {
        task_id: propose.task_id,
        status: propose.status,
        created_at: propose.created_at,
        completed_at: propose.completed_at,
        verdict: propose.result?.verdict || null,
        propose_round: propose.result?.propose_round || i + 1,
      } : null,
      review: review ? {
        task_id: review.task_id,
        status: review.status,
        created_at: review.created_at,
        completed_at: review.completed_at,
        verdict: review.result?.verdict || null,
        feedback: review.result?.feedback || review.result?.result_summary || null,
        contract_branch: review.result?.contract_branch || review.payload?.contract_branch || null,
      } : null,
    });
  }
  return rounds;
}

/**
 * 构建阶段概览（完整 10 步：Planner → Propose → Review → Generate →
 * Evaluate → Report → Auto-merge → Deploy → Smoke-test → Cleanup）
 */
function buildStages(tasks) {
  // 注：harness_planner stage 已退役（PR retire-harness-planner），从 STAGE_ORDER/LABELS 移除
  const STAGE_ORDER = [
    'harness_contract_propose', 'harness_contract_review',
    'harness_generate', 'harness_evaluate', 'harness_report',
    'harness_auto_merge', 'harness_deploy', 'harness_smoke_test', 'harness_cleanup',
  ];
  const STAGE_LABELS = {
    harness_contract_propose: 'Propose',
    harness_contract_review: 'Review',
    harness_generate: 'Generate',
    harness_evaluate: 'Evaluate',
    harness_report: 'Report',
    harness_auto_merge: 'Auto-merge',
    harness_deploy: 'Deploy',
    harness_smoke_test: 'Smoke-test',
    harness_cleanup: 'Cleanup',
  };

  return STAGE_ORDER.map(type => {
    // 取该类型最新的任务
    const matching = tasks.filter(t => t.task_type === type);
    const latest = matching[matching.length - 1];
    return {
      task_type: type,
      label: STAGE_LABELS[type] || type,
      status: latest?.status || 'not_started',
      task_id: latest?.task_id || null,
      title: latest?.title || null,
      created_at: latest?.created_at || null,
      started_at: latest?.started_at || null,
      completed_at: latest?.completed_at || null,
      error_message: latest?.error_message || null,
      pr_url: latest?.pr_url || null,
      result: latest?.result || null,
      count: matching.length,
    };
  });
}

/**
 * 尝试读取 sprint 目录下的关键文件
 */
async function readSprintFiles(sprintDir) {
  const files = {
    'sprint-prd.md': null,
    'contract-draft.md': null,
    'contract-review-feedback.md': null,
    'sprint-contract.md': null,
    'harness-report.md': null,
  };

  for (const filename of Object.keys(files)) {
    try {
      const filePath = join(REPO_ROOT, sprintDir, filename);
      files[filename] = await readFile(filePath, 'utf8');
    } catch {
      // 文件不存在，保持 null
    }
  }

  // contract-dod-ws*.md 已废弃 — harness-contract-proposer v8.0+ 使用单文件 contract-dod.md

  return files;
}

/**
 * 从远程分支读取文件内容（复用 executor.js _fetchSprintFile 逻辑）
 */
function fetchFileFromBranch(branch, filePath) {
  try {
    execSync('git fetch origin', { cwd: REPO_ROOT, stdio: 'pipe' });
  } catch {
    // fetch 失败不阻塞
  }
  try {
    return execSync(`git show origin/${branch}:${filePath}`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    return null;
  }
}

/**
 * 获取任务的结果分支名（根据任务类型读不同字段）
 * - propose 任务：result.propose_branch
 * - review 任务：result.review_branch
 * - generate/fix 任务：result.contract_branch 或 payload.contract_branch
 */
function getResultBranch(task) {
  return task.result?.propose_branch
    || task.result?.review_branch
    || task.result?.branch
    || task.result?.contract_branch
    || task.payload?.contract_branch
    || null;
}

/**
 * 为单个任务重建 prompt（简化版，匹配 executor.js preparePrompt 逻辑）
 */
function rebuildPrompt(task, sprintDir) {
  const t = task.task_type;
  const id = task.task_id;
  const desc = task.description || task.title || '';

  // 注：harness_planner 已退役（PR retire-harness-planner），仅保留 sprint_planner
  if (t === 'sprint_planner') {
    return `/sprint-planner\n\n## Harness v4.0 — Planner\n\ntask_id: ${id}\nsprint_dir: ${sprintDir}\n\n${desc}`;
  }

  if (t === 'harness_contract_propose' || t === 'sprint_contract_propose') {
    const round = task.payload?.propose_round || 1;
    const plannerBranch = task.payload?.planner_branch || '';
    const reviewBranch = task.payload?.review_branch || '';
    return `/harness-contract-proposer\n\n## Harness v4.0 — Contract Proposer\n\ntask_id: ${id}\nsprint_dir: ${sprintDir}\npropose_round: ${round}\nplanner_task_id: ${task.payload?.planner_task_id || ''}\nplanner_branch: ${plannerBranch}\nreview_branch: ${reviewBranch}\n\n${desc}`;
  }

  if (t === 'harness_contract_review' || t === 'sprint_contract_review') {
    const plannerBranch = task.payload?.planner_branch || '';
    const proposeBranch = task.payload?.propose_branch || '';
    return `/harness-contract-reviewer\n\n## Harness v4.0 — Contract Reviewer\n\ntask_id: ${id}\nsprint_dir: ${sprintDir}\npropose_task_id: ${task.payload?.propose_task_id || ''}\npropose_round: ${task.payload?.propose_round || 1}\nplanner_branch: ${plannerBranch}\npropose_branch: ${proposeBranch}\n\n${desc}`;
  }

  if (t === 'harness_generate' || t === 'sprint_generate' || t === 'harness_fix' || t === 'sprint_fix') {
    const contractBranch = task.payload?.contract_branch || '';
    const wsIdx = task.payload?.workstream_index || '';
    const wsCnt = task.payload?.workstream_count || 1;
    let p = `/harness-generator\n\n## Harness v4.0 — Generator\n\ntask_id: ${id}\nsprint_dir: ${sprintDir}\ncontract_branch: ${contractBranch}\n\n${desc}`;
    if (wsIdx) p += `\nworkstream_index: ${wsIdx}\nworkstream_count: ${wsCnt}`;
    return p;
  }

  if (t === 'harness_report' || t === 'sprint_report') {
    return `/harness-report\n\n## Harness v4.0 — Report\n\ntask_id: ${id}\nsprint_dir: ${sprintDir}\npr_url: ${task.payload?.pr_url || ''}\n\n${desc}`;
  }

  return desc;
}

/**
 * 为单个步骤获取 input 内容
 */
async function getStepInput(task, sprintDir) {
  const t = task.task_type;

  // 注：harness_planner 已退役（PR retire-harness-planner），仅保留 sprint_planner
  if (t === 'sprint_planner') {
    return task.description || task.payload?.description || task.title || null;
  }

  if (t === 'harness_contract_propose' || t === 'sprint_contract_propose') {
    const plannerBranch = task.payload?.planner_branch;
    if (plannerBranch) {
      return fetchFileFromBranch(plannerBranch, `${sprintDir}/sprint-prd.md`);
    }
    return null;
  }

  if (t === 'harness_contract_review' || t === 'sprint_contract_review') {
    // propose_branch 在 payload 里常为 null，需从 propose 任务的 result 里取
    let proposeBranch = task.payload?.propose_branch;
    if (!proposeBranch && task.payload?.propose_task_id) {
      try {
        const { rows } = await pool.query(
          `SELECT result->>'propose_branch' AS branch FROM tasks WHERE id::text = $1 LIMIT 1`,
          [task.payload.propose_task_id]
        );
        proposeBranch = rows[0]?.branch || null;
      } catch { /* 忽略 */ }
    }
    if (proposeBranch) {
      return fetchFileFromBranch(proposeBranch, `${sprintDir}/contract-draft.md`);
    }
    return null;
  }

  if (t === 'harness_generate' || t === 'sprint_generate' || t === 'harness_fix') {
    const contractBranch = task.payload?.contract_branch;
    if (contractBranch) {
      return fetchFileFromBranch(contractBranch, `${sprintDir}/sprint-contract.md`);
    }
    return null;
  }

  if (t === 'harness_report' || t === 'sprint_report') {
    return task.description || task.title || null;
  }

  return null;
}

/**
 * 为单个步骤获取 output 内容
 */
async function getStepOutput(task, sprintDir, plannerBranchFromPropose) {
  const t = task.task_type;
  const branch = getResultBranch(task);

  // Planner 的 branch 不在自身的 result，而是从 propose 任务的 payload.planner_branch 传入
  // 注：harness_planner 已退役（PR retire-harness-planner），仅保留 sprint_planner
  if (t === 'sprint_planner') {
    const useBranch = branch || plannerBranchFromPropose;
    if (useBranch) return fetchFileFromBranch(useBranch, `${sprintDir}/sprint-prd.md`);
    return null;
  }

  if (!branch) {
    if (task.result?.verdict) return `Verdict: ${task.result.verdict}`;
    if (task.result?.feedback) return task.result.feedback;
    if (task.result?.result_summary) return task.result.result_summary;
    return null;
  }

  // 注：harness_planner 已退役（PR retire-harness-planner），仅保留 sprint_planner
  if (t === 'sprint_planner') {
    return fetchFileFromBranch(branch, `${sprintDir}/sprint-prd.md`);
  }

  if (t === 'harness_contract_propose' || t === 'sprint_contract_propose') {
    return fetchFileFromBranch(branch, `${sprintDir}/contract-draft.md`);
  }

  if (t === 'harness_contract_review' || t === 'sprint_contract_review') {
    const feedback = fetchFileFromBranch(branch, `${sprintDir}/contract-review-feedback.md`);
    if (feedback) return feedback;
    if (task.result?.feedback) return task.result.feedback;
    return task.result?.verdict ? `Verdict: ${task.result.verdict}` : null;
  }

  if (t === 'harness_generate' || t === 'sprint_generate' || t === 'harness_fix') {
    return task.pr_url ? `PR: ${task.pr_url}` : null;
  }

  if (t === 'harness_report' || t === 'sprint_report') {
    return fetchFileFromBranch(branch, `${sprintDir}/harness-report.md`);
  }

  return null;
}

// task_type → skill 目录名映射
// 注：harness_planner 已退役（PR retire-harness-planner），仅保留 sprint_planner
const TASK_TYPE_TO_SKILL = {
  sprint_planner: 'harness-planner',
  harness_contract_propose: 'harness-contract-proposer',
  sprint_contract_propose: 'harness-contract-proposer',
  harness_contract_review: 'harness-contract-reviewer',
  sprint_contract_review: 'harness-contract-reviewer',
  harness_generate: 'harness-generator',
  sprint_generate: 'harness-generator',
  harness_fix: 'harness-generator',
  sprint_fix: 'harness-generator',
  harness_evaluate: 'harness-evaluator',
  sprint_evaluate: 'harness-evaluator',
  harness_report: 'harness-report',
  sprint_report: 'harness-report',
};

// LangGraph node name → skill 目录名
const NODE_TO_SKILL = {
  planner: 'harness-planner',
  proposer: 'harness-contract-proposer',
  reviewer: 'harness-contract-reviewer',
  generator: 'harness-generator',
  run_sub_task: 'harness-generator',
  report: 'harness-report',
};

// LangGraph node name → system prompt 前缀
const NODE_SYSTEM_PROMPTS = {
  planner: '你是 harness-planner agent。按下面 SKILL 指令工作。',
  proposer: '你是 harness-contract-proposer agent。按下面 SKILL 指令工作。',
  reviewer: '你是 harness-contract-reviewer agent。按下面 SKILL 指令工作。',
  generator: '你是 harness-generator agent。按下面 SKILL 指令工作。',
  run_sub_task: '你是 harness-generator agent。按下面 SKILL 指令工作。',
  report: '你是 harness-report agent。按下面 SKILL 指令工作。',
};

// 节点读入的 sprint dir 文件（user input）
const NODE_INPUT_FILE = {
  proposer: 'sprint-prd.md',
  reviewer: 'contract-draft.md',
  generator: 'task-plan.json',
  run_sub_task: 'task-plan.json',
};

// 节点写出的 sprint dir 文件（output）
const NODE_OUTPUT_FILE = {
  planner: 'sprint-prd.md',
  proposer: 'contract-draft.md',
  report: 'harness-report.md',
};

async function readSkillFile(skillName) {
  if (!skillName) return null;
  try {
    return await readFile(join(homedir(), '.claude-account1', 'skills', skillName, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
}

async function readSprintFile(sprintDir, filename) {
  if (!sprintDir || !filename) return null;
  try {
    return await readFile(join(REPO_ROOT, sprintDir, filename), 'utf8');
  } catch {
    return null;
  }
}

/**
 * 读取对应 skill 的 SKILL.md 内容；无则返回 null
 */
async function getSystemPromptContent(taskType) {
  const skillName = TASK_TYPE_TO_SKILL[taskType];
  if (!skillName) return null;
  const skillPath = join(homedir(), '.claude-account1', 'skills', skillName, 'SKILL.md');
  try {
    return await readFile(skillPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 生成步骤标签（含轮次编号）
 */
function buildStepLabel(taskType, counters) {
  // 注：harness_planner 已退役（PR retire-harness-planner），仅保留 sprint_planner
  const BASE_LABELS = {
    sprint_planner: 'Planner',
    harness_contract_propose: 'Propose', sprint_contract_propose: 'Propose',
    harness_contract_review: 'Review', sprint_contract_review: 'Review',
    harness_generate: 'Generate', sprint_generate: 'Generate',
    harness_fix: 'Fix', sprint_fix: 'Fix',
    harness_ci_watch: 'CI Watch',
    harness_report: 'Report', sprint_report: 'Report',
  };

  const base = BASE_LABELS[taskType] || taskType;
  const needsRound = taskType.includes('propose') || taskType.includes('review');
  if (!needsRound) return base;

  counters[taskType] = (counters[taskType] || 0) + 1;
  return `${base} R${counters[taskType]}`;
}

/**
 * 构建串行步骤数组（按 created_at 升序，含 input/prompt/output）
 */
async function buildSteps(tasks, sprintDir) {
  const counters = {};
  const steps = [];

  // 预计算 planner branch（从第一个 propose 任务的 payload.planner_branch 取）
  const plannerBranchFromPropose = tasks.find(
    t => (t.task_type === 'harness_contract_propose' || t.task_type === 'sprint_contract_propose')
      && t.payload?.planner_branch
  )?.payload?.planner_branch || null;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const label = buildStepLabel(task.task_type, counters);
    const [inputContent, outputContent, systemPromptContent] = await Promise.all([
      getStepInput(task, sprintDir),
      getStepOutput(task, sprintDir, plannerBranchFromPropose),
      getSystemPromptContent(task.task_type),
    ]);

    steps.push({
      step: i + 1,
      task_id: task.task_id,
      task_type: task.task_type,
      label,
      status: task.status,
      created_at: task.created_at,
      completed_at: task.completed_at,
      verdict: task.result?.verdict || null,
      pr_url: task.pr_url || task.result?.pr_url || null,
      error_message: task.error_message || null,
      input_content: inputContent,
      prompt_content: rebuildPrompt(task, sprintDir),
      output_content: outputContent,
      system_prompt_content: systemPromptContent,
    });
  }

  return steps;
}

/**
 * LangGraph 时间轴信息
 *
 * 从 cecelia_events (event_type='langgraph_step') + checkpoints 表
 * 重建 LangGraph 路径 pipeline 的可视化数据：
 *   - enabled: 是否走了 LangGraph 路径（查 cecelia_events 是否有 langgraph_step 事件）
 *   - thread_id: = taskId (PostgresSaver 用作 checkpoint key)
 *   - steps: 按 created_at 升序的节点事件（每节点一条）
 *   - gan_rounds: proposer ↔ reviewer 配对轮次
 *   - fix_rounds: generator ↔ evaluator 配对轮次
 *   - checkpoints: 持久化 state 计数（判断是否可断点续跑）
 *   - mermaid: pipeline 架构图源码（静态，所有 pipeline 一致）
 *
 * 非 LangGraph task（老路径，没有 langgraph_step 事件）返回 enabled=false，
 * 其他字段为空数组/0，mermaid 仍提供（便于老 pipeline 也看架构图）。
 *
 * @param {string} taskId  planner_task_id = langgraph thread_id
 * @returns {Promise<{enabled,thread_id,steps,gan_rounds,fix_rounds,checkpoints,mermaid}>}
 */
async function buildLangGraphInfo(taskId) {
  const empty = {
    enabled: false,
    thread_id: taskId,
    steps: [],
    gan_rounds: [],
    fix_rounds: [],
    workstreams: [],
    pr_urls: [],
    ws_verdicts: [],
    ws_feedbacks: [],
    checkpoints: { count: 0, latest_checkpoint_id: null, state_available: false },
    mermaid: HARNESS_MERMAID,
  };

  // task_id 必须是合法 UUID 才能走 ::uuid cast；不合法直接返回空
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(taskId))) {
    return empty;
  }

  let events = [];
  try {
    const { rows } = await pool.query(
      `SELECT payload, created_at
       FROM cecelia_events
       WHERE task_id = $1::uuid
         AND event_type = 'langgraph_step'
       ORDER BY created_at ASC`,
      [taskId]
    );
    events = rows;
  } catch (err) {
    console.warn(`[buildLangGraphInfo] events query failed: ${err.message}`);
    return empty;
  }

  // Checkpoints 计数（PostgresSaver 持久化 state）
  let checkpointRows = [];
  try {
    const { rows } = await pool.query(
      `SELECT checkpoint_id
       FROM checkpoints
       WHERE thread_id = $1
       ORDER BY checkpoint_id DESC`,
      [String(taskId)]
    );
    checkpointRows = rows;
  } catch (err) {
    // checkpoints 表可能不存在（PostgresSaver 未初始化），降级为 0
    console.warn(`[buildLangGraphInfo] checkpoints query failed: ${err.message}`);
  }

  const checkpoints = {
    count: checkpointRows.length,
    latest_checkpoint_id: checkpointRows[0]?.checkpoint_id || null,
    state_available: checkpointRows.length > 0,
  };

  // Fetch task data for DB context and sprint_dir
  let taskData = null;
  let sprintDir = null;
  try {
    const { rows: taskRows } = await pool.query(
      `SELECT title, description, payload FROM tasks WHERE id = $1::uuid`,
      [taskId]
    );
    if (taskRows[0]) {
      taskData = taskRows[0];
      sprintDir = taskRows[0].payload?.sprint_dir || null;
    }
  } catch (err) {
    console.warn(`[buildLangGraphInfo] task query failed: ${err.message}`);
  }

  if (events.length === 0) {
    return { ...empty, checkpoints };
  }

  // 把每条事件 normalize 成 step（async 以便并发读 skill/sprint 文件）
  const steps = await Promise.all(events.map(async (row, idx) => {
    const p = row.payload || {};
    const nodeName = p.node || 'unknown';
    // 从 review_verdict / evaluator_verdict 里取一个作为 verdict
    const verdict = p.review_verdict || p.evaluator_verdict || null;
    const skillName = NODE_TO_SKILL[nodeName] || null;
    const [skillContent, inputContent, outputContent] = await Promise.all([
      readSkillFile(skillName),
      readSprintFile(sprintDir, NODE_INPUT_FILE[nodeName]),
      readSprintFile(sprintDir, NODE_OUTPUT_FILE[nodeName]),
    ]);
    return {
      step_index: typeof p.step_index === 'number' ? p.step_index : idx + 1,
      node: nodeName,
      verdict,
      review_round: p.review_round ?? null,
      eval_round: p.eval_round ?? null,
      review_verdict: p.review_verdict || null,
      evaluator_verdict: p.evaluator_verdict || null,
      pr_url: p.pr_url || null,
      // 多 WS 快照（用于前端每步展开时查看本步的多 PR 情况）
      workstreams: Array.isArray(p.workstreams) ? p.workstreams : null,
      pr_urls: Array.isArray(p.pr_urls) ? p.pr_urls : null,
      ws_verdicts: Array.isArray(p.ws_verdicts) ? p.ws_verdicts : null,
      error: p.error || null,
      timestamp: row.created_at,
      state_snapshot: p,
      // Enriched context fields
      skill_name: skillName,
      system_prompt: NODE_SYSTEM_PROMPTS[nodeName] || null,
      skill_content: skillContent,
      input_content: inputContent,
      output_content: outputContent,
      db_context: taskData ? {
        task_id: taskId,
        title: taskData.title,
        description: (taskData.description || '').slice(0, 500),
        sprint_dir: sprintDir,
      } : null,
    };
  }));

  // 按 step_index 稳定排序（防止时间戳相同时顺序错乱）
  steps.sort((a, b) => (a.step_index || 0) - (b.step_index || 0));

  // 多 WS 汇总：找最新含有 workstreams / pr_urls / ws_verdicts 的事件
  // 规则：从后往前扫，第一次出现的非空数组即为当前 state
  const findLatestArray = (field) => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const v = steps[i][field] || steps[i].state_snapshot?.[field];
      if (Array.isArray(v) && v.length > 0) return v;
    }
    return [];
  };
  const workstreams = findLatestArray('workstreams');
  const prUrls = findLatestArray('pr_urls');
  const wsVerdicts = findLatestArray('ws_verdicts');
  // ws_feedbacks 不一定非空数组，但同样取最近一次（含 null 占位）
  let wsFeedbacks = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const v = steps[i].state_snapshot?.ws_feedbacks;
    if (Array.isArray(v)) { wsFeedbacks = v; break; }
  }

  // 配对 GAN 轮次：proposer ↔ reviewer
  const ganRounds = [];
  let pendingProposer = null;
  // 配对 Fix 轮次：generator ↔ evaluator
  const fixRounds = [];
  let pendingGenerator = null;

  for (const step of steps) {
    if (step.node === 'proposer') {
      pendingProposer = step;
    } else if (step.node === 'reviewer' && pendingProposer) {
      ganRounds.push({
        round: ganRounds.length + 1,
        proposer: pendingProposer,
        reviewer: step,
      });
      pendingProposer = null;
    } else if (step.node === 'generator') {
      pendingGenerator = step;
    } else if (step.node === 'evaluator' && pendingGenerator) {
      fixRounds.push({
        round: fixRounds.length + 1,
        generator: pendingGenerator,
        evaluator: step,
      });
      pendingGenerator = null;
    }
  }

  // pending proposer 没收到 reviewer，但 pipeline 还在跑 — 也返回半轮
  if (pendingProposer) {
    ganRounds.push({
      round: ganRounds.length + 1,
      proposer: pendingProposer,
      reviewer: null,
    });
  }
  if (pendingGenerator) {
    fixRounds.push({
      round: fixRounds.length + 1,
      generator: pendingGenerator,
      evaluator: null,
    });
  }

  return {
    enabled: true,
    thread_id: taskId,
    steps,
    gan_rounds: ganRounds,
    fix_rounds: fixRounds,
    // 多 WS 字段（前端列表页显示 "N PRs"，详情页显示 WS 列表）
    workstreams,
    pr_urls: prUrls,
    ws_verdicts: wsVerdicts,
    ws_feedbacks: wsFeedbacks,
    checkpoints,
    mermaid: HARNESS_MERMAID,
  };
}

// nodeName → 人类可读 label 映射
const NODE_LABEL_MAP = {
  planner: 'Planner',
  proposer: 'Proposer',
  reviewer: 'Reviewer',
  generator: 'Generator',
  evaluator: 'Evaluator',
  report: 'Report',
};

/**
 * GET /stream?planner_task_id=<uuid>
 * SSE 实时推送 harness pipeline 节点进度（planner_task_id 模式）
 *
 * event: node_update  data: {attempt, label, node, ts}
 * event: done         data: {status, verdict}
 * : keepalive         （每 30s 一次）
 *
 * GET /stream?initiative_id=<uuid>
 * SSE 实时推送 initiative_run_events（initiative_id 模式，ws3 DoD）
 *
 * event: node_update   data: {node, status, attempt, ts}
 * event: run_completed data: {status}
 * : keepalive          （每 30s 一次）
 */
router.get('/stream', async (req, res) => {
  const { planner_task_id, initiative_id } = req.query;

  // ── initiative_id 模式（ws3 DoD）──────────────────────────────────────────
  if (initiative_id) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let lastId = 0;
    let closed = false;
    let pollTimer = null;
    let keepaliveTimer = null;

    const cleanup = () => {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (keepaliveTimer) clearInterval(keepaliveTimer);
    };

    res.on('close', cleanup);

    const pollInitiative = async () => {
      if (closed) return;
      try {
        const { rows } = await pool.query(
          `SELECT id, node, status, attempt, ts
           FROM initiative_run_events
           WHERE initiative_id = $1::uuid AND id > $2
           ORDER BY id ASC`,
          [initiative_id, lastId]
        );

        for (const row of rows) {
          if (closed) return;
          const data = { node: row.node, status: row.status, attempt: row.attempt, ts: Number(row.ts) };
          res.write(`event: node_update\ndata: ${JSON.stringify(data)}\n\n`);
          lastId = row.id;
        }

        // 检查 initiative 任务是否已结束
        const { rows: taskRows } = await pool.query(
          `SELECT status FROM tasks WHERE id = $1::uuid AND task_type = 'harness_initiative' LIMIT 1`,
          [initiative_id]
        );
        if (taskRows.length > 0 && (taskRows[0].status === 'completed' || taskRows[0].status === 'failed')) {
          if (!closed) {
            const runStatus = taskRows[0].status === 'completed' ? 'done' : 'failed';
            res.write(`event: run_completed\ndata: ${JSON.stringify({ status: runStatus })}\n\n`);
            res.end();
            cleanup();
          }
        }
      } catch (err) {
        console.error('[SSE /stream initiative_id] poll error:', err.message);
      }
    };

    await pollInitiative();

    if (!closed) {
      pollTimer = setInterval(pollInitiative, 3000);
      keepaliveTimer = setInterval(() => {
        if (!closed) res.write(': keepalive\n\n');
      }, 30000);
    }
    return;
  }

  // ── planner_task_id 模式（原有逻辑）──────────────────────────────────────
  if (!planner_task_id) {
    return res.status(400).json({ error: 'planner_task_id is required' });
  }

  let taskRow;
  try {
    const { rows } = await pool.query(
      'SELECT id, status, result FROM tasks WHERE id = $1::uuid LIMIT 1',
      [planner_task_id]
    );
    taskRow = rows[0] || null;
  } catch {
    taskRow = null;
  }

  if (!taskRow) {
    return res.status(404).json({ error: 'pipeline not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let lastSeen = new Date(0);
  let closed = false;
  let pollTimer = null;
  let keepaliveTimer = null;

  const cleanup = () => {
    closed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (keepaliveTimer) clearInterval(keepaliveTimer);
  };

  res.on('close', cleanup);

  const poll = async () => {
    if (closed) return;
    try {
      const { rows: events } = await pool.query(
        `SELECT payload, created_at FROM task_events
         WHERE task_id = $1::uuid AND event_type = 'graph_node_update' AND created_at > $2
         ORDER BY created_at ASC`,
        [planner_task_id, lastSeen]
      );

      for (const evt of events) {
        if (closed) return;
        const p = evt.payload;
        const data = {
          attempt: p.attemptN,
          label: NODE_LABEL_MAP[p.nodeName] || p.nodeName || '',
          node: p.nodeName,
          ts: new Date(evt.created_at).toISOString(),
        };
        res.write(`event: node_update\ndata: ${JSON.stringify(data)}\n\n`);
        lastSeen = new Date(evt.created_at);
      }

      const { rows: taskRows } = await pool.query(
        'SELECT status, result FROM tasks WHERE id = $1::uuid LIMIT 1',
        [planner_task_id]
      );

      if (taskRows.length > 0) {
        const task = taskRows[0];
        if (task.status === 'completed' || task.status === 'failed') {
          if (!closed) {
            const verdict = task.result?.verdict ?? null;
            res.write(`event: done\ndata: ${JSON.stringify({ status: task.status, verdict })}\n\n`);
            res.end();
            cleanup();
          }
        }
      }
    } catch (err) {
      console.error('[SSE /stream] poll error:', err.message);
    }
  };

  await poll();

  if (!closed) {
    pollTimer = setInterval(poll, 2000);
    keepaliveTimer = setInterval(() => {
      if (!closed) res.write(': keepalive\n\n');
    }, 30000);
  }
});

/**
 * GET /stats
 * Pipeline 统计：最近 30 天的完成率、平均 GAN 轮次、平均耗时
 */
router.get('/stats', async (req, res) => {
  try {
    // ── 战况室数据层（P2）：?by=journey 按 Line 聚合 run 数 / 成功率 / 最近战况 / 卡点 ──
    // 数据卫生：INNER JOIN journeys 天然排除无 journey 孤儿 run；再显式过滤 smoke-* 测试任务。
    if (req.query.by === 'journey') {
      let days = parseInt(req.query.days, 10);
      if (!Number.isInteger(days) || days < 1 || days > 365) days = 30;
      const { rows } = await pool.query(`
        SELECT j.id   AS journey_id,
               j.name AS journey_name,
               COUNT(*)                                     AS runs,
               COUNT(*) FILTER (WHERE ir.phase = 'done')    AS done,
               COUNT(*) FILTER (WHERE ir.phase = 'failed')  AS failed,
               MAX(ir.created_at)                           AS last_run_at,
               (ARRAY_AGG(ir.failure_reason ORDER BY ir.created_at DESC)
                  FILTER (WHERE ir.failure_reason IS NOT NULL))[1] AS last_failure
        FROM initiative_runs ir
        JOIN journeys j ON j.id = ir.journey_id
        LEFT JOIN tasks t ON t.id = ir.initiative_id
        WHERE ir.created_at >= NOW() - make_interval(days => $1)
          AND ir.journey_id IS NOT NULL                    -- 排除无 journey 孤儿 run
          AND (t.title IS NULL OR t.title NOT ILIKE 'smoke-%')  -- 过滤 smoke-* 测试任务
        GROUP BY j.id, j.name
        ORDER BY runs DESC, last_run_at DESC NULLS LAST
      `, [days]);
      const journeys = rows.map((r) => {
        const done = parseInt(r.done, 10) || 0;
        const failed = parseInt(r.failed, 10) || 0;
        const terminal = done + failed;
        return {
          journey_id: r.journey_id,
          journey_name: r.journey_name,
          runs: parseInt(r.runs, 10) || 0,
          done,
          failed,
          // 成功率 = done/(done+failed)（只算终态 run，进行中不计入分母）
          success_rate: terminal > 0 ? Math.round((done / terminal) * 100) / 100 : 0,
          last_run_at: r.last_run_at,
          last_failure: r.last_failure || null,
        };
      });
      return res.json({ by: 'journey', period_days: days, journeys });
    }

    // 最近 30 天 pipeline 总数
    // 注：harness_planner 已退役（PR retire-harness-planner），改用 harness_initiative 作为 pipeline 主轴
    const { rows: totalRows } = await pool.query(`
      SELECT COUNT(*) AS total
      FROM tasks
      WHERE task_type = 'harness_initiative'
        AND created_at >= NOW() - INTERVAL '30 days'
    `);
    const total = parseInt(totalRows[0]?.total ?? 0, 10);

    // 完成数
    const { rows: doneRows } = await pool.query(`
      SELECT COUNT(*) AS done
      FROM tasks
      WHERE task_type = 'harness_initiative'
        AND status = 'completed'
        AND created_at >= NOW() - INTERVAL '30 days'
    `);
    const done = parseInt(doneRows[0]?.done ?? 0, 10);
    const completion_rate = total > 0 ? Math.round((done / total) * 100) / 100 : 0;

    // 平均 GAN 轮次（每个 pipeline 的 propose 任务数）
    const { rows: ganRows } = await pool.query(`
      SELECT AVG(propose_count) AS avg_rounds
      FROM (
        SELECT payload->>'planner_task_id' AS pid, COUNT(*) AS propose_count
        FROM tasks
        WHERE task_type = 'harness_contract_propose'
          AND created_at >= NOW() - INTERVAL '30 days'
          AND payload->>'planner_task_id' IS NOT NULL
        GROUP BY payload->>'planner_task_id'
      ) sub
    `);
    const avg_gan_rounds = ganRows[0]?.avg_rounds != null
      ? Math.round(parseFloat(ganRows[0].avg_rounds) * 100) / 100
      : 0;

    // 平均耗时（ms，只统计已完成的 pipeline）
    // 注：harness_planner 已退役（PR retire-harness-planner），改用 harness_initiative
    const { rows: durRows } = await pool.query(`
      SELECT AVG(
        EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000
      ) AS avg_ms
      FROM tasks
      WHERE task_type = 'harness_initiative'
        AND status = 'completed'
        AND completed_at IS NOT NULL
        AND created_at >= NOW() - INTERVAL '30 days'
    `);
    const avg_duration = durRows[0]?.avg_ms != null
      ? Math.round(parseFloat(durRows[0].avg_ms))
      : 0;

    res.json({
      period_days: 30,
      total_pipelines: total,
      completed_pipelines: done,
      completion_rate,
      avg_gan_rounds,
      avg_duration,
    });
  } catch (err) {
    console.error('[GET /harness/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /failure-stats?days=N
 * harness 失败可观测计量（决策 e8f6134f 交付物2）：按 failure_class 分组计数 + 滚动失败率。
 *
 * 分母口径（判定点登记表选 A）：窗口内 harness 任务总数（含 in_progress），
 * created_at >= NOW() - N days，task_type IN (harness_initiative, golden_path_proposal)。
 * 分子/分组：窗口内 terminal 失败态（failed/blocked/cancelled）任务，
 * 按 COALESCE(result->>'failure_class','unclassified') 分组。by_class 各类之和 == terminal_failed_count（无双重计数）。
 * days 非整数 / 越界（<1 或 >365）→ 400；窗口空 → 200 空口径（rate=0, by_class={}），不 500。
 */
router.get('/failure-stats', async (req, res) => {
  try {
    const parsed = parseFailureStatsDays(req.query.days);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const { days } = parsed;

    // 分母：窗口内 harness 任务总数（含 in_progress）
    const { rows: totalRows } = await pool.query(
      `SELECT COUNT(*) AS total
         FROM tasks
        WHERE task_type IN ('harness_initiative', 'golden_path_proposal')
          AND created_at >= NOW() - make_interval(days => $1)`,
      [days]
    );

    // 分子 + 分组：窗口内 terminal 失败态（failed/blocked/cancelled），按 failure_class 分组
    const { rows: classRows } = await pool.query(
      `SELECT COALESCE(result->>'failure_class', 'unclassified') AS failure_class,
              COUNT(*) AS cnt
         FROM tasks
        WHERE task_type IN ('harness_initiative', 'golden_path_proposal')
          AND status IN ('failed', 'blocked', 'cancelled')
          AND created_at >= NOW() - make_interval(days => $1)
        GROUP BY 1`,
      [days]
    );

    res.json(buildFailureStats(days, totalRows[0]?.total ?? 0, classRows));
  } catch (err) {
    console.error('[GET /harness/failure-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /sprint-docs?sprint_dir=...
 * 返回 sprint 目录下 4 个文档的 markdown 内容
 * 文件不存在时对应字段为 null；缺 sprint_dir 返回 400
 */
router.get('/sprint-docs', async (req, res) => {
  const { sprint_dir } = req.query;
  if (!sprint_dir) {
    return res.status(400).json({ error: 'sprint_dir is required' });
  }

  const fileMap = [
    ['prep_prd', 'prep-prd.md'],
    ['sprint_prd', 'sprint-prd.md'],
    ['contract', 'contract-draft.md'],
    ['harness_report', 'harness-report.md'],
  ];

  const docs = {};
  for (const [key, filename] of fileMap) {
    try {
      docs[key] = await readFile(join(REPO_ROOT, sprint_dir, filename), 'utf8');
    } catch {
      docs[key] = null;
    }
  }

  res.json({ sprint_dir, docs });
});

/**
 * POST /api/brain/harness/complete
 * harness-report SKILL.md Step 2 调用：pipeline 全部 WS 交付后更新 initiative 状态
 * body: { initiative_id, sprint_dir?, pr_url?, screenshots? }
 */
router.post('/complete', async (req, res) => {
  const { initiative_id, sprint_dir, pr_url, screenshots } = req.body ?? {};
  if (!initiative_id) return res.status(400).json({ error: 'initiative_id required' });

  // 收账权收归（决策 dc18d43d）：终态只能来自 watchdog 确认 MERGED（phase=done）后的 report 回写。
  // 防止 generator callback 提前收账（merged:false 实证）。历史任务无 relay run → 保守继续。
  try {
    const runQ = await pool.query(
      `SELECT phase FROM initiative_runs
        WHERE initiative_id = $1 AND orchestrator_version = 'v2'
        ORDER BY started_at DESC LIMIT 1`,
      [initiative_id]
    );
    if (runQ.rows.length > 0 && runQ.rows[0].phase !== 'done') {
      // 绝不 409：冻结期 skill 把非 2xx 当可重试会造死循环（设计 2026-07-14-harness-lifecycle-gates
      // 对抗审查明确否决 409）。与 finalize 拒绝同款 200 accepted:false 语义。
      return res.json({
        ok: true,
        accepted: false,
        reason: `initiative_run_not_done: phase=${runQ.rows[0].phase}`,
        current_phase: runQ.rows[0].phase,
        initiative_id,
      });
    }
  } catch (err) {
    console.warn(`[POST /harness/complete] 收账权检查失败（保守继续）: ${err.message}`);
  }

  try {
    const result = { completed_at: new Date().toISOString() };
    if (pr_url) result.pr_url = pr_url;
    if (screenshots) result.screenshots = screenshots;
    if (sprint_dir) result.sprint_dir = sprint_dir;
    // 收账权收归（决策 dc18d43d）：harness_initiative(skill-relay) completed 一律申请，
    // 外部真相核验不过 → 不标 completed，但把 report 产物照记进 result（不丢信息），200 accepted:false。
    const { finalizeHarnessTask } = await import('../lib/harness-finalize.js');
    const fin = await finalizeHarnessTask(initiative_id, { pool });
    if (fin.applies && !fin.allow) {
      await pool.query(
        `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || $1::jsonb WHERE id::text = $2`,
        [JSON.stringify(result), initiative_id]
      );
      console.warn(`[POST /harness/complete] initiative ${initiative_id} completed 申请被拒 → 降级（${fin.reason}）`);
      return res.json({ ok: true, accepted: false, reason: fin.reason, initiative_id });
    }
    const updateResult = await pool.query(
      `UPDATE tasks SET status='completed', completed_at=NOW(),
       result = COALESCE(result, '{}'::jsonb) || $1::jsonb
       WHERE id::text = $2 AND status != 'completed'`,
      [JSON.stringify(result), initiative_id]
    );
    if (updateResult.rowCount === 0) {
      console.warn(`[POST /harness/complete] initiative ${initiative_id} UPDATE affected 0 rows — not found or already completed`);
    }
    console.log(`[POST /harness/complete] initiative ${initiative_id} marked completed`);
    res.json({ ok: true, initiative_id, rowsAffected: updateResult.rowCount });
  } catch (err) {
    console.error('[POST /harness/complete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/harness/notify
 * harness-report SKILL.md Step 5 调用：发送飞书通知
 * body: { type, title, message?, initiative_id?, pr_url?, task_id?, verdict? }
 * type: harness_complete | harness_task_merged | harness_final_e2e | general
 */
router.post('/notify', async (req, res) => {
  const { type, title, message, initiative_id, pr_url, task_id, verdict } = req.body ?? {};
  if (!type || !title) return res.status(400).json({ error: 'type and title required' });
  try {
    const { notifyHarnessFinalE2E, notifyHarnessTaskMerged, sendFeishu } = await import('../notifier.js');
    let sent = false;
    if (type === 'harness_complete' || type === 'harness_final_e2e') {
      sent = await notifyHarnessFinalE2E({
        initiative_id: initiative_id || title,
        initiative_title: title,
        verdict: verdict || 'PASS',
      });
    } else if (type === 'harness_task_merged') {
      sent = await notifyHarnessTaskMerged({ title, pr_url, task_id });
    } else {
      const text = message ? `${title}\n${message}` : title;
      sent = await sendFeishu(text);
    }
    res.json({ ok: true, sent: !!sent });
  } catch (err) {
    console.error('[POST /harness/notify]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /messages/:initiativeId/:subTaskId
 * 查询某 sub-task 的未消费消息（默认 consumed_at IS NULL）。
 * - initiativeId 不存在（或 harness_messages 表暂缺）→ 返回 { messages: [] }，绝不 404/500
 * - 响应仅含 messages 键，禁用 data/items/results/payload/list
 */
router.get('/messages/:initiativeId/:subTaskId', async (req, res) => {
  const { initiativeId, subTaskId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, message, created_at, consumed_at
         FROM harness_messages
        WHERE initiative_id = $1 AND sub_task_id = $2 AND consumed_at IS NULL
        ORDER BY created_at ASC`,
      [initiativeId, subTaskId]
    );
    res.json({ messages: rows });
  } catch (err) {
    // 表暂缺（WS1 migration 未合）或 id 非法：优雅降级为空列表
    console.warn(`[GET /harness/messages] ${err.message}`);
    res.json({ messages: [] });
  }
});

/**
 * POST /messages/:initiativeId/:subTaskId
 * 写入一条消息到 harness_messages（consumed_at=NULL）。
 * - 无 message 字段 → 400
 * - 成功 → 201 + { id, message, created_at }，禁用 data/result/payload/body
 * - harness_messages 表未就绪（WS1 migration 未合）→ 503（依赖未就绪）
 */
router.post('/messages/:initiativeId/:subTaskId', async (req, res) => {
  const { initiativeId, subTaskId } = req.params;
  const { message } = req.body ?? {};
  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'message is required' });
  }
  const id = randomUUID();
  try {
    const { rows } = await pool.query(
      `INSERT INTO harness_messages (id, initiative_id, sub_task_id, message, consumed_at)
       VALUES ($1, $2, $3, $4, NULL)
       RETURNING id, message, created_at`,
      [id, initiativeId, subTaskId, message]
    );
    res.status(201).json({
      id: rows[0].id,
      message: rows[0].message,
      created_at: rows[0].created_at,
    });
  } catch (err) {
    console.warn(`[POST /harness/messages] ${err.message}`);
    res.status(503).json({ error: 'harness_messages unavailable' });
  }
});

router.get('/ping', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * GET /skill-drift
 * 只读检测 6 个 harness skill 的 SSOT 与快照 SKILL.md frontmatter version 漂移。
 * SSOT: SKILLS_SSOT_DIR（默认 ~/perfect21/zenithjoy-skills，支持 <name>/SKILL.md 与
 *       skills/<name>/SKILL.md 两种布局探测）
 * 快照: SKILLS_SNAPSHOT_DIR（默认 repo 内 packages/workflows/skills/）
 * 每次请求实读磁盘，不缓存；仅检测，不写文件、无 DB 访问。
 */
const HARNESS_DRIFT_SKILLS = [
  'harness-planner',
  'harness-contract-proposer',
  'harness-contract-reviewer',
  'harness-generator',
  'harness-evaluator',
  'harness-report',
];

// 与合同交叉验证命令 grep -m1 '^version:' 同语义：取文件首个 version: 行的值
async function readSkillVersion(filePath) {
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  const line = content.split('\n').find((l) => l.startsWith('version:'));
  if (!line) return null;
  const value = line.slice('version:'.length).replace(/[\s"]/g, '');
  return value || null;
}

async function readSsotSkillVersion(ssotDir, name) {
  for (const candidate of [join(ssotDir, name, 'SKILL.md'), join(ssotDir, 'skills', name, 'SKILL.md')]) {
    try {
      await access(candidate);
    } catch {
      continue;
    }
    return readSkillVersion(candidate);
  }
  return null;
}

router.get('/skill-drift', async (_req, res) => {
  try {
    const ssotDir = process.env.SKILLS_SSOT_DIR || join(homedir(), 'perfect21', 'zenithjoy-skills');
    // 生产容器修复：模块级 REPO_ROOT 由 import.meta.url 算 → 镜像里是 /app（无 packages/workflows）。
    // deploy 已把宿主 repo 以绝对路径挂进容器并设 env REPO_ROOT（同 zombie-cleaner/startup-recovery 惯例），
    // 故快照路径优先用 process.env.REPO_ROOT，复用现成挂载，避免 snapshot_version 全 null。
    const snapshotRepoRoot = process.env.REPO_ROOT || REPO_ROOT;
    const snapshotDir = process.env.SKILLS_SNAPSHOT_DIR || join(snapshotRepoRoot, 'packages', 'workflows', 'skills');
    const skills = [];
    for (const name of HARNESS_DRIFT_SKILLS) {
      const ssotVersion = await readSsotSkillVersion(ssotDir, name);
      const snapshotVersion = await readSkillVersion(join(snapshotDir, name, 'SKILL.md'));
      // 任一侧 null（文件缺失/无 version 行）按 PRD 边界规则记为漂移
      const drifted = ssotVersion === null || snapshotVersion === null
        ? true
        : ssotVersion !== snapshotVersion;
      skills.push({ name, ssot_version: ssotVersion, snapshot_version: snapshotVersion, drifted });
    }
    return res.json({ skills, any_drift: skills.some((s) => s.drifted) });
  } catch (err) {
    console.error('[GET /harness/skill-drift]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /skill-drift/patrol-history
 * 查询 skill-drift 巡检告警历史记录。
 * Response 200: { alerts: Array<{id, skill_name, ssot_version, snapshot_version, drift_date, detected_at}> }
 */
router.get('/skill-drift/patrol-history', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, skill_name, ssot_version, snapshot_version,
              to_char(drift_date, 'YYYY-MM-DD') AS drift_date,
              detected_at
       FROM skill_drift_alerts
       ORDER BY detected_at DESC
       LIMIT 500`
    );
    return res.json({ alerts: rows });
  } catch (err) {
    console.error('[GET /harness/skill-drift/patrol-history]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /disk-guard/trigger
 * 手动触发一次 disk-guard 磁盘哨兵（供 E2E 测试使用，自动重置节流 gate）。
 * Response 200: { triggered: true, used: number, action: string, log: string }
 */
router.post('/disk-guard/trigger', async (_req, res) => {
  try {
    const { runDiskGuard, __resetDiskGuardForTest } = await import('../cron/disk-guard.js');
    __resetDiskGuardForTest(); // 重置节流 gate，确保本次触发不被跳过
    const logs = [];
    const origLog = console.log.bind(console);
    console.log = (...args) => { logs.push(args.join(' ')); origLog(...args); };
    let result;
    try {
      result = await runDiskGuard();
    } finally {
      console.log = origLog;
    }
    const diskCheckLog = logs.find(l => l.includes('[disk_check]')) || '';
    return res.json({ triggered: true, result, log: diskCheckLog, all_logs: logs });
  } catch (err) {
    console.error('[POST /harness/disk-guard/trigger]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /skill-drift/patrol-trigger
 * 手动触发一次 skill-drift 巡检（供 E2E 测试使用，无需等待每日窗口）。
 * Response 200: { triggered: true, message: string }
 */
router.post('/skill-drift/patrol-trigger', async (_req, res) => {
  try {
    const { runSkillDriftPatrol } = await import('../cron/skill-drift-patrol.js');
    await runSkillDriftPatrol();
    return res.json({ triggered: true, message: 'patrol 已完成' });
  } catch (err) {
    console.error('[POST /harness/skill-drift/patrol-trigger]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /phase-event
 * 记录 harness phase 开始事件（含 model）。
 * Body: { initiative_id, node, status='running', model }
 * Response 201: { id, initiative_id, node, status, model, ts }
 */
router.post('/phase-event', async (req, res) => {
  const { initiative_id, node, status = 'running', model } = req.body ?? {};
  if (!initiative_id || !node) {
    return res.status(400).json({ error: 'initiative_id and node are required' });
  }
  const ts = Math.floor(Date.now() / 1000);
  try {
    const { rows } = await pool.query(
      `INSERT INTO initiative_run_events (initiative_id, node, status, ts, model)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, initiative_id, node, status, model, ts`,
      [initiative_id, node, status, ts, model ?? null]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /harness/phase-event]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /phase-event/:id
 * 记录 harness phase 结束事件（ts_end + cost_usd + status）。
 * Body: { status, ts_end, cost_usd }
 * Response 200: { id, initiative_id, node, status, model, ts, ts_end, cost_usd }
 * 404 + { error: string } 当 :id 不存在
 */
router.patch('/phase-event/:id', async (req, res) => {
  const { id } = req.params;
  const { status, ts_end, cost_usd } = req.body ?? {};
  try {
    const { rows } = await pool.query(
      `UPDATE initiative_run_events
          SET ts_end   = COALESCE($2, ts_end),
              cost_usd = COALESCE($3, cost_usd),
              status   = COALESCE($4, status)
        WHERE id = $1
        RETURNING id, initiative_id, node, status, model, ts, ts_end, cost_usd`,
      [id, ts_end ?? null, cost_usd ?? null, status ?? null]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: `phase-event id ${id} not found` });
    }
    const row = rows[0];
    return res.json({
      id: row.id,
      initiative_id: row.initiative_id,
      node: row.node,
      status: row.status,
      model: row.model,
      ts: row.ts,
      ts_end: row.ts_end !== null ? Number(row.ts_end) : null,
      cost_usd: row.cost_usd !== null ? Number(row.cost_usd) : null,
    });
  } catch (err) {
    console.error('[PATCH /harness/phase-event/:id]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /promote/:resultId — Slice2：主理人放行回流接口（客户线 pending_promote → promoted）
 *
 * 幂等状态机：仅当 promote_status='pending_promote' 时接受；置 promoting → 终态。
 * - 内部线（base_repo=cecelia，理论上已 auto_promoted，不会 pending；若 base_repo 缺失走到这）：
 *   跑 in-repo promote。
 * - 客户线（base_repo=zenithjoy）：决策1 跨 repo 边界——Cecelia 不跨 repo 伸手打 zenithjoy 生产，
 *   confirm 只把本 repo 状态标 promoted（记录主理人已放行），真打 zenithjoy 生产由 zenithjoy repo 放行闸接。
 * 非 pending_promote（已 promoted / auto_promoted / 不存在）→ 409，防重复 promote。
 */
router.post('/promote/:resultId', async (req, res) => {
  const { resultId } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(resultId)) return res.status(400).json({ error: 'invalid resultId (uuid required)' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 行级锁 + 仅 pending_promote 可放行（幂等：并发/重复 confirm 只第一次生效）
    const sel = await client.query(
      `SELECT id, initiative_id, pr_url, verdict, promote_status FROM staging_e2e_results WHERE id = $1::uuid FOR UPDATE`,
      [resultId]
    );
    if (sel.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'staging_e2e_result not found' }); }
    const row = sel.rows[0];
    if (row.promote_status !== 'pending_promote') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `not pending_promote (current=${row.promote_status})`, promote_status: row.promote_status });
    }
    await client.query(`UPDATE staging_e2e_results SET promote_status = 'promoting' WHERE id = $1::uuid`, [resultId]);
    await client.query('COMMIT');

    // 放行：本 repo 内部线跑 promote 脚本；客户线只记录确认（不跨 repo）。
    const { resolveLine, runInternalPromote, defaultPromoteExec, getRepoRoot, PROMOTE_STATUS,
            spawnHarnessReport, readProductionInfo, REPORT_KIND } = await import('../staging-promote.js');
    const line = resolveLine(req.body?.base_repo || '');
    let finalStatus = PROMOTE_STATUS.PROMOTED;
    let output = 'owner confirmed';
    if (line === 'internal') {
      const r = await runInternalPromote({ promoteExec: defaultPromoteExec(getRepoRoot()) });
      finalStatus = r.ok ? PROMOTE_STATUS.PROMOTED : PROMOTE_STATUS.PROMOTE_FAILED;
      output = r.output;
    } else {
      // 客户线/unknown：决策1 不跨 repo 打 zenithjoy 生产，只标已放行
      output = `owner confirmed (customer line: real zenithjoy prod promote handled by zenithjoy repo gate)`;
    }
    await pool.query(
      `UPDATE staging_e2e_results SET promote_status = $2, promote_output = $3, promoted_at = now(),
        promoted_by = COALESCE($4, promoted_by) WHERE id = $1::uuid`,
      [resultId, finalStatus, String(output).slice(0, 4000), req.body?.promoted_by || 'owner']
    );
    // Slice3：confirm 放行成功 → 派成功交付证书 report（幂等 by initiative_id；失败不派，靠 reportNode 失败路径）。
    if (finalStatus === PROMOTE_STATUS.PROMOTED) {
      const prod = readProductionInfo(getRepoRoot());
      await spawnHarnessReport(
        { dbQuery: (sql, p) => pool.query(sql, p) },
        {
          initiativeId: row.initiative_id, prUrl: row.pr_url,
          reportKind: REPORT_KIND.SUCCESS,
          stagingE2eVerdict: row.verdict,
          promoteStatus: finalStatus,
          promotedAt: new Date().toISOString(),
          promotedBy: req.body?.promoted_by || 'owner',
          productionVersion: prod.productionVersion,
          rollbackAnchor: prod.rollbackAnchor,
        },
      );
    }
    return res.json({ ok: finalStatus !== PROMOTE_STATUS.PROMOTE_FAILED, resultId, promote_status: finalStatus });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error('[POST /harness/promote/:resultId]', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/brain/harness/judge — judge 环 API 化（跨 repo 刀2）。
 * 语义镜像 scripts/harness-judge-cli.mjs main()（该 CLI 保留兼容）：
 * 三必填校验 → verdict 回退读 .brain-result.json → FIXED 归一 PASS → runJudgeGate 透传。
 * HTTP 恒 200 承载裁决（等价 CLI exit 0/2 由调用方按 body.verdict 分支）。
 */
router.post('/judge', judgeRateLimit, async (req, res) => {
  const { task_id, run_id, sprint_dir, worktree, agent_verdict, agent_feedback, prompt_dir, transcript_file } = req.body || {};
  if (!task_id || !sprint_dir || !worktree) {
    return res.status(400).json({ error: 'task_id/sprint_dir/worktree 必填' });
  }
  if (!UUID_RE.test(String(task_id))) {
    return res.status(400).json({ error: 'task_id 必须是 uuid' });
  }
  if (typeof worktree !== 'string' || !isAbsolute(worktree)) {
    return res.status(400).json({ error: 'worktree 必须是绝对路径' });
  }
  try {
    normalizeJudgeSprintDir(sprint_dir);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (prompt_dir || transcript_file) {
    return res.status(400).json({
      error: 'prompt_dir/transcript_file 不接受客户端路径；证据由服务端 worktree 收集',
    });
  }
  let safeWorktree;
  let safeSprintDir;
  let authoritativeRunId;
  try {
    const requestPool = req.app.get('pool') || pool;
    const authority = await loadJudgeAuthority(requestPool, {
      runId: run_id,
      taskId: task_id,
    });
    if (worktree !== authority.worktreePath || sprint_dir !== authority.sprintDir) {
      return res.status(409).json({ error: 'judge filesystem authority mismatch' });
    }
    safeWorktree = await resolveStoredJudgeWorktree(authority.worktreePath);
    safeSprintDir = normalizeJudgeSprintDir(authority.sprintDir);
    authoritativeRunId = authority.runId;
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  // 读取 .brain-result.json（完整对象，供机械预检 + runJudgeGate 使用）
  let resolvedBrainResult = null;
  let verdict = agent_verdict;
  let feedback = agent_feedback;
  try {
    resolvedBrainResult = JSON.parse(
      await readFile(join(safeWorktree, '.brain-result.json'), 'utf8'),
    );
    if (!verdict) { verdict = resolvedBrainResult.verdict; }
    if (feedback === undefined) { feedback = resolvedBrainResult.feedback; }
  } catch { /* verdict 缺省路径下方统一 400 */ }
  if (!verdict) {
    return res.status(400).json({ error: 'agent_verdict 缺失且 .brain-result.json 不可读' });
  }
  if (verdict === 'FIXED') verdict = 'PASS'; // 前科语义归一（memory: harness-evaluator-verdict-bug）

  // 刀B — 机械预检（同步，纯结构校验，不调 AI）
  const mechFailSync = runMechanicalPreflightChecks(resolvedBrainResult);
  if (mechFailSync) {
    console.warn(`[POST /harness/judge] 机械预检 FAIL: ${mechFailSync.mechFail} task=${task_id}`);
    return res.json({ ...mechFailSync, judged: false });
  }
  // 刀B — judgments_written 对账（异步，DB 查 decisions 表）
  const mechFailAsync = await checkJudgmentsWritten(resolvedBrainResult, task_id, pool);
  if (mechFailAsync) {
    console.warn(`[POST /harness/judge] judgments_written 不匹配 FAIL task=${task_id}`);
    return res.json({ ...mechFailAsync, judged: false });
  }

  try {
    const result = await runJudgeGate({
      agentVerdict: verdict,
      agentFeedback: feedback,
      worktreePath: safeWorktree,
      sprintDir: safeSprintDir,
      taskId: task_id,
      instanceLabel: `judge-api-${String(task_id).slice(0, 8)}`,
    }, { dbPool: pool });

    // 刀C-2：judge 判定后自写 judge_verdict 落库（不依赖 controller 容器内 curl 上报）
    // 只写 judged=true 的真实裁决；PASS 禁被回退，FAIL→PASS 允许收敛；写失败 non-fatal
    if (result?.judged === true) {
      try {
        await pool.query(
          `UPDATE initiative_runs SET judge_verdict = $1
            WHERE id = $2
              AND current_task_id = $3
              AND orchestrator_version = 'v2'
              AND judge_verdict IS DISTINCT FROM 'PASS'`,
          [result.verdict, String(authoritativeRunId), String(task_id)]
        );
      } catch (dbErr) {
        console.warn(`[POST /harness/judge] judge_verdict 落库失败（non-fatal）: ${dbErr.message}`);
      }
    }

    return res.json(result);
  } catch (err) {
    console.error('[POST /harness/judge]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

/**
 * POST /staging-e2e — staging_e2e 派生端点（刀4 重构阶段1，决策 76ab76ea）。
 * 背景：原派生源 mergePrNode._spawnStagingE2eTask 属 LangGraph 图，skill-relay 迁移后图不跑
 * → staging→production 放行层悬空。本端点把派生迁到图外，供 controller merge 成功后调用；
 * 删图（阶段3）后成为唯一生产者。幂等：按 payload->>'pr_url' WHERE NOT EXISTS 去重（复刻原逻辑）。
 */
router.post('/staging-e2e', async (req, res) => {
  const { pr_url, pr_branch, sub_task_id, initiative_id, journey_id, base_repo, project_id } = req.body || {};
  if (!pr_url) return res.status(400).json({ error: 'pr_url 必填' });
  const payload = {
    pr_url,
    pr_branch: pr_branch || '',
    sub_task_id: sub_task_id || '',
    initiative_id: initiative_id || '',
    journey_id: journey_id || '',
    base_repo: base_repo || '',
    project_id: project_id || '',
  };
  try {
    const r = await pool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, payload)
       SELECT $1, $2, 'staging_e2e', 'queued', 'P2', $3::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM tasks WHERE task_type = 'staging_e2e' AND payload->>'pr_url' = $4
       )`,
      [
        `[Staging E2E] ${pr_branch || pr_url}`,
        `Auto-spawned by controller relay (post-merge): deploy :5222 + contract E2E for ${pr_url}`,
        JSON.stringify(payload),
        pr_url,
      ]
    );
    const created = r.rowCount > 0;
    if (created) console.log(`[staging-e2e endpoint] spawned staging_e2e task for pr=${pr_url}`);
    return res.json(created ? { created: true } : { created: false, reason: 'already_exists' });
  } catch (err) {
    console.error('[POST /harness/staging-e2e]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

export default router;
