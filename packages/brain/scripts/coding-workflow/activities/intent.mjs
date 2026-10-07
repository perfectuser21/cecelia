// intent 活动：GET Brain 任务 → 提取验收条目 → 写 <sprint_dir>/01-intent.md。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, resolveSprintDir, log } from '../lib/protocol.mjs';
import { extractAcceptance, renderIntent } from '../lib/intent.mjs';

const INTENT_FILE = '01-intent.md';
const DEFAULT_BRAIN_URL = 'http://localhost:5221';
const FETCH_TIMEOUT_MS = 30000;

function fail(failureClass, reasonCode) {
  return { status: 'failed', failure_class: failureClass, reason_code: reasonCode };
}

await runActivity(async (input) => {
  const { task_id: taskId, worktree, sprint_dir: sprintDir } = input;
  if (typeof taskId !== 'string' || taskId === '') return fail('fatal', 'task_id_missing');

  // 先校验目录，再做任何网络请求或写文件
  let dir;
  try {
    dir = resolveSprintDir(worktree, sprintDir);
  } catch {
    return fail('fatal', 'sprint_dir_invalid');
  }

  const base = String(input.brain_url || DEFAULT_BRAIN_URL).replace(/\/+$/, '');
  const url = `${base}/api/brain/tasks/${encodeURIComponent(taskId)}`;

  let task;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 404 || res.status === 400) return fail('fatal', 'task_not_found');
    if (res.status >= 500 || res.status === 429 || res.status === 408) return fail('retryable', 'brain_unavailable');
    if (!res.ok) return fail('fatal', `brain_http_${res.status}`);
    task = await res.json();
  } catch (error) {
    log(`[intent] GET ${url} 失败: ${error?.message || error}`);
    return fail('retryable', 'brain_unavailable');
  }

  const items = extractAcceptance(task);
  if (items.length === 0) return fail('needs_human', 'acceptance_missing');

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, INTENT_FILE), renderIntent({ taskId, title: task?.title, items }));

  return {
    status: 'completed',
    outputs: { intent_file: INTENT_FILE, intent_ids: items.map((_, i) => `I-${i + 1}`) },
    metrics: { intent_count: items.length },
    evidence: [`${INTENT_FILE}: ${items.length} 条验收`],
  };
});
