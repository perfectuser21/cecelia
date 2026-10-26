// intent 活动：GET Brain 任务 → 提取验收条目 → 写 <sprint_dir>/01-intent.md；
// 另拉全部 active 铁律写 01-invariants.md，供合同逐条对照（审计 P1 #3）。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail, log } from '../lib/protocol.mjs';
import { extractAcceptance, renderIntent } from '../lib/intent.mjs';
import { sha256File } from '../lib/guards.mjs';
import { renderInvariants, INVARIANTS_FILE } from '../lib/invariants.mjs';
import { validateAuthority, resolveAuthority, sameAuthority, commitAvailable } from '../lib/authority-refs.mjs';
import { execFileSync } from 'node:child_process';
import { resolveRepo } from '../runner/lib/repos.mjs';

const INTENT_FILE = '01-intent.md';
const INVARIANT_LIMIT = 1000;
const DEFAULT_BRAIN_URL = 'http://localhost:5221';
const FETCH_TIMEOUT_MS = 30000;

await runActivity(async (input) => {
  // 先校验输入，再做任何网络请求或写文件
  const { dir } = validateBase(input);
  const taskId = input.task_id;
  // 重试失败时不能留下上一轮成功的 01，让后继误读。
  fs.rmSync(path.join(dir, INTENT_FILE), { force: true });

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

  const managed = task?.payload?.authority_required === true || task?.payload?.authority !== undefined
    || input.authority_required === true || input.authority !== undefined;
  let authorityFacts = null;
  if (managed) {
    const authority = task?.payload?.authority;
    if (task?.payload?.authority_required !== true || input.authority_required !== true
      || validateAuthority(authority).length > 0 || !sameAuthority(authority, input.authority)) {
      return fail('fatal', 'authority_receipt_mismatch');
    }
    const fixed = task?.payload?.base_sha;
    const initialBase = input.initial_base_sha;
    if (typeof initialBase !== 'string' || !commitAvailable(input.worktree, initialBase)
      || (fixed !== undefined && fixed !== initialBase)) return fail('fatal', 'authority_base_mismatch');
    let origin;
    try { origin = execFileSync('git', ['-C', input.worktree, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim(); }
    catch { origin = null; }
    if (!origin || resolveRepo(origin) !== task.payload.repo) return fail('fatal', 'authority_repo_mismatch');
    authorityFacts = resolveAuthority(input.worktree, authority.refs).map((fact) => ({ ...fact, object_id: authority.object_id }));
    const blocked = authorityFacts.find((fact) => fact.required && fact.status !== 'found');
    if (blocked) return fail('fatal', blocked.reason, { evidence: [{ ref_id: blocked.ref_id, path: blocked.path }] });
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
  fs.writeFileSync(intentPath, renderIntent({ taskId, title: task?.title, items, description: task?.description, authorityFacts }));
  fs.writeFileSync(path.join(dir, INVARIANTS_FILE), renderInvariants(invariants));

  return {
    status: 'completed',
    // 验收标准的指纹：后续活动比对，发现被改即 chain_tampered
    outputs: { intent_file: INTENT_FILE, intent_ids: items.map((_, i) => `I-${i + 1}`), intent_sha256: sha256File(intentPath) },
    metrics: { intent_count: items.length },
    evidence: [`${INTENT_FILE}: ${items.length} 条验收`],
  };
}, { stage: 'intent', entry: import.meta.url });
