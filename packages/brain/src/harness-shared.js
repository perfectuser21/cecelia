/**
 * harness-shared.js — 跨模块共享的 docker output parsing 工具。
 *
 * 这 3 个函数原定义在 harness-graph.js（6 节点 GAN pipeline 主文件）。
 * 该 pipeline 已退役（PR retire-harness-planner），但 docker-executor /
 * harness-initiative.graph / harness-task.graph 仍依赖这 3 个纯函数解析
 * Claude `--output-format json` 容器输出，故抽到本模块独立保留。
 *
 * 函数语义与 harness-graph.js 原版完全一致，仅 module 路径切换。
 */

import { readFileSync, existsSync } from 'fs';
import { readFile } from 'node:fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// ─── Skill 内联加载 ──────────────────────────────────────────────────────────
// Docker 容器里 Claude Code headless (-p) 模式不识别 `/skill-name` 语法，
// 必须把 SKILL.md 原文内联到 prompt 里，Claude 才能按 skill 指令工作。
//
// 搜索顺序:
// 1-3. host 上 ~/.claude*/skills 的 symlink（开发本机 + brain runtime）
// 4. monorepo 内 packages/workflows/skills（CI / 任何 git checkout 都有，无 home 依赖）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_SEARCH_DIRS = [
  path.join(os.homedir(), '.claude-account1', 'skills'),
  path.join(os.homedir(), '.claude-account2', 'skills'),
  path.join(os.homedir(), '.claude', 'skills'),
  // packages/brain/src/ → packages/workflows/skills/
  path.resolve(__dirname, '..', '..', 'workflows', 'skills'),
];

const _skillCache = new Map();

/**
 * 读取 skill 的 SKILL.md 内容（缓存）。
 * 优先查 ~/.claude-account1/skills/<name>/SKILL.md。
 * 找不到返回空串（不抛错，让 prompt 能回退）。
 */
export function loadSkillContent(skillName) {
  if (_skillCache.has(skillName)) return _skillCache.get(skillName);
  for (const base of SKILL_SEARCH_DIRS) {
    const p = path.join(base, skillName, 'SKILL.md');
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf8');
        _skillCache.set(skillName, content);
        return content;
      } catch { /* continue */ }
    }
  }
  _skillCache.set(skillName, '');
  return '';
}

// ─── Docker 输出解析 ─────────────────────────────────────────────────────────

/**
 * 解析 claude --output-format json 的 stdout。
 * Claude CLI JSON 输出格式：最后一个 JSON 对象包含 result 字段。
 * 兼容多行输出（streaming chunks + final result）。
 *
 * @param {string} stdout  Docker container stdout
 * @returns {string}       提取的文本内容（result 字段或 raw stdout）
 */
export function parseDockerOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') return '';
  const trimmed = stdout.trim();
  if (!trimmed) return '';

  // 尝试从末尾找最后一个完整 JSON 对象
  // claude --output-format json 输出的最后一段是 {"type":"result","result":"..."}
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.result) return typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result);
      if (obj.content) return typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
      // 其他 JSON — 返回整行
      return line;
    } catch {
      continue;
    }
  }

  // 非 JSON 输出 — 返回最后 4000 字符
  return trimmed.slice(-4000);
}

/**
 * 被视为"未提供"的字面量（Claude 在失败/缺值时可能输出这些）。
 * extractField 抓到这些字符串时返回 null，下游才不会把假值当真。
 *
 * 背景：harness task 0154e285 在 Generator 里 git push 静默失败（容器 .gitconfig
 * :ro 挂载导致 safe.directory 设置失败），Claude 输出 `pr_url: null`，老正则
 * 贪婪匹配返回字符串 "null"，Evaluator 拿到这个"URL" 必然 FAIL，Fix 循环无限死循环。
 */
const INVALID_LITERALS = new Set([
  'null', 'undefined', 'none', 'n/a', 'na',
  'failed', 'error', 'tbd', 'todo',
  '<url>', '<pr_url>', '<branch>', '<pr_branch>',
]);

/**
 * 从 Docker 输出中提取特定字段值。
 *
 * 策略（按优先级）：
 *   1. 字面量匹配 `field: value` / `**field**: value` / JSON `"field": "value"`
 *      - 值命中 INVALID_LITERALS（null/FAILED/none/...）→ 视为无提取
 *      - 值两端引号 → 剥掉
 *   2. pr_url 额外 fallback：扫全文找 `https://github.com/{owner}/{repo}/pull/{num}`
 *   3. pr_branch 额外 fallback：扫全文找 `cp-\d{8,10}-[\w-]+` 分支名
 *   4. 否则返回 null
 *
 * SKILL.md 要求 Claude 输出纯 JSON `{"verdict":"DONE","pr_url":"..."}`；
 * harness-graph.js prompt 要求 `pr_url: <URL>` 字面量。两种格式经过上面
 * 三步策略都能被正确提取。
 */
export function extractField(text, fieldName) {
  if (!text) return null;
  const fieldLower = String(fieldName).toLowerCase();

  // Step 1: 字面量匹配
  // 允许 key 被 `**` 或 `"` 包裹（markdown 粗体 / JSON 场景）
  // 值首字符允许可选 `"`，然后非引号/非换行/非逗号/非右花括号的字符
  // 尾端可选 `"`，前瞻 `,` `}` `\n` `EOF`
  const re = new RegExp(
    `(?:\\*\\*|")?${fieldName}(?:\\*\\*|")?\\s*:\\s*"?([^"\\n,}]*?)"?(?=\\s*(?:[,}]|\\n|$))`,
    'i'
  );
  const m = text.match(re);
  if (m && m[1] !== undefined) {
    const candidate = m[1].trim();
    if (candidate && !INVALID_LITERALS.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  // Step 2: pr_url fallback — 扫裸 GitHub PR URL
  // 兼容 markdown 链接 / gh pr create 默认输出 / JSON 里被引号包的 URL
  if (fieldLower === 'pr_url') {
    const urlMatch = text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/);
    if (urlMatch) return urlMatch[0];
  }

  // Step 3: pr_branch fallback — 扫 cp- 分支名
  // cp-<8-10 digits>-<word-chars and hyphens>
  if (fieldLower === 'pr_branch') {
    const branchMatch = text.match(/\bcp-\d{8,10}-[\w-]+/);
    if (branchMatch) return branchMatch[0];
  }

  return null;
}

// ─── Protocol v2：Brain 直接读 git 状态 + 约定路径文件 ────────────────────────
// 彻底消除依赖 LLM stdout 提取确定性值（分支名、verdict、pr_url）。
// 约定文件路径（容器内写入，Brain 容器退出后读取）：
//   ${worktreePath}/.cecelia/output.json  → { pr_url, pr_branch }  (generator)
//   ${worktreePath}/.cecelia/verdict.json → { verdict, feedback }  (evaluator)

/**
 * 从 worktree git 状态读取 pr_url + pr_branch，不依赖 LLM stdout 解析。
 *
 * 步骤：
 *   1. git rev-parse --abbrev-ref HEAD → 当前分支名
 *   2. gh pr list --head <branch> --json url → PR URL
 *
 * @param {string} worktreePath
 * @param {object} [opts]
 * @param {Function} [opts.execFile]  测试注入（默认 promisify(execFileCb)）
 * @returns {Promise<{pr_url:string, pr_branch:string}|null>}
 */
export async function readPrFromGitState(worktreePath, opts = {}) {
  if (!worktreePath) return null;
  // 懒加载 execFile：harness-shared.js 被 docker-executor.js import，
  // 测试普遍 mock 了 child_process 但只导出 spawn，静态 import execFile 会触发 mock 报错。
  // 只在真实调用时才 import，避免 module 级别污染。
  let execFn = opts.execFile;
  if (!execFn) {
    const { execFile: ef } = await import('node:child_process');
    const { promisify: p } = await import('node:util');
    execFn = p(ef);
  }
  try {
    const { stdout: branchOut } = await execFn('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 10_000 });
    const branch = String(branchOut || '').trim();
    if (!branch || branch === 'HEAD') return null;

    const { stdout: prOut } = await execFn('gh', ['pr', 'list', '--head', branch, '--json', 'url', '-q', '.[0].url'], { timeout: 15_000 });
    const pr_url = String(prOut || '').trim();
    if (!pr_url || INVALID_LITERALS.has(pr_url.toLowerCase())) return null;

    return { pr_url, pr_branch: branch };
  } catch {
    return null;
  }
}

/**
 * 读取 evaluator 写入的 verdict 文件（Protocol v2）。
 * 容器写 ${worktreePath}/.cecelia/verdict.json → { verdict: "PASS"|"FAIL", feedback?: string }
 *
 * @param {string} worktreePath
 * @returns {Promise<{verdict:'PASS'|'FAIL', feedback:string|null}|null>}
 */
export async function readVerdictFile(worktreePath) {
  if (!worktreePath) return null;
  try {
    const filePath = path.join(worktreePath, '.cecelia', 'verdict.json');
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    const verdict = String(parsed.verdict || '').toUpperCase().trim();
    if (verdict !== 'PASS' && verdict !== 'FAIL') return null;
    return { verdict, feedback: parsed.feedback || null };
  } catch {
    return null;
  }
}

/**
 * 容器退出后从 worktree 读 .brain-result.json，验证 requiredFields 存在。
 * 文件不存在 → 抛 ContractViolation: missing_result_file
 * 字段缺失或为 null → 抛 ContractViolation: invalid_result_file: missing field {field}
 *
 * @param {string} worktreePath    worktree 根目录路径
 * @param {string[]} requiredFields  必须存在且非 null 的字段名列表
 * @returns {Promise<object>}      parsed .brain-result.json 对象
 */
export async function readBrainResult(worktreePath, requiredFields = []) {
  const filePath = path.join(worktreePath, '.brain-result.json');
  if (!existsSync(filePath)) {
    const err = new Error(`ContractViolation: missing_result_file — ${filePath}`);
    err.code = 'missing_result_file';
    throw err;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    const err = new Error(`ContractViolation: invalid_result_file — JSON parse failed: ${e.message}`);
    err.code = 'invalid_result_file';
    throw err;
  }
  for (const field of requiredFields) {
    if (data[field] === null || data[field] === undefined) {
      const err = new Error(`ContractViolation: invalid_result_file: missing field ${field}`);
      err.code = 'invalid_result_file';
      throw err;
    }
  }
  return data;
}
