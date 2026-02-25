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
    // L2 fix: 移除未使用的 possiblePaths 死代码
    // manual 证据可以是目录或文件（带扩展名）
    // 允许：manual:template-review, manual:rci-review
    // 这些是标识符，不要求实际文件存在（因为可能是人工审核项）
    // manual 类型不强制要求文件存在，只要格式正确即可
    return { valid: true };
  }

  return { valid: false, reason: `无效的 Test 格式: ${testRef}` };
}

function main() {
  const args = process.argv.slice(2);
  const dodFile = args[0] || ".dod.md";

  // L3 fix: 找项目根目录（兼容 Windows）
  let projectRoot = process.cwd();
  const rootPath = path.parse(projectRoot).root; // "/" on Unix, "C:\\" on Windows
  while (projectRoot !== rootPath && !fs.existsSync(path.join(projectRoot, ".git"))) {
    projectRoot = path.dirname(projectRoot);
  }
  if (projectRoot === rootPath) {
    projectRoot = process.cwd();
  }

  const dodPath = path.isAbsolute(dodFile)
    ? dodFile
    : path.join(projectRoot, dodFile);

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  DoD ↔ Test 映射检查");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  if (!fs.existsSync(dodPath)) {
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
