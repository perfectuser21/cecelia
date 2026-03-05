#!/usr/bin/env node
/**
 * check-contract-drift.mjs — CI 合并闸门
 *
 * 在每个 Brain PR 上运行，检查：
 * 1. PR 变更的文件是否触及任何契约的 consumer/provider 路径
 * 2. 如果触及了，对应的 test_file 是否存在
 * 3. 如果 signature_file 变了但 test_file 没变 → 警告（接口变了测试没跟上）
 *
 * 退出码：
 *   0 = 通过（无漂移或所有漂移都有测试覆盖）
 *   1 = 检测到未保护的契约漂移（硬失败，阻止合并）
 *
 * 用法：
 *   node scripts/devgate/check-contract-drift.mjs                    # 对比 origin/main
 *   node scripts/devgate/check-contract-drift.mjs --base=origin/main # 显式指定 base
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const CONTRACT_FILE = join(ROOT, 'packages/quality/contracts/cecelia-module-boundaries.yaml');

// ─── 参数解析 ───────────────────────────────────────────────────────────────
const BASE_ARG = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
const BASE_REF = BASE_ARG || 'origin/main';

// ─── 读取契约定义 ─────────────────────────────────────────────────────────────
function loadContracts() {
  if (!existsSync(CONTRACT_FILE)) {
    console.log('[contract-drift] 契约文件不存在，跳过检查');
    process.exit(0);
  }
  const raw = readFileSync(CONTRACT_FILE, 'utf8');
  return yaml.load(raw);
}

// ─── 获取 PR 变更文件列表 ──────────────────────────────────────────────────────
function getChangedFiles() {
  try {
    const output = execSync(`git diff --name-only ${BASE_REF}...HEAD`, { encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    // fallback: 如果 base ref 不存在（浅 clone），用 HEAD~1
    try {
      const output = execSync('git diff --name-only HEAD~1', { encoding: 'utf8' });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      console.warn('[contract-drift] 无法获取变更文件列表，跳过');
      return [];
    }
  }
}

// ─── 检查文件路径是否匹配契约的 consumer/provider ─────────────────────────────
function fileMatchesContract(filePath, contract) {
  const consumer = contract.consumer || '';
  const provider = contract.provider || '';
  const sigFile = contract.signature_file || '';
  return filePath.startsWith(consumer) || filePath.startsWith(provider) || filePath === sigFile;
}

// ─── 检查 signature_file 是否在变更列表中 ────────────────────────────────────
function signatureChanged(contract, changedFiles) {
  if (!contract.signature_file) return false;
  return changedFiles.includes(contract.signature_file);
}

// ─── 检查 test_file 是否在变更列表中 ────────────────────────────────────────
function testFileChanged(contract, changedFiles) {
  if (!contract.test_file) return false;
  return changedFiles.includes(contract.test_file);
}

// ─── 主函数 ──────────────────────────────────────────────────────────────────
function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Contract Drift Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Base: ${BASE_REF}`);
  console.log('');

  const config = loadContracts();
  const contracts = config?.contracts ?? [];
  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    console.log('[contract-drift] 无变更文件，跳过');
    process.exit(0);
  }

  console.log(`[contract-drift] ${changedFiles.length} 个文件变更，${contracts.length} 个契约`);
  console.log('');

  const warnings = [];
  const errors = [];

  for (const contract of contracts) {
    // 检查 PR 是否触及此契约的边界
    const touchedFiles = changedFiles.filter(f => fileMatchesContract(f, contract));

    if (touchedFiles.length === 0) continue;

    console.log(`[contract-drift] ${contract.id} (${contract.priority}): 触及 ${touchedFiles.length} 个文件`);

    // 检查 1: test_file 是否存在
    const testPath = join(ROOT, contract.test_file);
    const testExists = existsSync(testPath);

    if (!testExists) {
      const msg = `${contract.id}: 触及边界但契约测试不存在 (${contract.test_file})`;
      if (contract.priority === 'P0') {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
      continue;
    }

    // 检查 2: signature_file 变了但 test_file 没更新
    const sigChanged = signatureChanged(contract, changedFiles);
    const testChanged = testFileChanged(contract, changedFiles);

    if (sigChanged && !testChanged) {
      warnings.push(
        `${contract.id}: 接口文件 ${contract.signature_file} 变更，但测试 ${contract.test_file} 未更新`
      );
    }
  }

  // ─── 输出结果 ────────────────────────────────────────────────────────────
  console.log('');

  if (warnings.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  WARNING: ${warnings.length} 个契约漂移警告`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const w of warnings) {
      console.log(`  - ${w}`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  FAIL: ${errors.length} 个 P0 契约无测试保护`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const e of errors) {
      console.log(`  - ${e}`);
    }
    console.log('');
    process.exit(1);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Contract Drift Check passed');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main();
