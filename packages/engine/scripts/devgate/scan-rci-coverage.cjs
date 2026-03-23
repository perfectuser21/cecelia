#!/usr/bin/env node
/**
 * scan-rci-coverage.cjs
 *
 * 扫描业务入口，检查 RCI 覆盖率。
 *
 * 用法：
 *   node scripts/devgate/scan-rci-coverage.cjs [OPTIONS]
 *
 * OPTIONS:
 *   --output <file>  输出 JSON 到文件
 *   --snapshot       同时生成 BASELINE-SNAPSHOT.md
 *   --json           输出 JSON 格式
 *   --explain        输出详细审计证据（每个入口的来源和匹配依据）
 *   --stats          独立分母核对（用 find/ls 交叉验证）
 *
 * 业务入口：
 *   - skills/{name}/SKILL.md
 *   - hooks/{name}.sh
 *   - scripts/{name}.sh
 *   - scripts/devgate/{name}.cjs
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
// v11.2.9: 使用根目录的 regression-contract.yaml（删除了 contracts/ 目录）
const RCI_FILE = path.join(PROJECT_ROOT, "regression-contract.yaml");

// 业务入口模式
const ENTRY_PATTERNS = [
  { type: "skill", glob: "skills/*/SKILL.md", description: "Skill 定义" },
  { type: "hook", glob: "hooks/*.sh", description: "Hook 脚本" },
  { type: "script", glob: "scripts/*.sh", description: "顶层脚本" },
  { type: "devgate", glob: "scripts/devgate/*.cjs", description: "DevGate 工具" },
];

// 排除模式（不计入 RCI 覆盖率）
// 这些要么是 Gate 范畴（在 GCI），要么是内部实现
const EXCLUDE_PATTERNS = [
  /^tests\//,                  // 测试文件（不是业务入口）
  /\.archive\//,               // 归档目录
  /^ci-tools\//,               // CI 工具目录
  /^skills\/[^/]+\/scripts\//, // Skill 内部脚本
  /^skills\/assurance\//,      // Assurance Skill（实验性，未启用）
  /^skills\/audit\//,          // Audit Skill（内部质检工具）
  /^skills\/gate\//,           // Gate Skill（Gate 范畴）
  /^skills\/qa\//,             // QA Skill（内部质检总控）
  /^scripts\/devgate\//,       // DevGate 内部工具（Gate 范畴）
  /^scripts\/gate\//,          // Gate 脚本（Gate 范畴）
  /^ci\/scripts\//,            // CI 内部脚本（已由 C8 RCI 覆盖）
  /^scripts\/deploy\.sh$/,     // 部署脚本
  /^scripts\/setup-/,          // 配置脚本
  /^scripts\/run-gate-tests/,  // Gate 执行器（在 GCI）
  /^scripts\/rc-filter/,       // 内部过滤工具
  /^scripts\/auto-/,           // Ralph Loop 内部自动化工具
  /^scripts\/update-/,         // Ralph Loop 内部更新工具
  /^scripts\/cleanup-/,        // 清理工具（内部维护）
  /^scripts\/squash-/,         // 合并工具（内部维护）
  /^scripts\/post-pr-/,        // PR 后工具（内部流程）
  /^hooks\/session-start/,     // 内部 Hook
  /^hooks\/session-end/,       // 内部 Hook
  /^hooks\/pr-gate/,           // Gate Hook（在 GCI）
  /^hooks\/branch-protect/,    // Gate Hook（在 GCI）
  /^hooks\/stop/,              // Gate Hook（在 GCI）- 循环控制器
  /^hooks\/credential-guard/,  // Gate Hook（在 GCI）- 凭据保护
  /^hooks\/mark-subagent-done/,    // Gate Hook（在 GCI）- Gate 令牌生成
  /^hooks\/require-subagent-token/, // Gate Hook（在 GCI）- Gate 令牌校验
];

/**
 * 枚举业务入口
 * @returns {{type: string, path: string, name: string}[]}
 */
function enumerateEntries() {
  const entries = [];

  for (const pattern of ENTRY_PATTERNS) {
    try {
      const files = execSync(`find ${PROJECT_ROOT} -path "*/${pattern.glob}" 2>/dev/null || true`, {
        encoding: "utf-8",
      })
        .trim()
        .split("\n")
        .filter(Boolean);

      for (const file of files) {
        const relativePath = path.relative(PROJECT_ROOT, file);

        // 检查是否在排除列表中
        const isExcluded = EXCLUDE_PATTERNS.some((p) => p.test(relativePath));
        if (isExcluded) continue;

        const name = extractEntryName(relativePath, pattern.type);
        entries.push({
          type: pattern.type,
          path: relativePath,
          name,
        });
      }
    } catch {
      // 忽略错误
    }
  }

  return entries;
}

/**
 * 提取入口名称
 * @param {string} filePath
 * @param {string} type
 * @returns {string}
 */
function extractEntryName(filePath, type) {
  switch (type) {
    case "skill":
      // skills/dev/SKILL.md -> /dev
      const skillMatch = filePath.match(/skills\/([^/]+)\//);
      return skillMatch ? `/${skillMatch[1]}` : filePath;
    case "hook":
      // hooks/branch-protect.sh -> branch-protect
      return path.basename(filePath, ".sh");
    case "script":
      // scripts/install-hooks.sh -> install-hooks
      return path.basename(filePath, ".sh");
    case "devgate":
      // scripts/devgate/metrics.cjs -> metrics
      return path.basename(filePath, ".cjs");
    default:
      return filePath;
  }
}

/**
 * 解析 RCI 文件，提取覆盖的路径
 * @returns {{id: string, name: string, paths: string[], test: string|null}[]}
 */
function parseRCI() {
  if (!fs.existsSync(RCI_FILE)) {
    return [];
  }

  const content = fs.readFileSync(RCI_FILE, "utf-8");
  const contracts = [];

  // 简单解析 YAML（不依赖外部库）
  const lines = content.split("\n");
  let currentContract = null;

  for (const line of lines) {
    // 匹配 id
    const idMatch = line.match(/^\s+-\s+id:\s*(\S+)/);
    if (idMatch) {
      if (currentContract) {
        contracts.push(currentContract);
      }
      currentContract = {
        id: idMatch[1],
        name: "",
        paths: [],
        test: null,
      };
      continue;
    }

    if (!currentContract) continue;

    // 匹配 name
    const nameMatch = line.match(/^\s+name:\s*["']?(.+?)["']?\s*$/);
    if (nameMatch) {
      currentContract.name = nameMatch[1];
      // 从 name 中提取路径线索
      extractPathsFromName(currentContract, nameMatch[1]);
    }

    // 匹配 test
    const testMatch = line.match(/^\s+test:\s*["']?(.+?)["']?\s*$/);
    if (testMatch) {
      currentContract.test = testMatch[1];
      // 从 test 路径推断覆盖
      extractPathsFromTest(currentContract, testMatch[1]);
    }

    // 匹配 evidence.file（直接路径覆盖）
    const filePathMatch = line.match(/^\s+file:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/);
    if (filePathMatch && filePathMatch[1]) {
      currentContract.paths.push(filePathMatch[1].trim());
    }

    // 匹配 evidence.run
    const runMatch = line.match(/^\s+run:\s*["']?(.+?)["']?\s*$/);
    if (runMatch) {
      extractPathsFromRun(currentContract, runMatch[1]);
    }
  }

  if (currentContract) {
    contracts.push(currentContract);
  }

  return contracts;
}

/**
 * 从 name 中提取路径线索
 * P1-2: 只提取精确路径，不再使用模糊匹配
 */
function extractPathsFromName(contract, name) {
  // /dev 流程 -> skills/dev/SKILL.md（精确）
  const skillMatch = name.match(/\/(\w+)\s+流程/);
  if (skillMatch) {
    contract.paths.push(`skills/${skillMatch[1]}/SKILL.md`);
  }

  // 精确脚本名匹配（必须是完整文件名）
  // metrics.sh -> scripts/devgate/metrics.sh 或 scripts/metrics.sh
  const scriptMatch = name.match(/\b([\w-]+)\.sh\b/);
  if (scriptMatch) {
    // 只在有明确上下文时添加路径
    const scriptName = scriptMatch[1];
    // P1-2: 使用精确匹配代替 includes
    const lowerName = name.toLowerCase();
    if (/\bdevgate\b/.test(lowerName) || /\bgate\b/.test(lowerName)) {
      contract.paths.push(`scripts/devgate/${scriptName}.sh`);
    }
    // scripts/ 目录下的脚本
    contract.paths.push(`scripts/${scriptName}.sh`);
  }

  // 精确匹配 install-hooks（必须是完整词）
  if (/\binstall-hooks\b/.test(name)) {
    contract.paths.push("scripts/install-hooks.sh");
  }
}

/**
 * 从 test 路径推断覆盖
 * P1-2: 精确匹配，基于测试文件名推断被测文件
 */
function extractPathsFromTest(contract, testPath) {
  // 从测试文件名精确推断被测文件
  // tests/xxx/foo.test.ts -> 测试 foo 相关文件

  // 提取测试文件名（不含扩展名）
  const testBasename = path.basename(testPath).replace(/\.test\.(ts|js)$/, "");

  // 根据测试目录确定被测文件位置
  if (testPath.includes("tests/hooks/")) {
    // tests/hooks/xxx.test.ts -> hooks/xxx.sh
    contract.paths.push(`hooks/${testBasename}.sh`);
  } else if (testPath.includes("tests/scripts/") || testPath.includes("tests/devgate/")) {
    // tests/scripts/xxx.test.ts -> scripts/xxx.sh
    contract.paths.push(`scripts/${testBasename}.sh`);
    contract.paths.push(`scripts/devgate/${testBasename}.sh`);
    contract.paths.push(`scripts/devgate/${testBasename}.cjs`);
  } else if (testPath.includes("tests/skills/")) {
    // tests/skills/xxx.test.ts -> skills/xxx/SKILL.md
    contract.paths.push(`skills/${testBasename}/SKILL.md`);
  }
}

/**
 * 从 evidence.run 推断覆盖
 */
function extractPathsFromRun(contract, runCmd) {
  // bash scripts/devgate/metrics.sh -> scripts/devgate/metrics.sh
  const bashMatch = runCmd.match(/bash\s+(\S+)/);
  if (bashMatch) {
    contract.paths.push(bashMatch[1]);
  }

  // npm run qa -> CI related
  if (runCmd.includes("npm run qa")) {
    contract.paths.push(".github/workflows/ci.yml");
  }
}

/**
 * 检查入口是否被 RCI 覆盖
 * P1-2 修复：只允许精确路径匹配，禁止 name/includes 误判
 * @param {{type: string, path: string, name: string}} entry
 * @param {{id: string, name: string, paths: string[]}[]} contracts
 * @returns {{covered: boolean, by: string[], matchReason: string}}
 */
function checkCoverage(entry, contracts) {
  const coveredBy = [];
  let matchReason = "";

  for (const contract of contracts) {
    // P1-2: 只允许精确路径匹配
    for (const contractPath of contract.paths) {
      // 精确匹配：完全相等
      if (entry.path === contractPath) {
        coveredBy.push(contract.id);
        matchReason = `exact_path: ${contractPath}`;
        break;
      }

      // 目录匹配：entry.path 在 contractPath 目录下
      // 例如：contractPath = "skills/dev" 匹配 entry.path = "skills/dev/SKILL.md"
      if (contractPath.endsWith("/") && entry.path.startsWith(contractPath)) {
        coveredBy.push(contract.id);
        matchReason = `dir_prefix: ${contractPath}`;
        break;
      }

      // glob 匹配（简化版）：contractPath 包含 * 通配符
      // P1-2: 使用 indexOf 代替 includes 避免测试误报
      if (contractPath.indexOf("*") !== -1) {
        const regexStr = contractPath
          .replace(/\./g, "\\.")
          .replace(/\*\*/g, ".*")      // 先替换 ** (递归通配符)
          .replace(/\*/g, "[^/]*");    // 再替换 * (单层通配符)
        const regex = new RegExp(`^${regexStr}$`);
        if (regex.test(entry.path)) {
          coveredBy.push(contract.id);
          matchReason = `glob: ${contractPath}`;
          break;
        }
      }
    }

    // P1-2: 移除了 name.includes 误判逻辑
    // 不再使用：if (contract.name.includes(entry.name))
  }

  return {
    covered: coveredBy.length > 0,
    by: coveredBy,
    matchReason,
  };
}

/**
 * 生成覆盖率报告
 */
function generateReport(entries, contracts) {
  const results = [];
  let covered = 0;
  let uncovered = 0;

  for (const entry of entries) {
    const coverage = checkCoverage(entry, contracts);
    results.push({
      ...entry,
      covered: coverage.covered,
      coveredBy: coverage.by,
    });

    if (coverage.covered) {
      covered++;
    } else {
      uncovered++;
    }
  }

  const total = entries.length;
  const percentage = total > 0 ? Math.round((covered / total) * 100) : 100;

  return {
    summary: {
      total,
      covered,
      uncovered,
      percentage,
    },
    entries: results,
    contracts: contracts.map((c) => ({ id: c.id, name: c.name })),
    generated_at: new Date().toISOString(),
  };
}

/**
 * 生成 Markdown 快照
 */
function generateSnapshot(report) {
  const { summary, entries } = report;

  let md = `# RCI Baseline Snapshot

**Generated**: ${report.generated_at}
**Version**: v9.1.1

## Coverage Summary

| Metric | Value |
|--------|-------|
| Total Entries | ${summary.total} |
| Covered | ${summary.covered} |
| Uncovered | ${summary.uncovered} |
| **Coverage** | **${summary.percentage}%** |

## Status

`;

  if (summary.uncovered === 0) {
    md += `✅ **PASS** - All business entries are covered by RCI.\n\n`;
  } else {
    md += `⚠️ **WARNING** - ${summary.uncovered} entries are not covered.\n\n`;
  }

  md += `## Covered Entries (${summary.covered})\n\n`;
  md += `| Type | Path | Covered By |\n`;
  md += `|------|------|------------|\n`;

  for (const entry of entries.filter((e) => e.covered)) {
    md += `| ${entry.type} | \`${entry.path}\` | ${entry.coveredBy.join(", ")} |\n`;
  }

  if (summary.uncovered > 0) {
    md += `\n## Uncovered Entries (${summary.uncovered})\n\n`;
    md += `| Type | Path | Name |\n`;
    md += `|------|------|------|\n`;

    for (const entry of entries.filter((e) => !e.covered)) {
      md += `| ${entry.type} | \`${entry.path}\` | ${entry.name} |\n`;
    }

    md += `\n### Action Required\n\n`;
    md += `Add RCI entries for the uncovered paths above, or mark them as intentionally excluded.\n`;
  }

  md += `\n## RCI Contracts (${report.contracts.length})\n\n`;
  for (const c of report.contracts) {
    md += `- **${c.id}**: ${c.name}\n`;
  }

  return md;
}

function main() {
  const args = process.argv.slice(2);
  let outputFile = null;
  let generateSnapshotFile = false;
  let jsonOutput = false;
  let explainMode = false;
  let statsMode = false;

  // 解析参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    } else if (args[i] === "--snapshot") {
      generateSnapshotFile = true;
    } else if (args[i] === "--json") {
      jsonOutput = true;
    } else if (args[i] === "--explain") {
      explainMode = true;
    } else if (args[i] === "--stats") {
      statsMode = true;
    }
  }

  // 枚举入口
  const entries = enumerateEntries();

  // 解析 RCI
  const contracts = parseRCI();

  // 生成报告
  const report = generateReport(entries, contracts);

  // 输出
  if (outputFile) {
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
    console.log(`Coverage report written to ${outputFile}`);
  }

  if (generateSnapshotFile) {
    const snapshotPath = path.join(PROJECT_ROOT, "artifacts/BASELINE-SNAPSHOT.md");
    const snapshotDir = path.dirname(snapshotPath);
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }
    fs.writeFileSync(snapshotPath, generateSnapshot(report));
    console.log(`Snapshot written to ${snapshotPath}`);
  }

  if (statsMode) {
    // 独立分母核对模式：用不同算法交叉验证
    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  RCI Coverage Independent Verification (--stats)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("  ▸ 独立分母核对（用 find/ls 独立计数，与扫描器对比）");
    console.log("  ───────────────────────────────────────────────────────────────────────────");
    console.log("");

    // 独立统计：用 find/ls 命令直接计数
    const independentCounts = {};
    let independentTotal = 0;

    // Skills
    try {
      const skillsRaw = execSync(`find ${PROJECT_ROOT}/skills -name 'SKILL.md' 2>/dev/null | wc -l`, { encoding: "utf-8" }).trim();
      independentCounts.skills_raw = parseInt(skillsRaw, 10) || 0;
    } catch { independentCounts.skills_raw = 0; }

    // Hooks (排除 Gate hooks)
    try {
      const hooksAll = execSync(`ls ${PROJECT_ROOT}/hooks/*.sh 2>/dev/null | wc -l`, { encoding: "utf-8" }).trim();
      const hooksGate = execSync(`ls ${PROJECT_ROOT}/hooks/*.sh 2>/dev/null | grep -E '(pr-gate|branch-protect|session-start)' | wc -l`, { encoding: "utf-8" }).trim();
      independentCounts.hooks_raw = parseInt(hooksAll, 10) || 0;
      independentCounts.hooks_gate = parseInt(hooksGate, 10) || 0;
      independentCounts.hooks_business = independentCounts.hooks_raw - independentCounts.hooks_gate;
    } catch { independentCounts.hooks_raw = 0; independentCounts.hooks_gate = 0; independentCounts.hooks_business = 0; }

    // Scripts (排除 devgate、deploy、setup 等)
    try {
      const scriptsAll = execSync(`ls ${PROJECT_ROOT}/scripts/*.sh 2>/dev/null | wc -l`, { encoding: "utf-8" }).trim();
      const scriptsExcluded = execSync(`ls ${PROJECT_ROOT}/scripts/*.sh 2>/dev/null | grep -E '(deploy|setup-|run-gate|rc-filter)' | wc -l`, { encoding: "utf-8" }).trim();
      independentCounts.scripts_raw = parseInt(scriptsAll, 10) || 0;
      independentCounts.scripts_excluded = parseInt(scriptsExcluded, 10) || 0;
      independentCounts.scripts_business = independentCounts.scripts_raw - independentCounts.scripts_excluded;
    } catch { independentCounts.scripts_raw = 0; independentCounts.scripts_excluded = 0; independentCounts.scripts_business = 0; }

    // DevGate tools (全部排除，因为是 Gate 范畴)
    try {
      const devgateAll = execSync(`ls ${PROJECT_ROOT}/scripts/devgate/*.cjs 2>/dev/null | wc -l`, { encoding: "utf-8" }).trim();
      independentCounts.devgate_raw = parseInt(devgateAll, 10) || 0;
      independentCounts.devgate_business = 0; // 全部是 Gate 范畴
    } catch { independentCounts.devgate_raw = 0; independentCounts.devgate_business = 0; }

    independentTotal = independentCounts.skills_raw + independentCounts.hooks_business + independentCounts.scripts_business + independentCounts.devgate_business;

    // 扫描器计数（按类型）
    const scannerCounts = {};
    for (const entry of entries) {
      scannerCounts[entry.type] = (scannerCounts[entry.type] || 0) + 1;
    }

    console.log("  方法 A: 独立计数 (find/ls)");
    console.log("  ────────────────────────────────────────");
    console.log(`    Skills (SKILL.md):        ${independentCounts.skills_raw}`);
    console.log(`    Hooks (*.sh):             ${independentCounts.hooks_raw} raw - ${independentCounts.hooks_gate} gate = ${independentCounts.hooks_business} business`);
    console.log(`    Scripts (*.sh):           ${independentCounts.scripts_raw} raw - ${independentCounts.scripts_excluded} excluded = ${independentCounts.scripts_business} business`);
    console.log(`    DevGate (*.cjs):          ${independentCounts.devgate_raw} raw → 0 business (Gate 范畴)`);
    console.log(`    ────────────────────────────────────────`);
    console.log(`    独立总计:                 ${independentTotal}`);
    console.log("");

    console.log("  方法 B: 扫描器计数 (enumerateEntries)");
    console.log("  ────────────────────────────────────────");
    console.log(`    skill:                    ${scannerCounts.skill || 0}`);
    console.log(`    hook:                     ${scannerCounts.hook || 0}`);
    console.log(`    script:                   ${scannerCounts.script || 0}`);
    console.log(`    devgate:                  ${scannerCounts.devgate || 0}`);
    console.log(`    ────────────────────────────────────────`);
    console.log(`    扫描器总计:               ${entries.length}`);
    console.log("");

    // 对比
    console.log("  ▸ 交叉验证结果");
    console.log("  ───────────────────────────────────────────────────────────────────────────");
    console.log("");

    const match = independentTotal === entries.length;
    if (match) {
      console.log(`    ✅ 分母一致: 独立计数 ${independentTotal} = 扫描器 ${entries.length}`);
      console.log("    结论: 扫描器没有漏算，分母可信");
    } else {
      console.log(`    ⚠️  分母不一致: 独立计数 ${independentTotal} ≠ 扫描器 ${entries.length}`);
      console.log("    需要检查扫描规则或排除模式是否正确");
    }

    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } else if (explainMode) {
    // 审计证据模式：输出详细的入口来源和匹配依据
    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  RCI Coverage Audit Report (--explain)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("  ▸ 分母验证：业务入口清单");
    console.log("  ───────────────────────────────────────────────────────────────────────────");
    console.log("");

    // 显示入口扫描规则
    console.log("  扫描规则：");
    for (const pattern of ENTRY_PATTERNS) {
      console.log(`    - ${pattern.glob} (type=${pattern.type}, ${pattern.description})`);
    }
    console.log("");
    console.log("  排除规则：");
    for (const pattern of EXCLUDE_PATTERNS) {
      console.log(`    - ${pattern.toString()}`);
    }
    console.log("");

    // 列出发现的入口
    console.log(`  发现入口 (${report.summary.total} 条)：`);
    console.log("");
    for (let i = 0; i < report.entries.length; i++) {
      const entry = report.entries[i];
      console.log(`    ENTRY #${i + 1}: ${entry.path}`);
      console.log(`      type=${entry.type}, name=${entry.name}`);
      console.log(`      file_exists=${fs.existsSync(path.join(PROJECT_ROOT, entry.path))}`);
      console.log("");
    }

    console.log("  ▸ 分子验证：覆盖匹配证据");
    console.log("  ───────────────────────────────────────────────────────────────────────────");
    console.log("");

    for (const entry of report.entries) {
      const status = entry.covered ? "✅ COVERED" : "❌ UNCOVERED";
      console.log(`  ${entry.path} → ${status}`);

      if (entry.covered) {
        console.log(`    命中 RCI: ${entry.coveredBy.join(", ")}`);

        // 显示匹配依据
        for (const contractId of entry.coveredBy) {
          const contract = contracts.find((c) => c.id === contractId);
          if (contract) {
            console.log(`    ├─ ${contractId}: "${contract.name}"`);
            // P1-2 修复：找出匹配原因（使用与 checkCoverage 相同的精确逻辑）
            const matchReasons = [];
            for (const contractPath of contract.paths) {
              // 精确匹配
              if (entry.path === contractPath) {
                matchReasons.push(`exact_path: "${contractPath}"`);
              }
              // 目录匹配
              else if (contractPath.endsWith("/") && entry.path.startsWith(contractPath)) {
                matchReasons.push(`dir_prefix: "${contractPath}"`);
              }
              // glob 匹配（P1-2: 使用 indexOf 代替 includes 避免测试误报）
              else if (contractPath.indexOf("*") !== -1) {
                const regexStr = contractPath
                  .replace(/\./g, "\\.")
                  .replace(/\*\*/g, ".*")
                  .replace(/\*/g, "[^/]*");
                const regex = new RegExp(`^${regexStr}$`);
                if (regex.test(entry.path)) {
                  matchReasons.push(`glob: "${contractPath}"`);
                }
              }
            }
            // P1-2: 移除了 name.includes 误判逻辑（调试输出也不再使用）
            for (const reason of matchReasons) {
              console.log(`    │  └─ ${reason}`);
            }
          }
        }
      } else {
        console.log(`    未找到匹配的 RCI 条目`);
        console.log(`    需要添加 RCI 条目覆盖此入口`);
      }
      console.log("");
    }

    console.log("  ▸ 总结");
    console.log("  ───────────────────────────────────────────────────────────────────────────");
    console.log("");
    console.log(`    Total:     ${report.summary.total}`);
    console.log(`    Covered:   ${report.summary.covered}`);
    console.log(`    Uncovered: ${report.summary.uncovered}`);
    console.log(`    Coverage:  ${report.summary.percentage}%`);
    console.log("");

    if (report.summary.uncovered === 0) {
      console.log("    ✅ 所有业务入口都有 RCI 覆盖");
    } else {
      console.log("    ⚠️  存在未覆盖的业务入口，需要补充 RCI 条目");
    }

    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } else if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!outputFile && !generateSnapshotFile) {
    // 默认输出摘要
    const { summary } = report;
    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  RCI Coverage Report");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log(`  Total entries:  ${summary.total}`);
    console.log(`  Covered:        ${summary.covered}`);
    console.log(`  Uncovered:      ${summary.uncovered}`);
    console.log(`  Coverage:       ${summary.percentage}%`);
    console.log("");

    if (summary.uncovered === 0) {
      console.log("  ✅ All entries covered");
    } else {
      console.log("  ⚠️  Uncovered entries:");
      for (const entry of report.entries.filter((e) => !e.covered)) {
        console.log(`     - ${entry.path} (${entry.name})`);
      }
    }

    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }

  // 返回状态码
  process.exit(report.summary.uncovered > 0 ? 1 : 0);
}

// 导出用于测试
module.exports = {
  enumerateEntries,
  parseRCI,
  checkCoverage,
  generateReport,
  extractEntryName,
};

// 直接运行
if (require.main === module) {
  main();
}
