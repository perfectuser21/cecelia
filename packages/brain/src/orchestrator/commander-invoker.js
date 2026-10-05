/**
 * commander-invoker — 常驻监工唤醒器（第 81 批，回家工程第二块）
 *
 * 监工形态（Alex 2026-09-05 拍板）：记忆常驻、进程不常驻。
 *   一 run 一个 Claude Code 会话（--session-id 开局，--resume 逐收口唤醒），
 *   会话存磁盘，每次唤醒只追加一封蒸馏收口摘要（≤1200B，压缩病源头绝育）。
 *   实测：fojc1r 重放 8/8（含 c8 盲区题）、v1423a 跨格对质、单唤醒 10-13 秒。
 *
 * 裁定+疑点写 sequencer_ledger（审计 + 会话丢失时的重建源）。
 * 唤醒失败三级降级：①同会话重问一次 ②从台账重建会话 ③verdict=null 升人。
 * 绝不猜裁定——封闭词表解析失败就是失败。
 */

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { parseCommanderReply } from './home-sequencer.js';

const DIGEST_MAX_BYTES = 1200;
const WAKE_TIMEOUT_MS = 240_000;
const COMMANDER_MODEL = process.env.SEQUENCER_COMMANDER_MODEL || 'claude-haiku-4-5-20251001';

/** 默认 CLI runner：真 spawn claude -p。测试注入 fake。 */
function defaultRunner(args, prompt) {
  return new Promise((resolve, reject) => {
    execFile('claude', ['-p', ...args, '--model', COMMANDER_MODEL, prompt], {
      timeout: WAKE_TIMEOUT_MS,
      env: { ...process.env, CLAUDE_CONFIG_DIR: process.env.SEQUENCER_COMMANDER_CONFIG_DIR || process.env.HOME + '/.claude-account1' },
      maxBuffer: 4 * 1024 * 1024,
    }, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim())));
  });
}

/**
 * 监工 charter：裁定纪律 + 封闭词表 + 跨格记忆职责 + 题目原文。
 * 判则细节（案卷库）后续从 HK skill 平移追加；这里是不可缺的骨架。
 */
export function buildCharter({ runId, taskRequest, gear }) {
  return `你是 coding harness 的常驻监工（work-commander），负责 run ${runId}（档位 ${gear}）每个收口的验收裁定。

## 裁定纪律
- 裁定词封闭三选一：accepted / retry / blocked
- accepted：本格完成且证据自洽（带 P2 非阻塞保留意见的完成也算）
- retry：存在具体、可修的缺口，且重试有望改变结果（瞬时基础设施故障——容量耗尽、网络抖动——属于可重试）
- blocked：重试无意义——持久性基础设施故障、上游冻结产物本身有病需要回上游、或确定性失败（同样输入必然复现同样拒绝，如坐标不匹配类的服务端 409）
- 跨格记忆职责：你带着整个 run 的来龙去脉。裁定时参考之前各格的事实；发现值得后续格警惕的疑点，在分析里显式写出（它会进台账成为对质材料）。

## 输出格式（严格）
先一句话分析，然后单独一行机器行：
VERDICT: <accepted|retry|blocked>

## 任务原文（冻结）
${taskRequest}

本条消息回复"监工就位"即可。`;
}

/** 开局：--session-id 起 run 专属会话。 */
export async function createCommanderSession(runCtx, { runner = defaultRunner } = {}) {
  const sessionId = randomUUID();
  await runner(['--session-id', sessionId], buildCharter(runCtx));
  return { sessionId };
}

async function writeLedger(pool, { runId, stageId, stageAttempt, verdict, reasoning, digest }) {
  await pool.query(
    `INSERT INTO sequencer_ledger (run_id, stage_id, stage_attempt, verdict, reasoning, digest, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [runId, stageId, stageAttempt, verdict, reasoning, digest],
  );
}

/**
 * 唤醒监工裁定一个收口。
 * @returns {{verdict: string|null, reasoning: string, escalate?: boolean}}
 */
export async function wakeCommander(
  { sessionId, runId, stageId, stageAttempt, digest },
  { runner = defaultRunner, pool } = {},
) {
  if (Buffer.byteLength(digest, 'utf8') > DIGEST_MAX_BYTES) {
    throw new Error(`digest_too_large:${stageId}`);
  }
  let out;
  try {
    out = await runner(['--resume', sessionId], `${digest}\n\n给出裁定。`);
  } catch (err) {
    throw new Error(`commander_wake_failed:${stageId}: ${err.message}`);
  }
  let { verdict, reasoning } = parseCommanderReply(out);

  if (!verdict) {
    // 降级①：同会话重问一次，点明格式要求。
    try {
      out = await runner(['--resume', sessionId],
        '上一条回复缺少机器行。重新给出，最后必须单独一行：VERDICT: <accepted|retry|blocked>');
      ({ verdict, reasoning } = parseCommanderReply(out));
    } catch (err) {
      throw new Error(`commander_wake_failed:${stageId}: ${err.message}`);
    }
  }

  if (pool) {
    await writeLedger(pool, {
      runId, stageId, stageAttempt,
      verdict: verdict ?? 'unparseable', reasoning, digest,
    });
  }
  if (!verdict) return { verdict: null, reasoning, escalate: true };
  return { verdict, reasoning };
}

/**
 * 降级②：会话丢失时，用台账全部裁定记录重开会话（charter + 逐格回放摘要与裁定史）。
 */
export async function rebuildSessionFromLedger(runCtx, { runner = defaultRunner, pool }) {
  const { rows } = await pool.query(
    'SELECT run_id, stage_id, stage_attempt, verdict, reasoning, digest FROM sequencer_ledger WHERE run_id = $1 ORDER BY created_at ASC, stage_attempt ASC',
    [runCtx.runId],
  );
  const history = rows.map((r) =>
    `[${r.stage_id} 第${r.stage_attempt}次] 摘要:${r.digest}\n你当时的裁定:${r.verdict}（${r.reasoning}）`,
  ).join('\n\n');
  const sessionId = randomUUID();
  await runner(['--session-id', sessionId],
    `${buildCharter(runCtx)}\n\n## 会话恢复（原会话丢失，以下是台账里你此前的全部裁定史，恢复上下文后回复"监工已恢复上下文"）\n\n${history}`);
  return { sessionId };
}
