#!/usr/bin/env node
/**
 * check-new-files-need-rci.cjs
 *
 * 检测 PR 新增的 hooks/ 或 scripts/devgate/ 文件是否在 regression-contract.yaml 中有 RCI 条目。
 * 防止新能力无 RCI 覆盖悄悄滑入生产。
 *
 * 使用方式：
 *   node packages/engine/scripts/devgate/check-new-files-need-rci.cjs <added-file1> [added-file2 ...]
 *
 * 退出码：
 *   0 — 所有新增目标文件均有 RCI 条目，通过
 *   1 — 发现无 RCI 的新增文件，blocked
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** 目标监控路径（相对 repo 根目录） */
const TARGET_DIRS = [
  'packages/engine/hooks/',
  'packages/engine/scripts/devgate/',
];

/**
 * 从文件路径中提取相对 packages/engine/ 的路径
 * e.g. "packages/engine/hooks/foo.sh" → "hooks/foo.sh"
 */
function toRelativePath(filePath) {
  const prefix = 'packages/engine/';
  if (filePath.startsWith(prefix)) {
    return filePath.slice(prefix.length);
  }
  return null;
}

/**
 * 从 regression-contract.yaml 内容中提取所有 file: 字段值
 */
function extractRciFiles(contractContent) {
  const files = new Set();
  // 匹配 file: "some/path" 或 file: some/path
  const regex = /^\s+file:\s+"?([^"\n]+)"?\s*$/gm;
  let match;
  while ((match = regex.exec(contractContent)) !== null) {
    files.add(match[1].trim());
  }
  return files;
}

/**
 * 扫描新增文件中是否有缺少 RCI 条目的文件
 *
 * @param {string[]} addedFiles - 新增文件路径数组（相对 repo 根目录）
 * @param {string} contractContent - regression-contract.yaml 的内容
 * @returns {{ file: string, relativePath: string }[]} 缺少 RCI 的文件列表
 */
function scanMissingRci(addedFiles, contractContent) {
  if (!addedFiles || addedFiles.length === 0) return [];

  // 过滤出目标目录下的文件
  const targetFiles = addedFiles.filter((f) =>
    TARGET_DIRS.some((dir) => f.startsWith(dir))
  );

  if (targetFiles.length === 0) return [];

  const rciFiles = extractRciFiles(contractContent);
  const violations = [];

  for (const filePath of targetFiles) {
    const relativePath = toRelativePath(filePath);
    if (relativePath === null) continue;

    if (!rciFiles.has(relativePath)) {
      violations.push({ file: filePath, relativePath });
    }
  }

  return violations;
}

/**
 * CLI 入口
 */
function main(addedFiles) {
  if (!addedFiles || addedFiles.length === 0) {
    process.stderr.write('用法: node check-new-files-need-rci.cjs <added-file1> [added-file2 ...]\n');
    process.exit(0); // 无文件时跳过（降级保护）
  }

  // 找到 regression-contract.yaml
  const projectRoot = process.cwd();
  const contractPath = path.join(projectRoot, 'packages/engine/regression-contract.yaml');

  if (!fs.existsSync(contractPath)) {
    process.stderr.write(`⚠️  regression-contract.yaml 不存在: ${contractPath}，跳过 RCI 检查\n`);
    process.exit(0); // 降级保护
  }

  const contractContent = fs.readFileSync(contractPath, 'utf-8');
  const violations = scanMissingRci(addedFiles, contractContent);

  if (violations.length === 0) {
    process.stdout.write(`✅ 新增文件 RCI 检查通过 — 所有目标文件均有 RCI 条目\n`);
    process.exit(0);
  }

  process.stderr.write(`❌ 发现 ${violations.length} 个新增文件缺少 RCI 条目：\n`);
  for (const v of violations) {
    process.stderr.write(`   • ${v.file}\n`);
    process.stderr.write(`     (相对路径: ${v.relativePath})\n`);
  }
  process.stderr.write(`\n`);
  process.stderr.write(`请在 packages/engine/regression-contract.yaml 中为每个新增文件添加 RCI 条目。\n`);
  process.stderr.write(`参考格式：\n`);
  process.stderr.write(`  hooks:\n`);
  process.stderr.write(`    - id: HXX-your-hook\n`);
  process.stderr.write(`      description: "描述这个 hook 的功能"\n`);
  process.stderr.write(`      file: "hooks/your-hook.sh"\n`);
  process.stderr.write(`      trigger: [PR, Release]\n`);
  process.stderr.write(`      method: auto\n`);
  process.stderr.write(`      test: tests/hooks/your-hook.test.ts\n`);
  process.exit(1);
}

module.exports = { scanMissingRci, extractRciFiles, toRelativePath, TARGET_DIRS };

if (require.main === module) {
  main(process.argv.slice(2));
}
