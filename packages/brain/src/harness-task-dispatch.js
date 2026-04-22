import { ensureHarnessWorktree as defaultEnsureWorktree } from './harness-worktree.js';
import { resolveGitHubToken as defaultResolveToken } from './harness-credentials.js';

/**
 * Phase B dispatcher：把 harness_task 派到 Docker 容器跑 /harness-generator。
 *
 * @param {object} task                   {id, task_type, title, description, payload}
 * @param {object} [deps]
 * @param {Function} [deps.executor]      默认 dynamic import './docker-executor.js'.executeInDocker
 * @param {Function} [deps.ensureWorktree]
 * @param {Function} [deps.resolveToken]
 * @returns {Promise<{success, result?, cost_usd?, error?}>}
 */
export async function triggerHarnessTaskDispatch(task, deps = {}) {
  const ensureWorktree = deps.ensureWorktree || defaultEnsureWorktree;
  const resolveToken = deps.resolveToken || defaultResolveToken;
  const executor = deps.executor || (async (opts) => {
    const mod = await import('./docker-executor.js');
    return mod.executeInDocker(opts);
  });

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

  return {
    success: true,
    result: result.stdout,
    cost_usd: result.cost_usd,
  };
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
