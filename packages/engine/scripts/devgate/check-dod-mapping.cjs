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
 * @returns {Array<{item: string, test: string|null, line: number, checked: boolean}>}
 */
function parseDodItems(content) {
  const lines = content.split("\n");
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配验收项格式：- [ ] 或 - [x]
    const checkboxMatch = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);

    if (checkboxMatch) {
      const checked = checkboxMatch[1].toLowerCase() === "x";
      const itemText = checkboxMatch[2];
      let testRef = null;

      // 检查下一行是否是 Test: 字段
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const testMatch = nextLine.match(
          /^\s*Test:\s*(tests\/[^\s]+|contract:[^\s]+|manual:.+)\s*$/
        );
        if (testMatch) {
          testRef = testMatch[1].trim();
        }
      }

      items.push({
        item: itemText.trim(),
        test: testRef,
        line: i + 1,
        checked,
      });
    }
  }

  return items;
}

/**
 * 检查测试命令是否包含假测试模式
 * @param {string} testCommand - 测试命令
 * @returns {{valid: boolean, reason?: string}}
 */
function detectFakeTest(testCommand) {
  // 禁止 echo 假测试
  if (/\becho\b/.test(testCommand)) {
    return { valid: false, reason: "禁止使用 echo 假测试（应使用真实执行命令）" };
  }

  // 禁止 grep | wc -l 假测试
  if (/grep.*\|.*wc\s+-l/.test(testCommand)) {
    return { valid: false, reason: "禁止使用 grep | wc -l 假测试（应使用真实执行命令）" };
  }

  // 禁止 test -f 假测试
  if (/test\s+-f\b/.test(testCommand)) {
    return { valid: false, reason: "禁止使用 test -f 假测试（应使用真实执行命令）" };
  }

  // 禁止 TODO 占位符
  if (/TODO/.test(testCommand)) {
    return { valid: false, reason: "禁止使用 TODO 占位符（应使用真实执行命令）" };
  }

  // 强制要求真实执行命令（node, npm, psql, curl, bash等）
  const hasRealExecution = /\b(node|npm|npx|psql|curl|bash|python|pytest|jest|mocha|vitest)\b/.test(testCommand);
  if (!hasRealExecution) {
    return { valid: false, reason: "Test 命令必须包含真实执行命令（如 node, npm, psql, curl 等）" };
  }

  return { valid: true };
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

  // 检查是否为合法格式（tests/, contract:, manual:）
  const isValidFormat = testRef.startsWith("tests/") ||
                        testRef.startsWith("contract:") ||
                        testRef.startsWith("manual:");

  if (!isValidFormat) {
    // 不是合法格式，检查是否为假测试
    const fakeTestCheck = detectFakeTest(testRef);
    if (!fakeTestCheck.valid) {
      return fakeTestCheck;
    }
    // 即使通过假测试检查，也必须使用规定的格式
    return {
      valid: false,
      reason: `Test 字段必须使用规定格式: tests/..., contract:..., 或 manual:...（当前: ${testRef}）`
    };
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

  // manual:chrome: 视觉截图验证（非 shell 命令，由 AI 在 Step 7 截图判断）
  if (testRef.startsWith("manual:chrome:")) {
    const assertion = testRef.substring("manual:chrome:".length).trim();
    if (!assertion || /^TODO$/i.test(assertion) || assertion.length < 10) {
      return { valid: false, reason: "manual:chrome: 需要明确的视觉断言描述（至少10字符，不能是TODO）。示例：screenshot verify .sidebar is on LEFT side at http://localhost:5211/page" };
    }
    return { valid: true };
  }

  if (testRef.startsWith("manual:")) {
    const evidenceContent = testRef.substring("manual:".length);

    // 新格式：manual:<可执行命令>（含 curl/grep/psql 等关键词）
    // Step 7 实际执行命令后标记 [x]，[x] 本身是验证通过的证明，不需要 evidence 文件
    const isInlineCommand = /\b(curl|grep|psql|node|npm|npx|bash|python|pytest|jest|vitest)\b/.test(evidenceContent);
    if (isInlineCommand) {
      // 只检查假测试（禁止 echo/test -f/TODO 等）
      const fakeCheck = detectFakeTest(evidenceContent);
      if (!fakeCheck.valid) {
        return fakeCheck;
      }
      return { valid: true };
    }

    // 旧格式：manual:<EVIDENCE_ID>（短 ID，向后兼容）
    // 要求 .quality-evidence.*.json 中有对应记录
    const evidenceId = evidenceContent;
    const HEAD_SHA = getHeadSha();
    const evidenceFile = path.join(projectRoot, `.quality-evidence.${HEAD_SHA}.json`);

    if (!fs.existsSync(evidenceFile)) {
      // 尝试找任意 evidence 文件（本地开发时可能 SHA 不匹配）
      const files = fs.readdirSync(projectRoot).filter(f => f.startsWith('.quality-evidence.') && f.endsWith('.json'));
      if (files.length === 0) {
        return {
          valid: false,
          reason: `manual:${evidenceId} 需要 evidence 文件，或改用 manual:<curl命令> 内联格式`
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
 * 从 DoD 条目文本中提取有意义的关键词（≥2字符，去除助词）
 * @param {string} text - DoD 条目文本
 * @returns {string[]}
 */
function extractKeywords(text) {
  return text
    .replace(/[【】「」『』（）()[\]{}<>]/g, " ")
    .replace(
      /\b(the|a|an|is|are|must|should|shall|will|can|be|in|to|of|and|or|not|for|with|that|this|it|has|have|do|does|did|was|were|from|at|by|as|on|all|any)\b/gi,
      " "
    )
    .replace(
      /\b(可以|应该|必须|需要|进行|实现|功能|正常|工作|通过|验证|检查|保证|确保|支持|提供|包含|完成|执行|运行|使用|设置|配置|更新|修改|添加|删除|返回|输出|输入|处理)\b/g,
      " "
    )
    .split(/[\s,，。！？/\\·—]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
}

/**
 * Phase 2: 检查 DoD 条目是否能追溯到 PRD 成功标准章节
 * @param {Array<{item: string}>} dodItems - DoD 验收项列表
 * @param {string} prdFile - PRD 文件路径
 * @returns {{passed: boolean, failures: number}}
 */
function checkDodTracesToPrd(dodItems, prdFile) {
  if (!fs.existsSync(prdFile)) {
    console.log("  ℹ️  PRD 文件不存在，跳过追溯检查");
    return { passed: true, failures: 0 };
  }

  const prdContent = fs.readFileSync(prdFile, "utf-8");

  // 提取 PRD 成功标准章节内容
  const criteriaMatch = prdContent.match(
    /^#{1,3}\s*(成功标准|[Ss]uccess\s+[Cc]riteria|验收标准)[^\n]*\n([\s\S]*?)(?=^#{1,3}|\Z)/m
  );

  if (!criteriaMatch) {
    console.log(
      "  ℹ️  PRD 无成功标准章节，跳过 DoD 追溯检查（check-prd 会处理）"
    );
    return { passed: true, failures: 0 };
  }

  const criteriaText = criteriaMatch[2].toLowerCase();

  let failures = 0;
  const failedItems = [];

  for (const item of dodItems) {
    const keywords = extractKeywords(item.item);

    // 检查是否至少有一个关键词出现在 PRD 成功标准中
    const hasMatch =
      keywords.length === 0 ||
      keywords.some((kw) => criteriaText.includes(kw.toLowerCase()));

    if (!hasMatch) {
      failedItems.push({ text: item.item, keywords });
      failures++;
    }
  }

  if (failures > 0) {
    for (const fi of failedItems) {
      console.log(`  ${RED}❌${RESET}  DoD 条目无法追溯到 PRD 成功标准：`);
      console.log(`      "${fi.text.substring(0, 80)}"`);
      console.log(`      关键词：${fi.keywords.join(", ")}`);
    }
  }

  return { passed: failures === 0, failures };
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

  // 新增检查：所有验收项必须已勾选（[x]），不允许 [ ] 未验证项
  const uncheckedItems = items.filter((item) => !item.checked);
  let hasUnchecked = false;

  if (uncheckedItems.length > 0) {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  未验证项检查");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    for (const item of uncheckedItems) {
      console.log(`  ${RED}❌${RESET} L${item.line}: - [ ] ${item.item}`);
      console.log(
        `     → ${RED}此项未验证，请在 Step 7 执行验证后将 [ ] 改为 [x]${RESET}`
      );
    }
    hasUnchecked = true;
    console.log("");
  }

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
    console.log("    - Test: tests/...                          (自动化测试文件)");
    console.log("    - Test: contract:<RCI_ID>                  (引用回归契约)");
    console.log("    - Test: manual:curl -s http://... | jq ... (可执行命令)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(1);
  }

  if (hasUnchecked) {
    console.log(
      `  ${RED}❌ 未验证项检查失败${RESET} (${uncheckedItems.length} 项未勾选)`
    );
    console.log("");
    console.log("  请在 Step 7 执行 DoD 验证后将所有 [ ] 改为 [x]");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(1);
  }

  console.log(`  ${GREEN}✅ 映射检查通过${RESET} (${passCount} 项，全部已验证)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // === Phase 3: DoD ↔ PRD 追溯检查（HARD GATE） ===
  const prdPath = path.join(projectRoot, ".prd.md");
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  DoD ↔ PRD 追溯检查（HARD GATE）");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const traceResult = checkDodTracesToPrd(items, prdPath);
  if (!traceResult.passed) {
    console.log(
      `  ${RED}❌ ${traceResult.failures} 条 DoD 条目无法追溯到 PRD 成功标准${RESET}`
    );
    console.log("  请确保每条 DoD 条目的关键词出现在 PRD 成功标准章节中。");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(1);
  } else {
    console.log(`  ${GREEN}✅ 追溯检查通过${RESET}`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  process.exit(0);
}

// 直接运行时执行 main()，被 require() 时只导出函数
if (require.main === module) {
  main();
}

module.exports = { extractKeywords, checkDodTracesToPrd };
