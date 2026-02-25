#!/usr/bin/env node
/**
 * detect-priority.cjs
 *
 * 检测 PR 优先级（P0/P1/P2/P3）。
 *
 * 检测来源（按优先级）：
 *   1. docs/QA-DECISION.md 的 Priority 字段（最高优先级，明确来源）
 *   2. 环境变量 PR_PRIORITY
 *   3. PR labels（如 "priority:P0"）
 *   4. Git config branch.*.priority
 *
 * 移除的检测来源（容易误识别）：
 *   ✗ PR title（"p1 阶段" 会被误识别为 P1）
 *   ✗ Commit messages（"修复 p1 问题" 会被误识别为 P1）
 *
 * 用法：
 *   node scripts/devgate/detect-priority.cjs [--json]
 *
 * 环境变量：
 *   PR_PRIORITY - 直接指定优先级
 *   PR_TITLE    - PR 标题（已禁用检测）
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
  // A3 fix: 精确匹配，避免 P0wer 误匹配
  // 策略：
  //   1. 使用全局匹配查找所有 P[0-3]
  //   2. 验证前面不是字母数字（空格、标点OK）
  //   3. 验证后面不是字母（数字、空格、标点OK，但不能是字母如 P0wer）
  const priorityPattern = /[Pp]([0-3])/g;
  let match;
  while ((match = priorityPattern.exec(text)) !== null) {
    const before = match.index > 0 ? text[match.index - 1] : ' ';
    const after = match.index + match[0].length < text.length
      ? text[match.index + match[0].length]
      : ' ';

    // 前面不能是字母或数字，后面不能是字母
    if (!/[a-zA-Z0-9]/.test(before) && !/[a-zA-Z]/.test(after)) {
      return `P${match[1]}`;
    }
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

/**
 * 从 docs/QA-DECISION.md 读取 Priority
 * @returns {string|null}
 */
function detectFromQADecision() {
  const fs = require("fs");
  const path = require("path");

  const qaPath = path.join(process.cwd(), "docs/QA-DECISION.md");

  if (!fs.existsSync(qaPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(qaPath, "utf-8");
    // 匹配 "Priority: P0" 或 "Priority: P1" 等
    const match = content.match(/^Priority:\s*(P[0-3])/m);
    if (match) {
      return match[1];
    }
  } catch {
    // 忽略错误
  }

  return null;
}

/**
 * 从 git config 读取 Priority
 * @returns {string|null}
 */
function detectFromGitConfig() {
  try {
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
      encoding: "utf-8",
    }).trim();

    if (!/^[a-zA-Z0-9._\/-]+$/.test(currentBranch)) {
      return null;
    }

    const priority = execSync(
      `git config branch.${currentBranch}.priority 2>/dev/null || echo ""`,
      { encoding: "utf-8" }
    ).trim();

    if (priority && /^P[0-3]$/i.test(priority)) {
      return priority.toUpperCase();
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
  // 当提供直接输入时，只测试 extractPriority 逻辑，跳过文件/环境变量检测
  if (directInput) {
    const p = extractPriority(directInput);
    priority = p || "unknown";
    source = p ? "direct" : "default";

    if (jsonOutput) {
      console.log(JSON.stringify({ priority, source }));
    } else {
      console.log(priority);
    }
    return;
  }

  // 1. docs/QA-DECISION.md（最高优先级，明确来源）
  // 跳过条件：SKIP_GIT_DETECTION=1（测试环境）
  if (!priority && !process.env.SKIP_GIT_DETECTION) {
    const p = detectFromQADecision();
    if (p) {
      priority = p;
      source = "qa-decision";
    }
  }

  // 2. 环境变量
  if (!priority && process.env.PR_PRIORITY) {
    const p = extractPriority(process.env.PR_PRIORITY);
    if (p) {
      priority = p;
      source = "env";
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

  // 4. Git config branch.*.priority
  if (!priority) {
    const p = detectFromGitConfig();
    if (p) {
      priority = p;
      source = "git-config";
    }
  }

  // 移除：从 PR title 和 commit messages 检测（容易误识别）
  // 例如 "修复 p1 阶段问题" 会被误识别为 Priority P1

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
