/**
 * Harness 公用工具（小而纯，便于单测注入）。
 *
 * 当前导出：
 *   - makeCpBranchName(taskId, { now }) — 生成符合 branch-protect 规约的分支名
 */

/**
 * 返回上海时区（UTC+8）的 MMDDHHMM 8 位字符串。
 * @param {Date} [date]
 */
export function shanghaiMMDDHHMM(date = new Date()) {
  // 直接加 8h offset 再取 UTC 字段，避开本机时区差异（CI 在 UTC）
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${mm}${dd}${hh}${mi}`;
}

/**
 * 取 taskId 前 8 位作为 shortid。不足 8 位抛错。
 * @param {string} taskId
 */
export function shortTaskId(taskId) {
  if (!taskId || String(taskId).length < 8) {
    throw new Error(`taskId must be ≥8 chars, got ${taskId}`);
  }
  return String(taskId).slice(0, 8);
}

/**
 * 生成 Harness worktree 的 cp-* 分支名，满足 `hooks/branch-protect.sh`
 * 的正则 `^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$`，并且符合 CI `branch-naming`
 * 检查（以 `cp-` 开头）。
 *
 * 格式：`cp-<MMDDHHMM>-ws-<taskId8>`  例如 `cp-04240814-ws-abcdef12`
 *
 * @param {string} taskId            Brain task id（uuid 等），至少 8 字符
 * @param {object} [opts]
 * @param {Date|number} [opts.now]   测试注入
 * @returns {string}
 */
export function makeCpBranchName(taskId, opts = {}) {
  const sid = shortTaskId(taskId);
  const when = opts.now instanceof Date
    ? opts.now
    : (typeof opts.now === 'number' ? new Date(opts.now) : new Date());
  const ts = shanghaiMMDDHHMM(when);
  return `cp-${ts}-ws-${sid}`;
}

// ───────────────────────────────────────────────────────────────────────
// Sprint 1 Phase B/C 全图重构追加
//   - topologicalLayers   sub-task DAG 拓扑分层（顶层 graph 分层 fanout）
//   - extractWorkstreamIndex  payload → workstream index 字符串
//   - buildGeneratorPrompt    /harness-generator prompt 拼装（原 harness-task-dispatch.js 抽出）
// Spec: docs/superpowers/specs/2026-04-26-harness-langgraph-full-graph-design.md
// ───────────────────────────────────────────────────────────────────────

/**
 * 把 sub-task 列表按 depends_on 拓扑分层。
 * 返回 [[id...], [id...], ...]，每层内可并行 fanout。
 * 算法：Kahn's algorithm（BFS by indegree）。
 * 外部依赖（dep 不在本批 tasks 中）跳过：视为外部 satisfied。
 *
 * @param {Array<{id:string, depends_on?:string[]}>} tasks
 * @returns {string[][]}
 * @throws Error('cycle ...') 检测到环时抛错
 */
export function topologicalLayers(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];

  const indegree = new Map();
  const adj = new Map();
  const ids = new Set();

  for (const t of tasks) {
    ids.add(t.id);
    indegree.set(t.id, 0);
    adj.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of (t.depends_on || [])) {
      if (!ids.has(dep)) continue;
      adj.get(dep).push(t.id);
      indegree.set(t.id, indegree.get(t.id) + 1);
    }
  }

  const layers = [];
  let frontier = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) frontier.push(id);
  }

  let processed = 0;
  while (frontier.length > 0) {
    layers.push([...frontier]);
    const next = [];
    for (const id of frontier) {
      processed += 1;
      for (const child of adj.get(id)) {
        const d = indegree.get(child) - 1;
        indegree.set(child, d);
        if (d === 0) next.push(child);
      }
    }
    frontier = next;
  }

  if (processed !== ids.size) {
    throw new Error(`topologicalLayers: dependency cycle detected (processed ${processed}/${ids.size})`);
  }
  return layers;
}

/**
 * 从 payload 提取 workstream index（兼容数字 / "wsN" 字符串 / 缺省）。
 * 主要给 sub-graph spawnGenerator node 注入 WORKSTREAM_INDEX env。
 *
 * @param {object} payload
 * @returns {string}  数字串 or 空串
 */
export function extractWorkstreamIndex(payload) {
  if (!payload) return '';
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

/**
 * 构造 /harness-generator prompt。
 * fixMode=true 时头部加 (FIX mode)，触发 Generator skill 走 fix 路径。
 *
 * @param {object} task   {id, title, description, payload: {dod[], files[], parent_task_id, logical_task_id}}
 * @param {{fixMode?: boolean}} opts
 * @returns {string}
 */
export function buildGeneratorPrompt(task, { fixMode = false } = {}) {
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
