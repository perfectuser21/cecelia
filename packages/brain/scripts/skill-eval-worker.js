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
// eval-prompt-v2.txt 现在存在 repo 内，可随 brain docker 打包
const _workerDir = path.dirname(new URL(import.meta.url).pathname);
const DEFAULT_EVAL_PROMPT = path.join(_workerDir, '..', 'src', 'skill-eval-formb-assets', 'eval-prompt-v2.txt');
const DEFAULT_WIZARD_PROMPT = path.join(_workerDir, '..', 'src', 'skill-eval-formb-assets', 'wizard-prompt.txt');

const EVAL_PROMPT_PATH =
  process.env.EVAL_PROMPT_PATH || (fs.existsSync(DEFAULT_EVAL_PROMPT) ? DEFAULT_EVAL_PROMPT : '/Users/administrator/perfect21/skill-eval-formb-assets/eval-prompt.txt');
const WIZARD_PROMPT_PATH =
  process.env.WIZARD_PROMPT_PATH || (fs.existsSync(DEFAULT_WIZARD_PROMPT) ? DEFAULT_WIZARD_PROMPT : '/Users/administrator/perfect21/skill-eval-formb-assets/wizard-prompt.txt');
// 旧版 eval-prompt.txt 里硬编码了一个示例路径（daily-report-v1-2 的调研路径），
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

// ─── spawn claude（通用）──────────────────────────────────────────────────

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, ['-p', prompt, '--model', 'sonnet', '--output-format', 'json'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(new Error(`claude 进程启动失败: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(`claude 退出码非 0: ${code}, stderr: ${stderr.slice(0, 2000)}`)); return; }
      resolve(stdout);
    });
  });
}

// ─── spawn claude eval ──────────────────────────────────────────────────────

function runClaudeEval(skillDir, wizardAssertions) {
  return new Promise((resolve, reject) => {
    const promptTemplate = fs.readFileSync(EVAL_PROMPT_PATH, 'utf8');
    const assertionText = wizardAssertions && wizardAssertions.length
      ? wizardAssertions.map((a) => `- ${a}`).join('\n')
      : '（无额外断言）';
    const prompt = promptTemplate
      .split(PROMPT_EXAMPLE_PATH).join(skillDir)
      .replace('__SKILL_DIR__', skillDir)
      .replace('__WIZARD_ASSERTIONS__', assertionText);

    const child = spawn(CLAUDE_BIN, ['-p', prompt, '--model', 'sonnet', '--output-format', 'json'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(new Error(`claude eval 进程启动失败: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(`claude eval 退出码非 0: ${code}, stderr: ${stderr.slice(0, 2000)}`)); return; }
      resolve(stdout);
    });
  });
}

// ─── 向导：生成7道是/否题 ─────────────────────────────────────────────────

async function runWizardQuestions(skillDir) {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  let skillContent = '';
  try {
    skillContent = (await fs.promises.readFile(skillMdPath, 'utf8')).slice(0, 4000);
  } catch (err) {
    throw new Error(`读取 SKILL.md 失败: ${err.message}`);
  }

  if (!fs.existsSync(WIZARD_PROMPT_PATH)) {
    throw new Error(`wizard-prompt.txt 不存在: ${WIZARD_PROMPT_PATH}`);
  }
  const promptTemplate = fs.readFileSync(WIZARD_PROMPT_PATH, 'utf8');
  const prompt = promptTemplate.replace('__SKILL_CONTENT__', skillContent);
  const stdout = await runClaude(prompt);

  let envelope;
  try { envelope = JSON.parse(stdout); } catch (e) { throw new Error(`wizard claude stdout 非法 JSON: ${e.message}`); }
  const resultText = envelope && envelope.result;
  if (!resultText) throw new Error('wizard claude envelope 缺 result');

  let wizardResult;
  try { wizardResult = JSON.parse(resultText); } catch (e) {
    const cleaned = sanitizeJsonString(resultText);
    try { wizardResult = JSON.parse(cleaned); } catch (e2) { throw new Error(`wizard questions JSON 解析失败: ${e2.message}`); }
  }
  const questions = wizardResult && Array.isArray(wizardResult.questions) ? wizardResult.questions : [];
  return questions;
}

// 把向导答案转成评估断言字符串列表
function buildWizardAssertions(wizardQuestions, wizardAnswers) {
  if (!wizardQuestions || !wizardAnswers) return [];
  return wizardQuestions
    .filter((q) => wizardAnswers[q.id] && wizardAnswers[q.id] !== 'skip')
    .map((q) => {
      const ans = wizardAnswers[q.id] === 'yes' ? '是' : '否';
      return `[用户确认] ${q.question} → 答：${ans}`;
    });
}

// ─── running 超时回收（进程崩溃后解除死锁）──────────────────────────────────

const STUCK_TIMEOUT_MINUTES = parseInt(process.env.EVAL_STUCK_TIMEOUT_MINUTES || '15', 10);

export async function reclaimStuckTasks() {
  const { rowCount } = await pool.query(
    `UPDATE skill_evals
     SET status = 'pending', updated_at = now()
     WHERE status = 'running'
       AND updated_at < now() - ($1 || ' minutes')::interval`,
    [STUCK_TIMEOUT_MINUTES]
  );
  if (rowCount > 0) {
    console.log(`[skill-eval-worker] 回收 ${rowCount} 条 stuck running 任务 → pending`);
  }
  return rowCount ?? 0;
}

// ─── 失败/成功路径写回 ──────────────────────────────────────────────────────

async function markFailed(taskId, reason) {
  await pool.query(
    `UPDATE skill_evals SET status = 'failed', failure_reason = $1, updated_at = now() WHERE task_id = $2`,
    [String(reason).slice(0, 4000), taskId]
  );
}

/**
 * 通过 HTTP 从 Brain 拉取 staging zip 的字节内容，写入宿主机本地临时文件。
 * Brain 跑在 Docker 容器里，直接用 claimPendingTask() 返回的 staging_path
 * （容器内路径）在宿主机 fs.readFile 会 ENOENT——容器和宿主机不共享文件系统。
 * @param {string} taskId
 * @returns {Promise<string>} 本地临时 zip 文件路径
 */
export async function downloadZipToTemp(taskId) {
  const url = `${BRAIN_BASE_URL}/api/skill-eval/staging/${taskId}`;
  const res = await fetch(url, {
    headers: { 'X-Eval-Proxy-Token': EVAL_PROXY_TOKEN },
  });
  if (!res.ok) {
    throw new Error(`下载 staging zip 失败: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const localZipPath = path.join(os.tmpdir(), `skill-eval-download-${randomUUID()}.zip`);
  await fs.promises.writeFile(localZipPath, buf);
  return localZipPath;
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
 * 原子取一条 pending 任务并标记为 running。
 * SELECT 子查询 + FOR UPDATE SKIP LOCKED 保证并发 worker 之间互相跳过对方正在锁的行，
 * 选取和状态迁移在同一条语句内完成，消除"先 SELECT 再 UPDATE"两步式的竞态窗口。
 * 标记 running 也满足 checkSlotAvailable 的槽位统计口径：routes/eval.js 的背压检查
 * 按 status='running' 数槽位，worker 取到任务后必须先占位，否则背压计数会漏掉正在处理的任务。
 * @returns {Promise<{task_id: string, staging_path: string} | null>}
 */
// 取一条「准备好跑全量评估」的 pending 任务（wizard 已答/跳过/旧数据）
export async function claimPendingTask() {
  const { rows } = await pool.query(
    `UPDATE skill_evals
     SET status = 'running', updated_at = now()
     WHERE task_id = (
       SELECT task_id FROM skill_evals
       WHERE status = 'pending'
         AND (wizard_status IN ('answered', 'skipped', 'none') OR wizard_status IS NULL)
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING task_id::text, staging_path, wizard_questions, wizard_answers`
  );
  return rows[0] || null;
}

// 取一条「需要生成向导问题」的任务（wizard_status='generating'）
export async function claimWizardTask() {
  const { rows } = await pool.query(
    `UPDATE skill_evals
     SET wizard_status = 'generating_locked', updated_at = now()
     WHERE task_id = (
       SELECT task_id FROM skill_evals
       WHERE status = 'pending' AND wizard_status = 'generating'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING task_id::text, staging_path`
  );
  return rows[0] || null;
}

// 向导问题生成完成后，回写并重置为 pending（等用户答题）
async function postWizardQuestions(taskId, questions) {
  const res = await fetch(`${BRAIN_BASE_URL}/api/skill-eval/wizard-ready/${taskId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Eval-Proxy-Token': EVAL_PROXY_TOKEN,
    },
    body: JSON.stringify({ questions }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/wizard-ready 回调失败: HTTP ${res.status} ${body.slice(0, 500)}`);
  }
}

// ─── 向导流程：取任务 → 生成7题 → 回写 → 等用户 ──────────────────────────
export async function runWizardOnce() {
  const claimed = await claimWizardTask();
  if (!claimed) return null;

  const { task_id: taskId } = claimed;
  console.log(`[skill-eval-worker] 向导任务 ${taskId} 开始生成问题`);

  const tmpDir = path.join(os.tmpdir(), `skill-eval-wizard-${randomUUID()}`);
  let localZipPath;
  try {
    localZipPath = await downloadZipToTemp(taskId);
    await extractZip(localZipPath, tmpDir);
    const skillDir = findSkillDir(tmpDir);
    const questions = await runWizardQuestions(skillDir);
    await postWizardQuestions(taskId, questions);
    console.log(`[skill-eval-worker] 向导任务 ${taskId} 生成了 ${questions.length} 道题，等待用户回答`);
    return { taskId, questions };
  } catch (err) {
    console.error(`[skill-eval-worker] 向导任务 ${taskId} 失败: ${err.message}`);
    // 向导生成失败 → 直接跳到可评估状态（不因向导失败阻塞整个流程）
    await pool.query(
      `UPDATE skill_evals SET wizard_status = 'skipped', updated_at = now() WHERE task_id = $1`,
      [taskId]
    );
    return null;
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    if (localZipPath) await fs.promises.unlink(localZipPath).catch(() => {});
  }
}

// ─── 全量评估流程 ──────────────────────────────────────────────────────────
export async function runOnce() {
  await reclaimStuckTasks();

  // 先跑向导（如果有生成中的任务）
  await runWizardOnce();

  const claimed = await claimPendingTask();
  if (!claimed) {
    console.log('[skill-eval-worker] 没有准备好评估的任务，退出');
    return null;
  }

  const { task_id: taskId, staging_path: stagingPath, wizard_questions, wizard_answers } = claimed;
  console.log(`[skill-eval-worker] 取到评估任务 ${taskId}，staging_path=${stagingPath}`);

  // 把向导答案转为评估断言
  const assertions = buildWizardAssertions(
    wizard_questions ? (typeof wizard_questions === 'string' ? JSON.parse(wizard_questions) : wizard_questions) : [],
    wizard_answers ? (typeof wizard_answers === 'string' ? JSON.parse(wizard_answers) : wizard_answers) : {}
  );

  const tmpDir = path.join(os.tmpdir(), `skill-eval-worker-${randomUUID()}`);
  let localZipPath;

  try {
    localZipPath = await downloadZipToTemp(taskId);
    await extractZip(localZipPath, tmpDir);
    const skillDir = findSkillDir(tmpDir);
    const stdout = await runClaudeEval(skillDir, assertions);
    const reportData = extractReportJson(stdout);
    await postComplete(taskId, reportData);
    console.log(`[skill-eval-worker] 任务 ${taskId} 完成`);
    return { taskId, reportData };
  } catch (err) {
    console.error(`[skill-eval-worker] 任务 ${taskId} 失败: ${err.message}`);
    await markFailed(taskId, err.message);
    return null;
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    if (localZipPath) await fs.promises.unlink(localZipPath).catch(() => {});
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
