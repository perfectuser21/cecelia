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
import { execSync } from 'child_process';
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

    // 5. 构建串行步骤列表（含 input/prompt/output 数据重建）
    const steps = buildSteps(tasks, sprintDir);

    // 6. 读取 sprint 目录下的文件内容
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
      steps,
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

// ─── Steps 串行步骤构建 ──────────────────────────────────────────────────────

const SKILL_MAP = {
  harness_planner: 'harness-planner',
  sprint_planner: 'harness-planner',
  harness_contract_propose: 'harness-contract-proposer',
  sprint_contract_propose: 'harness-contract-proposer',
  harness_contract_review: 'harness-contract-reviewer',
  sprint_contract_review: 'harness-contract-reviewer',
  harness_generate: 'harness-generator',
  sprint_generate: 'harness-generator',
  harness_fix: 'harness-generator',
  harness_report: 'harness-report',
  sprint_report: 'harness-report',
};

/**
 * 从 git 中读取指定分支的文件内容
 */
function gitShowFile(branch, filePath) {
  if (!branch) return null;
  for (const ref of [`origin/${branch}`, branch]) {
    try {
      return execSync(`git show ${ref}:${filePath}`, {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 10000,
      });
    } catch {
      // 继续尝试下一个 ref
    }
  }
  return null;
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
      .filter((b, i, arr) => arr.indexOf(b) === i); // dedupe
  } catch {
    return [];
  }
}

/**
 * 为 harness_planner 任务找到其输出分支（存有 sprint-prd.md 的分支）
 * 策略：从同 pipeline 的 propose 任务的 payload.planner_branch 字段获取
 */
function findPlannerBranch(plannerTask, allTasks) {
  // 先从 propose 任务的 payload 里找
  for (const t of allTasks) {
    if ((t.task_type === 'harness_contract_propose' || t.task_type === 'sprint_contract_propose')
        && t.payload?.planner_branch) {
      return t.payload.planner_branch;
    }
  }
  // fallback：按 task_id 前缀搜 git branch
  const branches = findBranchesByTaskId(plannerTask.task_id);
  return branches.find(b => b.includes('planner') || b.includes(plannerTask.task_id?.slice(0, 8))) || branches[0] || null;
}

/**
 * 为 propose 任务找到其输出分支
 */
function findProposeBranch(task) {
  if (task.result?.propose_branch) return task.result.propose_branch;
  const branches = findBranchesByTaskId(task.task_id);
  return branches.find(b => b.includes('propose')) || branches[0] || null;
}

/**
 * 为 review 任务找到其输出分支
 */
function findReviewBranch(task) {
  if (task.result?.review_branch) return task.result.review_branch;
  if (task.result?.contract_branch) return task.result.contract_branch;
  const branches = findBranchesByTaskId(task.task_id);
  return branches.find(b => b.includes('review')) || branches[0] || null;
}

/**
 * 重建某一步骤的 input / prompt / output 内容
 */
function reconstructStepContent(task, sprintDir, allTasks) {
  const taskType = task.task_type;
  const desc = task.description || task.payload?.feature_description || task.title || '';
  const taskId = task.task_id;

  if (taskType === 'harness_planner' || taskType === 'sprint_planner') {
    const plannerBranch = findPlannerBranch(task, allTasks);
    const input = desc;
    const prompt = `/harness-planner\n\n## Harness v4.0 — Planner\n\ntask_id: ${taskId}\nsprint_dir: ${sprintDir}\n\n${desc}`;
    const output = gitShowFile(plannerBranch, `${sprintDir}/sprint-prd.md`);
    return { input, prompt, output };
  }

  if (taskType === 'harness_contract_propose' || taskType === 'sprint_contract_propose') {
    const plannerBranch = task.payload?.planner_branch || null;
    const proposeBranch = findProposeBranch(task);
    const proposeRound = task.payload?.propose_round || 1;
    const input = gitShowFile(plannerBranch, `${sprintDir}/sprint-prd.md`) || desc;
    const prompt = `/harness-contract-proposer\n\n## Harness v4.0 — Contract Proposer\n\ntask_id: ${taskId}\nsprint_dir: ${sprintDir}\npropose_round: ${proposeRound}\nplanner_task_id: ${task.payload?.planner_task_id || ''}\nplanner_branch: ${plannerBranch || ''}\n\n${desc}`;
    const output = gitShowFile(proposeBranch, `${sprintDir}/contract-draft.md`);
    return { input, prompt, output };
  }

  if (taskType === 'harness_contract_review' || taskType === 'sprint_contract_review') {
    const proposeBranch = task.payload?.propose_branch || null;
    const reviewBranch = findReviewBranch(task);
    const proposeRound = task.payload?.propose_round || 1;
    const input = gitShowFile(proposeBranch, `${sprintDir}/contract-draft.md`) || desc;
    const prompt = `/harness-contract-reviewer\n\n## Harness v4.0 — Contract Reviewer\n\ntask_id: ${taskId}\nsprint_dir: ${sprintDir}\npropose_task_id: ${task.payload?.propose_task_id || ''}\npropose_round: ${proposeRound}\npropose_branch: ${proposeBranch || ''}\n\n${desc}`;
    const output = gitShowFile(reviewBranch, `${sprintDir}/contract-review-feedback.md`);
    return { input, prompt, output };
  }

  if (taskType === 'harness_generate' || taskType === 'harness_fix' || taskType === 'sprint_generate') {
    const contractBranch = task.payload?.contract_branch || null;
    const input = gitShowFile(contractBranch, `${sprintDir}/sprint-contract.md`) || desc;
    const prompt = `/harness-generator\n\n## Harness v4.0 — Generate\n\ntask_id: ${taskId}\nsprint_dir: ${sprintDir}\n\n${desc}`;
    const output = null; // Generate 输出为 PR，无法从 git 直接读取单文件
    return { input, prompt, output };
  }

  if (taskType === 'harness_report' || taskType === 'sprint_report') {
    const input = desc;
    const prompt = `/harness-report\n\n## Harness v4.0 — Report\n\ntask_id: ${taskId}\nsprint_dir: ${sprintDir}\npr_url: ${task.payload?.pr_url || ''}\n\n${desc}`;
    const output = gitShowFile(null, `${sprintDir}/harness-report.md`);
    return { input, prompt, output };
  }

  // 未知类型 fallback
  const skillName = SKILL_MAP[taskType] || taskType;
  return {
    input: desc,
    prompt: `/${skillName}\n\ntask_id: ${taskId}\n\n${desc}`,
    output: null,
  };
}

/**
 * 构建串行步骤列表
 */
function buildSteps(tasks, sprintDir) {
  const steps = [];
  let stepNum = 0;
  const proposeCount = {};
  const reviewCount = {};

  for (const task of tasks) {
    stepNum++;
    const taskType = task.task_type;
    let label;

    if (taskType === 'harness_contract_propose' || taskType === 'sprint_contract_propose') {
      const round = task.payload?.propose_round || (proposeCount[taskType] = (proposeCount[taskType] || 0) + 1, proposeCount[taskType]);
      label = `Propose R${round}`;
    } else if (taskType === 'harness_contract_review' || taskType === 'sprint_contract_review') {
      const round = task.payload?.propose_round || (reviewCount[taskType] = (reviewCount[taskType] || 0) + 1, reviewCount[taskType]);
      label = `Review R${round}`;
    } else {
      const labels = {
        harness_planner: 'Planner', sprint_planner: 'Planner',
        harness_generate: 'Generate', sprint_generate: 'Generate',
        harness_fix: 'Fix',
        harness_ci_watch: 'CI Watch',
        harness_report: 'Report', sprint_report: 'Report',
        harness_evaluate: 'Evaluate',
      };
      label = labels[taskType] || taskType;
    }

    const isCompleted = task.status === 'completed';
    let inputContent = null;
    let promptContent = null;
    let outputContent = null;

    if (isCompleted) {
      const content = reconstructStepContent(task, sprintDir, tasks);
      inputContent = content.input ?? null;
      promptContent = content.prompt ?? null;
      outputContent = content.output ?? null;
    }

    steps.push({
      step: stepNum,
      task_id: task.task_id,
      task_type: taskType,
      label,
      status: task.status,
      created_at: task.created_at,
      completed_at: task.completed_at || null,
      input_content: isCompleted ? inputContent : null,
      prompt_content: isCompleted ? promptContent : null,
      output_content: isCompleted ? outputContent : null,
    });
  }

  return steps;
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
