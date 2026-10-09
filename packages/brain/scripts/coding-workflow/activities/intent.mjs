// intent 活动：GET Brain 任务 → 提取验收条目 → 写 <sprint_dir>/01-intent.md；
// 另拉全部 active 铁律写 01-invariants.md，供合同逐条对照（审计 P1 #3）。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail, log } from '../lib/protocol.mjs';
import { extractAcceptance, renderIntent } from '../lib/intent.mjs';
import { sha256File } from '../lib/guards.mjs';
import { renderInvariants, INVARIANTS_FILE } from '../lib/invariants.mjs';

const INTENT_FILE = '01-intent.md';
const INVARIANT_LIMIT = 1000;
const DEFAULT_BRAIN_URL = 'http://localhost:5221';
const FETCH_TIMEOUT_MS = 30000;

await runActivity(async (input) => {
  // 先校验输入，再做任何网络请求或写文件
  const { dir } = validateBase(input);
  const taskId = input.task_id;

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

  // 全部 active 铁律（审计 P1 #3）：拉不到不能当作没有铁律
  let invariants;
  try {
    const res = await fetch(`${base}/api/brain/decisions?category=invariant&status=active&limit=${INVARIANT_LIMIT}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return fail('retryable', 'invariants_unavailable', { evidence: [{ http_status: res.status }] });
    const body = await res.json();
    invariants = (Array.isArray(body) ? body : body?.data ?? []).filter((r) => r?.id && (r.status ?? 'active') === 'active');
  } catch (error) {
    log(`[intent] 拉铁律清单失败: ${error?.message || error}`);
    return fail('retryable', 'invariants_unavailable');
  }

  fs.mkdirSync(dir, { recursive: true });
  const intentPath = path.join(dir, INTENT_FILE);
  fs.writeFileSync(intentPath, renderIntent({ taskId, title: task?.title, items, description: task?.description }));
  fs.writeFileSync(path.join(dir, INVARIANTS_FILE), renderInvariants(invariants));

  return {
    status: 'completed',
    // 验收标准的指纹：后续活动比对，发现被改即 chain_tampered
    outputs: { intent_file: INTENT_FILE, intent_ids: items.map((_, i) => `I-${i + 1}`), intent_sha256: sha256File(intentPath) },
    metrics: { intent_count: items.length },
    evidence: [`${INTENT_FILE}: ${items.length} 条验收`],
  };
});
