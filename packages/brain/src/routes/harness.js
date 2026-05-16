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
import { homedir } from 'os';
import pool from '../db.js';

const router = Router();

// routes/harness.js → packages/brain/src/routes/ → 向上 4 级到仓库根
const REPO_ROOT = new URL('../../../..', import.meta.url).pathname;

// LangGraph Harness pipeline 架构图（静态，节点拓扑从 harness-graph.js 对应过来）
// 前端用 mermaid.render() 画成 SVG
const HARNESS_MERMAID = `graph TD
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
    const planner = tasks.find(t => t.task_type === 'sprint_planner');
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

  if (events.length === 0) {
    return { ...empty, checkpoints };
  }

  // 把每条事件 normalize 成 step
  const steps = events.map((row, idx) => {
    const p = row.payload || {};
    // 从 review_verdict / evaluator_verdict 里取一个作为 verdict
    const verdict = p.review_verdict || p.evaluator_verdict || null;
    return {
      step_index: typeof p.step_index === 'number' ? p.step_index : idx + 1,
      node: p.node || 'unknown',
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
    };
  });

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
 * SSE 实时推送 harness pipeline 节点进度
 *
 * event: node_update  data: {attempt, label, node, ts}
 * event: done         data: {status, verdict}
 * : keepalive         （每 30s 一次）
 */
router.get('/stream', async (req, res) => {
  const { planner_task_id } = req.query;

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

export default router;
