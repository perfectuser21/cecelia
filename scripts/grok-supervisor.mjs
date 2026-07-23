#!/usr/bin/env node
/**
 * grok-supervisor.mjs — Provider-Neutral Grok Headless Supervisor
 *
 * 无头模式下驱动 grok -p，解析三态决策（continue/complete/blocked），
 * 并向 Brain API 回写状态。对齐 codex-supervisor.mjs 协议。
 *
 * 三态协议：
 *   "continue" → grok -p ... --resume <session-id> 续跑（INV-5 + GP6）
 *   "complete" → 外部验收（不信模型自称，INV-6）→ Brain PATCH completed
 *   "blocked"  → Brain PATCH blocked（不伪装 completed，INV-7）
 *
 * 超出 MAX_TURNS=10 或 SUPERVISOR_DEADLINE_SECONDS（默认 1800=30 分钟）→ 标 timed_out，exit 1
 * Sprint 1b997ed6：移除 28800（8 小时）硬编码，改用 run 剩余预算动态注入；
 * 安全降级值 = 1800 秒（最大角色上限 generator/evaluator）。
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { parseGrokDecision as parseDecision, extractGrokSessionId as extractSessionId } from './lib/supervisor-parse.mjs';

// ─── 配置常量 ─────────────────────────────────────────────────────────────────
const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? '10', 10);
// Sprint 1b997ed6：降级值从 28800（8h）改为 1800（30min，最大角色上限）。
// 实际值由 dispatcher 在 spawn 前计算 min(角色上限, run 剩余预算) 后注入 SUPERVISOR_DEADLINE_SECONDS 环境变量。
const SUPERVISOR_DEADLINE_SECONDS = parseInt(
  process.env.SUPERVISOR_DEADLINE_SECONDS ?? '1800',
  10
);
const BRAIN_URL = process.env.BRAIN_URL ?? 'http://host.docker.internal:5221';
const TASK_ID = process.env.HARNESS_TASK_ID ?? process.argv[2] ?? '';
const SPRINT_DIR = process.env.HARNESS_SPRINT_DIR ?? '';

if (!TASK_ID) {
  console.error('[grok-supervisor] HARNESS_TASK_ID is required');
  process.exit(1);
}

console.log(
  `[grok-supervisor] start: task=${TASK_ID} MAX_TURNS=${MAX_TURNS} DEADLINE=${SUPERVISOR_DEADLINE_SECONDS}s`
);

// ─── Brain API ────────────────────────────────────────────────────────────────

async function patchBrainTask(taskId, body) {
  try {
    const result = execSync(
      `curl -sf -m 15 -X PATCH "${BRAIN_URL}/api/brain/tasks/${taskId}" \
        -H 'Content-Type: application/json' \
        -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`,
      { encoding: 'utf8', timeout: 20000 }
    );
    return JSON.parse(result || '{}');
  } catch (err) {
    console.warn(`[grok-supervisor] Brain PATCH failed (non-fatal): ${err.message}`);
    return null;
  }
}

async function getBrainTask(taskId) {
  try {
    const result = execSync(
      `curl -sf -m 15 "${BRAIN_URL}/api/brain/tasks/${taskId}"`,
      { encoding: 'utf8', timeout: 20000 }
    );
    return JSON.parse(result || '{}');
  } catch (err) {
    console.warn(`[grok-supervisor] Brain GET failed: ${err.message}`);
    return null;
  }
}

// ─── 外部验收（INV-6: complete 不信模型自称）────────────────────────────────

async function externalVerification(taskId) {
  const task = await getBrainTask(taskId);
  if (!task) {
    console.warn('[grok-supervisor] external verification: Brain unreachable, treating as not-complete');
    return false;
  }

  const result = task.result ?? task.payload?.result;
  if (result?.pr_url || result?.pr_merged || result?.external_verified) {
    console.log('[grok-supervisor] external verification: PASS (pr/external evidence found)');
    return true;
  }

  if (task.status === 'completed') {
    console.log('[grok-supervisor] external verification: PASS (Brain task already completed)');
    return true;
  }

  console.log('[grok-supervisor] external verification: PENDING (no external evidence yet)');
  return false;
}

// ─── Grok 调用 ────────────────────────────────────────────────────────────────

function runGrokTurn(sessionId, promptContent) {
  // GP6: grok -p <prompt> --output-format json [--resume <session-id>]
  const args = [
    '-p', promptContent || '',
    '--output-format', 'json',
    '--always-approve',
  ];

  if (sessionId) {
    // INV-5 + GP6: continue 路径 — grok -p ... --resume <session-id>
    args.push('--resume', sessionId);
  }

  const result = spawnSync('grok', args, {
    encoding: 'utf8',
    timeout: SUPERVISOR_DEADLINE_SECONDS * 1000,
    maxBuffer: 50 * 1024 * 1024,
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}


// ─── 主循环 ───────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  let turn = 0;
  let sessionId = null;
  const promptFile = process.env.HARNESS_PROMPT_FILE ?? process.argv[3] ?? '';
  let promptContent = '';

  if (promptFile && existsSync(promptFile)) {
    promptContent = readFileSync(promptFile, 'utf8');
  }

  while (turn < MAX_TURNS) {
    // 检查 deadline
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    if (elapsedSeconds >= SUPERVISOR_DEADLINE_SECONDS) {
      console.error(
        `[grok-supervisor] deadline exceeded (${elapsedSeconds.toFixed(0)}s >= ${SUPERVISOR_DEADLINE_SECONDS}s) — timed_out`
      );
      await patchBrainTask(TASK_ID, {
        status: 'blocked',
        result: { reason: 'timed_out', turns: turn, elapsed_seconds: Math.round(elapsedSeconds) },
      });
      process.exit(1);
    }

    turn++;
    console.log(
      `[grok-supervisor] turn ${turn}/${MAX_TURNS} session=${sessionId ?? 'new'} elapsed=${Math.round(elapsedSeconds)}s`
    );

    const { exitCode, stdout, stderr } = runGrokTurn(sessionId, promptContent);

    // 提取 session-id
    const newSessionId = extractSessionId(stdout);
    if (newSessionId) sessionId = newSessionId;

    if (exitCode !== 0) {
      console.warn(`[grok-supervisor] grok exited ${exitCode}, treating as blocked`);
      // INV-7: blocked 写 Brain 不标 completed
      await patchBrainTask(TASK_ID, {
        status: 'blocked',
        result: {
          reason: 'grok_exit_nonzero',
          exit_code: exitCode,
          session_id: sessionId,
          turn,
          stderr: stderr.slice(-2000),
        },
      });
      process.exit(1);
    }

    const decision = parseDecision(stdout);
    console.log(`[grok-supervisor] decision=${decision} session=${sessionId}`);

    if (decision === 'blocked') {
      // INV-7: blocked → Brain PATCH blocked（不伪装 completed）
      await patchBrainTask(TASK_ID, {
        status: 'blocked',
        result: { reason: 'model_blocked', session_id: sessionId, turn },
      });
      console.log('[grok-supervisor] task blocked — exit 1');
      process.exit(1);
    }

    if (decision === 'complete') {
      // INV-6: complete 须外部验收，不信模型自称
      const verified = await externalVerification(TASK_ID);
      if (verified) {
        await patchBrainTask(TASK_ID, {
          status: 'completed',
          result: { session_id: sessionId, turn, verified: true },
        });
        console.log('[grok-supervisor] task complete + externally verified — exit 0');
        process.exit(0);
      } else {
        console.log('[grok-supervisor] complete claimed but external verification pending — continue');
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
    }

    // decision === 'continue': 用 session-id 续跑
    console.log(`[grok-supervisor] continue — next turn with session=${sessionId}`);
  }

  // 超过 MAX_TURNS → timed_out
  console.error(`[grok-supervisor] MAX_TURNS (${MAX_TURNS}) reached — timed_out`);
  await patchBrainTask(TASK_ID, {
    status: 'blocked',
    result: {
      reason: 'timed_out',
      turns: turn,
      session_id: sessionId,
      elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
    },
  });
  process.exit(1);
}

main().catch((err) => {
  console.error(`[grok-supervisor] fatal: ${err.message}`);
  process.exit(1);
});
