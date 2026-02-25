#!/usr/bin/env node
/**
 * detect-priority.cjs
 *
 * 检测 PR 优先级（P0/P1/P2/P3）。
 *
 * 检测来源（按优先级）：
 *   1. 环境变量 PR_PRIORITY
 *   2. PR title 前缀（如 "P0: xxx" 或 "fix(P0): xxx"）
 *   3. PR labels（如 "priority:P0"）
 *   4. Git commit 消息前缀
 *
 * 用法：
 *   node scripts/devgate/detect-priority.cjs [--json]
 *
 * 环境变量：
 *   PR_PRIORITY - 直接指定优先级
 *   PR_TITLE    - PR 标题
 *   PR_LABELS   - PR labels（逗号分隔）
 *
 * 输出：
 *   默认: P0/P1/P2/P3/unknown
 *   --json: {"priority": "P0", "source": "env"}
 */

const { execSync } = require("child_process");

/**
 * 从字符串中提取优先级
 *
 * L3 fix: 完整文档化隐式行为
 *
 * 优先级映射（按检查顺序）：
 *   1. CRITICAL (any case) → P0 (来自审计严重性分类)
 *   2. HIGH (any case) → P1 (来自审计严重性分类)
 *   3. security: 或 security( 前缀 → P0 (安全修复类型)
 *   4. P0/P1/P2/P3 (不区分大小写，词边界匹配) → 对应优先级
 *
 * 注意：
 *   - 检查顺序影响结果：CRITICAL 优先于 P1 标签
 *   - 使用词边界匹配，避免误匹配 "P0wer" 等
 *   - 返回 null 表示未检测到优先级
 *
 * @param {string} text - 要分析的文本
 * @returns {string|null} - P0/P1/P2/P3 或 null
 */
function extractPriority(text) {
  if (!text) return null;

  // CRITICAL → P0（审计严重性映射）
  if (/\bCRITICAL\b/i.test(text)) {
    return "P0";
  }

  // HIGH → P1（审计严重性映射）
  if (/\bHIGH\b/i.test(text)) {
    return "P1";
  }

  // security 前缀 → P0（安全修复类型）
  // 匹配: security: xxx, security(scope): xxx
  if (/^security[:(]/i.test(text)) {
    return "P0";
  }

  // 匹配 P0, P1, P2, P3（不区分大小写）
  // A3 fix: 使用负向前向查找，确保 P0 后面不是字母数字（防止 P0wer 误匹配）
  const match = text.match(/(?<![a-zA-Z0-9])[Pp]([0-3])(?![a-zA-Z0-9])/);
  if (match) {
    return `P${match[1]}`;
  }
  return null;
}

/**
 * 从最近的 commit 消息中检测优先级
 * @returns {string|null}
 */
function detectFromCommits() {
  try {
    // L2 fix: 避免 shell 命令注入，分步获取分支名
    let baseBranch = process.env.BASE_REF;

    if (!baseBranch) {
      try {
        const currentBranch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
          encoding: "utf-8",
        }).trim();
        // 验证分支名只包含安全字符
        if (/^[a-zA-Z0-9._\/-]+$/.test(currentBranch)) {
          baseBranch = execSync(`git config branch.${currentBranch}.base-branch 2>/dev/null`, {
            encoding: "utf-8",
          }).trim() || "develop";
        } else {
          baseBranch = "develop";
        }
      } catch {
        baseBranch = "develop";
      }
    }

    // 验证 baseBranch 只包含安全字符
    if (!/^[a-zA-Z0-9._\/-]+$/.test(baseBranch)) {
      baseBranch = "develop";
    }

    const commits = execSync(
      `git log ${baseBranch}..HEAD --pretty=format:"%s" 2>/dev/null || echo ""`,
      { encoding: "utf-8" }
    ).trim();

    if (!commits) return null;

    // 检查每条 commit 消息
    for (const line of commits.split("\n")) {
      const priority = extractPriority(line);
      if (priority) return priority;
    }
  } catch {
    // 忽略错误
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  // 获取非 --json 的参数作为直接输入文本
  const directInput = args.find((a) => a !== "--json");

  let priority = null;
  let source = null;

  // 0. 直接命令行参数（用于测试）
  if (directInput) {
    const p = extractPriority(directInput);
    if (p) {
      priority = p;
      source = "direct";
    }
  }

  // 1. 环境变量
  if (!priority && process.env.PR_PRIORITY) {
    const p = extractPriority(process.env.PR_PRIORITY);
    if (p) {
      priority = p;
      source = "env";
    }
  }

  // 2. PR title
  if (!priority && process.env.PR_TITLE) {
    const p = extractPriority(process.env.PR_TITLE);
    if (p) {
      priority = p;
      source = "title";
    }
  }

  // 3. PR labels
  if (!priority && process.env.PR_LABELS) {
    const labels = process.env.PR_LABELS.split(",");
    for (const label of labels) {
      // 匹配 priority:P0, P0, priority-P0 等格式
      const p = extractPriority(label);
      if (p) {
        priority = p;
        source = "label";
        break;
      }
    }
  }

  // 4. Git commits（可通过 SKIP_GIT_DETECTION=1 跳过，用于测试）
  if (!priority && !process.env.SKIP_GIT_DETECTION) {
    const p = detectFromCommits();
    if (p) {
      priority = p;
      source = "commit";
    }
  }

  // 默认值
  if (!priority) {
    priority = "unknown";
    source = "default";
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ priority, source }));
  } else {
    console.log(priority);
  }
}

main();
