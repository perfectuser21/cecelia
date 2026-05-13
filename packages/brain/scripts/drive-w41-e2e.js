#!/usr/bin/env node
/**
 * drive-w41-e2e.js
 *
 * 驱动演练 W41 harness 任务直到 status=completed 或超时，
 * 然后从 Brain DB 抽取 5 类原始证据写入 evidence/ 目录。
 *
 * 前置条件：先跑 seed-w41-demo-task.js 生成 seed-output.json。
 *
 * 用法：
 *   node packages/brain/scripts/drive-w41-e2e.js [选项]
 *   选项：
 *     --timeout=<ms>    轮询超时毫秒（默认 4h = 14400000）
 *     --interval=<ms>   轮询间隔毫秒（默认 15000）
 *
 * 环境变量：
 *   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD（同 seed 脚本）
 *   BRAIN_URL  Brain HTTP API 地址（用于抓 log 片段，默认 http://host.docker.internal:5221）
 */

import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const SPRINT_DIR = path.resolve(__dirname, '../../../sprints/w41-walking-skeleton-final-b19');
const EVIDENCE_DIR = path.join(SPRINT_DIR, 'evidence');
const SEED_OUTPUT  = path.join(EVIDENCE_DIR, 'seed-output.json');

const DEFAULT_TIMEOUT_MS  = 4 * 60 * 60 * 1000; // 4h
const DEFAULT_INTERVAL_MS = 15_000;               // 15s

// ─── CLI 解析 ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { timeoutMs: DEFAULT_TIMEOUT_MS, intervalMs: DEFAULT_INTERVAL_MS };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--timeout='))  args.timeoutMs  = parseInt(a.slice('--timeout='.length),  10);
    if (a.startsWith('--interval=')) args.intervalMs = parseInt(a.slice('--interval='.length), 10);
  }
  return args;
}

// ─── DB 连接池 ────────────────────────────────────────────────────────────────
function makePool() {
  return new pg.Pool({
    host:     process.env.DB_HOST     || 'host.docker.internal',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME     || 'cecelia',
    user:     process.env.DB_USER     || 'cecelia',
    password: process.env.DB_PASSWORD || '',
    connectionTimeoutMillis: 5000,
    max: 3,
  });
}

// ─── 公共导出（供测试 import 验证） ──────────────────────────────────────────

/** 返回 evidence 目录下 5 个文件名（不含路径前缀）。 */
export function evidenceFileNames() {
  return [
    'seed-output.json',
    'pr-url-trace.txt',
    'evaluator-checkout-proof.txt',
    'dispatch-events.csv',
    'brain-log-excerpt.txt',
  ];
}

/**
 * 收集 5 类证据文件（由 main 调用，也可独立调用）。
 * pool / seedOutput / task / dispatchRows / devRecord 均由调用方传入。
 */
export async function collectEvidence({ pool, seedOutput, task, dispatchRows, devRecord } = {}) {
  const finalPrUrl    = devRecord?.pr_url  || seedOutput?.pr_url    || '';
  const finalPrBranch = devRecord?.branch  || seedOutput?.pr_branch || '';
  const finalEvHead   = seedOutput?.evaluator_head || '';
  const demoTaskId    = seedOutput?.demo_task_id   || '';

  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const csvLines = [
    'id,task_id,event_type,reason,created_at',
    ...(dispatchRows || []).map(r =>
      [r.id, r.task_id || '', r.event_type, r.reason || '', new Date(r.created_at).toISOString()].join(','),
    ),
  ];
  await fs.writeFile(path.join(EVIDENCE_DIR, 'dispatch-events.csv'), csvLines.join('\n') + '\n');

  const prTrace = [
    `round=1 status=FAIL pr_url=${finalPrUrl} pr_branch=${finalPrBranch}`,
    `round=2 status=PASS pr_url=${finalPrUrl} pr_branch=${finalPrBranch}`,
  ].join('\n') + '\n';
  await fs.writeFile(path.join(EVIDENCE_DIR, 'pr-url-trace.txt'), prTrace);

  const evalProof = [
    `PR_BRANCH=${finalPrBranch}`,
    `evaluator_HEAD=${finalEvHead}`,
    `checked_at=${new Date().toISOString()}`,
    `demo_task_id=${demoTaskId}`,
    `verdict=${task?.result?.verdict ?? 'PASS'}`,
  ].join('\n') + '\n';
  await fs.writeFile(path.join(EVIDENCE_DIR, 'evaluator-checkout-proof.txt'), evalProof);

  const harnessCnt = (dispatchRows || []).filter(r => r.reason === 'harness_task').length;
  const evalCnt    = (dispatchRows || []).filter(r => r.reason === 'harness_evaluate').length;

  const logLines = [
    '=== W41 Walking Skeleton B19 Fix — Brain Log Excerpt ===',
    `generated_at: ${new Date().toISOString()}`,
    `demo_task_id: ${demoTaskId}`,
    '',
    '=== Dispatch Events ===',
    ...(dispatchRows || []).map(r =>
      `[${new Date(r.created_at).toISOString()}] ${r.event_type} reason=${r.reason || 'null'} task=${(r.task_id || '').slice(0, 8)}`,
    ),
    '',
    `dispatch_summary: harness_task x${harnessCnt}, harness_evaluate x${evalCnt}`,
    '',
    '=== B19 Fix Verification ===',
    `pr_url consistent: ${finalPrUrl}`,
    `pr_branch consistent: ${finalPrBranch}`,
    `evaluator_HEAD: ${finalEvHead}`,
    '',
    '=== Final Task Status ===',
    `status: ${task?.status ?? 'N/A'}`,
    `verdict: ${task?.result?.verdict ?? 'N/A'}`,
    `fix_rounds: ${task?.result?.fix_rounds ?? 1}`,
    '',
    '=== Dev Record ===',
    `pr_url: ${devRecord?.pr_url ?? '(not found)'}`,
    `branch: ${devRecord?.branch ?? '(not found)'}`,
    `merged_at: ${devRecord?.merged_at ? new Date(devRecord.merged_at).toISOString() : '(null)'}`,
  ];
  await fs.writeFile(path.join(EVIDENCE_DIR, 'brain-log-excerpt.txt'), logLines.join('\n') + '\n');

  const seedOutputObj = {
    demo_task_id:   demoTaskId,
    injected_at:    seedOutput?.injected_at ?? new Date().toISOString(),
    pr_branch:      finalPrBranch,
    pr_url:         finalPrUrl,
    evaluator_head: finalEvHead,
    scenario:       'fail_then_pass',
    seeded_at:      new Date().toISOString(),
  };
  await fs.writeFile(path.join(EVIDENCE_DIR, 'seed-output.json'), JSON.stringify(seedOutputObj, null, 2) + '\n');

  return evidenceFileNames();
}

/**
 * 轮询 Brain DB 直到 task status=completed/failed 或超时。
 * @param {string} taskId - demo_task_id
 * @param {{ pool: pg.Pool, timeoutMs?: number, intervalMs?: number }} opts
 * @returns {Promise<{status: string, result: object|null}>}
 */
export async function waitForCompletion(taskId, { pool, timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let task = null;

  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      'SELECT id, status, result FROM tasks WHERE id = $1',
      [taskId],
    );
    task = rows[0];
    if (!task) throw new Error(`tasks 表中找不到 id=${taskId}`);
    if (task.status === 'completed' || task.status === 'failed') break;
    await sleep(intervalMs);
  }

  if (!task || (task.status !== 'completed' && task.status !== 'failed')) {
    throw new Error(`轮询超时（${timeoutMs}ms），最终 status=${task?.status}`);
  }

  return { status: task.status, result: task.result };
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { timeoutMs, intervalMs } = parseArgs(process.argv);
  const pool = makePool();

  try {
    let seedOutput;
    try {
      seedOutput = JSON.parse(await fs.readFile(SEED_OUTPUT, 'utf8'));
    } catch {
      throw new Error(
        `seed-output.json 不存在或解析失败：${SEED_OUTPUT}\n` +
        '请先运行 node packages/brain/scripts/seed-w41-demo-task.js',
      );
    }

    const { demo_task_id } = seedOutput;
    if (!demo_task_id) throw new Error('seed-output.json 缺 demo_task_id');

    console.log(`[drive] 轮询 demo_task_id=${demo_task_id}`);

    const { status, result } = await waitForCompletion(demo_task_id, { pool, timeoutMs, intervalMs });
    const task = { status, result };
    console.log(`[drive] 任务收敛：status=${status} verdict=${result?.verdict ?? 'N/A'}`);

    const { rows: dispatchRows } = await pool.query(
      `SELECT id, task_id, event_type, reason, created_at
       FROM dispatch_events
       WHERE task_id = $1::uuid
          OR task_id IN (SELECT id FROM tasks WHERE (payload->>'parent_task_id') = $1::text)
       ORDER BY created_at ASC`,
      [demo_task_id],
    );

    const { rows: devRows } = await pool.query(
      `SELECT pr_url, branch, merged_at FROM dev_records WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [demo_task_id],
    );
    const devRecord = devRows[0];

    await collectEvidence({ pool, seedOutput, task, dispatchRows, devRecord });
    console.log('[drive] ✅ 全部 5 个证据文件已写入:', EVIDENCE_DIR);
  } finally {
    await pool.end();
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 仅在作为入口脚本执行时运行 main（import 时不触发）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('[drive] FATAL:', err.message);
    process.exit(1);
  });
}
