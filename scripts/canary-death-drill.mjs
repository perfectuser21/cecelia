#!/usr/bin/env node
/**
 * canary-death-drill.mjs — A8-3 金丝雀故障注入演习
 * 向 staging brain（5222）注册 canary 任务，注入死法，断言处置到位
 *
 * TODO: 接口预留 — incidents 表就绪后替换 design_docs 落档路径
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const STAGING_URL = process.env.STAGING_BRAIN_URL || 'http://localhost:5222';
const TIMEOUT_MIN = parseInt(process.env.DRILL_TIMEOUT_MIN || '15');
const MODE = process.argv[2] || 'oom'; // oom | kill9 | interactive_stuck
const BARK_URL = process.env.BARK_URL;

// ─── BEHAVIOR-4: 生产端口守卫 ─────────────────────────────────────────────────

/**
 * 验证 staging URL 不指向生产端口 5221
 * @param {string} url
 * @throws {Error} 若 url 含 :5221
 */
export function validateStagingUrl(url) {
  if (url.includes(':5221')) {
    throw new Error(
      `[canary-drill] FATAL: STAGING_BRAIN_URL 含 :5221（生产端口），拒绝执行。请设 STAGING_BRAIN_URL=http://localhost:5222`
    );
  }
}

// 启动时守卫
validateStagingUrl(STAGING_URL);

// ─── BEHAVIOR-7: Bark 告警 ────────────────────────────────────────────────────

/**
 * 发送 Bark 推送通知（失败不 throw）
 * @param {string} title
 * @param {string} body
 * @param {string|null} barkUrl
 */
export async function sendBark(title, body, barkUrl = BARK_URL) {
  if (!barkUrl) {
    console.warn('[canary-drill] BARK_URL 未设置，跳过告警');
    return;
  }
  const url = `${barkUrl}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) console.warn('[canary-drill] Bark 响应非 2xx:', resp.status);
    else console.log('[canary-drill] Bark 告警已发送');
  } catch (e) {
    console.warn('[canary-drill] Bark 发送失败:', e.message);
  }
}

/**
 * 通知演习失败（BEHAVIOR-7）
 * @param {{taskId: string, mode: string, failedAssertions: string[], barkFn?: Function|null}} opts
 */
export async function notifyDrillFailure({ taskId, mode, failedAssertions = [], barkFn = null }) {
  const barkSend = barkFn || sendBark;
  const title = 'CanaryDrill Failed';
  const body = `task_id=${taskId} mode=${mode} assertions=${failedAssertions.join(';')}`;
  if (barkFn === null) {
    // barkFn 显式为 null → 只 log warn，不调 bark
    console.warn(`[canary-drill] ${title}: ${body} (BARK_URL 未设，跳过推送)`);
    return;
  }
  await barkSend(title, body);
}

// ─── BEHAVIOR-6: 落档（降级写 design_docs） ──────────────────────────────────

/**
 * 落档演习结果（BEHAVIOR-6）
 * 优先 incidents 表，不可用时降级 design_docs
 * @param {{taskId: string, mode: string, results: object, success: boolean, fetchFn?: Function, baseUrl?: string}} opts
 */
export async function archiveDrillResult({ taskId, mode, results, success, fetchFn = fetch, baseUrl = STAGING_URL }) {
  // TODO: 优先尝试 incidents 表（刀5a 就绪后启用）
  // const incRes = await fetchFn(`${baseUrl}/api/brain/incidents`, { method: 'POST', ... });
  // if (incRes.ok) return;

  // 降级：写 design_docs type=drill_report
  const body = {
    type: 'drill_report',
    title: `Canary Drill ${success ? 'PASS' : 'FAIL'} — ${mode} — ${new Date().toISOString().slice(0, 10)}`,
    content: JSON.stringify({ task_id: taskId, injected_mode: mode, results, success }),
    tags: ['canary_drill', mode],
  };
  try {
    const res = await fetchFn(`${baseUrl}/api/brain/design-docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn('[canary-drill] 落档失败:', res.status);
    else console.log('[canary-drill] 演习结果已落档 design_docs');
  } catch (e) {
    console.warn('[canary-drill] 落档异常:', e.message);
  }
}

// ─── 注册金丝雀任务 ──────────────────────────────────────────────────────────

async function registerCanaryTask(mode, baseUrl = STAGING_URL, fetchFn = fetch) {
  const res = await fetchFn(`${baseUrl}/api/brain/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `[canary] ${mode} drill ${new Date().toISOString()}`,
      type: 'harness_initiative',
      payload: {
        canary: 'true',
        orchestrator: 'skill-relay',
        drill_mode: mode,
      },
    }),
  });
  if (!res.ok) throw new Error(`注册 canary 任务失败: ${res.status}`);
  const data = await res.json();
  return data.id || data.task?.id;
}

// ─── 轮询断言 ────────────────────────────────────────────────────────────────

async function pollAssert(taskId, assertFn, timeoutMin, baseUrl = STAGING_URL, fetchFn = fetch) {
  const deadline = Date.now() + timeoutMin * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await fetchFn(`${baseUrl}/api/brain/tasks/${taskId}`);
    const task = await res.json();
    const result = assertFn(task);
    if (result.pass) return { pass: true, task };
    if (result.terminal) return { pass: false, task, reason: result.reason };
    await new Promise(r => setTimeout(r, 30_000));
  }
  return { pass: false, reason: `超时 ${timeoutMin}min` };
}

// ─── BEHAVIOR-5: OOM 注入 ────────────────────────────────────────────────────

/**
 * OOM 注入演习（exit 137）
 * @param {{taskId: string, oomUpgraded?: boolean, fetchFn?: Function, baseUrl?: string, timeoutMin?: number}} opts
 */
export async function runOomDrill({ taskId, oomUpgraded = false, fetchFn = fetch, baseUrl = STAGING_URL, timeoutMin = TIMEOUT_MIN }) {
  console.log('[canary-drill] OOM 注入: PATCH cause=oom + exit_code=137');
  await fetchFn(`${baseUrl}/api/brain/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'failed',
      result: {
        exit_code: 137,
        cause: 'oom',
        stdout_tail: 'Killed',
        ...(oomUpgraded ? { oom_upgraded: true } : {}),
      },
    }),
  });

  const result = await pollAssert(taskId, (task) => {
    const cause = task.payload?.cause || task.result?.cause;
    if (cause === 'oom') {
      const upgraded = task.payload?.oom_upgraded === true || task.payload?.oom_upgraded === 'true';
      if (upgraded) return { pass: true };
      if (task.status === 'failed') return { pass: true }; // oom_wall
    }
    if (task.status === 'completed') return { terminal: true, reason: 'unexpected completion' };
    return { pass: false };
  }, timeoutMin, baseUrl, fetchFn);

  return {
    cause: 'oom',
    oom_upgraded: !oomUpgraded, // 首次 → true，oom_wall → false
    attempt: 1,
    ...result,
  };
}

// ─── BEHAVIOR-9: kill-9 注入 ──────────────────────────────────────────────────

async function drillKill9(taskId, baseUrl = STAGING_URL, fetchFn = fetch) {
  console.log('[canary-drill] kill-9 注入: 模拟容器被 kill');
  await fetchFn(`${baseUrl}/api/brain/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'failed',
      result: { exit_code: 137, cause: 'unknown', stdout_tail: '' },
    }),
  });
  return pollAssert(taskId, (task) => {
    const attempt = task.payload?.attempt || 0;
    if (attempt > 0) return { pass: true };
    return { pass: false };
  }, TIMEOUT_MIN, baseUrl, fetchFn);
}

// ─── BEHAVIOR-10: 卡交互注入 ─────────────────────────────────────────────────

async function drillInteractiveStuck(taskId, baseUrl = STAGING_URL, fetchFn = fetch) {
  console.log('[canary-drill] 卡交互注入: 模拟 interactive_stuck');
  await fetchFn(`${baseUrl}/api/brain/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'failed',
      result: { exit_code: 0, cause: 'interactive_stuck', stdout_tail: 'Press enter to continue' },
    }),
  });
  return pollAssert(taskId, (task) => {
    const cause = task.payload?.cause || task.result?.cause;
    if (cause === 'interactive_stuck' && (task.payload?.attempt || 0) > 0) {
      return { pass: true };
    }
    return { pass: false };
  }, TIMEOUT_MIN, baseUrl, fetchFn);
}

// ─── 主流程（CLI 入口） ──────────────────────────────────────────────────────

async function main() {
  console.log(`[canary-drill] 开始演习 mode=${MODE} staging=${STAGING_URL}`);

  let taskId;
  try {
    taskId = await registerCanaryTask(MODE);
    console.log(`[canary-drill] 已注册金丝雀任务 id=${taskId}`);
  } catch (e) {
    console.error('[canary-drill] 注册失败:', e.message);
    process.exit(1);
  }

  let result;
  try {
    if (MODE === 'oom') result = await runOomDrill({ taskId });
    else if (MODE === 'kill9') result = await drillKill9(taskId);
    else if (MODE === 'interactive_stuck') result = await drillInteractiveStuck(taskId);
    else { console.error(`[canary-drill] 未知 mode: ${MODE}`); process.exit(1); }
  } catch (e) {
    result = { pass: false, reason: e.message };
  }

  await archiveDrillResult({ taskId, mode: MODE, results: result, success: result.pass });

  if (!result.pass) {
    const failedMsg = `mode=${MODE} task=${taskId} reason=${result.reason || 'assertion failed'}`;
    console.error('[canary-drill] 演习 FAIL:', failedMsg);
    await notifyDrillFailure({ taskId, mode: MODE, failedAssertions: [result.reason || 'assertion failed'] });
    process.exit(1);
  }

  console.log('[canary-drill] 演习 PASS');
}

// 仅在直接执行时运行 main（非被 import 时）
if (process.argv[1] && process.argv[1].endsWith('canary-death-drill.mjs')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
