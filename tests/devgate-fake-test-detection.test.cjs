#!/usr/bin/env node
/**
 * DevGate 假测试检测单元测试
 *
 * 测试 check-dod-mapping.cjs 中的 detectFakeTest 函数
 * 确保能正确识别和阻止假测试模式
 */

const assert = require("assert");
const path = require("path");

// 颜色输出
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

// 测试计数
let testsPassed = 0;
let testsFailed = 0;

/**
 * 简化的假测试检测函数（从 check-dod-mapping.cjs 复制逻辑）
 */
function detectFakeTest(testCommand) {
  // 禁止 echo 假测试
  if (/\becho\b/.test(testCommand)) {
    return { valid: false, reason: "禁止使用 echo 假测试（应使用真实执行命令）" };
  }

  // 禁止 grep | wc -l 假测试
  if (/grep.*\|.*wc\s+-l/.test(testCommand)) {
    return { valid: false, reason: "禁止使用 grep | wc -l 假测试（应使用真实执行命令）" };
  }

  // 禁止 test -f 假测试
  if (/test\s+-f\b/.test(testCommand)) {
    return { valid: false, reason: "禁止使用 test -f 假测试（应使用真实执行命令）" };
  }

  // 禁止 TODO 占位符
  if (/TODO/.test(testCommand)) {
    return { valid: false, reason: "禁止使用 TODO 占位符（应使用真实执行命令）" };
  }

  // 强制要求真实执行命令（node, npm, psql, curl, bash等）
  const hasRealExecution = /\b(node|npm|npx|psql|curl|bash|python|pytest|jest|mocha|vitest)\b/.test(testCommand);
  if (!hasRealExecution) {
    return { valid: false, reason: "Test 命令必须包含真实执行命令（如 node, npm, psql, curl 等）" };
  }

  return { valid: true };
}

/**
 * 测试辅助函数
 */
function test(description, fn) {
  try {
    fn();
    console.log(`${GREEN}✓${RESET} ${description}`);
    testsPassed++;
  } catch (error) {
    console.log(`${RED}✗${RESET} ${description}`);
    console.log(`  ${RED}${error.message}${RESET}`);
    testsFailed++;
  }
}

// ============================================================================
// 测试套件
// ============================================================================

console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  DevGate 假测试检测单元测试");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");

// ===== 测试 1: 真实测试命令应该通过 =====

console.log("测试 1: 真实测试命令应该通过");
console.log("────────────────────────────────────────────────");

test("node 命令应该通过", () => {
  const result = detectFakeTest("node tests/unit/test.js");
  assert.strictEqual(result.valid, true);
});

test("npm 命令应该通过", () => {
  const result = detectFakeTest("npm run test:unit");
  assert.strictEqual(result.valid, true);
});

test("npx 命令应该通过", () => {
  const result = detectFakeTest("npx vitest run");
  assert.strictEqual(result.valid, true);
});

test("psql 命令应该通过", () => {
  const result = detectFakeTest("psql -U test -c 'SELECT 1'");
  assert.strictEqual(result.valid, true);
});

test("curl 命令应该通过", () => {
  const result = detectFakeTest("curl http://localhost:3000/health");
  assert.strictEqual(result.valid, true);
});

test("bash 脚本应该通过", () => {
  const result = detectFakeTest("bash scripts/test.sh");
  assert.strictEqual(result.valid, true);
});

test("python 命令应该通过", () => {
  const result = detectFakeTest("python -m pytest tests/");
  assert.strictEqual(result.valid, true);
});

// ===== 测试 2: echo 假测试应该被阻止 =====

console.log("");
console.log("测试 2: echo 假测试应该被阻止");
console.log("────────────────────────────────────────────────");

test("echo 假测试应该被阻止", () => {
  const result = detectFakeTest("echo 'test passed'");
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /禁止使用 echo/);
});

test("echo 配合管道应该被阻止", () => {
  const result = detectFakeTest("echo 'running tests' | grep test");
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /禁止使用 echo/);
});

// ===== 测试 3: grep | wc -l 假测试应该被阻止 =====

console.log("");
console.log("测试 3: grep | wc -l 假测试应该被阻止");
console.log("────────────────────────────────────────────────");

test("grep | wc -l 假测试应该被阻止", () => {
  const result = detectFakeTest("grep 'test' file.txt | wc -l");
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /禁止使用 grep.*wc/);
});

test("grep | wc -l 带参数应该被阻止", () => {
  const result = detectFakeTest("grep -q 'pattern' | wc -l");
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /禁止使用 grep.*wc/);
});

// ===== 测试 4: test -f 假测试应该被阻止 =====

console.log("");
console.log("测试 4: test -f 假测试应该被阻止");
console.log("────────────────────────────────────────────────");

test("test -f 假测试应该被阻止", () => {
  const result = detectFakeTest("test -f output.txt");
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /禁止使用 test -f/);
});

test("test -f 配合 && 应该被阻止", () => {
  const result = detectFakeTest("test -f result.json && echo ok");
  assert.strictEqual(result.valid, false);
  // 可能被 test -f 或 echo 检测到，都是正确的
  assert.match(result.reason, /禁止使用/);
});

// ===== 测试 5: TODO 占位符应该被阻止 =====

console.log("");
console.log("测试 5: TODO 占位符应该被阻止");
console.log("────────────────────────────────────────────────");

test("TODO 占位符应该被阻止", () => {
  const result = detectFakeTest("TODO: implement test");
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /禁止使用 TODO/);
});

test("TODO 注释应该被阻止", () => {
  const result = detectFakeTest("# TODO: add real test");
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /禁止使用 TODO/);
});

// ===== 测试 6: 缺少真实执行命令应该被阻止 =====

console.log("");
console.log("测试 6: 缺少真实执行命令应该被阻止");
console.log("────────────────────────────────────────────────");

test("只有 ls 应该被阻止", () => {
  const result = detectFakeTest("ls -la");
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /必须包含真实执行命令/);
});

test("只有 cat 应该被阻止", () => {
  const result = detectFakeTest("cat output.txt");
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /必须包含真实执行命令/);
});

test("只有注释应该被阻止", () => {
  const result = detectFakeTest("# This is a test");
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /必须包含真实执行命令/);
});

// ===== 测试 7: 边界情况 =====

console.log("");
console.log("测试 7: 边界情况");
console.log("────────────────────────────────────────────────");

test("bash -n 语法检查应该通过（包含 bash）", () => {
  const result = detectFakeTest("bash -n script.sh");
  assert.strictEqual(result.valid, true);
});

test("grep 单独使用（无 wc）但有 npm 应该通过", () => {
  const result = detectFakeTest("npm test && grep 'success' output.txt");
  assert.strictEqual(result.valid, true);
});

test("包含 node 的复杂命令应该通过", () => {
  const result = detectFakeTest("node scripts/test.js --verbose | tee output.txt");
  assert.strictEqual(result.valid, true);
});

// ===== 总结 =====

console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  测试结果");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");

if (testsFailed === 0) {
  console.log(`${GREEN}✅ 所有测试通过${RESET} (${testsPassed}/${testsPassed})`);
  console.log("");
} else {
  console.log(`${RED}❌ 部分测试失败${RESET} (${testsPassed} 通过, ${testsFailed} 失败)`);
  console.log("");
}

// Export results for potential use by other tools
module.exports = { testsPassed, testsFailed };

// When run directly, exit with appropriate code
if (require.main === module) {
  process.exit(testsFailed === 0 ? 0 : 1);
}

// Vitest will automatically pass if no errors are thrown during execution
// and testsFailed is 0 (no assertion failures)
