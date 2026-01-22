#!/usr/bin/env node
/**
 * metrics.cjs - DevGate Metrics Core Logic
 *
 * 计算 DevGate 闭环指标：
 * - P0/P1 PR 数
 * - P0/P1 RCI 覆盖率
 * - 新增 RCI 数
 * - DoD 条目数
 *
 * 用法:
 *   node scripts/devgate/metrics.cjs [OPTIONS]
 *
 * 选项:
 *   --since YYYY-MM-DD    开始日期
 *   --until YYYY-MM-DD    结束日期
 *   --month YYYY-MM       指定月份（覆盖 since/until）
 *   --format human|json   输出格式（默认 human）
 *   --verbose             详细输出
 *   --base develop        基准分支（默认 develop）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================================
// 参数解析
// ============================================================================

const args = process.argv.slice(2);
const options = {
  since: null,
  until: null,
  month: null,
  format: 'human',
  verbose: false,
  base: 'develop',
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--since':
      options.since = args[++i];
      break;
    case '--until':
      options.until = args[++i];
      break;
    case '--month':
      options.month = args[++i];
      break;
    case '--format':
      options.format = args[++i];
      break;
    case '--verbose':
      options.verbose = true;
      break;
    case '--base':
      options.base = args[++i];
      break;
    case '--help':
      console.log(`
DevGate Metrics - 闭环指标面板

用法:
  node scripts/devgate/metrics.cjs [OPTIONS]

选项:
  --since YYYY-MM-DD    开始日期
  --until YYYY-MM-DD    结束日期
  --month YYYY-MM       指定月份（覆盖 since/until）
  --format human|json   输出格式（默认 human）
  --verbose             详细输出
  --base develop        基准分支（默认 develop）
  --help                显示帮助

示例:
  node scripts/devgate/metrics.cjs
  node scripts/devgate/metrics.cjs --month 2026-01
  node scripts/devgate/metrics.cjs --format json
`);
      process.exit(0);
  }
}

// ============================================================================
// 时间窗口计算
// ============================================================================

function getTimeWindow(options) {
  const now = new Date();
  let since, until;

  if (options.month) {
    // --month YYYY-MM
    const [year, month] = options.month.split('-').map(Number);
    since = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    until = new Date(Date.UTC(year, month, 1, 0, 0, 0)); // 下月1日
  } else if (options.since && options.until) {
    // --since/--until
    since = new Date(options.since + 'T00:00:00Z');
    until = new Date(options.until + 'T23:59:59Z');
  } else {
    // 默认：当前月
    since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
    until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  }

  return { since, until };
}

// ============================================================================
// Meta 解析
// ============================================================================

/**
 * 解析快照文件的 meta 行
 * 格式: <!-- pr:N base:X priority:Y head:Z merged:W created:T title:"..." -->
 */
function parseMeta(content) {
  const metaMatch = content.match(/^<!--\s*(.+?)\s*-->/);
  if (!metaMatch) return null;

  const metaStr = metaMatch[1];
  const meta = {};

  // 解析 key:value 对
  const keyValueRegex = /(\w+):(?:"([^"]+)"|(\S+))/g;
  let match;
  while ((match = keyValueRegex.exec(metaStr)) !== null) {
    const key = match[1];
    const value = match[2] || match[3] || '';
    meta[key] = value;
  }

  // 转换 created 为 Date
  if (meta.created) {
    meta.createdDate = new Date(meta.created);
  }

  return meta;
}

// ============================================================================
// 快照收集
// ============================================================================

function collectSnapshots(historyDir, timeWindow) {
  const snapshots = [];

  if (!fs.existsSync(historyDir)) {
    return snapshots;
  }

  const files = fs.readdirSync(historyDir);
  const dodFiles = files.filter(f => f.match(/^PR-\d+-\d{8}-\d{4}\.dod\.md$/));

  for (const file of dodFiles) {
    const filePath = path.join(historyDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const meta = parseMeta(content);

    if (!meta || !meta.createdDate) continue;

    // 时间窗口过滤
    if (meta.createdDate >= timeWindow.since && meta.createdDate < timeWindow.until) {
      // 统计 DoD 条目数
      const dodItems = (content.match(/^- \[[ xX]\]/gm) || []).length;
      // 统计 manual test 数
      const manualTests = (content.match(/Test:\s*manual:/gim) || []).length;

      snapshots.push({
        file,
        meta,
        dodItems,
        manualTests,
        content,
      });
    }
  }

  return snapshots;
}

// ============================================================================
// RCI 覆盖率计算
// ============================================================================

/**
 * 检查某个 commit 是否修改了 regression-contract.yaml
 */
function checkRciUpdated(sha) {
  try {
    // 使用 git show 获取这个 commit 修改的文件列表
    const result = execSync(`git show --name-only --pretty=format: ${sha} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.includes('regression-contract.yaml');
  } catch {
    return false;
  }
}

/**
 * 计算 P0/P1 PR 的 RCI 覆盖率
 */
function calculateRciCoverage(snapshots) {
  const p0p1Prs = snapshots.filter(s => s.meta.priority === 'P0' || s.meta.priority === 'P1');

  let updated = 0;
  const details = [];

  for (const pr of p0p1Prs) {
    const sha = pr.meta.merged || pr.meta.head;
    const hasRci = sha ? checkRciUpdated(sha) : false;

    if (hasRci) updated++;

    details.push({
      pr: pr.meta.pr,
      priority: pr.meta.priority,
      sha,
      rciUpdated: hasRci,
    });
  }

  return {
    total: p0p1Prs.length,
    updated,
    pct: p0p1Prs.length > 0 ? Math.round((updated / p0p1Prs.length) * 100) : 100,
    details,
  };
}

// ============================================================================
// 新增 RCI 统计
// ============================================================================

/**
 * 统计时间窗口内新增的 RCI ID
 */
function countNewRciIds(timeWindow, baseBranch) {
  try {
    const sinceStr = timeWindow.since.toISOString().split('T')[0];
    const untilStr = timeWindow.until.toISOString().split('T')[0];

    // 获取时间范围内的 commits
    const commits = execSync(
      `git log --since="${sinceStr}" --until="${untilStr}" --pretty=format:%H -- regression-contract.yaml 2>/dev/null`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim().split('\n').filter(Boolean);

    const newIds = new Set();

    for (const commit of commits) {
      try {
        // 获取这个 commit 对 regression-contract.yaml 的 diff
        const diff = execSync(
          `git show ${commit} -- regression-contract.yaml 2>/dev/null`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );

        // 匹配新增的 ID 行（以 + 开头，包含 id: 字段）
        const idMatches = diff.matchAll(/^\+\s*-?\s*id:\s*([A-Z]\d+-\d+)/gm);
        for (const match of idMatches) {
          newIds.add(match[1]);
        }
      } catch {
        // 忽略单个 commit 的错误
      }
    }

    return {
      count: newIds.size,
      ids: Array.from(newIds).sort(),
    };
  } catch {
    return { count: 0, ids: [] };
  }
}

// ============================================================================
// 主逻辑
// ============================================================================

function main() {
  const projectRoot = execSync('git rev-parse --show-toplevel 2>/dev/null || pwd', {
    encoding: 'utf-8',
  }).trim();

  const historyDir = path.join(projectRoot, '.history');
  const timeWindow = getTimeWindow(options);

  // 收集快照
  const snapshots = collectSnapshots(historyDir, timeWindow);

  // 计算指标
  const p0Count = snapshots.filter(s => s.meta.priority === 'P0').length;
  const p1Count = snapshots.filter(s => s.meta.priority === 'P1').length;
  const totalP0P1 = p0Count + p1Count;

  const rciCoverage = calculateRciCoverage(snapshots);
  const rciGrowth = countNewRciIds(timeWindow, options.base);

  const totalDodItems = snapshots.reduce((sum, s) => sum + s.dodItems, 0);
  const totalManualTests = snapshots.reduce((sum, s) => sum + s.manualTests, 0);

  // 构建结果
  const result = {
    window: {
      since: timeWindow.since.toISOString().split('T')[0],
      until: timeWindow.until.toISOString().split('T')[0],
    },
    prs: {
      p0: p0Count,
      p1: p1Count,
      total_p0p1: totalP0P1,
      total: snapshots.length,
    },
    rci_coverage: {
      updated: rciCoverage.updated,
      total: rciCoverage.total,
      pct: rciCoverage.pct,
    },
    rci_growth: {
      new_ids_count: rciGrowth.count,
      new_ids: rciGrowth.ids,
    },
    dod: {
      items: totalDodItems,
      manual_tests: totalManualTests,
    },
  };

  // 输出
  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result, rciCoverage, options.verbose);
  }

  // 如果 P0/P1 覆盖率低于 100%，返回警告退出码
  if (totalP0P1 > 0 && rciCoverage.pct < 100) {
    process.exit(1);
  }
}

function printHuman(result, rciCoverage, verbose) {
  console.log(`
DevGate Metrics (${result.window.since} → ${result.window.until})

PRs
  P0 PRs: ${result.prs.p0}
  P1 PRs: ${result.prs.p1}
  P0/P1 total: ${result.prs.total_p0p1}
  All PRs: ${result.prs.total}

RCI Coverage (P0/P1)
  PRs with regression-contract.yaml updated: ${result.rci_coverage.updated}/${result.rci_coverage.total}  (${result.rci_coverage.pct}%)${result.rci_coverage.pct < 100 ? '  ⚠️  WARNING: Below 100%!' : ''}

RCI Growth
  New RCI IDs added: ${result.rci_growth.new_ids_count}${result.rci_growth.new_ids.length > 0 ? `  (${result.rci_growth.new_ids.join(', ')})` : ''}

DoD & Manual
  DoD items archived: ${result.dod.items}
  Manual tests declared: ${result.dod.manual_tests}
`);

  if (verbose && rciCoverage.details.length > 0) {
    console.log('Detailed P0/P1 Coverage:');
    for (const d of rciCoverage.details) {
      console.log(`  PR #${d.pr} (${d.priority}) sha:${d.sha || 'N/A'} → RCI: ${d.rciUpdated ? '✅' : '❌'}`);
    }
    console.log('');
  }
}

main();
