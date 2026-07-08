#!/usr/bin/env node
/**
 * skill-eval-worker.js — Skill Evaluator 单次轮询评估 worker（非常驻）
 * Sprint: skill-eval-formb-track2
 *
 * 单次执行：
 *   1. 查一条 pending 的 skill_evals（复用 ../src/db.js 的 pool，与 API 同一套连接方式）
 *   2. 解压 staging_path 的 zip 到临时目录，定位 SKILL.md 所在目录
 *   3. 拼 eval-prompt.txt + 目标 skill 目录路径，spawn 本地 claude 二进制评估
 *   4. 解析 stdout 中的 report_data JSON（含兜底正则修复）
 *   5. 成功 → POST /api/skill-eval/complete；失败 → 直接写库 status=failed
 *
 * 用法：node packages/brain/scripts/skill-eval-worker.js
 *
 * 本 PR 范围：验证"跑一次能 work"。常驻循环（pm2/systemd）留到 PR merge 后单独配置，不产生 git diff。
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import pool from '../src/db.js';

// ─── 配置 ──────────────────────────────────────────────────────────────────

// claude 在交互 shell 里是函数（alias/shell function），不是可执行文件——
// child_process.spawn 走的是真实 execve，必须给绝对路径，否则报 ENOENT。
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude';
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || '/Users/administrator/.claude-account2';
const EVAL_PROMPT_PATH =
  process.env.EVAL_PROMPT_PATH || '/Users/administrator/perfect21/skill-eval-formb-assets/eval-prompt.txt';
// eval-prompt.txt 里硬编码了一个示例路径（daily-report-v1-2 的调研路径），
// 每次真实运行时要把它替换成本次解压出来的目标 skill 目录。
const PROMPT_EXAMPLE_PATH = '/tmp/eval-exp/daily-report-v1-2';

const EVAL_PROXY_TOKEN = process.env.EVAL_PROXY_TOKEN || '';
const BRAIN_BASE_URL =
  process.env.BRAIN_BASE_URL || `http://localhost:${process.env.PORT || process.env.BRAIN_PORT || 5221}`;

// ─── 纯函数：JSON 加固（可脱离 claude 二进制单测）──────────────────────────

/**
 * 兜底正则：清理字符串值内部未转义的双引号（评估 prompt 已要求模型用中文引号「」，
 * 但模型仍可能偶尔吐出英文引号把 JSON 弄坏——这个正则把「夹在普通字符中间」的
 * 双引号直接删掉，不动结构性的引号（紧跟 : , { [ 或 } ] 的引号保留）。
 */
export function sanitizeJsonString(s) {
  return s.replace(/(?<=[^\s:,{[])"(?=[^\s:,}\]])/g, '');
}

/**
 * 从 `claude -p ... --output-format json` 的 stdout 里解析出 report_data。
 * stdout 本身是 claude CLI 的 JSON envelope（{type,result,...}），
 * envelope.result 是模型的最终文本输出，report_data 是这段文本本身应当就是的 JSON。
 * @param {string} claudeStdout
 * @returns {object} report_data
 */
export function extractReportJson(claudeStdout) {
  let envelope;
  try {
    envelope = JSON.parse(claudeStdout);
  } catch (err) {
    throw new Error(`claude stdout 不是合法 JSON envelope: ${err.message}`);
  }

  const resultText = envelope && envelope.result;
  if (typeof resultText !== 'string' || !resultText.trim()) {
    throw new Error('claude envelope 缺少 result 字段或为空');
  }

  try {
    return JSON.parse(resultText);
  } catch (firstErr) {
    const cleaned = sanitizeJsonString(resultText);
    try {
      return JSON.parse(cleaned);
    } catch (secondErr) {
      throw new Error(
        `report_data JSON 解析失败（直接解析: ${firstErr.message}；兜底正则重试后仍失败: ${secondErr.message}）`
      );
    }
  }
}

// ─── zip 解压 + 定位 SKILL.md 目录 ─────────────────────────────────────────

async function extractZip(zipPath, destDir) {
  const { default: unzipper } = await import('unzipper');
  await fs.promises.mkdir(destDir, { recursive: true });
  await new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destDir }))
      .on('close', resolve)
      .on('error', reject);
  });
}

/** 广度优先找 SKILL.md 所在目录（zip 可能把 skill 包在一层子目录里），最深搜 4 层。 */
function findSkillDir(rootDir) {
  let queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      return dir;
    }
    if (depth >= 4) continue;
    for (const e of entries) {
      if (e.isDirectory()) queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  throw new Error(`解压后未找到 SKILL.md（搜索根目录: ${rootDir}）`);
}

// ─── spawn claude ──────────────────────────────────────────────────────────

function runClaudeEval(skillDir) {
  return new Promise((resolve, reject) => {
    const promptTemplate = fs.readFileSync(EVAL_PROMPT_PATH, 'utf8');
    const prompt = promptTemplate.split(PROMPT_EXAMPLE_PATH).join(skillDir);

    const child = spawn(CLAUDE_BIN, ['-p', prompt, '--model', 'sonnet', '--output-format', 'json'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(new Error(`claude 进程启动失败: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude 退出码非 0: ${code}, stderr: ${stderr.slice(0, 2000)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

// ─── 失败/成功路径写回 ──────────────────────────────────────────────────────

async function markFailed(taskId, reason) {
  await pool.query(
    `UPDATE skill_evals SET status = 'failed', failure_reason = $1, updated_at = now() WHERE task_id = $2`,
    [String(reason).slice(0, 4000), taskId]
  );
}

async function postComplete(taskId, reportData) {
  const reportUrl = `${BRAIN_BASE_URL}/api/skill-eval/report/${taskId}`;
  const res = await fetch(`${BRAIN_BASE_URL}/api/skill-eval/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Eval-Proxy-Token': EVAL_PROXY_TOKEN,
    },
    body: JSON.stringify({ task_id: taskId, report_url: reportUrl, report_data: reportData }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/api/skill-eval/complete 回调失败: HTTP ${res.status} ${body.slice(0, 500)}`);
  }
}

// ─── 主流程：单次轮询一条 pending 任务 ──────────────────────────────────────

/**
 * 回收超时卡死的 running 任务：worker 进程崩溃/被杀后，claimPendingTask 抢到的任务
 * 会永久卡在 status='running'（原实现遗留问题）。常驻多实例部署后这个问题会被放大，
 * 因此每次 runOnce() 之前先扫一次，把超过阈值仍未完成的任务退回 pending 重新排队。
 * @param {number} timeoutMinutes 超时阈值（分钟），默认 10
 * @returns {Promise<{recovered: number}>}
 */
export async function reapStaleRunning(timeoutMinutes = 10) {
  const { rowCount } = await pool.query(
    `UPDATE skill_evals
     SET status = 'pending', updated_at = now()
     WHERE status = 'running'
       AND updated_at < now() - ($1 * interval '1 minute')`,
    [timeoutMinutes]
  );
  return { recovered: rowCount };
}

/**
 * 原子取一条 pending 任务并标记为 running。
 * SELECT 子查询 + FOR UPDATE SKIP LOCKED 保证并发 worker 之间互相跳过对方正在锁的行，
 * 选取和状态迁移在同一条语句内完成，消除"先 SELECT 再 UPDATE"两步式的竞态窗口。
 * 标记 running 也满足 checkSlotAvailable 的槽位统计口径：routes/eval.js 的背压检查
 * 按 status='running' 数槽位，worker 取到任务后必须先占位，否则背压计数会漏掉正在处理的任务。
 * @returns {Promise<{task_id: string, staging_path: string} | null>}
 */
export async function claimPendingTask() {
  const { rows } = await pool.query(
    `UPDATE skill_evals
     SET status = 'running', updated_at = now()
     WHERE task_id = (
       SELECT task_id FROM skill_evals
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING task_id::text, staging_path`
  );
  return rows[0] || null;
}

export async function runOnce() {
  const { recovered } = await reapStaleRunning();
  if (recovered > 0) {
    console.log(`[skill-eval-worker] 回收 ${recovered} 个超时 running 任务`);
  }

  const claimed = await claimPendingTask();

  if (!claimed) {
    console.log('[skill-eval-worker] 没有 pending 任务，退出');
    return null;
  }

  const { task_id: taskId, staging_path: stagingPath } = claimed;
  console.log(`[skill-eval-worker] 取到任务 ${taskId}，staging_path=${stagingPath}`);

  const tmpDir = path.join(os.tmpdir(), `skill-eval-worker-${randomUUID()}`);

  try {
    await extractZip(stagingPath, tmpDir);
    const skillDir = findSkillDir(tmpDir);
    const stdout = await runClaudeEval(skillDir);
    const reportData = extractReportJson(stdout);
    await postComplete(taskId, reportData);
    console.log(`[skill-eval-worker] 任务 ${taskId} 完成`);
    return { taskId, reportData };
  } catch (err) {
    console.error(`[skill-eval-worker] 任务 ${taskId} 失败: ${err.message}`);
    // 失败路径直接写库，不经 /api/skill-eval/complete ——
    // 该端点目前只处理成功路径（见 routes/eval.js 的 /complete 实现，只写 status='completed'）。
    await markFailed(taskId, err.message);
    return null;
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// 直接执行（node scripts/skill-eval-worker.js）时才跑主流程；被测试 import 时不自动执行。
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runOnce()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[skill-eval-worker] 未捕获错误:', err);
      process.exit(1);
    });
}
