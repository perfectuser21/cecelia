#!/usr/bin/env node
/**
 * check-rci-stale-refs.cjs
 *
 * 扫描 regression-contract.yaml 中所有 `file:` / `test: tests/` 引用，
 * 验证它们指向的文件在仓库中真实存在。
 *
 * 有悬空引用 → exit 1（CI 拒绝合并）
 * 全部有效   → exit 0
 *
 * 特殊 flag:
 *   --dry-run-fake-stale  注入一条假悬空引用，强制 exit 1（用于测试 gate）
 *
 * 用法:
 *   node packages/engine/scripts/devgate/check-rci-stale-refs.cjs
 *   node packages/engine/scripts/devgate/check-rci-stale-refs.cjs --dry-run-fake-stale
 */

'use strict';

const fs = require('fs');
const path = require('path');

// CLI 输出助手（Gate 0c 禁止 console.log，用 process.stdout/stderr.write 代替）
const out = (msg) => process.stdout.write((msg ?? '') + '\n');
const err = (msg) => process.stderr.write((msg ?? '') + '\n');

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/**
 * 找到仓库根目录（向上查找 package.json 含 workspaces 字段）
 */
function findRepoRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const content = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (content.workspaces) return dir;
      } catch {
        // 继续向上
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * 从 YAML 文本中提取所有 file: 字段值（简单行扫描，不用完整 YAML 解析器）
 * 支持格式：
 *   file: path/to/file.ts
 *   file: "path/to/file.ts"
 */
function extractFileRefs(yamlText) {
  const refs = [];
  const lines = yamlText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 匹配 file: <path>（evidence.file 或顶层 file 字段）
    const fileMatch = line.match(/^\s*file:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/);
    if (fileMatch && fileMatch[1]) {
      refs.push({ value: fileMatch[1].trim(), lineNum: i + 1, type: 'file' });
    }

    // 匹配 test: "tests/..." 或 test: tests/...（仅 tests/ 开头的路径）
    const testMatch = line.match(/^\s*test:\s*["']?(tests\/[^"'\s#]+)["']?\s*(?:#.*)?$/);
    if (testMatch && testMatch[1]) {
      refs.push({ value: testMatch[1].trim(), lineNum: i + 1, type: 'test' });
    }
  }

  return refs;
}

// ─── 主逻辑 ────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const dryRunFakeStale = args.includes('--dry-run-fake-stale');

  const repoRoot = findRepoRoot();
  const contractPath = path.join(repoRoot, 'packages/engine/regression-contract.yaml');

  out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  out('  RCI Stale Refs Check');
  out(`  Contract: ${path.relative(repoRoot, contractPath)}`);
  out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  out('');

  if (!fs.existsSync(contractPath)) {
    console.error(`❌ regression-contract.yaml 不存在: ${contractPath}`);
    process.exit(1);
  }

  const yamlText = fs.readFileSync(contractPath, 'utf8');
  const refs = extractFileRefs(yamlText);

  // 注入假悬空引用（用于测试 gate 行为）
  if (dryRunFakeStale) {
    refs.push({
      value: 'packages/engine/scripts/devgate/THIS_FILE_DOES_NOT_EXIST_fake_stale.cjs',
      lineNum: 0,
      type: 'file',
    });
    out('⚠️  --dry-run-fake-stale 已激活：注入一条假悬空引用用于测试');
    out('');
  }

  out(`扫描 ${refs.length} 条文件引用...`);
  out('');

  // regression-contract.yaml 在 packages/engine/ 目录下
  // file: 引用有两种基准路径：
  //   1. 相对于 packages/engine/（如 hooks/branch-protect.sh, tests/hooks/*.ts）
  //   2. 相对于仓库根（如 .github/workflows/*.yml, apps/dashboard/...）
  // 策略：两处都找，只要有一处存在即视为有效
  const engineDir = path.dirname(contractPath);

  const staleRefs = [];

  for (const ref of refs) {
    const fromEngineDir = path.join(engineDir, ref.value);
    const fromRepoRoot = path.join(repoRoot, ref.value);
    if (!fs.existsSync(fromEngineDir) && !fs.existsSync(fromRepoRoot)) {
      staleRefs.push(ref);
    }
  }

  if (staleRefs.length === 0) {
    out(`✅ 所有 ${refs.length} 条引用均有效，无悬空引用`);
    out('');
    out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    out('  ✅ RCI Stale Refs Check PASSED');
    out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(0);
  }

  // 有悬空引用 → 报告并 exit 1
  err(`❌ 发现 ${staleRefs.length} 条悬空引用（引用的文件不存在）：`);
  err('');
  for (const ref of staleRefs) {
    const lineInfo = ref.lineNum > 0 ? ` (L${ref.lineNum})` : ' (injected)';
    err(`  [${ref.type}]${lineInfo} ${ref.value}`);
  }
  err('');
  err('修复方式：');
  err('  - 如果文件已被删除/重命名，同步更新 regression-contract.yaml 中对应条目');
  err('  - 如果文件应存在但被误删，恢复该文件');
  err('');
  err('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  err('  ❌ RCI Stale Refs Check FAILED');
  err('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
}

main();
