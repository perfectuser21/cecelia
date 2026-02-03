#!/usr/bin/env node
/**
 * check-dod-mapping.cjs
 *
 * 检查 DoD 文件中每条验收项是否包含 Test 字段。
 *
 * 支持三种 Test 类型：
 *   - Test: tests/...           → 自动化测试文件
 *   - Test: contract:<RCI_ID>   → 引用 regression-contract.yaml
 *   - Test: manual:<EVIDENCE_ID> → 手动证据链
 *
 * 用法：
 *   node scripts/devgate/check-dod-mapping.cjs [dod-file]
 *
 * 默认读取 .dod.md
 *
 * 返回码：
 *   0 - 所有验收项都有 Test 映射
 *   1 - 存在验收项缺少 Test 映射
 *   2 - 文件不存在或读取错误
 */

const fs = require("fs");
const path = require("path");

// L1 fix: Handle missing js-yaml gracefully
let yaml;
try {
  yaml = require("js-yaml");
} catch {
  console.error("错误: js-yaml 未安装，请运行 npm install js-yaml");
  process.exit(2);
}

// 颜色输出
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * 获取 HEAD SHA
 */
function getHeadSha() {
  try {
    const { execSync } = require("child_process");
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * 验证 manual 证据是否存在于 evidence 文件中
 * @param {string} evidenceFile - evidence 文件路径
 * @param {string} evidenceId - manual 证据 ID
 * @returns {{valid: boolean, reason?: string}}
 */
function validateManualEvidence(evidenceFile, evidenceId) {
  try {
    const content = fs.readFileSync(evidenceFile, "utf-8");
    const evidence = JSON.parse(content);

    // 检查 manual_verifications 数组
    if (!evidence.manual_verifications || !Array.isArray(evidence.manual_verifications)) {
      return {
        valid: false,
        reason: `manual: 需要 evidence 中有 manual_verifications 数组`
      };
    }

    // 查找匹配的验证记录
    const verification = evidence.manual_verifications.find(v => v.id === evidenceId);
    if (!verification) {
      return {
        valid: false,
        reason: `manual:${evidenceId} 在 evidence.manual_verifications 中不存在`
      };
    }

    // 验证必需字段：actor, timestamp, evidence
    if (!verification.actor || !verification.timestamp || !verification.evidence) {
      const missing = [];
      if (!verification.actor) missing.push("actor");
      if (!verification.timestamp) missing.push("timestamp");
      if (!verification.evidence) missing.push("evidence");
      return {
        valid: false,
        reason: `manual:${evidenceId} 缺少必需字段: ${missing.join(", ")}`
      };
    }

    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      reason: `解析 evidence 文件失败: ${e.message}`
    };
  }
}

/**
 * 解析 DoD 文件，提取验收项和对应的 Test 字段
 * @param {string} content - DoD 文件内容
 * @returns {Array<{item: string, test: string|null, line: number}>}
 */
function parseDodItems(content) {
  const lines = content.split("\n");
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配验收项格式：- [ ] 或 - [x]
    const checkboxMatch = line.match(/^\s*-\s*\[[ xX]\]\s*(.+)$/);

    if (checkboxMatch) {
      const itemText = checkboxMatch[1];
      let testRef = null;

      // 检查下一行是否是 Test: 字段
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const testMatch = nextLine.match(
          /^\s*Test:\s*(tests\/[^\s]+|contract:[^\s]+|manual:[^\s]+)\s*$/
        );
        if (testMatch) {
          testRef = testMatch[1];
        }
      }

      items.push({
        item: itemText.trim(),
        test: testRef,
        line: i + 1,
      });
    }
  }

  return items;
}

/**
 * 验证 Test 引用是否存在
 * @param {string} testRef - Test 引用
 * @param {string} projectRoot - 项目根目录
 * @returns {{valid: boolean, reason?: string}}
 */
function validateTestRef(testRef, projectRoot) {
  if (!testRef) {
    return { valid: false, reason: "缺少 Test 字段" };
  }

  if (testRef.startsWith("tests/")) {
    // 检查测试文件是否存在
    const testPath = path.join(projectRoot, testRef);
    if (!fs.existsSync(testPath)) {
      return { valid: false, reason: `测试文件不存在: ${testRef}` };
    }
    return { valid: true };
  }

  if (testRef.startsWith("contract:")) {
    // 检查 RCI ID 是否存在于 regression-contract.yaml
    const rciId = testRef.substring("contract:".length);
    const contractPath = path.join(projectRoot, "regression-contract.yaml");

    if (!fs.existsSync(contractPath)) {
      return { valid: false, reason: "regression-contract.yaml 不存在" };
    }

    try {
      const content = fs.readFileSync(contractPath, "utf-8");
      const contract = yaml.load(content);

      // 在所有分类中搜索 ID
      const allItems = [
        ...(contract.hooks || []),
        ...(contract.workflow || []),
        ...(contract.ci || []),
        ...(contract.export || []),
        ...(contract.n8n || []),
      ];

      const found = allItems.some((item) => item.id === rciId);
      if (!found) {
        return {
          valid: false,
          reason: `RCI ID 不存在: ${rciId}`,
        };
      }
      return { valid: true };
    } catch (e) {
      return {
        valid: false,
        reason: `解析 regression-contract.yaml 失败: ${e.message}`,
      };
    }
  }

  if (testRef.startsWith("manual:")) {
    // P0-2 修复：manual 必须有对应的 manual_verifications 记录
    // 不再直接返回 valid: true，必须验证证据存在
    const evidenceId = testRef.substring("manual:".length);

    // 查找 evidence 文件
    const HEAD_SHA = getHeadSha();
    const evidenceFile = path.join(projectRoot, `.quality-evidence.${HEAD_SHA}.json`);

    if (!fs.existsSync(evidenceFile)) {
      // 尝试找任意 evidence 文件（本地开发时可能 SHA 不匹配）
      const files = fs.readdirSync(projectRoot).filter(f => f.startsWith('.quality-evidence.') && f.endsWith('.json'));
      if (files.length === 0) {
        return {
          valid: false,
          reason: `manual: 需要 evidence 文件，但未找到 .quality-evidence.*.json`
        };
      }
      // 使用最新的 evidence 文件
      const latestEvidence = path.join(projectRoot, files.sort().pop());
      return validateManualEvidence(latestEvidence, evidenceId);
    }

    return validateManualEvidence(evidenceFile, evidenceId);
  }

  return { valid: false, reason: `无效的 Test 格式: ${testRef}` };
}

/**
 * 获取当前分支名（v1.1: 支持 CI 环境）
 */
function getCurrentBranch() {
  // CI 中优先使用 GITHUB_HEAD_REF（PR 源分支）
  if (process.env.GITHUB_HEAD_REF) {
    return process.env.GITHUB_HEAD_REF;
  }

  // 本地环境使用 git 命令
  try {
    const { execSync } = require("child_process");
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * 获取 DoD 文件路径（v1.1: 支持分支级别文件）
 * 优先使用分支级别文件，再 fallback 到旧格式
 */
function getDodFilePath(projectRoot, explicitFile) {
  if (explicitFile && explicitFile !== ".dod.md") {
    return explicitFile;
  }

  const branch = getCurrentBranch();
  const branchDod = path.join(projectRoot, `.dod-${branch}.md`);
  const defaultDod = path.join(projectRoot, ".dod.md");

  if (fs.existsSync(branchDod)) {
    return branchDod;
  }
  return defaultDod;
}

function main() {
  const args = process.argv.slice(2);
  const dodFileArg = args[0];

  // L3 fix: 找项目根目录（兼容 Windows）
  let projectRoot = process.cwd();
  const rootPath = path.parse(projectRoot).root; // "/" on Unix, "C:\\" on Windows
  while (projectRoot !== rootPath && !fs.existsSync(path.join(projectRoot, ".git"))) {
    projectRoot = path.dirname(projectRoot);
  }
  if (projectRoot === rootPath) {
    projectRoot = process.cwd();
  }

  // v1.1: 支持分支级别 DoD 文件
  const dodPath = getDodFilePath(projectRoot, dodFileArg);

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  DoD ↔ Test 映射检查");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  if (!fs.existsSync(dodPath)) {
    // CI 环境中 DoD 不提交到仓库（在 .gitignore 中），跳过检查
    if (process.env.GITHUB_ACTIONS) {
      console.log(`${YELLOW}⚠️ [CI 模式] DoD 文件不存在，跳过检查${RESET}`);
      console.log(`   DoD 是本地工作文档，不提交到 develop/main`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      process.exit(0);
    }
    console.error(`${RED}❌ DoD 文件不存在: ${dodPath}${RESET}`);
    process.exit(2);
  }

  const content = fs.readFileSync(dodPath, "utf-8");
  const items = parseDodItems(content);

  if (items.length === 0) {
    console.log(`${YELLOW}⚠️  未找到验收项（- [ ] 格式）${RESET}`);
    process.exit(0);
  }

  let hasError = false;
  let passCount = 0;
  let failCount = 0;

  for (const item of items) {
    const validation = validateTestRef(item.test, projectRoot);

    if (validation.valid) {
      console.log(`  ${GREEN}✅${RESET} L${item.line}: ${item.item}`);
      console.log(`     → Test: ${item.test}`);
      passCount++;
    } else {
      console.log(`  ${RED}❌${RESET} L${item.line}: ${item.item}`);
      console.log(`     → ${RED}${validation.reason}${RESET}`);
      hasError = true;
      failCount++;
    }
  }

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (hasError) {
    console.log(
      `  ${RED}❌ 映射检查失败${RESET} (${passCount} 通过, ${failCount} 失败)`
    );
    console.log("");
    console.log("  请为每条验收项添加 Test: 字段：");
    console.log("    - [ ] 功能描述");
    console.log("      Test: tests/path/to/test.ts");
    console.log("");
    console.log("  支持的格式：");
    console.log("    - Test: tests/...           (自动化测试文件)");
    console.log("    - Test: contract:<RCI_ID>   (引用回归契约)");
    console.log("    - Test: manual:<EVIDENCE_ID> (手动证据)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(1);
  }

  console.log(`  ${GREEN}✅ 映射检查通过${RESET} (${passCount} 项)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  process.exit(0);
}

main();
