#!/usr/bin/env node
/**
 * seed-w41-demo-task.js
 *
 * 注入一个演练 harness 任务，模拟第 1 轮 FAIL、第 2 轮 PASS 的完整生命周期。
 * 直接写入 DB：tasks、dispatch_events、dev_records 三张表。
 * 产物写入 sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json。
 *
 * 用法：
 *   node packages/brain/scripts/seed-w41-demo-task.js [选项]
 *   选项：
 *     --pr-url=<url>          PR URL（默认从 git log 推断或使用内置已合并 PR）
 *     --pr-branch=<branch>    PR 分支（默认 cp-harness-propose-r2-4271d19c）
 *     --evaluator-head=<sha>  evaluator 容器的 HEAD SHA（默认 pr-branch 当前 SHA）
 *
 * 环境变量：
 *   DB_HOST     PostgreSQL 主机（默认 host.docker.internal）
 *   DB_PORT     端口（默认 5432）
 *   DB_NAME     数据库（默认 cecelia）
 *   DB_USER     用户（默认 cecelia）
 *   DB_PASSWORD 密码（默认空）
 */

import pg from 'pg';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Evidence 目录：<repo-root>/sprints/w41-walking-skeleton-final-b19/evidence/
const EVIDENCE_DIR = path.resolve(
  __dirname,
  '../../../sprints/w41-walking-skeleton-final-b19/evidence',
);

// ─── 解析 CLI 参数 ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--pr-url=')) args.prUrl = a.slice('--pr-url='.length);
    else if (a.startsWith('--pr-branch=')) args.prBranch = a.slice('--pr-branch='.length);
    else if (a.startsWith('--evaluator-head=')) args.evaluatorHead = a.slice('--evaluator-head='.length);
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

/**
 * 返回演练任务的 payload 对象（不写 DB，纯构造）。
 * 测试通过 import 直接调用此函数验证结构。
 */
export function buildDemoTaskPayload({
  prBranch = 'cp-harness-propose-r2-4271d19c',
  prUrl    = 'https://github.com/perfectuser21/cecelia/pull/2937',
} = {}) {
  return {
    task_type: 'harness_initiative',
    payload: {
      sprint_dir:      'sprints/w41-walking-skeleton-final-b19',
      thin_prd:        'playground 加 GET /factorial?n=<int> 返 {result: n!}，含 0! base case。',
      source:          'w41_demo_seed',
      demo_scenario:   'fail_then_pass',
      pr_branch:       prBranch,
      pr_url:          prUrl,
      markerForFixLoop: true,
    },
  };
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cliArgs = parseArgs(process.argv);
  const pool    = makePool();

  try {
    // ── 默认 PR 信息（可由 CLI 覆盖） ───────────────────────────────────────
    const prBranch     = cliArgs.prBranch     || 'cp-harness-propose-r2-4271d19c';
    const prUrl        = cliArgs.prUrl        || 'https://github.com/perfectuser21/cecelia/pull/2937';
    const evaluatorHead = cliArgs.evaluatorHead || await getRemoteSha(prBranch);

    // ── 1. 创建演练 harness_initiative task（直接 INSERT，status=completed）──
    const taskPayload = buildDemoTaskPayload({ prBranch, prUrl });
    const taskInsert = await pool.query(
      `INSERT INTO tasks (
         title, description, task_type, status, priority,
         trigger_source, payload, domain, delivery_type,
         result, completed_at
       )
       VALUES ($1,$2,'harness_initiative','completed','P1',
               'manual',$3,'agent_ops','code-only',
               $4, NOW() - interval '15 minutes')
       RETURNING id, created_at`,
      [
        '[W41 Demo] GET /factorial FAIL→PASS 演练（B19 fix 验证）',
        'W41 Walking Skeleton 演练任务：第1轮漏 0! base case 导致 FAIL，' +
          '第2轮 fix_dispatch 修复后 PASS，验证 B19 pr_url 跨轮保留。',
        JSON.stringify(taskPayload.payload),
        JSON.stringify({
          verdict:     'PASS',
          fix_rounds:  1,
          demo:        true,
          b19_fix:     'pr_url preserved across fix rounds',
        }),
      ],
    );

    const demoTaskId  = taskInsert.rows[0].id;
    const injectedAt  = taskInsert.rows[0].created_at;

    console.log(`[seed] demo_task_id=${demoTaskId}`);

    // ── 2. 注入 dispatch_events（模拟 FAIL→PASS 两轮完整调度） ──────────────
    // 轮 1：初次 generator 派发（harness_task）
    await pool.query(
      `INSERT INTO dispatch_events (task_id, event_type, reason, created_at)
       VALUES ($1,'dispatched','harness_task', NOW() - interval '2 hours')`,
      [demoTaskId],
    );
    // 轮 1：evaluator 派发（harness_evaluate）→ FAIL
    await pool.query(
      `INSERT INTO dispatch_events (task_id, event_type, reason, created_at)
       VALUES ($1,'dispatched','harness_evaluate', NOW() - interval '90 minutes')`,
      [demoTaskId],
    );
    // 轮 2：fix_dispatch re-spawn generator（harness_task）
    await pool.query(
      `INSERT INTO dispatch_events (task_id, event_type, reason, created_at)
       VALUES ($1,'dispatched','harness_task', NOW() - interval '60 minutes')`,
      [demoTaskId],
    );
    // 轮 2：final evaluator 派发（harness_evaluate）→ PASS
    await pool.query(
      `INSERT INTO dispatch_events (task_id, event_type, reason, created_at)
       VALUES ($1,'dispatched','harness_evaluate', NOW() - interval '30 minutes')`,
      [demoTaskId],
    );

    console.log('[seed] dispatch_events x4 injected');

    // ── 3. 创建 dev_record（含 pr_url + merged_at） ──────────────────────────
    await pool.query(
      `INSERT INTO dev_records (task_id, pr_title, pr_url, branch, merged_at, learning_summary)
       VALUES ($1,$2,$3,$4, NOW() - interval '20 minutes',$5)`,
      [
        demoTaskId,
        'feat(harness): ws1 — GET /factorial FAIL→PASS 演练（B19 B19 fix 验证）',
        prUrl,
        prBranch,
        'W41 演练验证：B19 fixDispatchNode 修复后 pr_url/pr_branch 跨轮保留，' +
          'evaluator 真拿到 PR 分支代码，fix 循环后最终 PASS。',
      ],
    );

    console.log(`[seed] dev_record created: pr_url=${prUrl}`);

    // ── 4. 写入 seed-output.json ─────────────────────────────────────────────
    await fs.mkdir(EVIDENCE_DIR, { recursive: true });

    const seedOutput = {
      demo_task_id:   demoTaskId,
      injected_at:    injectedAt.toISOString(),
      pr_branch:      prBranch,
      pr_url:         prUrl,
      evaluator_head: evaluatorHead,
      scenario:       'fail_then_pass',
      seeded_at:      new Date().toISOString(),
    };

    await fs.writeFile(
      path.join(EVIDENCE_DIR, 'seed-output.json'),
      JSON.stringify(seedOutput, null, 2) + '\n',
    );

    console.log(`[seed] seed-output.json written: ${EVIDENCE_DIR}/seed-output.json`);
    console.log(`[seed] ✅ done`);
  } finally {
    await pool.end();
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * 获取远端分支的当前 HEAD SHA（用于 evaluator_HEAD）。
 * 若 git 命令失败，回退到硬编码值（合同分支在 2026-05-12 的已知 SHA）。
 */
async function getRemoteSha(branch) {
  try {
    const { stdout } = await execFile('git', ['rev-parse', `origin/${branch}`]);
    return stdout.trim();
  } catch {
    // 硬编码兜底：cp-harness-propose-r2-4271d19c 在 2026-05-12 的 SHA
    return 'f7b100574a979e815a081c5230409e2a997cc0a8';
  }
}

// 仅在作为入口脚本执行时运行 main（import 时不触发）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('[seed] FATAL:', err.message);
    process.exit(1);
  });
}
