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
const RCI_FILE = path.join(PROJECT_ROOT, "contracts/regression-contract.yaml");

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
  /^hook-core\//,              // 部署产物目录
  /^skills\/[^/]+\/scripts\//, // Skill 内部脚本
  /^scripts\/devgate\//,       // DevGate 内部工具（Gate 范畴）
  /^scripts\/deploy\.sh$/,     // 部署脚本
  /^scripts\/setup-/,          // 配置脚本
  /^scripts\/run-gate-tests/,  // Gate 执行器（在 GCI）
  /^scripts\/rc-filter/,       // 内部过滤工具
  /^hooks\/session-start/,     // 内部 Hook
  /^hooks\/pr-gate/,           // Gate Hook（在 GCI）
  /^hooks\/branch-protect/,    // Gate Hook（在 GCI）
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
 */
function extractPathsFromName(contract, name) {
  // /dev 流程 -> /dev
  const skillMatch = name.match(/\/(\w+)\s+流程/);
  if (skillMatch) {
    contract.paths.push(`skills/${skillMatch[1]}/SKILL.md`);
  }

  // metrics.sh -> scripts/devgate/metrics.sh
  const scriptMatch = name.match(/(\w+)\.sh/);
  if (scriptMatch) {
    contract.paths.push(`scripts/devgate/${scriptMatch[1]}.sh`);
    contract.paths.push(`scripts/${scriptMatch[1]}.sh`);
  }

  // install-hooks -> scripts/install-hooks.sh
  if (name.includes("install-hooks")) {
    contract.paths.push("scripts/install-hooks.sh");
  }
}

/**
 * 从 test 路径推断覆盖
 */
function extractPathsFromTest(contract, testPath) {
  // tests/hooks/metrics.test.ts -> scripts/devgate/metrics.sh
  const metricsMatch = testPath.match(/metrics/i);
  if (metricsMatch) {
    contract.paths.push("scripts/devgate/metrics.sh");
    contract.paths.push("scripts/devgate/metrics.cjs");
    contract.paths.push("scripts/devgate/snapshot-prd-dod.sh");
  }

  // tests/hooks/install-hooks.test.ts -> scripts/install-hooks.sh
  const installMatch = testPath.match(/install-hooks/i);
  if (installMatch) {
    contract.paths.push("scripts/install-hooks.sh");
  }

  // tests/hooks/branch-protect.test.ts -> hooks/branch-protect.sh
  const branchMatch = testPath.match(/branch-protect/i);
  if (branchMatch) {
    contract.paths.push("hooks/branch-protect.sh");
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
 * @param {{type: string, path: string, name: string}} entry
 * @param {{id: string, name: string, paths: string[]}[]} contracts
 * @returns {{covered: boolean, by: string[]}}
 */
function checkCoverage(entry, contracts) {
  const coveredBy = [];

  for (const contract of contracts) {
    // 检查路径是否匹配
    for (const contractPath of contract.paths) {
      if (
        entry.path === contractPath ||
        entry.path.includes(contractPath) ||
        contractPath.includes(entry.path) ||
        contractPath.includes(entry.name)
      ) {
        coveredBy.push(contract.id);
        break;
      }
    }

    // 检查 name 是否包含入口名
    if (contract.name.includes(entry.name)) {
      if (!coveredBy.includes(contract.id)) {
        coveredBy.push(contract.id);
      }
    }
  }

  return {
    covered: coveredBy.length > 0,
    by: coveredBy,
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
            // 找出匹配原因
            const matchReasons = [];
            for (const contractPath of contract.paths) {
              if (entry.path === contractPath) {
                matchReasons.push(`exact_path_match: "${contractPath}"`);
              } else if (entry.path.includes(contractPath) || contractPath.includes(entry.path)) {
                matchReasons.push(`path_contains: "${contractPath}"`);
              } else if (contractPath.includes(entry.name)) {
                matchReasons.push(`name_in_path: "${contractPath}" contains "${entry.name}"`);
              }
            }
            if (contract.name.includes(entry.name)) {
              matchReasons.push(`name_in_contract: "${contract.name}" contains "${entry.name}"`);
            }
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
