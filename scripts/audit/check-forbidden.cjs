#!/usr/bin/env node
/**
 * Check Forbidden
 *
 * 检查是否触碰了禁止修改的区域
 *
 * Usage:
 *   node scripts/audit/check-forbidden.js [--base <branch>] [--head <commit>] [--qa-decision <path>]
 *
 * Output (JSON):
 *   {
 *     "pass": true,
 *     "forbiddenTouched": [],
 *     "details": "No forbidden areas touched"
 *   }
 */

const { execSync } = require('child_process');
const fs = require('fs');
const { DEFAULT_BASE_BRANCH, DEFAULT_HEAD_REF, QA_DECISION_PATH, debugLog } = require('../lib/constants.cjs');

const args = process.argv.slice(2);
let base = DEFAULT_BASE_BRANCH;
let head = DEFAULT_HEAD_REF;
let qaDecisionPath = QA_DECISION_PATH;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) {
    base = args[i + 1];
    i++;
  } else if (args[i] === '--head' && args[i + 1]) {
    head = args[i + 1];
    i++;
  } else if (args[i] === '--qa-decision' && args[i + 1]) {
    qaDecisionPath = args[i + 1];
    i++;
  }
}

function getChangedFiles() {
  try {
    const diff = execSync(`git diff --name-only ${base}...${head}`, { encoding: 'utf-8' });
    return diff.split('\n').filter(Boolean);
  } catch (error) {
    debugLog('getChangedFiles failed:', error.message);
    return [];
  }
}

function parseQADecision() {
  if (!fs.existsSync(qaDecisionPath)) {
    return { forbidden: [] };
  }

  const content = fs.readFileSync(qaDecisionPath, 'utf-8');

  // Parse Forbidden section
  const forbiddenMatch = content.match(/## Forbidden.*?\n([\s\S]*?)(?=\n##|$)/);
  const forbidden = forbiddenMatch
    ? forbiddenMatch[1].split('\n').filter(l => l.trim().startsWith('-')).map(l => l.replace(/^-\s*/, '').trim())
    : [];

  return { forbidden };
}

function matchPattern(file, pattern) {
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(file);
  }
  return file === pattern || file.startsWith(pattern);
}

function main() {
  const changedFiles = getChangedFiles();
  const { forbidden } = parseQADecision();

  const forbiddenTouched = [];

  for (const file of changedFiles) {
    const inForbidden = forbidden.some(f => matchPattern(file, f));
    if (inForbidden) {
      forbiddenTouched.push(file);
    }
  }

  const output = {
    pass: forbiddenTouched.length === 0,
    forbiddenTouched,
    details: forbiddenTouched.length === 0
      ? 'No forbidden areas touched'
      : `Forbidden areas touched: ${forbiddenTouched.join(', ')}`,
    forbidden: forbidden.length > 0 ? forbidden : ['No forbidden patterns defined']
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(output.pass ? 0 : 1);
}

main();
