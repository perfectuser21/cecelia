/**
 * Planner Agent - Brain's planning layer
 *
 * Dynamic planning loop: each tick selects the best KR → Project → Task to advance.
 * V1: dispatches existing queued tasks; flags when manual planning is needed.
 */

import pool from '../task-system/db.js';
import { getDailyFocus } from './focus.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { generatePrdFromGoalKR } from './templates.js';

/**
 * Get global state for planning decisions
 */
async function getGlobalState() {
  const [objectives, keyResults, projects, activeTasks, recentCompleted, focusResult] = await Promise.all([
    pool.query(`
      SELECT * FROM goals
      WHERE type = 'objective' AND status NOT IN ('completed', 'cancelled')
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    `),
    pool.query(`
      SELECT * FROM goals
      WHERE type = 'key_result' AND status NOT IN ('completed', 'cancelled')
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    `),
    pool.query(`SELECT * FROM projects WHERE status = 'active'`),
    pool.query(`SELECT * FROM tasks WHERE status IN ('queued', 'in_progress') ORDER BY created_at ASC`),
    pool.query(`SELECT * FROM tasks WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 10`),
    getDailyFocus()
  ]);

  return {
    objectives: objectives.rows,
    keyResults: keyResults.rows,
    projects: projects.rows,
    activeTasks: activeTasks.rows,
    recentCompleted: recentCompleted.rows,
    focus: focusResult
  };
}

/**
 * Select the KR most in need of advancement.
 */
function selectTargetKR(state) {
  const { keyResults, activeTasks, focus } = state;
  if (keyResults.length === 0) return null;

  const focusKRIds = new Set(
    focus?.focus?.key_results?.map(kr => kr.id) || []
  );

  const queuedByGoal = {};
  for (const t of activeTasks) {
    if (t.status === 'queued' && t.goal_id) {
      queuedByGoal[t.goal_id] = (queuedByGoal[t.goal_id] || 0) + 1;
    }
  }

  const scored = keyResults.map(kr => {
    let score = 0;
    if (focusKRIds.has(kr.id)) score += 100;
    if (kr.priority === 'P0') score += 30;
    else if (kr.priority === 'P1') score += 20;
    else if (kr.priority === 'P2') score += 10;
    score += (100 - (kr.progress || 0)) * 0.2;
    if (kr.target_date) {
      const daysLeft = (new Date(kr.target_date) - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysLeft > 0 && daysLeft < 14) score += 20;
      if (daysLeft > 0 && daysLeft < 7) score += 20;
    }
    if (queuedByGoal[kr.id]) score += 15;
    return { kr, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.kr || null;
}

/**
 * Select the Project most in need of advancement for a given KR.
 */
async function selectTargetProject(kr, state) {
  const { projects, activeTasks } = state;

  const linksResult = await pool.query(
    'SELECT project_id FROM project_kr_links WHERE kr_id = $1',
    [kr.id]
  );
  const linkedProjectIds = new Set(linksResult.rows.map(r => r.project_id));

  if (kr.project_id) linkedProjectIds.add(kr.project_id);

  for (const t of activeTasks) {
    if (t.goal_id === kr.id && t.project_id) linkedProjectIds.add(t.project_id);
  }

  if (linkedProjectIds.size === 0) return null;

  const candidateProjects = projects.filter(p => linkedProjectIds.has(p.id));
  if (candidateProjects.length === 0) return null;

  const queuedByProject = {};
  for (const t of activeTasks) {
    if (t.status === 'queued' && t.project_id) {
      queuedByProject[t.project_id] = (queuedByProject[t.project_id] || 0) + 1;
    }
  }

  const scored = candidateProjects.map(p => {
    let score = 0;
    if (queuedByProject[p.id]) score += 50;
    if (p.repo_path) score += 20;
    return { project: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.project || null;
}

/**
 * Generate the next task for a given KR + Project.
 * V2: returns existing queued task, or auto-generates a new one based on KR gap.
 *
 * @param {Object} kr - Target Key Result
 * @param {Object} project - Target Project
 * @param {Object} state - Global planning state
 * @param {Object} [options] - Options
 * @param {boolean} [options.dryRun=false] - If true, don't write to DB
 * @returns {Object|null} - Task or null
 */
async function generateNextTask(kr, project, state, options = {}) {
  // V1: check existing queued tasks first
  const result = await pool.query(`
    SELECT * FROM tasks
    WHERE project_id = $1 AND goal_id = $2 AND status = 'queued'
    ORDER BY
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      created_at ASC
    LIMIT 1
  `, [project.id, kr.id]);

  if (result.rows[0]) return result.rows[0];

  // V2: Auto-generate when queue is empty
  const generated = await autoGenerateTask(kr, project, state, options);
  return generated;
}

/**
 * Auto-generate a task based on KR progress gap and recently completed tasks.
 * Uses heuristic task generation (no LLM needed for V2.0).
 *
 * @param {Object} kr - Key Result with progress, title, metadata
 * @param {Object} project - Project with name, repo_path
 * @param {Object} state - Global state with recentCompleted
 * @param {Object} options - { dryRun: boolean }
 * @returns {Object|null} - Generated task or null
 */
async function autoGenerateTask(kr, project, state, options = {}) {
  const gap = 100 - (kr.progress || 0);
  if (gap <= 0) return null; // KR already complete

  // Get completed task titles for this KR to avoid duplication
  const completedResult = await pool.query(`
    SELECT title FROM tasks
    WHERE goal_id = $1 AND status = 'completed'
    ORDER BY completed_at DESC LIMIT 20
  `, [kr.id]);
  const completedTitles = completedResult.rows.map(r => r.title);

  // Get failed tasks to potentially retry
  const failedResult = await pool.query(`
    SELECT id, title, description, priority, payload FROM tasks
    WHERE goal_id = $1 AND project_id = $2 AND status = 'failed'
    ORDER BY updated_at DESC LIMIT 5
  `, [kr.id, project.id]);

  // Strategy 1: Retry most recent failed task (with retry count check)
  for (const failed of failedResult.rows) {
    const retries = failed.payload?.retry_count || 0;
    if (retries < 2) {
      const retryTitle = failed.title.startsWith('[Retry]') ? failed.title : `[Retry] ${failed.title}`;

      if (options.dryRun) {
        return { id: null, title: retryTitle, priority: failed.priority, goal_id: kr.id, project_id: project.id, _generated: true, _strategy: 'retry' };
      }

      const insertResult = await pool.query(`
        INSERT INTO tasks (title, description, priority, project_id, goal_id, status, payload)
        VALUES ($1, $2, $3, $4, $5, 'queued', $6) RETURNING *
      `, [
        retryTitle,
        failed.description || '',
        failed.priority || 'P1',
        project.id,
        kr.id,
        JSON.stringify({ retry_of: failed.id, retry_count: retries + 1, auto_generated: true })
      ]);

      return insertResult.rows[0];
    }
  }

  // Strategy 2: V3 - Generate concrete task from KR decomposition
  const taskCandidate = generateTaskFromKR(kr, project, completedTitles, gap);
  if (!taskCandidate) return null;

  const priority = kr.priority || (gap > 50 ? 'P0' : gap > 25 ? 'P1' : 'P2');

  // Generate PRD file for the task
  let prdPath = null;
  try {
    prdPath = generateTaskPRD(taskCandidate.title, taskCandidate.description, kr, project);
  } catch (err) {
    console.error('Failed to generate PRD:', err);
  }

  if (options.dryRun) {
    return {
      id: null,
      title: taskCandidate.title,
      description: taskCandidate.description,
      priority,
      goal_id: kr.id,
      project_id: project.id,
      _generated: true,
      _strategy: 'v3_decompose',
      payload: { prd_path: prdPath, auto_generated: true, kr_progress: kr.progress, kr_gap: gap }
    };
  }

  const insertResult = await pool.query(`
    INSERT INTO tasks (title, description, priority, project_id, goal_id, status, payload)
    VALUES ($1, $2, $3, $4, $5, 'queued', $6) RETURNING *
  `, [
    taskCandidate.title,
    taskCandidate.description,
    priority,
    project.id,
    kr.id,
    JSON.stringify({ auto_generated: true, prd_path: prdPath, kr_progress: kr.progress, kr_gap: gap })
  ]);

  return insertResult.rows[0];
}

// ── KR Decomposition Strategies (V3) ──────────────────────────────

/**
 * Strategy registry: maps KR keyword patterns to concrete task templates.
 * Each strategy returns an array of { title, description } candidates.
 */
const KR_STRATEGIES = [
  {
    name: 'intent_recognition',
    match: (krTitle) => /意图识别|intent|自然语言/.test(krTitle),
    tasks: [
      { title: '扩展 intent.js phrase patterns 覆盖率', description: '为每个意图类型补充更多中英文自然语言模式，提升匹配覆盖率至每类 10+ patterns' },
      { title: '添加 entity types（status/assignee/tag）', description: '新增 status、assignee、tag 等实体类型的提取 patterns' },
      { title: '增强 timeframe/dependency patterns', description: '补充"下个月"、"本季度"、"blocked by"等时间和依赖表达' },
      { title: '添加 intent 分类置信度测试', description: '为新增 patterns 编写单元测试，确保分类准确率' },
    ]
  },
  {
    name: 'prd_trd_generation',
    match: (krTitle) => /PRD|TRD|自动生成|模板/.test(krTitle),
    tasks: [
      { title: '实现 TRD 模板引擎', description: '基于 KR 上下文自动生成 TRD markdown 结构，包含里程碑分解' },
      { title: '添加 PRD 验证逻辑', description: '实现 PRD 必填字段校验（需求来源、功能描述、成功标准、非目标）' },
      { title: '实现 PRD 自动填充', description: '根据 KR metadata 和 project 信息自动填充 PRD 模板字段' },
      { title: '添加 TRD→PRD 分解流水线测试', description: '编写端到端测试验证 TRD 分解为多个 Feature PRD 的流程' },
    ]
  },
  {
    name: 'planning_engine',
    match: (krTitle) => /Planning|规划|planner|调度/.test(krTitle),
    tasks: [
      { title: '升级 planner 任务分解逻辑', description: '将 generateTaskTitle 从简单字符串拼接改为基于 KR 上下文的具体任务推断' },
      { title: '实现 planner PRD 自动生成', description: '为每个自动生成的任务创建标准 PRD 文件，路径存入 task payload' },
      { title: '添加 KR 分解策略注册机制', description: '支持按 KR 类型匹配不同的任务分解策略' },
      { title: '添加 planner V3 单元测试', description: '测试多种 KR 类型的任务分解和 PRD 生成' },
    ]
  },
  {
    name: 'self_healing',
    match: (krTitle) => /自修复|自愈|health|诊断/.test(krTitle),
    tasks: [
      { title: '实现服务健康检查 API', description: '添加 /api/health 端点，检查数据库、N8N、Cecelia 连接状态' },
      { title: '实现自动重启逻辑', description: '当健康检查失败时，自动重启对应服务组件' },
      { title: '添加健康检查定时任务', description: '通过 N8N 或 cron 定期触发健康检查' },
    ]
  },
  {
    name: 'project_lifecycle',
    match: (krTitle) => /项目系统|生命周期|project.*管理/.test(krTitle),
    tasks: [
      { title: '实现项目状态机', description: '添加项目状态流转逻辑：planning → active → completed → archived' },
      { title: '添加项目进度自动计算', description: '根据关联任务完成率自动更新项目进度' },
      { title: '实现项目归档和清理', description: '完成的项目自动归档，清理关联的临时数据' },
    ]
  },
  {
    name: 'frontend_display',
    match: (krTitle) => /前端|显示|实时|dashboard|UI/.test(krTitle),
    tasks: [
      { title: '实现执行状态实时展示组件', description: '在 Core 前端添加实时显示 Cecelia 执行状态的组件' },
      { title: '添加 WebSocket 状态推送', description: '后端通过 WebSocket 推送执行进度变更到前端' },
      { title: '实现执行日志查看页面', description: '添加执行日志流式展示和筛选功能' },
    ]
  },
  {
    name: 'n8n_scheduling',
    match: (krTitle) => /N8N|调度|触发|workflow/.test(krTitle),
    tasks: [
      { title: '实现 N8N workflow 自动创建', description: '通过 API 自动创建和配置 N8N 调度 workflow' },
      { title: '添加任务并发控制', description: '限制 N8N 同时触发的 Cecelia 任务数量（max 3）' },
      { title: '实现任务执行回调通知', description: '任务完成后通过 N8N 发送通知（Feishu/Webhook）' },
    ]
  },
  {
    name: 'cecelia_dev_flow',
    match: (krTitle) => /Cecelia|执行|\/dev|完整流程/.test(krTitle),
    tasks: [
      { title: '修复 Cecelia 无头执行卡点', description: '排查并修复 Cecelia 无头模式下 /dev 流程的阻塞问题' },
      { title: '添加执行超时和重试机制', description: '为 Cecelia 执行添加超时检测和自动重试' },
      { title: '实现执行结果自动上报', description: '执行完成后自动更新 Core 数据库和 Notion 状态' },
    ]
  },
  {
    name: 'conversation_interface',
    match: (krTitle) => /对话|接口|前台|chat/.test(krTitle),
    tasks: [
      { title: '实现对话式任务创建', description: '通过自然语言对话创建 OKR/Project/Task' },
      { title: '添加对话上下文管理', description: '维护对话历史，支持多轮对话引用' },
      { title: '实现对话响应格式化', description: '将系统响应格式化为友好的对话消息' },
    ]
  },
];

/**
 * Fallback strategy: 3-phase approach (research → implement → test)
 */
function getFallbackTasks(kr, project, gap) {
  const krTitle = kr.title || 'unknown KR';
  const projectName = project.name || 'unknown project';

  if (gap > 70) {
    return [
      { title: `调研 ${krTitle} 实现方案`, description: `分析 ${projectName} 项目中实现「${krTitle}」的技术方案，输出技术设计文档` },
      { title: `实现 ${krTitle} 核心逻辑`, description: `在 ${projectName} 项目中实现「${krTitle}」的核心功能` },
      { title: `为 ${krTitle} 编写测试`, description: `为「${krTitle}」的核心逻辑编写单元测试和集成测试` },
    ];
  } else if (gap > 30) {
    return [
      { title: `完善 ${krTitle} 功能`, description: `补充「${krTitle}」的边界处理和错误处理逻辑` },
      { title: `为 ${krTitle} 补充测试`, description: `提高「${krTitle}」相关代码的测试覆盖率` },
    ];
  } else {
    return [
      { title: `优化 ${krTitle} 细节`, description: `打磨「${krTitle}」的最后细节，确保生产可用` },
    ];
  }
}

/**
 * V3: Generate concrete task based on KR decomposition strategy.
 * Returns { title, description } or null if all candidates are duplicates.
 */
function generateTaskFromKR(kr, project, completedTitles, gap) {
  const krTitle = kr.title || '';

  // Find matching strategy
  const strategy = KR_STRATEGIES.find(s => s.match(krTitle));
  const candidates = strategy
    ? strategy.tasks
    : getFallbackTasks(kr, project, gap);

  // Filter out duplicates (title-based dedup)
  for (const candidate of candidates) {
    const isDuplicate = completedTitles.some(ct =>
      ct === candidate.title || ct.includes(candidate.title) || candidate.title.includes(ct)
    );
    if (!isDuplicate) {
      return candidate;
    }
  }

  return null; // All candidates exhausted
}

/**
 * V3: Generate a standard PRD file for an auto-generated task.
 * Returns the absolute path to the generated PRD file.
 */
const PRD_DIR = process.env.PRD_TEMP_DIR || '/tmp/cecelia-prds';

function generateTaskPRD(taskTitle, taskDescription, kr, project) {
  if (!existsSync(PRD_DIR)) {
    mkdirSync(PRD_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = taskTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '-').slice(0, 60);
  const prdPath = join(PRD_DIR, `prd-${slug}-${timestamp}.md`);

  const prdContent = generatePrdFromGoalKR({
    title: taskTitle,
    description: taskDescription,
    kr,
    project
  });

  writeFileSync(prdPath, prdContent, 'utf-8');
  return prdPath;
}

/**
 * Main entry point - called each tick.
 */
async function planNextTask() {
  const state = await getGlobalState();

  const targetKR = selectTargetKR(state);
  if (!targetKR) {
    return { planned: false, reason: 'no_active_kr' };
  }

  const targetProject = await selectTargetProject(targetKR, state);
  if (!targetProject) {
    return {
      planned: false,
      reason: 'no_project_for_kr',
      kr: { id: targetKR.id, title: targetKR.title }
    };
  }

  const task = await generateNextTask(targetKR, targetProject, state);

  if (task) {
    return {
      planned: true,
      task: { id: task.id, title: task.title, priority: task.priority, project_id: task.project_id, goal_id: task.goal_id },
      kr: { id: targetKR.id, title: targetKR.title },
      project: { id: targetProject.id, title: targetProject.name, repo_path: targetProject.repo_path }
    };
  }

  return {
    planned: false,
    reason: 'needs_planning',
    kr: { id: targetKR.id, title: targetKR.title },
    project: { id: targetProject.id, title: targetProject.name, repo_path: targetProject.repo_path }
  };
}

/**
 * Get current planning status
 */
async function getPlanStatus() {
  const state = await getGlobalState();
  const targetKR = selectTargetKR(state);

  let targetProject = null;
  let queuedTasks = [];
  let lastCompleted = null;

  if (targetKR) {
    targetProject = await selectTargetProject(targetKR, state);

    const queuedResult = await pool.query(`
      SELECT id, title, priority, project_id, status FROM tasks
      WHERE goal_id = $1 AND status = 'queued'
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    `, [targetKR.id]);
    queuedTasks = queuedResult.rows;

    const completedResult = await pool.query(`
      SELECT id, title, completed_at FROM tasks
      WHERE goal_id = $1 AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1
    `, [targetKR.id]);
    lastCompleted = completedResult.rows[0] || null;
  }

  return {
    target_kr: targetKR ? { id: targetKR.id, title: targetKR.title, progress: targetKR.progress, priority: targetKR.priority } : null,
    target_project: targetProject ? { id: targetProject.id, title: targetProject.name, repo_path: targetProject.repo_path } : null,
    queued_tasks: queuedTasks,
    last_completed: lastCompleted
  };
}

/**
 * Handle plan input - create resources at the correct level.
 * Enforces all 5 hard constraints.
 */
async function handlePlanInput(input, dryRun = false) {
  const result = {
    level: null,
    action: 'create',
    created: { goals: [], projects: [], tasks: [] },
    linked_to: { kr: null, project: null }
  };

  if (input.objective) {
    result.level = 'objective';
    if (!dryRun) {
      const oResult = await pool.query(`
        INSERT INTO goals (title, description, priority, type, status, progress)
        VALUES ($1, $2, $3, 'objective', 'pending', 0) RETURNING *
      `, [input.objective.title, input.objective.description || '', input.objective.priority || 'P1']);
      result.created.goals.push(oResult.rows[0]);

      if (Array.isArray(input.objective.key_results)) {
        for (const krInput of input.objective.key_results) {
          const krResult = await pool.query(`
            INSERT INTO goals (title, description, priority, type, parent_id, weight, status, progress, metadata)
            VALUES ($1, $2, $3, 'key_result', $4, $5, 'pending', 0, $6) RETURNING *
          `, [
            krInput.title, krInput.description || '', krInput.priority || input.objective.priority || 'P1',
            oResult.rows[0].id, krInput.weight || 1.0,
            JSON.stringify({ metric: krInput.metric, target: krInput.target, deadline: krInput.deadline })
          ]);
          result.created.goals.push(krResult.rows[0]);
        }
      }
    }
  } else if (input.key_result) {
    result.level = 'kr';
    if (!dryRun) {
      const krResult = await pool.query(`
        INSERT INTO goals (title, description, priority, type, parent_id, weight, status, progress, metadata)
        VALUES ($1, $2, $3, 'key_result', $4, $5, 'pending', 0, $6) RETURNING *
      `, [
        input.key_result.title, input.key_result.description || '', input.key_result.priority || 'P1',
        input.key_result.objective_id || null, input.key_result.weight || 1.0,
        JSON.stringify({ metric: input.key_result.metric, target: input.key_result.target, deadline: input.key_result.deadline })
      ]);
      result.created.goals.push(krResult.rows[0]);
      result.linked_to.kr = krResult.rows[0];
    }
  } else if (input.project) {
    result.level = 'project';
    if (!input.project.repo_path) {
      throw new Error('Hard constraint: Project must have repo_path');
    }
    if (!dryRun) {
      const pResult = await pool.query(`
        INSERT INTO projects (name, description, repo_path, prd_content, scope, status)
        VALUES ($1, $2, $3, $4, $5, 'active') RETURNING *
      `, [input.project.title, input.project.description || '', input.project.repo_path, input.project.prd_content || null, input.project.scope || null]);
      result.created.projects.push(pResult.rows[0]);
      result.linked_to.project = pResult.rows[0];

      if (Array.isArray(input.project.kr_ids)) {
        for (const krId of input.project.kr_ids) {
          await pool.query(
            'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [pResult.rows[0].id, krId]
          );
        }
      }
    }
  } else if (input.task) {
    result.level = 'task';
    if (!input.task.project_id) {
      throw new Error('Hard constraint: Task must have project_id');
    }
    if (!dryRun) {
      const projCheck = await pool.query('SELECT id, repo_path FROM projects WHERE id = $1', [input.task.project_id]);
      if (projCheck.rows.length === 0) throw new Error('Project not found');
      if (!projCheck.rows[0].repo_path) throw new Error('Hard constraint: Task\'s project must have repo_path');

      const tResult = await pool.query(`
        INSERT INTO tasks (title, description, priority, project_id, goal_id, status, payload)
        VALUES ($1, $2, $3, $4, $5, 'queued', $6) RETURNING *
      `, [
        input.task.title, input.task.description || '', input.task.priority || 'P1',
        input.task.project_id, input.task.goal_id || null,
        JSON.stringify(input.task.payload || {})
      ]);
      result.created.tasks.push(tResult.rows[0]);
    }
  } else {
    throw new Error('Input must contain one of: objective, key_result, project, task');
  }

  return result;
}

export {
  planNextTask,
  getPlanStatus,
  handlePlanInput,
  getGlobalState,
  selectTargetKR,
  selectTargetProject,
  generateNextTask,
  autoGenerateTask,
  generateTaskFromKR,
  generateTaskPRD,
  KR_STRATEGIES
};
