#!/usr/bin/env node
/**
 * check-coverage-completeness.mjs
 *
 * 覆盖率完整性检查：关键源文件必须有对应的测试文件
 *
 * 规则：
 * - hooks/HOOK.sh → tests/hooks/HOOK.test.ts 或 HOOK.test.sh 必须存在
 * - src/FILE.ts（非 .d.ts）→ tests 下必须有对应 FILE.test.ts
 * - scripts/devgate/SCRIPT.mjs, .cjs → tests/devgate 下必须有测试
 *   高风险脚本（HIGH_RISK_DEVGATE_SCRIPTS）缺测试 → error（exit 1）
 *   其他脚本缺测试 → warning（非阻断）
 *
 * 用法：
 *   node scripts/devgate/check-coverage-completeness.mjs
 *   node scripts/devgate/check-coverage-completeness.mjs --dry-run
 *   node scripts/devgate/check-coverage-completeness.mjs --strict  # 警告也算失败
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '../..');
const BRAIN_ROOT = path.resolve(ENGINE_ROOT, '..', 'brain');

// ─── ANSI colors ─────────────────────────────────────────────────────────────
const GREEN = '\x1b[0;32m';
const RED = '\x1b[0;31m';
const YELLOW = '\x1b[0;33m';
const CYAN = '\x1b[0;36m';
const NC = '\x1b[0m';

// ─── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isStrict = args.includes('--strict');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => (Array.isArray(ext) ? ext.some(e => f.endsWith(e)) : f.endsWith(ext)))
    .map(f => path.join(dir, f));
}

function walkDir(dir, predicate) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, predicate));
    } else if (predicate(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ─── Check 1: hooks/*.sh → tests/hooks/ ──────────────────────────────────────
function checkHooksCoverage() {
  const hooksDir = path.join(ENGINE_ROOT, 'hooks');
  const testsHooksDir = path.join(ENGINE_ROOT, 'tests', 'hooks');

  const hookFiles = listFiles(hooksDir, '.sh').map(f => path.basename(f, '.sh'));
  if (hookFiles.length === 0) return { missing: [], total: 0 };

  const testFiles = fs.existsSync(testsHooksDir)
    ? fs.readdirSync(testsHooksDir).map(f => f.replace(/\.(test\.(ts|sh)|spec\.ts)$/, ''))
    : [];

  const missing = hookFiles.filter(hook => !testFiles.some(t => t.includes(hook)));
  return { missing, total: hookFiles.length };
}

// ─── Check 2: src/*.ts → tests/**/*.test.ts ───────────────────────────────────
function checkSrcCoverage() {
  const srcDir = path.join(ENGINE_ROOT, 'src');
  if (!fs.existsSync(srcDir)) return { missing: [], total: 0, skipped: true };

  const srcFiles = listFiles(srcDir, '.ts')
    .filter(f => !f.endsWith('.d.ts') && !f.endsWith('.test.ts'))
    .map(f => path.basename(f, '.ts'));

  if (srcFiles.length === 0) return { missing: [], total: 0 };

  const allTests = walkDir(path.join(ENGINE_ROOT, 'tests'), n => n.endsWith('.test.ts'))
    .map(f => path.basename(f).replace(/\.test\.ts$/, ''));

  const missing = srcFiles.filter(src => !allTests.some(t => t.includes(src)));
  return { missing, total: srcFiles.length };
}

// ─── High-risk devgate scripts (missing test → error) ────────────────────────
export const HIGH_RISK_DEVGATE_SCRIPTS = new Set([
  'check-dod-mapping',
  'scan-rci-coverage',
  'check-coverage-completeness',
  'check-rci-stale-refs',
  'check-changed-coverage',
]);

// ─── Check 3: scripts/devgate/*.mjs/.cjs → tests/devgate/ ────────────────────
export function checkDevgateCoverage() {
  const devgateDir = path.join(ENGINE_ROOT, 'scripts', 'devgate');
  const testsDevgateDir = path.join(ENGINE_ROOT, 'tests', 'devgate');

  const devgateFiles = listFiles(devgateDir, ['.mjs', '.cjs'])
    .map(f => path.basename(f).replace(/\.(mjs|cjs)$/, ''));

  if (devgateFiles.length === 0) return { missingRequired: [], missingOptional: [], total: 0 };

  const testFiles = fs.existsSync(testsDevgateDir)
    ? fs.readdirSync(testsDevgateDir).map(f => f.replace(/\.test\.(ts|sh)$/, ''))
    : [];

  const missing = devgateFiles.filter(s => !testFiles.some(t => t.includes(s)));
  const missingRequired = missing.filter(s => HIGH_RISK_DEVGATE_SCRIPTS.has(s));
  const missingOptional = missing.filter(s => !HIGH_RISK_DEVGATE_SCRIPTS.has(s));
  return { missingRequired, missingOptional, total: devgateFiles.length };
}

// ─── High-risk Brain modules (missing test → error) ──────────────────────────
export const HIGH_RISK_BRAIN_MODULES = new Set([
  'tick',
  'thalamus',
  'executor',
  'cortex',
  'planner',
]);

// ─── Check 4: packages/brain/src/*.js → src/__tests__/MODULE*.test.js ─────────
export function checkBrainCoverage(brainRoot = BRAIN_ROOT) {
  const srcDir = path.join(brainRoot, 'src');
  const testsDir = path.join(brainRoot, 'src', '__tests__');

  if (!fs.existsSync(srcDir)) return { missingRequired: [], missingOptional: [], total: 0, skipped: true };

  const srcFiles = fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.js') && !f.endsWith('.d.js') && !f.endsWith('.test.js'))
    .map(f => path.basename(f, '.js'));

  if (srcFiles.length === 0) return { missingRequired: [], missingOptional: [], total: 0 };

  const testFiles = fs.existsSync(testsDir)
    ? fs.readdirSync(testsDir).filter(f => f.endsWith('.test.js')).map(f => path.basename(f, '.test.js'))
    : [];

  // Prefix match: executor.js → executor*.test.js (e.g. executor-billing-pause.test.js)
  const missing = srcFiles.filter(src => !testFiles.some(t => t === src || t.startsWith(src + '-') || t.startsWith(src + '.')));
  const missingRequired = missing.filter(s => HIGH_RISK_BRAIN_MODULES.has(s));
  const missingOptional = missing.filter(s => !HIGH_RISK_BRAIN_MODULES.has(s));
  return { missingRequired, missingOptional, total: srcFiles.length };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Coverage Completeness Check');
  if (isDryRun) console.log('  (dry-run mode)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  let hasErrors = false;
  let hasWarnings = false;

  // ── Check 1: Hooks ──────────────────────────────────────────────────────────
  const hooks = checkHooksCoverage();
  if (hooks.total === 0) {
    console.log(`${YELLOW}⚠️  Hooks 覆盖检查: SKIPPED (hooks/ 目录为空)${NC}`);
  } else if (hooks.missing.length > 0) {
    if (isStrict) {
      console.log(`${RED}❌ Hooks 覆盖检查: FAIL (${hooks.missing.length}/${hooks.total} 无测试文件)${NC}`);
      hasErrors = true;
    } else {
      console.log(`${YELLOW}⚠️  Hooks 覆盖检查: WARNING (${hooks.missing.length}/${hooks.total} 无测试文件)${NC}`);
      hasWarnings = true;
    }
    for (const hook of hooks.missing) {
      console.log(`   ${CYAN}  hooks/${hook}.sh → 建议添加 tests/hooks/${hook}.test.ts${NC}`);
    }
  } else {
    console.log(`${GREEN}✅ Hooks 覆盖检查: PASS (${hooks.total} 个 hook 均有测试)${NC}`);
  }

  // ── Check 2: src/ ───────────────────────────────────────────────────────────
  const src = checkSrcCoverage();
  if (src.skipped || src.total === 0) {
    console.log(`${YELLOW}⚠️  Src 覆盖检查: SKIPPED (src/ 目录为空或不存在)${NC}`);
  } else if (src.missing.length > 0) {
    if (isStrict) {
      console.log(`${RED}❌ Src 覆盖检查: FAIL (${src.missing.length}/${src.total} 无测试文件)${NC}`);
      hasErrors = true;
    } else {
      console.log(`${YELLOW}⚠️  Src 覆盖检查: WARNING (${src.missing.length}/${src.total} 无测试文件)${NC}`);
      hasWarnings = true;
    }
    for (const s of src.missing) {
      console.log(`   ${CYAN}  src/${s}.ts → 建议添加对应 test 文件${NC}`);
    }
  } else {
    console.log(`${GREEN}✅ Src 覆盖检查: PASS (${src.total} 个源文件均有测试)${NC}`);
  }

  // ── Check 3: scripts/devgate/ ────────────────────────────────────────────────
  const devgate = checkDevgateCoverage();
  if (devgate.total === 0) {
    console.log(`${YELLOW}⚠️  Devgate 脚本覆盖检查: SKIPPED (无 .mjs/.cjs 文件)${NC}`);
  } else {
    const totalMissing = devgate.missingRequired.length + devgate.missingOptional.length;
    if (devgate.missingRequired.length > 0) {
      console.log(`${RED}❌ Devgate 高风险脚本覆盖检查: FAIL (${devgate.missingRequired.length} 个高风险脚本无测试)${NC}`);
      for (const s of devgate.missingRequired) {
        console.log(`   ${RED}  ${s} → 必须在 tests/devgate/ 添加测试${NC}`);
      }
      hasErrors = true;
    }
    if (devgate.missingOptional.length > 0) {
      console.log(`${YELLOW}⚠️  Devgate 低风险脚本覆盖检查: WARNING (${devgate.missingOptional.length}/${devgate.total} 无测试)${NC}`);
      for (const s of devgate.missingOptional.slice(0, 5)) {
        console.log(`   ${CYAN}  ${s} → 建议在 tests/devgate/ 添加测试${NC}`);
      }
      if (devgate.missingOptional.length > 5) {
        console.log(`   ${CYAN}  ...还有 ${devgate.missingOptional.length - 5} 个${NC}`);
      }
      hasWarnings = true;
      if (isStrict) hasErrors = true;
    }
    if (totalMissing === 0) {
      console.log(`${GREEN}✅ Devgate 脚本覆盖检查: PASS (${devgate.total} 个脚本均有测试)${NC}`);
    }
  }

  // ── Check 4: Brain src/ ──────────────────────────────────────────────────────
  const brain = checkBrainCoverage();
  if (brain.skipped || brain.total === 0) {
    console.log(`${YELLOW}⚠️  Brain src 覆盖检查: SKIPPED (packages/brain/src/ 不存在或为空)${NC}`);
  } else {
    if (brain.missingRequired.length > 0) {
      console.log(`${RED}❌ Brain src 覆盖检查: FAIL (${brain.missingRequired.length} 个高风险模块无测试)${NC}`);
      for (const s of brain.missingRequired) {
        console.log(`   ${RED}  ${s}.js → 必须在 src/__tests__/ 添加测试${NC}`);
      }
      hasErrors = true;
    }
    if (brain.missingOptional.length > 0) {
      console.log(`${YELLOW}⚠️  Brain src 覆盖检查: WARNING (${brain.missingOptional.length}/${brain.total} 无测试)${NC}`);
      for (const s of brain.missingOptional.slice(0, 5)) {
        console.log(`   ${CYAN}  ${s}.js → 建议在 src/__tests__/ 添加测试${NC}`);
      }
      if (brain.missingOptional.length > 5) {
        console.log(`   ${CYAN}  ...还有 ${brain.missingOptional.length - 5} 个${NC}`);
      }
      hasWarnings = true;
      if (isStrict) hasErrors = true;
    }
    if (brain.missingRequired.length === 0 && brain.missingOptional.length === 0) {
      console.log(`${GREEN}✅ Brain src 覆盖检查: PASS (${brain.total} 个模块均有测试)${NC}`);
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (hasErrors) {
    console.log(`${RED}  ❌ 覆盖率完整性检查: FAIL${NC}`);
    if (!isDryRun) process.exit(1);
  } else if (hasWarnings) {
    console.log(`${YELLOW}  ⚠️  覆盖率完整性检查: PASS with warnings${NC}`);
  } else {
    console.log(`${GREEN}  ✅ 覆盖率完整性检查: PASS${NC}`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// Guard: only run main() when executed directly (not when imported by tests)
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
