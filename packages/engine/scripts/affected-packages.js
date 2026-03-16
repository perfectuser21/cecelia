#!/usr/bin/env node
/**
 * affected-packages.js — 基于 git diff 和包路径映射计算受影响的包集合
 *
 * 用法：
 *   node scripts/affected-packages.js <file1> [file2] [file3] ...
 *   echo "packages/brain/src/tick.js" | node scripts/affected-packages.js
 *
 * 输出：JSON 数组，如 ["brain","engine","dashboard"]
 *
 * 特殊规则：
 *   - .github/workflows/ 改动 → 所有包（CI 影响全局）
 *   - 根目录文件改动（不属于任何包）→ 所有包（兜底）
 *   - packages/engine/ 改动 → 始终包含 engine
 *   - packages/brain/ 改动 → 始终包含 brain
 */

'use strict';

// 所有已知包列表（用于"所有包"兜底）
const ALL_PACKAGES = ['brain', 'engine', 'quality', 'workflows', 'api', 'dashboard'];

/**
 * 路径前缀 → 包名映射表
 * 按优先级排列（更具体的前缀优先）
 */
const PATH_TO_PACKAGE = [
  { prefix: 'packages/brain/', pkg: 'brain' },
  { prefix: 'packages/engine/', pkg: 'engine' },
  { prefix: 'packages/quality/', pkg: 'quality' },
  { prefix: 'packages/workflows/', pkg: 'workflows' },
  { prefix: 'apps/api/', pkg: 'api' },
  { prefix: 'apps/dashboard/', pkg: 'dashboard' },
];

/**
 * 触发"所有包"的路径模式
 * 这些改动会影响所有包的 CI
 */
const ALL_PACKAGES_PATTERNS = [
  '.github/workflows/',  // CI workflow 改动影响所有包
  'package.json',        // 根目录 package.json
  'package-lock.json',   // 根目录 lock 文件
  'docker-compose',      // 开发环境配置
  '.brain-versions',     // Brain 版本追踪
  'DEFINITION.md',       // 系统定义文件
];

/**
 * 判断路径是否匹配"所有包"模式
 */
function matchesAllPackagesPattern(filePath) {
  // 如果路径以任何已知包前缀开头，不触发兜底（属于特定包）
  for (const { prefix } of PATH_TO_PACKAGE) {
    if (filePath.startsWith(prefix)) {
      return false;
    }
  }

  // 检查是否匹配触发"所有包"的模式
  for (const pattern of ALL_PACKAGES_PATTERNS) {
    if (filePath.startsWith(pattern) || filePath === pattern) {
      return true;
    }
  }

  return false;
}

/**
 * 将单个文件路径映射到包名
 * @param {string} filePath — git diff 输出的文件路径（相对于仓库根目录）
 * @returns {string | 'ALL' | null} 包名，'ALL' 表示所有包，null 表示未识别
 */
function mapFileToPackage(filePath) {
  // 检查是否触发"所有包"兜底
  if (matchesAllPackagesPattern(filePath)) {
    return 'ALL';
  }

  // 按路径前缀匹配包名
  for (const { prefix, pkg } of PATH_TO_PACKAGE) {
    if (filePath.startsWith(prefix)) {
      return pkg;
    }
  }

  // 未能识别的路径（如根目录其他文件）→ 兜底所有包
  return 'ALL';
}

/**
 * 计算受影响的包集合
 * @param {string[]} changedFiles — 改动文件路径列表
 * @returns {string[]} 受影响的包名数组（已去重，按 ALL_PACKAGES 顺序排列）
 */
function computeAffectedPackages(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) {
    // 无改动文件信息 → 兜底所有包（保守策略）
    return [...ALL_PACKAGES];
  }

  const affectedSet = new Set();

  for (const filePath of changedFiles) {
    const trimmed = filePath.trim();
    if (!trimmed) continue;

    const result = mapFileToPackage(trimmed);

    if (result === 'ALL') {
      // 任何文件触发"所有包" → 直接返回全集，无需继续
      return [...ALL_PACKAGES];
    }

    if (result !== null) {
      affectedSet.add(result);
    }
  }

  // 按 ALL_PACKAGES 顺序返回（保持稳定输出）
  return ALL_PACKAGES.filter(pkg => affectedSet.has(pkg));
}

// ─── CLI 入口 ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// 支持两种输入方式：
// 1. 命令行参数：node affected-packages.js file1 file2 file3
// 2. stdin（换行分隔）：echo "file1\nfile2" | node affected-packages.js
async function main() {
  let changedFiles = [];

  if (args.length > 0) {
    // 优先使用命令行参数
    changedFiles = args;
  } else if (!process.stdin.isTTY) {
    // 从 stdin 读取（换行分隔）
    const chunks = [];
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    changedFiles = chunks.join('').split('\n').filter(Boolean);
  }

  const affected = computeAffectedPackages(changedFiles);
  process.stdout.write(JSON.stringify(affected) + '\n');
}

main().catch(err => {
  process.stderr.write(`错误: ${err.message}\n`);
  process.exit(1);
});
