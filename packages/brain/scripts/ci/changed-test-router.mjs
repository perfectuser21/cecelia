#!/usr/bin/env node
// changed-test-router.mjs — maps changed files to relevant test paths
// Usage: node changed-test-router.mjs --files <file1> [file2...]

const args = process.argv.slice(2);
const filesIdx = args.indexOf('--files');
if (filesIdx === -1) {
  console.error('Usage: changed-test-router.mjs --files <file1> [file2...]');
  process.exit(1);
}

const files = args.slice(filesIdx + 1).filter(f => f && !f.startsWith('--'));

const testPaths = new Set();

for (const file of files) {
  // packages/workflows/skills/** → skill contract tests (不得输出通用 packages/brain/tests/**/* 通配)
  if (file.startsWith('packages/workflows/skills/')) {
    testPaths.add('packages/brain/tests/skill-contracts/evaluator-invariants.test.ts');
  }

  // packages/brain/src/** or packages/brain/tests/** → handled by brain-unit shard matrix
  // (no specific mapping needed here; brain-unit uses --changed flag)

  // sprints/**/tests/** → sprint-specific tests (included via brain vitest config)
}

console.log(JSON.stringify([...testPaths]));
