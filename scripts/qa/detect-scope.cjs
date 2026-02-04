#!/usr/bin/env node
/**
 * Detect Scope
 *
 * 根据变更文件自动建议允许的 Scope
 */

const { execSync } = require('child_process');
const { DEFAULT_BASE_BRANCH, DEFAULT_HEAD_REF } = require('../lib/constants.cjs');

const args = process.argv.slice(2);
let base = DEFAULT_BASE_BRANCH;
let head = DEFAULT_HEAD_REF;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) {
    base = args[i + 1];
    i++;
  } else if (args[i] === '--head' && args[i + 1]) {
    head = args[i + 1];
    i++;
  }
}

function getChangedFiles() {
  try {
    const diff = execSync(`git diff --name-only ${base}...${head}`, { encoding: 'utf-8' });
    return diff.split('\n').filter(Boolean);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

function main() {
  const files = getChangedFiles();

  // 提取目录模式
  const dirs = new Set();
  const exactFiles = [];

  for (const file of files) {
    const parts = file.split('/');
    if (parts.length > 1) {
      dirs.add(parts[0] + '/*');
    }
    exactFiles.push(file);
  }

  const output = {
    scope: Array.from(dirs),
    exactFiles,
    recommendation: 'Review and adjust scope as needed'
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
