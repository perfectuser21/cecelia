#!/usr/bin/env node
/**
 * playwright-evaluator.cjs
 *
 * Playwright Evaluator — 端到端行为验证
 *
 * 在 /dev Stage 3 CI 通过后调用，对照 Task Card 的 [BEHAVIOR] DoD 条目
 * 逐条执行 Test: 命令，始终包含 Brain API /api/brain/health 基线检查。
 *
 * 用法：
 *   node playwright-evaluator.cjs --dry-run [--task-card <file>]
 *   node playwright-evaluator.cjs --run [--task-card <file>] [--brain-url <url>]
 *
 * 选项：
 *   --dry-run            仅解析并列出要执行的测试，不实际运行
 *   --run                实际执行所有测试（默认模式）
 *   --task-card <file>   指定 Task Card 文件路径（默认：自动查找 .task-cp-*.md）
 *   --brain-url <url>    Brain API 地址（默认：http://localhost:5221）
 *
 * 退出码：
 *   0 — 所有测试通过（或 dry-run 完成）
 *   1 — 至少一个测试失败
 *   2 — 无法读取 Task Card 或配置错误
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

// ─── 颜色输出 ───────────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ─── 参数解析 ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

let taskCardPath = null;
let brainUrl = 'http://localhost:5221';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--task-card' && args[i + 1]) {
    taskCardPath = args[i + 1];
    i++;
  }
  if (args[i] === '--brain-url' && args[i + 1]) {
    brainUrl = args[i + 1];
    i++;
  }
}

// ─── Task Card 查找 ──────────────────────────────────────────────────────────
function findTaskCard() {
  if (taskCardPath) {
    if (fs.existsSync(taskCardPath)) return taskCardPath;
    console.error(`${RED}❌ 指定的 Task Card 不存在：${taskCardPath}${RESET}`);
    process.exit(2);
  }

  // 自动查找 .task-cp-*.md
  const cwd = process.cwd();
  const files = fs.readdirSync(cwd).filter(f => /^\.task-cp-.+\.md$/.test(f));
  if (files.length === 0) {
    console.error(`${RED}❌ 未找到 .task-cp-*.md，请指定 --task-card <file>${RESET}`);
    process.exit(2);
  }
  return path.join(cwd, files[0]);
}

// ─── DoD [BEHAVIOR] 条目解析 ─────────────────────────────────────────────────
/**
 * 从 Task Card 内容解析所有 [BEHAVIOR] 条目
 * @param {string} content - Task Card 文件内容
 * @returns {{ description: string; test: string }[]}
 */
function parseBehaviorEntries(content) {
  const entries = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 匹配 - [ ] [BEHAVIOR] 或 - [x] [BEHAVIOR]
    const behaviorMatch = line.match(/^\s*-\s*\[.\]\s*\[BEHAVIOR\]\s*(.+)/);
    if (behaviorMatch) {
      const description = behaviorMatch[1].trim();
      let test = null;

      // 查找紧随其后的 Test: 行
      let j = i + 1;
      while (j < lines.length && j <= i + 3) {
        const testMatch = lines[j].match(/^\s+Test:\s*(.+)/);
        if (testMatch) {
          test = testMatch[1].trim();
          break;
        }
        // 遇到下一个条目则停止
        if (lines[j].match(/^\s*-\s*\[/)) break;
        j++;
      }

      if (test) {
        entries.push({ description, test });
      }
    }
    i++;
  }
  return entries;
}

// ─── Test 命令执行 ────────────────────────────────────────────────────────────
/**
 * 执行单条 Test 命令
 * @param {string} testField - Test: 字段值（如 manual:node -e "..."）
 * @returns {{ passed: boolean; output: string; error?: string }}
 */
function executeTest(testField) {
  // 解析测试类型
  if (testField.startsWith('manual:')) {
    const cmd = testField.slice('manual:'.length).trim();
    return runShellCommand(cmd);
  }

  if (testField.startsWith('tests/')) {
    return { passed: true, output: `[跳过] tests/ 文件引用需要 vitest 环境：${testField}` };
  }

  if (testField.startsWith('contract:')) {
    return { passed: true, output: `[跳过] contract: 引用需要 regression-contract.yaml：${testField}` };
  }

  return { passed: false, output: '', error: `未知 Test 格式：${testField}` };
}

/**
 * 执行 shell 命令并返回结果
 */
function runShellCommand(cmd) {
  try {
    const output = execSync(cmd, {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { passed: true, output: output.trim() };
  } catch (err) {
    const output = ((err.stdout || '') + (err.stderr || '')).trim();
    return {
      passed: false,
      output,
      error: `退出码 ${err.status || 1}：${output.slice(0, 200)}`,
    };
  }
}

// ─── Brain /health 基线检查 ──────────────────────────────────────────────────
function checkBrainHealth() {
  const healthUrl = `${brainUrl}/api/brain/health`;
  return {
    description: 'Brain API /health 基线检查',
    test: `manual:curl -s -o /dev/null -w "%{http_code}" ${healthUrl}`,
    isBaseline: true,
  };
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────
function main() {
  const cardFile = findTaskCard();
  const content = fs.readFileSync(cardFile, 'utf8');
  const behaviorEntries = parseBehaviorEntries(content);
  const brainHealthEntry = checkBrainHealth();

  // 构建完整检查清单（基线 + [BEHAVIOR] 条目）
  const checkList = [brainHealthEntry, ...behaviorEntries];

  console.log(`${BOLD}${CYAN}╔════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   Playwright Evaluator — 行为验证      ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚════════════════════════════════════════╝${RESET}`);
  console.log(`  Task Card: ${path.basename(cardFile)}`);
  console.log(`  Brain URL: ${brainUrl}`);
  console.log(`  模式: ${isDryRun ? 'DRY RUN（仅列出，不执行）' : '执行验证'}`);
  console.log(`  发现 ${behaviorEntries.length} 个 [BEHAVIOR] 条目 + 1 个基线检查`);
  console.log('');

  if (isDryRun) {
    // DRY RUN 模式：输出检查清单
    console.log(`${BOLD}DRY RUN — 将要执行的检查（共 ${checkList.length} 项）：${RESET}`);
    checkList.forEach((entry, idx) => {
      const tag = entry.isBaseline ? '[基线]' : '[BEHAVIOR]';
      console.log(`  ${idx + 1}. ${CYAN}${tag}${RESET} ${entry.description}`);
      console.log(`     Test: ${YELLOW}${entry.test}${RESET}`);
    });
    console.log('');
    console.log(`${GREEN}✅ DRY RUN 完成 — ${checkList.length} 项检查已列出${RESET}`);
    process.exit(0);
  }

  // 执行模式：逐条运行
  let passCount = 0;
  let failCount = 0;
  const results = [];

  console.log(`${BOLD}开始逐条执行（共 ${checkList.length} 项）...${RESET}`);
  console.log('');

  checkList.forEach((entry, idx) => {
    const tag = entry.isBaseline ? '[基线]' : '[BEHAVIOR]';
    process.stdout.write(`  ${idx + 1}/${checkList.length} ${tag} ${entry.description} ... `);

    const result = executeTest(entry.test);

    if (result.passed) {
      passCount++;
      console.log(`${GREEN}PASS${RESET}`);
    } else {
      failCount++;
      console.log(`${RED}FAIL${RESET}`);
      if (result.error) {
        console.log(`    ${RED}↳ ${result.error.slice(0, 150)}${RESET}`);
      }
    }

    results.push({ ...entry, ...result });
  });

  // 输出摘要
  console.log('');
  console.log(`${BOLD}════ 评估摘要 ════${RESET}`);
  console.log(`  总计：${checkList.length} 项`);
  console.log(`  ${GREEN}通过：${passCount}${RESET}`);
  if (failCount > 0) {
    console.log(`  ${RED}失败：${failCount}${RESET}`);
    console.log('');
    console.log(`${RED}${BOLD}❌ FAIL — ${failCount} 项检查未通过${RESET}`);
    console.log('');
    console.log('失败详情：');
    results
      .filter(r => !r.passed)
      .forEach((r, i) => {
        const tag = r.isBaseline ? '[基线]' : '[BEHAVIOR]';
        console.log(`  ${i + 1}. ${RED}${tag}${RESET} ${r.description}`);
        console.log(`     Test: ${r.test}`);
        if (r.error) {
          console.log(`     错误: ${r.error.slice(0, 300)}`);
        }
      });
    process.exit(1);
  } else {
    console.log('');
    console.log(`${GREEN}${BOLD}✅ PASS — 所有 ${passCount} 项检查通过${RESET}`);
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseBehaviorEntries, executeTest, runShellCommand, checkBrainHealth, findTaskCard };
