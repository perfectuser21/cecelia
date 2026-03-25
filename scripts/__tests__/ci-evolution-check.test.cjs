'use strict';
/**
 * ci-evolution-check.test.cjs
 * 验证 Check 4（基础设施路径注册校验）的核心逻辑：
 *   - scripts/devgate、ci、.github/workflows 均已在 routing-map.yml 注册
 *   - ci-evolution-check.mjs 整体运行 exit 0
 */

const { execSync } = require('child_process');
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

console.log('ci-evolution-check Check 4 — 测试套件');
console.log('─'.repeat(50));

// ── routing-map.yml 条目验证 ────────────────────────────────────────────────

const routingMapPath = resolve(ROOT, 'ci/routing-map.yml');
const routingContent = existsSync(routingMapPath)
  ? readFileSync(routingMapPath, 'utf8')
  : '';

test('routing-map.yml 包含 devgate-core 条目', () => {
  assert(routingContent.includes('devgate-core:'), '缺少 devgate-core 条目');
  assert(
    routingContent.includes('root: scripts/devgate'),
    'devgate-core root 路径不正确'
  );
});

test('routing-map.yml 包含 ci-helpers 条目', () => {
  assert(routingContent.includes('ci-helpers:'), '缺少 ci-helpers 条目');
  assert(
    routingContent.includes('root: scripts'),
    'ci-helpers root 路径不正确'
  );
});

test('routing-map.yml 包含 ci-configuration 条目', () => {
  assert(routingContent.includes('ci-configuration:'), '缺少 ci-configuration 条目');
  assert(
    routingContent.includes('root: ci'),
    'ci-configuration root 路径不正确'
  );
});

test('routing-map.yml 包含 github-workflows 条目', () => {
  assert(routingContent.includes('github-workflows:'), '缺少 github-workflows 条目');
  assert(
    routingContent.includes('root: .github/workflows'),
    'github-workflows root 路径不正确'
  );
});

// ── ci-evolution-check.mjs 包含 Check 4 ────────────────────────────────────

const checkScriptPath = resolve(ROOT, 'scripts/ci-evolution-check.mjs');
const checkContent = existsSync(checkScriptPath)
  ? readFileSync(checkScriptPath, 'utf8')
  : '';

test('ci-evolution-check.mjs 包含 Check 4 基础设施路径校验', () => {
  assert(checkContent.includes('Check 4'), '缺少 Check 4 注释/输出');
  assert(checkContent.includes('INFRASTRUCTURE_PATHS'), '缺少 INFRASTRUCTURE_PATHS 常量');
  assert(checkContent.includes('scripts/devgate'), 'Check 4 未覆盖 scripts/devgate');
  assert(checkContent.includes('.github/workflows'), 'Check 4 未覆盖 .github/workflows');
});

// ── 整体运行 exit 0 ─────────────────────────────────────────────────────────

test('node scripts/ci-evolution-check.mjs 整体 exit 0', () => {
  try {
    execSync('node scripts/ci-evolution-check.mjs', {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } catch (e) {
    throw new Error(`exit code ${e.status}: ${e.stderr?.toString()?.slice(0, 200)}`);
  }
});

// ── 结果 ────────────────────────────────────────────────────────────────────

console.log('─'.repeat(50));
console.log(`结果: ${passed} 通过, ${failed} 失败`);

if (failed > 0) {
  process.exit(1);
}
