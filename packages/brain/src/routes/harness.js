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
import { readFile } from 'fs/promises';
import { join } from 'path';
import pool from '../db.js';

const router = Router();

// routes/harness.js → packages/brain/src/routes/ → 向上 4 级到仓库根
const REPO_ROOT = new URL('../../../..', import.meta.url).pathname;

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

    // 2. 提取 planner 信息
    const planner = tasks.find(t => t.task_type === 'harness_planner' || t.task_type === 'sprint_planner');
    const sprintDir = planner?.payload?.sprint_dir || tasks[0]?.payload?.sprint_dir || 'sprints';

    // 3. 构建 GAN 对抗轮次
    const ganRounds = buildGanRounds(tasks);

    // 4. 构建阶段列表
    const stages = buildStages(tasks);

    // 5. 读取 sprint 目录下的文件内容
    const fileContents = await readSprintFiles(sprintDir);

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
 * 构建阶段概览（按标准 6 步排列）
 */
function buildStages(tasks) {
  const STAGE_ORDER = [
    'harness_planner', 'harness_contract_propose', 'harness_contract_review',
    'harness_generate', 'harness_ci_watch', 'harness_report',
  ];
  const STAGE_LABELS = {
    harness_planner: 'Planner',
    harness_contract_propose: 'Propose',
    harness_contract_review: 'Review',
    harness_generate: 'Generate',
    harness_ci_watch: 'CI Watch',
    harness_report: 'Report',
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

  // 也尝试读取 workstream 合同
  for (let i = 1; i <= 5; i++) {
    const wsFile = `contract-dod-ws${i}.md`;
    try {
      const filePath = join(REPO_ROOT, sprintDir, wsFile);
      files[wsFile] = await readFile(filePath, 'utf8');
    } catch {
      break; // 一旦某个 ws 不存在，后续大概也没有
    }
  }

  return files;
}

export default router;
