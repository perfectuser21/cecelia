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

// L1 fix: 参数解析添加越界检查，不在内部修改 i
function requireArg(args, i, flag) {
  if (i + 1 >= args.length) {
    console.error(`错误: ${flag} 需要一个参数值`);
    process.exit(1);
  }
  return args[i + 1];
}

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--metrics':
      options.metrics = requireArg(args, i, '--metrics');
      i++;  // L1 fix: 只在这里递增一次
      break;
    case '--learnings':
      options.learnings = requireArg(args, i, '--learnings');
      i++;
      break;
    case '--contract':
      options.contract = requireArg(args, i, '--contract');
      i++;
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
 * L2 fix: 改进 YAML 解析，支持多行和各种引号格式
 */
function loadRciNames(contractPath) {
  const rciMap = {};

  if (!fs.existsSync(contractPath)) {
    return rciMap;
  }

  const content = fs.readFileSync(contractPath, 'utf-8');
  const lines = content.split('\n');

  let currentId = null;
  let inMultilineName = false;
  let multilineBuffer = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 匹配 id 字段
    const idMatch = line.match(/^\s*-?\s*id:\s*([A-Z]\d+-\d+)\s*$/);
    if (idMatch) {
      currentId = idMatch[1];
      inMultilineName = false;
      continue;
    }

    // 如果有当前 id，查找 name 字段
    if (currentId) {
      // 单行 name（带引号或不带）
      const nameMatch = line.match(/^\s*name:\s*["']?(.+?)["']?\s*$/);
      if (nameMatch && !line.includes('|') && !line.includes('>')) {
        rciMap[currentId] = nameMatch[1].replace(/["']$/, '');
        currentId = null;
        continue;
      }

      // 多行 name 开始（| 或 >）
      if (line.match(/^\s*name:\s*[|>]/)) {
        inMultilineName = true;
        multilineBuffer = '';
        continue;
      }

      // 多行内容收集
      if (inMultilineName) {
        if (line.match(/^\s{4,}/) || line.trim() === '') {
          multilineBuffer += (multilineBuffer ? ' ' : '') + line.trim();
        } else {
          rciMap[currentId] = multilineBuffer.trim();
          currentId = null;
          inMultilineName = false;
          i--; // 重新处理当前行
        }
        continue;
      }

      // 遇到下一个 id 或新 section 就重置
      if (line.match(/^\s*-\s*id:|^[a-z_]+:/)) {
        currentId = null;
      }
    }
  }

  // 处理文件末尾的多行
  if (currentId && multilineBuffer) {
    rciMap[currentId] = multilineBuffer.trim();
  }

  return rciMap;
}

// ============================================================================
// 报告生成
// ============================================================================

/**
 * 生成月度报告 markdown
 * L3 fix: 确保 markdown 表格前后有空行
 */
function generateReport(metrics, rciMap) {
  const month = metrics.window.since.substring(0, 7); // YYYY-MM
  const timestamp = new Date().toISOString();

  // 指标概览（表格前后必须有空行）
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
  report += '### Top Offenders\n\n';
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
