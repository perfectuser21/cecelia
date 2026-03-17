#!/usr/bin/env node
/**
 * check-rci-health.mjs
 *
 * 检查 regression-contract.yaml 的健康状态：
 * 1. 无重复 ID
 * 2. method: auto 条目的 test 字段引用文件必须存在
 * 3. known-failures.json 无过期条目
 * 4. 孤儿测试检测：tests/ 下存在但 RCI 未引用的测试文件
 *
 * 用法：
 *   node scripts/devgate/check-rci-health.mjs
 *   node scripts/devgate/check-rci-health.mjs --check missing-files
 *   node scripts/devgate/check-rci-health.mjs --check duplicate-ids
 *   node scripts/devgate/check-rci-health.mjs --check known-failures
 *   node scripts/devgate/check-rci-health.mjs --check orphan-tests
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const RCI_FILE = path.join(PROJECT_ROOT, 'regression-contract.yaml');
const KNOWN_FAILURES_FILE = path.join(PROJECT_ROOT, 'ci/known-failures.json');

// ─── ANSI colors ────────────────────────────────────────────────────────────
const GREEN = '\x1b[0;32m';
const RED = '\x1b[0;31m';
const YELLOW = '\x1b[0;33m';
const CYAN = '\x1b[0;36m';
const NC = '\x1b[0m';

// ─── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const checkFlag = args.indexOf('--check');
const specificCheck = checkFlag >= 0 ? args[checkFlag + 1] : null;

// ─── Check 1: Duplicate IDs ──────────────────────────────────────────────────
function checkDuplicateIds(content) {
  const ids = [];
  const idPattern = /^  - id:\s+(\S+)/gm;
  let m;
  while ((m = idPattern.exec(content)) !== null) {
    ids.push(m[1]);
  }

  const counts = {};
  for (const id of ids) {
    counts[id] = (counts[id] || 0) + 1;
  }
  const duplicates = Object.entries(counts).filter(([, v]) => v > 1);
  return { total: ids.length, duplicates };
}

// ─── Check 2: Missing test files ─────────────────────────────────────────────
function checkMissingFiles(content) {
  // Parse entries: find id + method + test for each entry
  const entryPattern = /  - id:\s+(\S+)[\s\S]*?(?=  - id:|$)/g;
  const missing = [];

  let m;
  while ((m = entryPattern.exec(content)) !== null) {
    const block = m[0];
    const id = m[1];

    // Only check method: auto entries
    if (!/^\s+method:\s+auto/m.test(block)) continue;

    const testMatch = /^\s+test:\s+"(.+)"/m.exec(block);
    if (!testMatch) continue;

    const testVal = testMatch[1];
    // Skip manual: prefixed commands
    if (testVal.startsWith('manual:')) continue;

    const testPath = path.join(PROJECT_ROOT, testVal);
    if (!fs.existsSync(testPath)) {
      missing.push({ id, test: testVal });
    }
  }

  return missing;
}

// ─── Check 3: known-failures expiry ──────────────────────────────────────────
function checkKnownFailuresExpiry() {
  if (!fs.existsSync(KNOWN_FAILURES_FILE)) {
    return { skipped: true, reason: 'known-failures.json not found' };
  }

  const data = JSON.parse(fs.readFileSync(KNOWN_FAILURES_FILE, 'utf8'));
  const allowed = data.allowed || {};
  const today = new Date().toISOString().split('T')[0];

  const expired = [];
  const noExpiry = [];

  for (const [key, entry] of Object.entries(allowed)) {
    if (!entry.expires) {
      noExpiry.push({ key, description: entry.description });
    } else if (entry.expires < today) {
      expired.push({ key, expires: entry.expires, description: entry.description });
    }
  }

  return { expired, noExpiry, total: Object.keys(allowed).length, today };
}

// ─── Check 4: Orphan test files ──────────────────────────────────────────────
function checkOrphanTests(content) {
  const TESTS_DIR = path.join(PROJECT_ROOT, 'tests');
  if (!fs.existsSync(TESTS_DIR)) {
    return { skipped: true, reason: 'tests/ directory not found' };
  }

  // Collect all test file references from RCI
  const referencedTests = new Set();
  const testRefPattern = /^\s+test:\s+"(?!manual:)(.+\.(test\.ts|test\.sh|spec\.ts))"/gm;
  let m;
  while ((m = testRefPattern.exec(content)) !== null) {
    referencedTests.add(m[1]);
  }

  // Walk tests/ directory and find .test.ts / .test.sh files
  const orphans = [];
  function walk(dir, base) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(base, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (/\.(test\.ts|test\.sh|spec\.ts)$/.test(entry.name)) {
        const rciRef = `tests/${relPath}`;
        if (!referencedTests.has(rciRef)) {
          orphans.push(rciRef);
        }
      }
    }
  }
  walk(TESTS_DIR, '');

  return { orphans, referencedCount: referencedTests.size };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  RCI Health Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  if (!fs.existsSync(RCI_FILE)) {
    console.error(`${RED}❌ regression-contract.yaml not found: ${RCI_FILE}${NC}`);
    process.exit(1);
  }

  const content = fs.readFileSync(RCI_FILE, 'utf8');
  let hasErrors = false;

  // ── Check 1: Duplicate IDs ──────────────────────────────────────────────────
  if (!specificCheck || specificCheck === 'duplicate-ids') {
    const { total, duplicates } = checkDuplicateIds(content);
    if (duplicates.length > 0) {
      console.log(`${RED}❌ 重复 ID 检查: FAIL${NC}`);
      console.log(`   发现 ${duplicates.length} 组重复 ID:`);
      for (const [id, count] of duplicates) {
        console.log(`   ${YELLOW}  ${id} (出现 ${count} 次)${NC}`);
      }
      hasErrors = true;
    } else {
      console.log(`${GREEN}✅ 重复 ID 检查: PASS (${total} 个唯一 ID)${NC}`);
    }
  }

  // ── Check 2: Missing test files ─────────────────────────────────────────────
  if (!specificCheck || specificCheck === 'missing-files') {
    const missing = checkMissingFiles(content);
    if (missing.length > 0) {
      console.log(`${RED}❌ Test 文件存在性检查: FAIL${NC}`);
      console.log(`   发现 ${missing.length} 个 method:auto 条目引用不存在的 test 文件:`);
      for (const { id, test } of missing) {
        console.log(`   ${YELLOW}  ${id}: ${test}${NC}`);
      }
      hasErrors = true;
    } else {
      console.log(`${GREEN}✅ Test 文件存在性检查: PASS${NC}`);
    }
  }

  // ── Check 3: known-failures expiry ──────────────────────────────────────────
  if (!specificCheck || specificCheck === 'known-failures') {
    const result = checkKnownFailuresExpiry();
    if (result.skipped) {
      console.log(`${YELLOW}⚠️  Known-failures 检查: SKIPPED (${result.reason})${NC}`);
    } else {
      if (result.expired.length > 0) {
        console.log(`${RED}❌ Known-failures 过期检查: FAIL${NC}`);
        console.log(`   发现 ${result.expired.length} 个过期条目 (today=${result.today}):`);
        for (const { key, expires, description } of result.expired) {
          console.log(`   ${YELLOW}  ${key} (过期: ${expires}): ${description}${NC}`);
        }
        hasErrors = true;
      } else {
        console.log(`${GREEN}✅ Known-failures 过期检查: PASS (${result.total} 个条目，均未过期，today=${result.today})${NC}`);
      }
      if (result.noExpiry.length > 0) {
        console.log(`${YELLOW}⚠️  发现 ${result.noExpiry.length} 个无 expires 字段的条目（建议添加）:${NC}`);
        for (const { key } of result.noExpiry) {
          console.log(`   ${CYAN}  ${key}${NC}`);
        }
      }
    }
  }

  // ── Check 4: Orphan test files ──────────────────────────────────────────────
  if (!specificCheck || specificCheck === 'orphan-tests') {
    const result = checkOrphanTests(content);
    if (result.skipped) {
      console.log(`${YELLOW}⚠️  孤儿测试检查: SKIPPED (${result.reason})${NC}`);
    } else if (result.orphans.length > 0) {
      console.log(`${YELLOW}⚠️  孤儿测试检查: WARNING (${result.orphans.length} 个测试文件未被 RCI 引用)${NC}`);
      for (const orphan of result.orphans) {
        console.log(`   ${CYAN}  ${orphan}${NC}`);
      }
      console.log(`   ${CYAN}  提示：孤儿测试文件应在 regression-contract.yaml 中登记，或确认是临时文件${NC}`);
    } else {
      console.log(`${GREEN}✅ 孤儿测试检查: PASS (所有测试文件均已被 RCI 引用，引用数: ${result.referencedCount})${NC}`);
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (hasErrors) {
    console.log(`${RED}  ❌ RCI 健康检查: FAIL${NC}`);
    process.exit(1);
  } else {
    console.log(`${GREEN}  ✅ RCI 健康检查: PASS${NC}`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main();
