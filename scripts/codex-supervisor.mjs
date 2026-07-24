#!/usr/bin/env node
/**
 * codex-supervisor.mjs — Provider-Neutral Codex Headless Supervisor
 *
 * 无头模式下驱动 codex exec，解析三态决策（continue/complete/blocked），
 * 并向 Brain API 回写状态。
 *
 * 三态协议：
 *   "continue" → codex exec resume <session-id> 续跑（INV-5）
 *   "complete" → 外部验收（不信模型自称，INV-6）→ Brain PATCH completed
 *   "blocked"  → Brain PATCH blocked（不伪装 completed，INV-7）
 *
 * 超出 MAX_TURNS=10 或 SUPERVISOR_DEADLINE_SECONDS=28800 → 标 timed_out，exit 1
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, existsSync, realpathSync } from 'fs';
import { delimiter, sep } from 'node:path';
import { parseCodexDecision as parseDecision, extractCodexSessionId as extractSessionId } from './lib/supervisor-parse.mjs';

// ─── 配置常量 ─────────────────────────────────────────────────────────────────
const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? '10', 10);
const SUPERVISOR_DEADLINE_SECONDS = parseInt(
  process.env.SUPERVISOR_DEADLINE_SECONDS ?? '28800',
  10
);
const BRAIN_URL = process.env.BRAIN_URL ?? 'http://host.docker.internal:5221';
const TASK_ID = process.env.HARNESS_TASK_ID ?? process.argv[2] ?? '';
const SPRINT_DIR = process.env.HARNESS_SPRINT_DIR ?? '';
const CODEX_SUPERVISOR_HOME = process.env.CODEX_SUPERVISOR_HOME ?? '';

function isolatedSupervisorEnv() {
  if (!CODEX_SUPERVISOR_HOME) throw new Error('CODEX_SUPERVISOR_HOME is required');
  const home = realpathSync(CODEX_SUPERVISOR_HOME);
  const allowlist = (process.env.CODEX_ISOLATED_ROOT_ALLOWLIST || '')
    .split(delimiter)
    .filter(Boolean)
    .map(root => realpathSync(root));
  if (!allowlist.some(root => home === root || home.startsWith(`${root}${sep}`))) {
    throw new Error('CODEX_SUPERVISOR_HOME realpath is outside root allowlist');
  }
  const env = { ...process.env, CODEX_HOME: home };
  delete env.CODEX_HOMES;
  delete env.CODEX_RELAY_HOME;
  delete env.CODEX_REVIEW_HOME;
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

if (!TASK_ID) {
  console.error('[codex-supervisor] HARNESS_TASK_ID is required');
  process.exit(1);
}

console.log(
  `[codex-supervisor] start: task=${TASK_ID} MAX_TURNS=${MAX_TURNS} DEADLINE=${SUPERVISOR_DEADLINE_SECONDS}s`
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
    console.warn(`[codex-supervisor] Brain PATCH failed (non-fatal): ${err.message}`);
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
    console.warn(`[codex-supervisor] Brain GET failed: ${err.message}`);
    return null;
  }
}

// ─── 外部验收（INV-6: complete 不信模型自称）────────────────────────────────

async function externalVerification(taskId) {
  // 外部验收：查询 Brain task 状态，看是否有外部 PR/CI 验证通过的证据
  // 若 Brain 不可达，保守返回 false（不伪装 complete）
  const task = await getBrainTask(taskId);
  if (!task) {
    console.warn('[codex-supervisor] external verification: Brain unreachable, treating as not-complete');
    return false;
  }

  // 检查是否有 PR URL 或外部验收结果
  const result = task.result ?? task.payload?.result;
  if (result?.pr_url || result?.pr_merged || result?.external_verified) {
    console.log('[codex-supervisor] external verification: PASS (pr/external evidence found)');
    return true;
  }

  // 检查 brain task 状态 — 只有 Brain 自己标 completed 才算
  if (task.status === 'completed') {
    console.log('[codex-supervisor] external verification: PASS (Brain task already completed)');
    return true;
  }

  console.log('[codex-supervisor] external verification: PENDING (no external evidence yet)');
  return false;
}

// ─── Codex 调用 ───────────────────────────────────────────────────────────────

function runCodexTurn(sessionId, promptFile) {
  const args = ['exec'];

  if (sessionId) {
    // INV-5: continue 时用同一 session-id 续跑（resume session-id）
    args.push('resume', sessionId);
  }

  args.push(
    '--json',
    '-c', 'approval_policy="never"',
    '-c', 'sandbox_mode="danger-full-access"',
    '--skip-git-repo-check'
  );

  const stdio = promptFile && existsSync(promptFile) ? ['pipe', 'pipe', 'pipe'] : 'pipe';
  const input = promptFile && existsSync(promptFile) ? readFileSync(promptFile) : undefined;

  const result = spawnSync('codex', args, {
    encoding: 'utf8',
    env: isolatedSupervisorEnv(),
    input,
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

  while (turn < MAX_TURNS) {
    // 检查 deadline
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    if (elapsedSeconds >= SUPERVISOR_DEADLINE_SECONDS) {
      console.error(
        `[codex-supervisor] deadline exceeded (${elapsedSeconds.toFixed(0)}s >= ${SUPERVISOR_DEADLINE_SECONDS}s) — timed_out`
      );
      await patchBrainTask(TASK_ID, {
        status: 'blocked',
        result: { reason: 'timed_out', turns: turn, elapsed_seconds: Math.round(elapsedSeconds) },
      });
      process.exit(1);
    }

    turn++;
    console.log(
      `[codex-supervisor] turn ${turn}/${MAX_TURNS} session=${sessionId ?? 'new'} elapsed=${Math.round(elapsedSeconds)}s`
    );

    const { exitCode, stdout, stderr } = runCodexTurn(sessionId, promptFile);

    // 提取 session-id（首轮建立后保存）
    const newSessionId = extractSessionId(stdout);
    if (newSessionId) sessionId = newSessionId;

    if (exitCode !== 0) {
      console.warn(`[codex-supervisor] codex exited ${exitCode}, treating as blocked`);
      // INV-7: blocked 写 Brain 不标 completed
      await patchBrainTask(TASK_ID, {
        status: 'blocked',
        result: {
          reason: 'codex_exit_nonzero',
          exit_code: exitCode,
          session_id: sessionId,
          turn,
          stderr: stderr.slice(-2000),
        },
      });
      process.exit(1);
    }

    const decision = parseDecision(stdout);
    console.log(`[codex-supervisor] decision=${decision} session=${sessionId}`);

    if (decision === 'blocked') {
      // INV-7: blocked → Brain PATCH blocked（不伪装 completed）
      await patchBrainTask(TASK_ID, {
        status: 'blocked',
        result: { reason: 'model_blocked', session_id: sessionId, turn },
      });
      console.log('[codex-supervisor] task blocked — exit 1');
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
        console.log('[codex-supervisor] task complete + externally verified — exit 0');
        process.exit(0);
      } else {
        // 外部验收未通过 → 继续等待/续跑
        console.log('[codex-supervisor] complete claimed but external verification pending — continue');
        // 短暂等待后续跑（外部验收可能需要等 CI）
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
    }

    // decision === 'continue': INV-5 — 用 session-id 续跑（下一循环用 resume）
    console.log(`[codex-supervisor] continue — next turn with session=${sessionId}`);
  }

  // 超过 MAX_TURNS
  console.error(`[codex-supervisor] MAX_TURNS (${MAX_TURNS}) reached — timed_out`);
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
  console.error(`[codex-supervisor] fatal: ${err.message}`);
  process.exit(1);
});
