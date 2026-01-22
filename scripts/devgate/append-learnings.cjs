#!/usr/bin/env node
/**
 * append-learnings.cjs - LEARNINGS 自动写回
 *
 * 读取 DevGate 指标，生成月度报告，追加到 docs/LEARNINGS.md
 *
 * 用法:
 *   node scripts/devgate/append-learnings.cjs [OPTIONS]
 *
 * 选项:
 *   --metrics <path>    指标 JSON 文件（默认 devgate-metrics.json）
 *   --learnings <path>  LEARNINGS 文件（默认 docs/LEARNINGS.md）
 *   --contract <path>   回归契约文件（默认 regression-contract.yaml）
 *   --dry-run           只输出报告，不写入文件
 *   --force             强制写入（忽略幂等检查）
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// 参数解析
// ============================================================================

const args = process.argv.slice(2);
const options = {
  metrics: 'devgate-metrics.json',
  learnings: 'docs/LEARNINGS.md',
  contract: 'regression-contract.yaml',
  dryRun: false,
  force: false,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--metrics':
      options.metrics = args[++i];
      break;
    case '--learnings':
      options.learnings = args[++i];
      break;
    case '--contract':
      options.contract = args[++i];
      break;
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--force':
      options.force = true;
      break;
    case '--help':
      console.log(`
LEARNINGS 自动写回 - 生成 DevGate 月度报告

用法:
  node scripts/devgate/append-learnings.cjs [OPTIONS]

选项:
  --metrics <path>    指标 JSON 文件（默认 devgate-metrics.json）
  --learnings <path>  LEARNINGS 文件（默认 docs/LEARNINGS.md）
  --contract <path>   回归契约文件（默认 regression-contract.yaml）
  --dry-run           只输出报告，不写入文件
  --force             强制写入（忽略幂等检查）
  --help              显示帮助
`);
      process.exit(0);
  }
}

// ============================================================================
// RCI 名称解析
// ============================================================================

/**
 * 从 regression-contract.yaml 读取 RCI id → name 映射
 */
function loadRciNames(contractPath) {
  const rciMap = {};

  if (!fs.existsSync(contractPath)) {
    return rciMap;
  }

  const content = fs.readFileSync(contractPath, 'utf-8');

  // 简单解析 YAML 中的 id 和 name 字段
  // 格式: - id: H4-001
  //         name: "DevGate Metrics 指标计算"
  const idMatches = content.matchAll(/^\s*-\s*id:\s*([A-Z]\d+-\d+)\s*$/gm);
  const lines = content.split('\n');

  for (const match of idMatches) {
    const id = match[1];
    const lineIndex = content.substring(0, match.index).split('\n').length - 1;

    // 向下找 name 字段（通常在接下来几行内）
    for (let i = lineIndex + 1; i < Math.min(lineIndex + 10, lines.length); i++) {
      const nameMatch = lines[i].match(/^\s*name:\s*["']?(.+?)["']?\s*$/);
      if (nameMatch) {
        rciMap[id] = nameMatch[1];
        break;
      }
      // 遇到下一个 id 或 section 就停止
      if (lines[i].match(/^\s*-\s*id:|^[a-z_]+:/)) {
        break;
      }
    }
  }

  return rciMap;
}

// ============================================================================
// 报告生成
// ============================================================================

/**
 * 生成月度报告 markdown
 */
function generateReport(metrics, rciMap) {
  const month = metrics.window.since.substring(0, 7); // YYYY-MM
  const timestamp = new Date().toISOString();

  // 指标概览
  let report = `## [${month}] DevGate 月度报告

### 指标概览
| 指标 | 值 |
|------|-----|
| P0 PRs | ${metrics.prs.p0} |
| P1 PRs | ${metrics.prs.p1} |
| RCI 覆盖率 | ${metrics.rci_coverage.pct}% |
| 新增 RCI | ${metrics.rci_growth.new_ids_count} |
| DoD 条目 | ${metrics.dod.items} |

`;

  // Top Offenders
  report += '### Top Offenders\n';
  if (metrics.rci_coverage.offenders && metrics.rci_coverage.offenders.length > 0) {
    for (const o of metrics.rci_coverage.offenders) {
      report += `- PR #${o.pr} (${o.priority}) - 未更新 RCI\n`;
    }
  } else {
    report += '(无)\n';
  }
  report += '\n';

  // 新增 RCI IDs
  report += '### 新增 RCI IDs\n';
  if (metrics.rci_growth.new_ids && metrics.rci_growth.new_ids.length > 0) {
    for (const id of metrics.rci_growth.new_ids) {
      const name = rciMap[id] || '(未知)';
      report += `- ${id}: ${name}\n`;
    }
  } else {
    report += '(无新增)\n';
  }
  report += '\n';

  // 生成时间
  report += `### 生成时间\n${timestamp} (nightly)\n\n`;

  return { month, report };
}

// ============================================================================
// 幂等检查
// ============================================================================

/**
 * 检查月度报告是否已存在
 */
function checkExists(learningsPath, month) {
  if (!fs.existsSync(learningsPath)) {
    return false;
  }

  const content = fs.readFileSync(learningsPath, 'utf-8');
  const marker = `## [${month}] DevGate 月度报告`;
  return content.includes(marker);
}

// ============================================================================
// 主逻辑
// ============================================================================

function main() {
  // 读取指标文件
  if (!fs.existsSync(options.metrics)) {
    console.error(`错误: 指标文件不存在: ${options.metrics}`);
    process.exit(1);
  }

  const metrics = JSON.parse(fs.readFileSync(options.metrics, 'utf-8'));

  // 读取 RCI 名称映射
  const rciMap = loadRciNames(options.contract);

  // 生成报告
  const { month, report } = generateReport(metrics, rciMap);

  // 幂等检查
  if (!options.force && checkExists(options.learnings, month)) {
    console.log(`跳过: [${month}] 报告已存在于 ${options.learnings}`);
    process.exit(0);
  }

  // 输出报告
  console.log('生成的报告:');
  console.log('─'.repeat(50));
  console.log(report);
  console.log('─'.repeat(50));

  if (options.dryRun) {
    console.log('(dry-run 模式，未写入文件)');
    process.exit(0);
  }

  // 追加到 LEARNINGS.md
  if (!fs.existsSync(options.learnings)) {
    console.error(`错误: LEARNINGS 文件不存在: ${options.learnings}`);
    process.exit(1);
  }

  const currentContent = fs.readFileSync(options.learnings, 'utf-8');
  const newContent = currentContent + '\n' + report;
  fs.writeFileSync(options.learnings, newContent);

  console.log(`✅ 已追加 [${month}] 报告到 ${options.learnings}`);
}

main();
