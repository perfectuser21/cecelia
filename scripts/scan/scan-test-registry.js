#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const TARGET_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/cecelia';
const SCAN_REPO_ROOT = path.resolve(process.env.SCAN_REPO_ROOT || path.resolve(__dirname, '../..'));
const SCAN_REPO_NAME = process.env.SCAN_REPO_NAME || 'cecelia';
const SCANNER_VERSION = 'test-registry-v2';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.worktrees']);

function inferType(filePath) {
  if (/e2e|\.spec\./i.test(filePath)) return 'e2e';
  if (/integration/i.test(filePath)) return 'integration';
  return 'unit';
}

function scanDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      results.push(...scanDir(full));
    } else if (entry.isFile() && /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      const coveredBehaviors = [];
      const testRe = /(?:it|test)\s*\(\s*['"`]([^'"`]{3,100})['"`]/g;
      let match;
      while ((match = testRe.exec(content)) !== null) coveredBehaviors.push(match[1]);
      results.push({
        file_path: path.relative(SCAN_REPO_ROOT, full),
        test_count: coveredBehaviors.length,
        covered_behaviors: coveredBehaviors,
        area: SCAN_REPO_NAME,
        test_type: inferType(full),
      });
    }
  }
  return results;
}

async function main() {
  if (!fs.existsSync(SCAN_REPO_ROOT)) throw new Error(`scanner root 不存在: ${SCAN_REPO_ROOT}`);
  const [{ replaceFactSnapshot }, { readGitRevision }] = await Promise.all([
    import('../../packages/brain/src/lib/fact-snapshot-store.js'),
    import('../../packages/brain/src/lib/git-revision.js'),
  ]);
  const pool = new pg.Pool({ connectionString: TARGET_DATABASE_URL });
  try {
    const files = scanDir(SCAN_REPO_ROOT);
    const sourceRevision = readGitRevision(SCAN_REPO_ROOT);
    await replaceFactSnapshot(pool, 'test', {
      repo: SCAN_REPO_NAME,
      sourceRevision,
      scannerVersion: SCANNER_VERSION,
      rows: files,
    });
    console.log(`test_registry repo=${SCAN_REPO_NAME} rows=${files.length} revision=${sourceRevision.slice(0, 8)}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
