#!/usr/bin/env node
/**
 * check-new-files-need-rci.cjs
 *
 * 检查 PR 新增的 hooks/ 或 scripts/devgate/ 文件是否在
 * regression-contract.yaml 中有对应 RCI 条目。
 *
 * 三重降级保护：
 *   1. 无变更文件       → 跳过（exit 0）
 *   2. 文件已有 RCI     → 跳过该文件
 *   3. 非目标路径文件   → 跳过
 *
 * 用法（CI 中调用）：
 *   node packages/engine/scripts/devgate/check-new-files-need-rci.cjs
 *
 * 导出（供测试调用）：
 *   scanMissingRci(changedFiles, contractContent) → string[]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── 目标路径规则 ──────────────────────────────────────────────────────────

/**
 * 判断文件是否属于需要检查 RCI 的目标路径
 * 目标：packages/engine/hooks/*.sh 和 packages/engine/scripts/devgate/*.cjs
 */
function isTargetFile(filePath) {
  if (/^packages\/engine\/hooks\/[^/]+\.sh$/.test(filePath)) return true;
  if (/^packages\/engine\/scripts\/devgate\/[^/]+\.cjs$/.test(filePath)) return true;
  return false;
}

/**
 * 将仓库相对路径转换为 engine-relative 路径
 * 例: packages/engine/hooks/foo.sh → hooks/foo.sh
 */
function toEnginePath(filePath) {
  return filePath.replace(/^packages\/engine\//, '');
}

// ─── RCI 匹配 ──────────────────────────────────────────────────────────────

/**
 * 从 YAML 文本中提取所有 evidence.file 值
 * 使用简单字符串匹配，避免引入外部 YAML 解析器
 */
function extractEvidenceFiles(contractContent) {
  if (!contractContent) return [];
  const refs = [];
  const lines = contractContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配 `file: hooks/foo.sh` 或 `file: "hooks/foo.sh"`
    const m = line.match(/^\s+file:\s+"?([^"#\s]+)"?\s*$/);
    if (m) {
      refs.push(m[1].trim());
    }
  }
  return refs;
}

// ─── 核心导出函数 ──────────────────────────────────────────────────────────

/**
 * 扫描缺少 RCI 条目的新增目标文件
 *
 * @param {string[]|undefined} changedFiles - PR 中变更的文件列表（仓库相对路径）
 * @param {string|null} contractContent     - regression-contract.yaml 的文本内容
 * @returns {string[]} 缺少 RCI 条目的文件路径列表
 */
function scanMissingRci(changedFiles, contractContent) {
  // 降级保护 1：无变更文件
  if (!changedFiles || changedFiles.length === 0) return [];

  // 降级保护 3：过滤出目标路径文件
  const targetFiles = changedFiles.filter(isTargetFile);
  if (targetFiles.length === 0) return [];

  // 提取已有 RCI 的 evidence.file 列表
  const rciFiles = extractEvidenceFiles(contractContent || '');

  // 降级保护 2：对每个目标文件，检查是否有对应 RCI
  const missing = targetFiles.filter((filePath) => {
    const enginePath = toEnginePath(filePath);
    const basename = path.basename(filePath);
    // 匹配规则：enginePath 或 basename 出现在某个 evidence.file 值中
    return !rciFiles.some(
      (ref) => ref === enginePath || ref.endsWith('/' + basename) || ref === basename
    );
  });

  return missing;
}

module.exports = { scanMissingRci, isTargetFile, toEnginePath, extractEvidenceFiles };

// ─── CLI 入口（CI 调用）───────────────────────────────────────────────────

if (require.main === module) {
  const out = (msg) => process.stdout.write((msg ?? '') + '\n');
  const err = (msg) => process.stderr.write((msg ?? '') + '\n');

  // 找仓库根目录
  let repoRoot = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(repoRoot, 'package.json'))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
        if (pkg.workspaces) break;
      } catch { /* 继续向上 */ }
    }
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) break;
    repoRoot = parent;
  }

  out('');
  out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  out('  New Files Need RCI Check');
  out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  out('');

  // 获取变更文件列表
  let changedFiles = [];
  try {
    const baseRef = process.env.BASE_REF || 'origin/main';
    const raw = execSync(`git diff --name-only --diff-filter=A "${baseRef}"...HEAD`, {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    changedFiles = raw ? raw.split('\n').filter(Boolean) : [];
    out(`检测到新增文件 ${changedFiles.length} 个`);
  } catch (e) {
    err(`警告：无法获取变更文件列表（${e.message}），跳过检查`);
    out('');
    out('✅ New Files Need RCI Check passed (无法获取变更，跳过)');
    process.exit(0);
  }

  // 读取 regression-contract.yaml
  const contractPath = path.join(repoRoot, 'packages', 'engine', 'regression-contract.yaml');
  let contractContent = '';
  try {
    contractContent = fs.readFileSync(contractPath, 'utf8');
  } catch (e) {
    err(`警告：无法读取 regression-contract.yaml（${e.message}），跳过检查`);
    out('✅ New Files Need RCI Check passed (无合约文件，跳过)');
    process.exit(0);
  }

  const missing = scanMissingRci(changedFiles, contractContent);

  if (missing.length === 0) {
    out('');
    out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    out('  ✅ New Files Need RCI Check PASSED');
    out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(0);
  }

  err('');
  err('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  err('  ❌ New Files Need RCI Check FAILED');
  err('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  err('');
  err(`以下 ${missing.length} 个新增文件缺少 RCI 条目：`);
  missing.forEach((f) => err(`  - ${f}`));
  err('');
  err('修复方法：在 packages/engine/regression-contract.yaml 中为每个文件');
  err('添加对应的 RCI 条目，并在 evidence.file 字段引用该文件路径。');
  err('');
  err('示例：');
  err('  - id: H9-001');
  err('    name: "功能描述"');
  err('    evidence:');
  err(`      file: ${missing[0] ? toEnginePath(missing[0]) : 'hooks/your-hook.sh'}`);
  err('      contains: "关键行为关键词"');
  process.exit(1);
}
