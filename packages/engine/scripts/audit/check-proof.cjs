#!/usr/bin/env node
/**
 * Check Proof
 *
 * 验证测试证据是否完成（检查 Tests 字段对应的测试位置）
 *
 * Usage:
 *   node scripts/audit/check-proof.js [--qa-decision <path>]
 *
 * Output (JSON):
 *   {
 *     "pass": true,
 *     "totalTests": 5,
 *     "passedTests": 5,
 *     "failedTests": [],
 *     "details": "All tests verified"
 *   }
 */

const fs = require('fs');
const { execSync } = require('child_process');
const { QA_DECISION_PATH } = require('../lib/constants.cjs');

const args = process.argv.slice(2);
let qaDecisionPath = QA_DECISION_PATH;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--qa-decision' && args[i + 1]) {
    qaDecisionPath = args[i + 1];
    i++;
  }
}

function parseQADecision() {
  if (!fs.existsSync(qaDecisionPath)) {
    return { tests: [] };
  }

  const content = fs.readFileSync(qaDecisionPath, 'utf-8');

  // Parse Tests section (YAML-like format)
  const testsMatch = content.match(/Tests:\n([\s\S]*?)(?=\n[A-Z][a-z]+:|$)/);
  if (!testsMatch) {
    return { tests: [] };
  }

  const testsBlock = testsMatch[1];
  const tests = [];
  let currentTest = null;

  for (const line of testsBlock.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- dod_item:')) {
      if (currentTest) tests.push(currentTest);
      currentTest = { dod_item: trimmed.replace(/^- dod_item:\s*["']?/, '').replace(/["']$/, '') };
    } else if (trimmed.startsWith('method:') && currentTest) {
      currentTest.method = trimmed.replace(/^method:\s*/, '');
    } else if (trimmed.startsWith('location:') && currentTest) {
      currentTest.location = trimmed.replace(/^location:\s*/, '');
    }
  }
  if (currentTest) tests.push(currentTest);

  return { tests };
}

function verifyTest(test) {
  if (test.method === 'manual') {
    // Manual tests - assume passed if defined
    return { pass: true, reason: 'Manual test defined' };
  }

  if (test.method === 'auto') {
    // Auto tests - check if file exists
    const location = test.location;
    if (!location) {
      return { pass: false, reason: 'No location specified' };
    }

    if (fs.existsSync(location)) {
      return { pass: true, reason: 'Test file exists' };
    } else {
      return { pass: false, reason: `Test file not found: ${location}` };
    }
  }

  return { pass: false, reason: 'Unknown test method' };
}

function main() {
  const { tests } = parseQADecision();

  if (tests.length === 0) {
    console.log(JSON.stringify({
      pass: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: [],
      details: 'No tests defined in QA-DECISION.md'
    }, null, 2));
    process.exit(1);
  }

  const results = tests.map(test => ({
    test: test.dod_item,
    method: test.method,
    location: test.location,
    ...verifyTest(test)
  }));

  const passedTests = results.filter(r => r.pass);
  const failedTests = results.filter(r => !r.pass);

  const output = {
    pass: failedTests.length === 0,
    totalTests: tests.length,
    passedTests: passedTests.length,
    failedTests: failedTests.map(t => ({
      test: t.test,
      reason: t.reason
    })),
    details: failedTests.length === 0
      ? 'All tests verified'
      : `${failedTests.length} test(s) failed verification`,
    results
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(output.pass ? 0 : 1);
}

main();
