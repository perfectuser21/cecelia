#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const TARGET_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/cecelia';
const SCAN_REPO_ROOT = path.resolve(process.env.SCAN_REPO_ROOT || path.resolve(__dirname, '../..'));
const SCAN_REPO_NAME = process.env.SCAN_REPO_NAME || 'cecelia';
const SCANNER_VERSION = 'api-registry-v2';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.worktrees']);
const ROUTE_RE = /\.(get|post|put|patch|delete|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

function scanDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      results.push(...scanDir(full));
    } else if (entry.isFile() && /\.(js|mjs|cjs|ts)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      let match;
      while ((match = ROUTE_RE.exec(content)) !== null) {
        results.push({
          method: match[1].toUpperCase(),
          path: match[2],
          file_path: path.relative(SCAN_REPO_ROOT, full),
          line_number: content.slice(0, match.index).split('\n').length,
          area: SCAN_REPO_NAME,
        });
      }
      ROUTE_RE.lastIndex = 0;
    }
  }
  return results;
}

function selectedRoots() {
  const configured = (process.env.SCAN_API_DIRS || 'apps/api/src packages/brain/src')
    .split(/\s+/).filter(Boolean)
    .map((relativePath) => path.join(SCAN_REPO_ROOT, relativePath))
    .filter((candidate) => fs.existsSync(candidate));
  return configured.length > 0 ? configured : [SCAN_REPO_ROOT];
}

async function main() {
  if (!fs.existsSync(SCAN_REPO_ROOT)) throw new Error(`scanner root 不存在: ${SCAN_REPO_ROOT}`);
  const [{ replaceFactSnapshot }, { readGitRevision }] = await Promise.all([
    import('../../packages/brain/src/lib/fact-snapshot-store.js'),
    import('../../packages/brain/src/lib/git-revision.js'),
  ]);
  const pool = new pg.Pool({ connectionString: TARGET_DATABASE_URL });
  try {
    const routes = selectedRoots().flatMap(scanDir);
    const sourceRevision = readGitRevision(SCAN_REPO_ROOT);
    await replaceFactSnapshot(pool, 'api', {
      repo: SCAN_REPO_NAME,
      sourceRevision,
      scannerVersion: SCANNER_VERSION,
      rows: routes,
    });
    console.log(`api_registry repo=${SCAN_REPO_NAME} rows=${routes.length} revision=${sourceRevision.slice(0, 8)}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
