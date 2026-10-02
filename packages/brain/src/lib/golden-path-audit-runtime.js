import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { isIsolatedRuntime } from '../runtime-safety.js';
import { createGoldenPathAudit } from './golden-path-audit.js';
import { createGoldenPathAuditStore } from './golden-path-audit-store.js';
import { readGoldenPathT0 } from './golden-path-window.js';

let active = null, timer = null, admissionLoader = null, archivedT0 = null, tickRunning = false;
export const setGoldenPathAudit = audit => { active = audit; };
export const recordGoldenPathHttp = input => active?.recordHttp(input)
  ?? Promise.resolve({ persisted: false, reason: 'gp_runtime_not_started' });
export const recordGoldenPathInternal = operation => active?.recordInternal(operation)
  ?? Promise.resolve({ persisted: false, reason: 'gp_runtime_not_started' });

export function goldenPathSource(env = process.env) {
  const files = ['golden-path-archive.js', 'golden-path-journal.js', 'golden-path-audit-store.js', 'golden-path-audit.js',
    'golden-path-audit-runtime.js', 'golden-path-window.js', 'golden-path-observation.js',
    '../harness-line-context.js', '../../server.js'];
  return { git_sha: /^[a-f0-9]{40}$/.test(env.GIT_SHA ?? '') ? env.GIT_SHA : null,
    manifest: Object.fromEntries(files.map(file => [file, createHash('sha256')
      .update(fs.readFileSync(new URL(file, import.meta.url))).digest('hex')])) };
}

export async function startGoldenPathAudit({ pool, env = process.env } = {}) {
  // 不在导入时或单位/预览实例上建文件、查询DB、注册timer。
  if (isIsolatedRuntime(env)) return { disabled: true };
  if (active) return { already_started: true };
  const source = goldenPathSource(env);
  const query = (text, values) => pool.query({ text, values, query_timeout: 2_000 });
  const root = path.join(env.REPO_ROOT || fileURLToPath(new URL('../../', import.meta.url)), 'logs/gp-observation');
  const task = (await query(`SELECT result->'gp_observation_window' AS window FROM tasks WHERE id=$1`,
    ['115a39b8-b66a-45b1-9b1a-9ff88fe16152'])).rows[0]?.window;
  // 只接真身已登记的窗口；不创建T0，缺身份或来源不匹配仍未准入。
  const sources = task?.sources ?? (task?.source ? [task.source] : []);
  const matches = source.git_sha && sources.some(admitted => isDeepStrictEqual(admitted, source));
  const admission = matches && /^[a-f0-9-]{36}$/.test(task?.window_id ?? '')
    ? await readGoldenPathT0({ pool, root, window: task }) : null;
  // 先绑定正式登记的候选window/source，再由外部在listener就绪后写实际T0。
  // 这样T0不会早于本实例完整覆盖；本模块始终不签发T0。
  const windowId = matches && /^[a-f0-9-]{36}$/.test(task?.window_id ?? '') ? task.window_id : 'unadmitted';
  const audit = createGoldenPathAudit({ root, store: createGoldenPathAuditStore(pool), source, windowId, admission,
    flag: () => env.GOLDEN_PATH_LEGACY_READ === '1' });
  active = audit;
  archivedT0 = admission?.id ?? null;
  admissionLoader = async () => {
    if (windowId === 'unadmitted' || archivedT0) return;
    const current = (await query(`SELECT result->'gp_observation_window' AS window FROM tasks WHERE id=$1`,
      ['115a39b8-b66a-45b1-9b1a-9ff88fe16152'])).rows[0]?.window;
    const currentSources = current?.sources ?? (current?.source ? [current.source] : []);
    if (current?.window_id !== windowId || !currentSources.some(s => isDeepStrictEqual(s, source))) {
      throw new Error('gp_admission_changed');
    }
    const receipt = await readGoldenPathT0({ pool, root, window: current });
    if (receipt) { await audit.archiveT0(receipt); archivedT0 = receipt.id; }
  };
  await audit.recover();
  if (!(await audit.start()).persisted) {
    audit.abandon('gp_startup_incomplete'); active = null; throw new Error('gp_startup_incomplete');
  }
  return { disabled: false, window_id: windowId };
}

export async function goldenPathAuditListening() {
  if (!active) return;
  await active.listening();
  if (timer) return;
  timer = setInterval(() => {
    if (tickRunning) {
      active?.abandon('gp_heartbeat_overrun'); clearInterval(timer); timer = null; return;
    }
    tickRunning = true;
    Promise.resolve().then(() => admissionLoader?.()).then(() => active?.heartbeat())
      .catch(() => { active?.abandon('gp_heartbeat_failed'); clearInterval(timer); timer = null; })
      .finally(() => { tickRunning = false; });
  }, 30_000);
  timer.unref();
}

export async function drainGoldenPathListener(server, timeoutMs = 10_000) {
  let timer;
  try {
    return await Promise.race([
      new Promise(resolve => server.close(error => resolve(!error))),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function stopGoldenPathAudit(options = {}) {
  const { timeoutMs = 2_000, listenerDrained = true } = typeof options === 'number' ? { timeoutMs: options } : options;
  clearInterval(timer); timer = null;
  const audit = active;
  if (!audit) return { disabled: true };
  if (!listenerDrained) {
    audit.abandon('gp_shutdown_incomplete'); active = null; admissionLoader = null; archivedT0 = null; tickRunning = false;
    return { completed: false, listener_drained: false };
  }
  let timeout;
  const done = await Promise.race([
    audit.stop().then(() => true, () => false),
    new Promise(resolve => { timeout = setTimeout(() => resolve(false), timeoutMs); }),
  ]);
  clearTimeout(timeout);
  if (!done) audit.abandon('gp_shutdown_incomplete');
  active = null;
  admissionLoader = null; archivedT0 = null;
  tickRunning = false;
  return { completed: done };
}
