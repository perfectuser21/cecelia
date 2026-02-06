#!/usr/bin/env node
/**
 * check-dod-mapping.cjs
 *
 * Checks that each DoD item in .dod.md has a non-empty Test mapping.
 * Adapted from Engine's scripts/devgate/check-dod-mapping.cjs (simplified).
 *
 * Core doesn't have regression-contract or evidence system,
 * so only checks for non-empty Test 映射 column.
 *
 * Usage: node scripts/devgate/check-dod-mapping.cjs [dod-file]
 * Default: .dod.md
 *
 * Exit codes:
 *   0 - All DoD items have test mappings
 *   1 - Some items missing test mappings
 *   2 - File not found or parse error
 */

const fs = require('fs');
const path = require('path');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const dodFile = process.argv[2] || '.dod.md';
const dodPath = path.resolve(process.cwd(), dodFile);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  DoD-Test Mapping Check (Core)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// Read file
if (!fs.existsSync(dodPath)) {
  console.log(`${YELLOW}⚠️  ${dodFile} not found, skipping${RESET}`);
  process.exit(0);
}

const content = fs.readFileSync(dodPath, 'utf-8');
const lines = content.split('\n');

// Find markdown table with DoD items
// Expected format: | # | DoD 条目 | Test 映射 | 验证方式 |
let headerIdx = -1;
let testColIdx = -1;
let dodColIdx = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line.startsWith('|')) continue;

  const cols = line.split('|').map(c => c.trim()).filter(c => c !== '');

  // Look for header row with "Test" or "Test 映射" column
  const testIdx = cols.findIndex(c => /test/i.test(c));
  const dodIdx = cols.findIndex(c => /dod|条目|验收/i.test(c));

  if (testIdx >= 0 && dodIdx >= 0) {
    headerIdx = i;
    testColIdx = testIdx;
    dodColIdx = dodIdx;
    break;
  }
}

if (headerIdx < 0) {
  console.log(`${YELLOW}⚠️  No DoD table found in ${dodFile}, skipping${RESET}`);
  process.exit(0);
}

// Parse data rows (skip header + separator)
let errors = 0;
let total = 0;

for (let i = headerIdx + 2; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line.startsWith('|')) break; // End of table

  const cols = line.split('|').map(c => c.trim()).filter(c => c !== '');
  if (cols.length <= testColIdx) continue;

  const dodItem = cols[dodColIdx] || '';
  const testMapping = cols[testColIdx] || '';

  if (!dodItem) continue; // Skip empty rows
  total++;

  // Check test mapping is non-empty and not just whitespace/placeholder
  const cleaned = testMapping.replace(/`/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === 'N/A' || cleaned === '无') {
    console.log(`  ${RED}❌${RESET} #${total}: "${dodItem.substring(0, 50)}..." → ${RED}missing test mapping${RESET}`);
    errors++;
  } else {
    console.log(`  ${GREEN}✅${RESET} #${total}: "${dodItem.substring(0, 50)}..." → ${cleaned.substring(0, 40)}`);
  }
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (total === 0) {
  console.log(`  ${YELLOW}⚠️  No DoD items found${RESET}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
}

if (errors > 0) {
  console.log(`  ${RED}❌ ${errors}/${total} items missing test mapping${RESET}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
} else {
  console.log(`  ${GREEN}✅ All ${total} DoD items have test mappings${RESET}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
}
