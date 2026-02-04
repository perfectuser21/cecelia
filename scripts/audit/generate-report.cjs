#!/usr/bin/env node
/**
 * Generate Audit Report
 *
 * 聚合所有审计结果，生成结构化的 AUDIT-REPORT.md
 *
 * Usage:
 *   node scripts/audit/generate-report.js [--base <branch>] [--head <commit>] [--output <path>]
 *
 * Output:
 *   Writes to docs/AUDIT-REPORT.md by default
 */

const { execSync } = require('child_process');
const fs = require('fs');
const { DEFAULT_BASE_BRANCH, DEFAULT_HEAD_REF } = require('../lib/constants.cjs');

const args = process.argv.slice(2);
let base = DEFAULT_BASE_BRANCH;
let head = DEFAULT_HEAD_REF;
let outputPath = 'docs/AUDIT-REPORT.md';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) {
    base = args[i + 1];
    i++;
  } else if (args[i] === '--head' && args[i + 1]) {
    head = args[i + 1];
    i++;
  } else if (args[i] === '--output' && args[i + 1]) {
    outputPath = args[i + 1];
    i++;
  }
}

function getCurrentBranch() {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  } catch (error) {
    return 'unknown';
  }
}

function getChangedFiles() {
  try {
    const diff = execSync(`git diff --name-only ${base}...${head}`, { encoding: 'utf-8' });
    return diff.split('\n').filter(Boolean);
  } catch (error) {
    return [];
  }
}

function runScript(script) {
  try {
    const output = execSync(`node ${script} --base ${base} --head ${head}`, { encoding: 'utf-8' });
    return JSON.parse(output);
  } catch (error) {
    // Script may exit with non-zero, but still output valid JSON
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch (parseError) {
        return { error: 'Failed to parse output', raw: error.stdout };
      }
    }
    return { error: error.message };
  }
}

function generateReport() {
  const branch = getCurrentBranch();
  const date = new Date().toISOString().split('T')[0];
  const changedFiles = getChangedFiles();

  // Run all audit checks
  const scopeCheck = runScript('scripts/audit/compare-scope.cjs');
  const forbiddenCheck = runScript('scripts/audit/check-forbidden.cjs');
  const proofCheck = runScript('scripts/audit/check-proof.cjs');

  // Determine overall decision
  const scopePass = scopeCheck.scopeCheck?.pass ?? scopeCheck.pass ?? false;
  const forbiddenPass = forbiddenCheck.pass ?? false;
  const proofPass = proofCheck.pass ?? false;
  const overallPass = scopePass && forbiddenPass && proofPass;

  // Generate findings
  const findings = [];
  let findingId = 1;

  if (!scopePass && scopeCheck.scopeCheck?.extraChanges) {
    for (const file of scopeCheck.scopeCheck.extraChanges) {
      findings.push({
        id: `A1-${String(findingId).padStart(3, '0')}`,
        layer: 'L2',
        file,
        issue: 'File changed outside of allowed scope',
        fix: 'Either add to scope or revert changes',
        status: 'pending'
      });
      findingId++;
    }
  }

  if (!forbiddenPass && forbiddenCheck.forbiddenTouched) {
    for (const file of forbiddenCheck.forbiddenTouched) {
      findings.push({
        id: `A1-${String(findingId).padStart(3, '0')}`,
        layer: 'L1',
        file,
        issue: 'Touched forbidden area',
        fix: 'Revert changes to forbidden files',
        status: 'pending'
      });
      findingId++;
    }
  }

  if (!proofPass && proofCheck.failedTests) {
    for (const test of proofCheck.failedTests) {
      findings.push({
        id: `A2-${String(findingId).padStart(3, '0')}`,
        layer: 'L2',
        file: test.location || 'N/A',
        issue: `Test failed: ${test.test}`,
        fix: test.reason,
        status: 'pending'
      });
      findingId++;
    }
  }

  // Count by layer
  const summary = {
    L1: findings.filter(f => f.layer === 'L1').length,
    L2: findings.filter(f => f.layer === 'L2').length,
    L3: 0,
    L4: 0
  };

  const blockers = findings.filter(f => f.layer === 'L1' || f.layer === 'L2').map(f => f.id);

  // Generate markdown report
  const report = `# Audit Report

Branch: ${branch}
Date: ${date}
Scope: ${changedFiles.join(', ')}
Target Level: L2

## Summary

- L1 (Blocking): ${summary.L1}
- L2 (Functional): ${summary.L2}
- L3 (Best Practice): ${summary.L3}
- L4 (Over-optimization): ${summary.L4}

## Decision

Decision: ${overallPass ? 'PASS' : 'FAIL'}

${overallPass ? 'All checks passed. Safe to proceed.' : 'Blockers found. Must fix before proceeding.'}

## Checks

### Scope Check
- Status: ${scopePass ? '✅ PASS' : '❌ FAIL'}
- Details: ${scopeCheck.scopeCheck?.extraChanges?.length || 0} file(s) outside scope

### Forbidden Check
- Status: ${forbiddenPass ? '✅ PASS' : '❌ FAIL'}
- Details: ${forbiddenCheck.forbiddenTouched?.length || 0} forbidden file(s) touched

### Proof Check
- Status: ${proofPass ? '✅ PASS' : '❌ FAIL'}
- Details: ${proofCheck.passedTests || 0}/${proofCheck.totalTests || 0} tests verified

## Findings

${findings.length === 0 ? 'No issues found.' : findings.map(f => `
### ${f.id} - ${f.layer}
- **File**: ${f.file}
- **Issue**: ${f.issue}
- **Fix**: ${f.fix}
- **Status**: ${f.status}
`).join('\n')}

## Blockers

${blockers.length === 0 ? 'None' : blockers.map(id => `- ${id}`).join('\n')}

---

Generated: ${new Date().toISOString()}
`;

  return { report, overallPass };
}

function main() {
  const { report, overallPass } = generateReport();

  // Write report to file
  fs.writeFileSync(outputPath, report, 'utf-8');

  console.log(JSON.stringify({
    success: true,
    outputPath,
    decision: overallPass ? 'PASS' : 'FAIL'
  }, null, 2));

  process.exit(overallPass ? 0 : 1);
}

main();
