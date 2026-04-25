import crypto from 'node:crypto';
import { ensureHarnessWorktree as defaultEnsureWorktree } from './harness-worktree.js';
import { resolveGitHubToken as defaultResolveToken } from './harness-credentials.js';
import { writeDockerCallback as defaultWriteDockerCallback } from './docker-executor.js';
import { parseDockerOutput, extractField } from './harness-graph.js';
import defaultPool from './db.js';

/**
 * Phase B dispatcher：把 harness_task 派到 Docker 容器跑 /harness-generator。
 *
 * v6 Phase B 回调链路三联修：
 *   1. 容器跑完 → writeDockerCallback 写 callback_queue（含 pr_url / verdict）
 *   2. 成功拿到 pr_url → INSERT harness_ci_watch task 供 harness-watcher 轮询
 *   3. 下游 callback-worker (routePrUrlToTasks) 自动回填 tasks.pr_url
 *
 * @param {object} task                   {id, task_type, title, description, payload}
 * @param {object} [deps]
 * @param {Function} [deps.executor]      默认 dynamic import './docker-executor.js'.executeInDocker
 * @param {Function} [deps.ensureWorktree]
 * @param {Function} [deps.resolveToken]
 * @param {Function} [deps.writeDockerCallback]  默认 ./docker-executor.js writeDockerCallback
 * @param {{query:Function}} [deps.pool]         默认 ./db.js pool
 * @returns {Promise<{success, result?, cost_usd?, error?}>}
 */
export async function triggerHarnessTaskDispatch(task, deps = {}) {
  const ensureWorktree = deps.ensureWorktree || defaultEnsureWorktree;
  const resolveToken = deps.resolveToken || defaultResolveToken;
  const executor = deps.executor || (async (opts) => {
    const mod = await import('./docker-executor.js');
    return mod.executeInDocker(opts);
  });
  const writeDockerCallback = deps.writeDockerCallback || defaultWriteDockerCallback;
  const dbPool = deps.pool || defaultPool;

  const payload = task.payload || {};
  const initiativeId = payload.parent_task_id || payload.initiative_id || task.id;
  const fixMode = payload.fix_mode === true;

  let worktreePath;
  let token;
  try {
    worktreePath = await ensureWorktree({ taskId: task.id, initiativeId });
    token = await resolveToken();
  } catch (err) {
    console.error(`[harness-task-dispatch] prep failed task=${task.id}: ${err.message}`);
    return { success: false, error: err.message };
  }

  const prompt = buildGeneratorPrompt(task, { fixMode });

  let result;
  try {
    result = await executor({
      task: { ...task, task_type: 'harness_task' },
      prompt,
      worktreePath,
      env: {
        // CECELIA_CREDENTIALS 不传 → executeInDocker middleware 走 selectBestAccount
        CECELIA_TASK_TYPE: 'harness_task',
        HARNESS_NODE: 'generator',
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_TASK_ID: task.id,
        HARNESS_FIX_MODE: fixMode ? 'true' : 'false',
        GITHUB_TOKEN: token,
        // v6 P1-D: Brain↔Generator prompt env 协议（详见 docs/superpowers/specs/2026-04-25-harness-v6-p1d-brain-env-inject-design.md）
        // SKILL.md Step 0 自检依赖这 4 个 env 任一缺失即 ABORT，必须显式注入。
        CONTRACT_BRANCH: payload.contract_branch || '',
        SPRINT_DIR: payload.sprint_dir || 'sprints',
        BRAIN_URL: 'http://host.docker.internal:5221',
        WORKSTREAM_INDEX: extractWorkstreamIndex(payload),
        WORKSTREAM_COUNT:
          payload.workstream_count !== undefined && payload.workstream_count !== null
            ? String(payload.workstream_count)
            : '',
        PLANNER_BRANCH: payload.planner_branch || '',
      },
    });
  } catch (err) {
    console.error(`[harness-task-dispatch] spawn failed task=${task.id}: ${err.message}`);
    return { success: false, error: err.message };
  }

  if (!result || result.exit_code !== 0) {
    const detail = result?.stderr?.slice(0, 500) || `exit_code=${result?.exit_code}`;
    return { success: false, error: `container failed: ${detail}` };
  }

  // v6 Phase B 链路 2: 写 callback_queue 让下游 callback-worker 拿到容器成果。
  // try/catch 兜住：DB 写失败不应污染 caller 成功状态（容器已成功跑完）。
  try {
    const runId = crypto.randomUUID();
    await writeDockerCallback(
      { ...task, task_type: 'harness_task' },
      runId,
      null,
      result
    );
  } catch (err) {
    console.error(
      `[harness-task-dispatch] writeDockerCallback failed task=${task.id}: ${err.message}`
    );
  }

  // v6 Phase B 链路 3: stdout 解析到 pr_url → INSERT harness_ci_watch 供 harness-watcher 轮询 CI。
  // 无 pr_url（Generator 未开 PR）就跳过；watcher SELECT 不到无副作用。
  try {
    const parsedOutput = parseDockerOutput(result.stdout || '');
    const prUrl = extractField(parsedOutput, 'pr_url');
    if (prUrl) {
      await dbPool.query(
        `INSERT INTO tasks (title, description, task_type, priority, status, payload, trigger_source)
         VALUES ($1, $2, 'harness_ci_watch', 'P0', 'queued', $3::jsonb, 'harness_task_dispatch')`,
        [
          `[CI-Watch] ${task.title || task.id}`,
          `监控 PR CI: ${prUrl}`,
          JSON.stringify({
            pr_url: prUrl,
            parent_task_id: task.id,
            initiative_id: payload.parent_task_id || payload.initiative_id || null,
            harness_mode: true,
          }),
        ]
      );
    }
  } catch (err) {
    console.error(
      `[harness-task-dispatch] insert harness_ci_watch failed task=${task.id}: ${err.message}`
    );
  }

  return {
    success: true,
    result: result.stdout,
    cost_usd: result.cost_usd,
  };
}

/**
 * 从 payload 提取 workstream index，支持两种来源：
 *   1. payload.workstream_index（数字优先）
 *   2. payload.logical_task_id 形如 "ws<N>"
 * 都不匹配返回空串（Generator SKILL Step 0 自检会拦截）。
 */
function extractWorkstreamIndex(payload) {
  if (payload.workstream_index !== undefined && payload.workstream_index !== null) {
    return String(payload.workstream_index);
  }
  const lti = payload.logical_task_id;
  if (typeof lti === 'string') {
    const m = lti.match(/^ws(\d+)$/i);
    if (m) return m[1];
  }
  return '';
}

function buildGeneratorPrompt(task, { fixMode }) {
  const payload = task.payload || {};
  const dod = Array.isArray(payload.dod) ? payload.dod.join('\n- ') : '';
  const files = Array.isArray(payload.files) ? payload.files.join('\n- ') : '';
  const header = fixMode ? '/harness-generator (FIX mode)' : '/harness-generator';
  return [
    header,
    '',
    `task_id: ${task.id}`,
    `initiative_id: ${payload.parent_task_id || ''}`,
    `logical_task_id: ${payload.logical_task_id || ''}`,
    `fix_mode: ${fixMode}`,
    '',
    `## 任务标题`,
    task.title || '',
    '',
    `## 任务描述`,
    task.description || '',
    '',
    `## DoD`,
    dod ? `- ${dod}` : '(none)',
    '',
    `## 目标文件`,
    files ? `- ${files}` : '(none)',
  ].join('\n');
}
