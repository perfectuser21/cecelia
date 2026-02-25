#!/usr/bin/env node
/**
 * draft-gci.cjs
 *
 * 自动生成 Gate Contract (GCI) 草稿。
 *
 * 当 PR 改到 Gate 相关文件时，自动分析 diff 并生成契约草稿。
 *
 * 用法：
 *   node scripts/devgate/draft-gci.cjs [--base <branch>] [--output <file>]
 *
 * 环境变量：
 *   BASE_REF - 基准分支（默认 develop）
 *
 * Gate 文件模式：
 *   - hooks/*
 *   - scripts/run-gate-tests.sh
 *   - scripts/devgate/*
 *   - tests/gate/*
 *   - .github/workflows/ci.yml
 *   - contracts/gate-contract.yaml
 *
 * 输出：
 *   默认输出到 stdout
 *   --output: 输出到指定文件（如 artifacts/gci-draft.yaml）
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Gate 文件模式
const GATE_PATTERNS = [
  /^hooks\//,
  /^scripts\/run-gate-tests\.sh$/,
  /^scripts\/devgate\//,
  /^tests\/gate\//,
  /^\.github\/workflows\/ci\.yml$/,
  /^contracts\/gate-contract\.yaml$/,
];

// GCI 分类映射
const CATEGORY_MAP = {
  "hooks/pr-gate": { category: "G1", name: "DoD/QA 验证" },
  "hooks/branch-protect": { category: "G6", name: "数据保护" },
  "scripts/devgate/detect-priority": { category: "G3", name: "优先级检测" },
  "scripts/run-gate-tests": { category: "G1", name: "Gate 测试" },
  "tests/gate": { category: "G1", name: "Gate 测试" },
  ".github/workflows/ci": { category: "G4", name: "CI 依赖" },
  "scripts/devgate/": { category: "G5", name: "命令安全" },
};

/**
 * 判断文件是否是 Gate 相关文件
 * @param {string} filePath - 文件路径
 * @returns {boolean}
 */
function isGateFile(filePath) {
  return GATE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * 获取文件对应的 GCI 分类
 * @param {string} filePath - 文件路径
 * @returns {{category: string, name: string}}
 */
function getCategory(filePath) {
  for (const [pattern, info] of Object.entries(CATEGORY_MAP)) {
    if (filePath.includes(pattern)) {
      return info;
    }
  }
  return { category: "G0", name: "其他" };
}

/**
 * 获取 git diff 中改动的文件
 * @param {string} baseBranch - 基准分支
 * @returns {string[]} - 改动的文件列表
 */
function getChangedFiles(baseBranch) {
  try {
    const output = execSync(`git diff --name-only ${baseBranch}...HEAD 2>/dev/null`, {
      encoding: "utf-8",
    }).trim();
    return output ? output.split("\n") : [];
  } catch {
    // 如果 baseBranch 不存在，尝试 diff HEAD
    try {
      const output = execSync("git diff --name-only HEAD~1 2>/dev/null", {
        encoding: "utf-8",
      }).trim();
      return output ? output.split("\n") : [];
    } catch {
      return [];
    }
  }
}

/**
 * 分析文件 diff，提取关键改动
 * @param {string} filePath - 文件路径
 * @param {string} baseBranch - 基准分支
 * @returns {{added: string[], removed: string[], functions: string[]}}
 */
function analyzeDiff(filePath, baseBranch) {
  const result = { added: [], removed: [], functions: [] };

  try {
    const diff = execSync(`git diff ${baseBranch}...HEAD -- "${filePath}" 2>/dev/null`, {
      encoding: "utf-8",
    });

    const lines = diff.split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        const content = line.substring(1).trim();
        if (content && !content.startsWith("//") && !content.startsWith("#")) {
          result.added.push(content);
          // 提取函数名
          const funcMatch = content.match(/function\s+(\w+)|const\s+(\w+)\s*=|(\w+)\s*\(/);
          if (funcMatch) {
            const funcName = funcMatch[1] || funcMatch[2] || funcMatch[3];
            if (funcName && !result.functions.includes(funcName)) {
              result.functions.push(funcName);
            }
          }
        }
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        const content = line.substring(1).trim();
        if (content && !content.startsWith("//") && !content.startsWith("#")) {
          result.removed.push(content);
        }
      }
    }
  } catch {
    // 忽略错误
  }

  return result;
}

/**
 * 生成契约草稿
 * @param {string} filePath - 文件路径
 * @param {{added: string[], removed: string[], functions: string[]}} diff - diff 分析结果
 * @returns {object} - 契约草稿对象
 */
function generateDraft(filePath, diff) {
  const { category, name } = getCategory(filePath);
  const fileName = path.basename(filePath, path.extname(filePath));

  // 推断改动类型
  let changeType = "修改";
  if (diff.added.length > 0 && diff.removed.length === 0) {
    changeType = "新增";
  } else if (diff.removed.length > 0 && diff.added.length === 0) {
    changeType = "删除";
  }

  // 生成场景描述
  let scenario = {
    given: `${filePath} 文件存在`,
    when: `执行相关操作`,
    then: `行为符合预期`,
  };

  // 根据改动内容细化场景
  if (diff.functions.length > 0) {
    scenario.when = `调用 ${diff.functions.slice(0, 2).join("/")} 函数`;
  }

  if (diff.added.some((l) => l.includes("throw") || l.includes("error") || l.includes("fail"))) {
    scenario.then = "错误情况正确处理";
  }

  if (diff.added.some((l) => l.includes("if") || l.includes("check") || l.includes("valid"))) {
    scenario.then = "验证逻辑正确执行";
  }

  return {
    id: `${category}-NEW`,
    name: `${changeType} ${fileName} 功能`,
    priority: "P1",
    trigger: ["PR", "Release"],
    scenario,
    reason: `${filePath} 有改动，需要确保 ${name} 行为不变`,
    _meta: {
      file: filePath,
      changeType,
      addedLines: diff.added.length,
      removedLines: diff.removed.length,
      functions: diff.functions,
    },
  };
}

/**
 * 格式化为 YAML
 * @param {object[]} drafts - 契约草稿列表
 * @returns {string}
 */
function formatYaml(drafts) {
  if (drafts.length === 0) {
    return "# 无 Gate 相关改动，无需更新 GCI\n";
  }

  let yaml = `# GCI Draft - 自动生成
# 生成时间: ${new Date().toISOString()}
# 请审核后手动合并到 contracts/gate-contract.yaml

drafts:
`;

  for (const draft of drafts) {
    yaml += `
  - id: "${draft.id}"
    name: "${draft.name}"
    priority: ${draft.priority}
    trigger: [${draft.trigger.join(", ")}]
    scenario:
      given: "${draft.scenario.given}"
      when: "${draft.scenario.when}"
      then: "${draft.scenario.then}"
    reason: "${draft.reason}"
    # === 元信息（审核后删除） ===
    # file: ${draft._meta.file}
    # changeType: ${draft._meta.changeType}
    # addedLines: ${draft._meta.addedLines}
    # removedLines: ${draft._meta.removedLines}
    # functions: [${draft._meta.functions.join(", ")}]
`;
  }

  return yaml;
}

function main() {
  const args = process.argv.slice(2);
  let baseBranch = process.env.BASE_REF || "develop";
  let outputFile = null;

  // 解析参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) {
      baseBranch = args[i + 1];
      i++;
    } else if (args[i] === "--output" && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    }
  }

  // 验证 baseBranch 只包含安全字符
  if (!/^[a-zA-Z0-9._\/-]+$/.test(baseBranch)) {
    baseBranch = "develop";
  }

  // 获取改动文件
  const changedFiles = getChangedFiles(baseBranch);
  const gateFiles = changedFiles.filter(isGateFile);

  // 分析并生成草稿
  const drafts = [];
  for (const file of gateFiles) {
    const diff = analyzeDiff(file, baseBranch);
    if (diff.added.length > 0 || diff.removed.length > 0) {
      drafts.push(generateDraft(file, diff));
    }
  }

  // 输出
  const yaml = formatYaml(drafts);

  if (outputFile) {
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputFile, yaml);
    console.log(`GCI draft written to ${outputFile}`);
    console.log(`Gate files: ${gateFiles.length}, Drafts: ${drafts.length}`);
  } else {
    console.log(yaml);
  }

  // 返回状态码
  process.exit(gateFiles.length > 0 ? 0 : 0);
}

// 导出用于测试
module.exports = { isGateFile, getCategory, generateDraft, analyzeDiff };

// 直接运行
if (require.main === module) {
  main();
}
