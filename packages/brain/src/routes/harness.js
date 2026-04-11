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
import { execSync } from 'child_process';
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

    // 6. 构建串行步骤列表（含 input/prompt/output）
    const steps = await buildSteps(tasks, sprintDir);

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

/**
 * 从远程分支读取文件内容（复用 executor.js _fetchSprintFile 逻辑）
 */
function fetchFileFromBranch(branch, filePath) {
  if (!branch) return null;
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
    // 也尝试本地分支
    try {
      return execSync(`git show ${branch}:${filePath}`, {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      return null;
    }
  }
}

/**
 * 在 git 分支列表中搜索含有 task_id 前缀的分支
 */
function findBranchesByTaskId(taskId) {
  if (!taskId) return [];
  const prefix = taskId.slice(0, 8);
  try {
    const output = execSync('git branch -a', {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    });
    return output.split('\n')
      .map(b => b.trim().replace(/^\* /, '').replace(/^remotes\/origin\//, ''))
      .filter(b => b.includes(prefix) && b !== '')
      .filter((b, i, arr) => arr.indexOf(b) === i);
  } catch {
    return [];
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

  if (t === 'harness_planner' || t === 'sprint_planner') {
    return `/harness-planner\n\n## Harness v4.0 — Planner\n\ntask_id: ${id}\nsprint_dir: ${sprintDir}\n\n${desc}`;
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

  if (t === 'harness_evaluate' || t === 'sprint_evaluate') {
    return `/harness-evaluator\n\ntask_id: ${id}\nsprint_dir: ${sprintDir}\n\n${desc}`;
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

  if (t === 'harness_planner' || t === 'sprint_planner') {
    return task.description || task.payload?.description || task.title || null;
  }

  if (t === 'harness_contract_propose' || t === 'sprint_contract_propose') {
    let plannerBranch = task.payload?.planner_branch;
    // planner_branch 常为 null，通过 planner_task_id 的 git branch 搜索
    if (!plannerBranch && task.payload?.planner_task_id) {
      const branches = findBranchesByTaskId(task.payload.planner_task_id);
      plannerBranch = branches.find(b => b.includes('planner')) || branches[0] || null;
    }
    return fetchFileFromBranch(plannerBranch, `${sprintDir}/sprint-prd.md`);
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
      // 仍未找到：通过 propose_task_id 搜 git branch
      if (!proposeBranch && task.payload?.propose_task_id) {
        const branches = findBranchesByTaskId(task.payload.propose_task_id);
        proposeBranch = branches.find(b => b.includes('propose') || b.includes('contract')) || branches[0] || null;
      }
    }
    return fetchFileFromBranch(proposeBranch, `${sprintDir}/contract-draft.md`);
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

  // Planner：branch 不在自身 result，从 propose 任务 payload 或 git branch 搜索
  if (t === 'harness_planner' || t === 'sprint_planner') {
    let useBranch = branch || plannerBranchFromPropose;
    // 通过 task_id 前缀搜 git branch 作为 fallback
    if (!useBranch) {
      const branches = findBranchesByTaskId(task.task_id);
      useBranch = branches.find(b => b.includes('planner')) || branches[0] || null;
    }
    return fetchFileFromBranch(useBranch, `${sprintDir}/sprint-prd.md`);
  }

  if (t === 'harness_contract_propose' || t === 'sprint_contract_propose') {
    // propose_branch 可能为 null，通过 task_id 搜 git branch
    let useBranch = branch;
    if (!useBranch) {
      const branches = findBranchesByTaskId(task.task_id);
      useBranch = branches.find(b => b.includes('propose') || b.includes('contract')) || branches[0] || null;
    }
    const content = fetchFileFromBranch(useBranch, `${sprintDir}/contract-draft.md`);
    if (content) return content;
    // fallback：verdict/feedback 摘要
    if (task.result?.verdict) return `Verdict: ${task.result.verdict}`;
    return task.result?.feedback || task.result?.result_summary || null;
  }

  if (t === 'harness_contract_review' || t === 'sprint_contract_review') {
    // review_branch 通常存在于 result
    let useBranch = branch;
    if (!useBranch) {
      const branches = findBranchesByTaskId(task.task_id);
      useBranch = branches.find(b => b.includes('review')) || branches[0] || null;
    }
    const feedback = fetchFileFromBranch(useBranch, `${sprintDir}/contract-review-feedback.md`);
    if (feedback) return feedback;
    if (task.result?.feedback) return task.result.feedback;
    return task.result?.verdict ? `Verdict: ${task.result.verdict}` : null;
  }

  if (t === 'harness_generate' || t === 'sprint_generate' || t === 'harness_fix') {
    const prUrl = task.pr_url || task.result?.pr_url || null;
    return prUrl ? `PR: ${prUrl}` : null;
  }

  if (t === 'harness_report' || t === 'sprint_report') {
    const content = fetchFileFromBranch(branch, `${sprintDir}/harness-report.md`);
    if (content) return content;
    return task.result?.result_summary || null;
  }

  if (!branch) {
    if (task.result?.verdict) return `Verdict: ${task.result.verdict}`;
    if (task.result?.feedback) return task.result.feedback;
    return task.result?.result_summary || null;
  }

  return null;
}

/**
 * 生成步骤标签（含轮次编号）
 */
function buildStepLabel(taskType, counters) {
  const BASE_LABELS = {
    harness_planner: 'Planner', sprint_planner: 'Planner',
    harness_contract_propose: 'Propose', sprint_contract_propose: 'Propose',
    harness_contract_review: 'Review', sprint_contract_review: 'Review',
    harness_generate: 'Generate', sprint_generate: 'Generate',
    harness_fix: 'Fix', sprint_fix: 'Fix',
    harness_evaluate: 'Evaluate', sprint_evaluate: 'Evaluate',
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
    const [inputContent, outputContent] = await Promise.all([
      getStepInput(task, sprintDir),
      getStepOutput(task, sprintDir, plannerBranchFromPropose),
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
    });
  }

  return steps;
}

export default router;
