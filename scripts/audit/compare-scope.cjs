#!/usr/bin/env node
/**
 * Compare Scope
 *
 * 对比实际改动与 QA-DECISION.md 中允许的 Scope
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
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
    return { scope: [], forbidden: [] };
  }

  const content = fs.readFileSync(qaDecisionPath, 'utf-8');

  // 简单解析（实际应该更严格）
  const scopeMatch = content.match(/## Scope.*?\n([\s\S]*?)(?=\n##|$)/);
  const forbiddenMatch = content.match(/## Forbidden.*?\n([\s\S]*?)(?=\n##|$)/);

  const scope = scopeMatch ? scopeMatch[1].split('\n').filter(l => l.trim().startsWith('-')).map(l => l.replace(/^-\s*/, '').trim()) : [];
  const forbidden = forbiddenMatch ? forbiddenMatch[1].split('\n').filter(l => l.trim().startsWith('-')).map(l => l.replace(/^-\s*/, '').trim()) : [];

  return { scope, forbidden };
}

function matchPattern(file, pattern) {
  // 简单匹配规则
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(file);
  }
  return file === pattern || file.startsWith(pattern);
}

function main() {
  const changedFiles = getChangedFiles();
  const { scope, forbidden } = parseQADecision();

  const extraChanges = [];
  const forbiddenTouched = [];

  for (const file of changedFiles) {
    // 检查是否在允许范围内
    const inScope = scope.length === 0 || scope.some(s => matchPattern(file, s));
    if (!inScope) {
      extraChanges.push(file);
    }

    // 检查是否触碰禁区
    const inForbidden = forbidden.some(f => matchPattern(file, f));
    if (inForbidden) {
      forbiddenTouched.push(file);
    }
  }

  const output = {
    scopeCheck: {
      allowed: scope,
      changed: changedFiles,
      extraChanges,
      pass: extraChanges.length === 0
    },
    forbiddenCheck: {
      forbidden,
      forbiddenTouched,
      pass: forbiddenTouched.length === 0
    },
    overallPass: extraChanges.length === 0 && forbiddenTouched.length === 0
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(output.overallPass ? 0 : 1);
}

main();
