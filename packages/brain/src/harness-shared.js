/**
 * 现役共享工具：docker-executor的stdout解析、仓库Skill加载及executor的sprint目录校验。
 * 旧图专用的文件/Schema桥已随无消费者依赖闭包清退；.brain-result真协议仍由
 * ground-truth、loop、harness-judge及HTTP路由独立读取，本模块不代表那些入口。
 */

import { loadRepositorySkillContent } from './orchestrator/skill-bundle.js';

// ─── Skill 内联加载 ──────────────────────────────────────────────────────────
// Docker 容器里 Claude Code headless (-p) 模式不识别 `/skill-name` 语法，
// 必须把 SKILL.md 原文内联到 prompt 里，Claude 才能按 skill 指令工作。
//
/**
 * 读取仓库内冻结 Skill bundle 的完整内容（成功结果缓存）。
 * 不再读取 ~/.claude* 账号目录，避免跨账号/跨机器的隐式版本漂移。
 * B56: 找不到/读失败 → throw（不返回空串、不缓存失败）。
 * 调用方拿空 SKILL 静默降级会跑出错误成果（generator 无 PR），故 fail-fast。
 */
export function loadSkillContent(skillName) {
  return loadRepositorySkillContent(skillName);
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

/**
 * 校验 sprint_dir 合法性（输入层防御）。
 * 裸 'sprints'（root fallback）或缺值 → throw，防止 LLM 读到 root-level 陈旧文件。
 * 合法路径示例：'sprints/06291104-feature-slug'（含子路径分隔符即合法）。
 */
export function assertSprintDir(sprintDir, context = '') {
  if (!sprintDir || sprintDir === 'sprints') {
    const err = new Error(
      `ConfigViolation: invalid_sprint_dir — sprint_dir="${sprintDir}" in ${context}. ` +
      `Must be a specific sprint path like "sprints/MMDDHHNN-feature-slug", not the root "sprints/" directory.`
    );
    err.code = 'invalid_sprint_dir';
    throw err;
  }
  return sprintDir;
}

