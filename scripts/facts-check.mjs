#!/usr/bin/env node
/**
 * facts-check.mjs — Extract key facts from code and validate against DEFINITION.md
 *
 * Prevents documentation drift by machine-checking that DEFINITION.md matches
 * the actual constants, counts, and values in source code.
 *
 * Usage: node scripts/facts-check.mjs
 * Exit code: 0 = all consistent, 1 = mismatches found
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BRAIN = resolve(ROOT, 'brain');

// ─── Helpers ────────────────────────────────────────────────

function readFile(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf-8');
}

function findLineNumber(content, pattern) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (typeof pattern === 'string' ? lines[i].includes(pattern) : pattern.test(lines[i])) {
      return i + 1;
    }
  }
  return null;
}

// ─── Fact extractors ────────────────────────────────────────

function extractBrainPort() {
  const src = readFile('brain/server.js');
  const match = src.match(/const PORT\s*=\s*.*\|\|\s*(\d+)/);
  return {
    name: 'brain_port',
    value: match ? parseInt(match[1], 10) : null,
    source: 'brain/server.js',
    line: findLineNumber(src, 'const PORT'),
  };
}

function extractVersion() {
  const pkg = JSON.parse(readFile('brain/package.json'));
  return {
    name: 'brain_version',
    value: pkg.version,
    source: 'brain/package.json',
    line: findLineNumber(readFile('brain/package.json'), '"version"'),
  };
}

function extractTickLoopMs() {
  const src = readFile('brain/src/tick.js');
  const match = src.match(/TICK_LOOP_INTERVAL_MS\s*=\s*parseInt\([^|]*\|\|\s*'(\d+)'/);
  return {
    name: 'tick_loop_ms',
    value: match ? parseInt(match[1], 10) : null,
    source: 'brain/src/tick.js',
    line: findLineNumber(src, 'TICK_LOOP_INTERVAL_MS'),
  };
}

function extractTickIntervalMin() {
  const src = readFile('brain/src/tick.js');
  const match = src.match(/TICK_INTERVAL_MINUTES\s*=\s*(\d+)/);
  return {
    name: 'tick_interval_min',
    value: match ? parseInt(match[1], 10) : null,
    source: 'brain/src/tick.js',
    line: findLineNumber(src, 'TICK_INTERVAL_MINUTES'),
  };
}

function extractTaskTypes() {
  const src = readFile('brain/src/task-router.js');
  // Extract keys from LOCATION_MAP — only the key before the colon on each line
  const mapMatch = src.match(/const LOCATION_MAP\s*=\s*\{([^}]+)\}/s);
  if (!mapMatch) return { name: 'task_types', value: null, source: 'brain/src/task-router.js', line: null };
  // Match pattern: 'key': 'value' — capture only the key
  const keys = [...mapMatch[1].matchAll(/'(\w+)'\s*:/g)].map(m => m[1]);
  return {
    name: 'task_types',
    value: keys.sort().join(','),
    source: 'brain/src/task-router.js',
    line: findLineNumber(src, 'LOCATION_MAP'),
  };
}

function extractActionCount() {
  const src = readFile('brain/src/thalamus.js');
  const mapMatch = src.match(/const ACTION_WHITELIST\s*=\s*\{([\s\S]*?)\n\};/);
  if (!mapMatch) return { name: 'action_count', value: null, source: 'brain/src/thalamus.js', line: null };
  // Match 'action_name': { pattern — only keys
  const keys = [...mapMatch[1].matchAll(/'(\w+)'\s*:/g)].map(m => m[1]);
  return {
    name: 'action_count',
    value: keys.length,
    source: 'brain/src/thalamus.js',
    line: findLineNumber(src, 'ACTION_WHITELIST'),
  };
}

function extractCortexActionCount() {
  const src = readFile('brain/src/cortex.js');
  // Cortex adds extra actions on top of ACTION_WHITELIST via spread
  // Count only the NEW actions (not the ...ACTION_WHITELIST spread)
  const mapMatch = src.match(/const CORTEX_ACTION_WHITELIST\s*=\s*\{([\s\S]*?)\n\};/);
  if (!mapMatch) return { name: 'cortex_extra_actions', value: null, source: 'brain/src/cortex.js', line: null };
  // Count lines with 'key': { ... } pattern, excluding the spread
  const extraKeys = [...mapMatch[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  return {
    name: 'cortex_extra_actions',
    value: extraKeys.length,
    source: 'brain/src/cortex.js',
    line: findLineNumber(src, 'CORTEX_ACTION_WHITELIST'),
  };
}

function extractSchemaVersion() {
  const src = readFile('brain/src/selfcheck.js');
  const match = src.match(/EXPECTED_SCHEMA_VERSION\s*=\s*'(\d+)'/);
  return {
    name: 'schema_version',
    value: match ? match[1] : null,
    source: 'brain/src/selfcheck.js',
    line: findLineNumber(src, 'EXPECTED_SCHEMA_VERSION'),
  };
}

// ─── Doc validators ─────────────────────────────────────────

function validateFacts(facts) {
  const doc = readFile('DEFINITION.md');
  const results = [];
  let hasFailure = false;

  for (const fact of facts) {
    if (fact.value === null) {
      results.push({ ...fact, status: 'error', message: 'Could not extract from code' });
      hasFailure = true;
      continue;
    }

    let docMatch = false;
    let docLine = null;
    let docValue = null;

    switch (fact.name) {
      case 'brain_port': {
        // Check "port 5221" or ":5221"
        const re = new RegExp(`port\\s+${fact.value}|:${fact.value}`, 'i');
        docMatch = re.test(doc);
        docLine = findLineNumber(doc, re);
        docValue = docMatch ? String(fact.value) : 'not found';
        break;
      }

      case 'brain_version': {
        // Check "Brain 版本: X.Y.Z" in frontmatter
        const re = new RegExp(`Brain\\s+版本.*${fact.value.replace(/\./g, '\\.')}`);
        docMatch = re.test(doc);
        docLine = findLineNumber(doc, re);
        docValue = docMatch ? fact.value : (() => {
          const m = doc.match(/Brain\s+版本[^:]*:\s*(\S+)/);
          return m ? m[1] : 'not found';
        })();
        break;
      }

      case 'tick_loop_ms': {
        // Check "5s 循环" or "每 5s"
        const expectedSec = fact.value / 1000;
        const re = new RegExp(`${expectedSec}s\\s*循环|每\\s*${expectedSec}s`);
        docMatch = re.test(doc);
        docLine = findLineNumber(doc, re);
        docValue = docMatch ? `${expectedSec}s` : 'not matched';
        break;
      }

      case 'tick_interval_min': {
        // Check "5min 执行" or "每 5min"
        const re = new RegExp(`${fact.value}min\\s*执行|每\\s*${fact.value}min`);
        docMatch = re.test(doc);
        docLine = findLineNumber(doc, re);
        docValue = docMatch ? `${fact.value}min` : 'not matched';
        break;
      }

      case 'task_types': {
        // Check all task types appear in the type table
        const types = fact.value.split(',');
        const missing = types.filter(t => {
          // Look for "| type |" pattern in the table
          return !new RegExp(`\\|\\s*${t}\\s*\\|`).test(doc);
        });
        docMatch = missing.length === 0;
        docLine = findLineNumber(doc, /任务类型与路由/);
        docValue = docMatch ? fact.value : `missing: ${missing.join(',')}`;
        break;
      }

      case 'action_count': {
        // Check "N 个白名单 action" or "N 个 action"
        const re = new RegExp(`${fact.value}\\s*个.*(?:白名单|action)`, 'i');
        docMatch = re.test(doc);
        docLine = findLineNumber(doc, re);
        docValue = docMatch ? String(fact.value) : (() => {
          const m = doc.match(/(\d+)\s*个.*(?:白名单|action)/i);
          return m ? m[1] : 'not found';
        })();
        break;
      }

      case 'cortex_extra_actions': {
        // Check "皮层额外 N 个 action"
        const re = new RegExp(`皮层.*${fact.value}\\s*个\\s*action|额外\\s*${fact.value}\\s*个`);
        docMatch = re.test(doc);
        docLine = findLineNumber(doc, /皮层额外/);
        docValue = docMatch ? String(fact.value) : (() => {
          const m = doc.match(/皮层.*?(\d+)\s*个\s*action|额外\s*(\d+)\s*个/);
          return m ? (m[1] || m[2]) : 'not found';
        })();
        break;
      }

      case 'schema_version': {
        // Check "Schema 版本: 008" or "schema v008"
        const re = new RegExp(`[Ss]chema.*${fact.value}|v${fact.value}`);
        docMatch = re.test(doc);
        docLine = findLineNumber(doc, re);
        docValue = docMatch ? fact.value : (() => {
          const m = doc.match(/Schema\s+版本[^:]*:\s*(\S+)/);
          return m ? m[1] : 'not found';
        })();
        break;
      }
    }

    results.push({
      ...fact,
      status: docMatch ? 'pass' : 'fail',
      docLine,
      docValue,
    });

    if (!docMatch) hasFailure = true;
  }

  return { results, hasFailure };
}

// ─── Main ───────────────────────────────────────────────────

const facts = [
  extractBrainPort(),
  extractVersion(),
  extractTickLoopMs(),
  extractTickIntervalMin(),
  extractTaskTypes(),
  extractActionCount(),
  extractCortexActionCount(),
  extractSchemaVersion(),
];

const { results, hasFailure } = validateFacts(facts);

// Output
for (const r of results) {
  const icon = r.status === 'pass' ? '✓' : '✗';
  const srcRef = r.line ? `${r.source}:${r.line}` : r.source;
  if (r.status === 'pass') {
    console.log(`  ${icon} ${r.name}: ${r.value} (${srcRef})`);
  } else if (r.status === 'error') {
    console.log(`  ${icon} ${r.name}: ${r.message} (${srcRef})`);
  } else {
    const docRef = r.docLine ? `DEFINITION.md:${r.docLine}` : 'DEFINITION.md';
    console.log(`  ${icon} ${r.name}: code=${r.value} (${srcRef}) ≠ doc=${r.docValue} (${docRef})`);
  }
}

if (hasFailure) {
  console.log('\nFacts check FAILED — DEFINITION.md is out of sync with code.');
  process.exit(1);
} else {
  console.log('\nAll facts consistent.');
  process.exit(0);
}
