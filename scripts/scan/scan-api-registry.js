#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCANNER_VERSION = 'api-registry-v2';

const SCAN_DIRS = [
  'apps/api/src',
  'packages/brain/src',
];

const ROUTE_RE = /\.(get|post|put|patch|delete|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
const AREA_MAP = { 'apps/api': 'zenithjoy', 'packages/brain': 'cecelia' };

function inferArea(filePath) {
  for (const [prefix, area] of Object.entries(AREA_MAP)) {
    if (filePath.includes(prefix)) return area;
  }
  return 'unknown';
}

function scanDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.includes('node_modules')) {
      results.push(...scanDir(full));
    } else if (entry.isFile() && /\.(js|ts)$/.test(entry.name) && !entry.name.includes('.test.')) {
      const content = fs.readFileSync(full, 'utf8');
      let match;
      while ((match = ROUTE_RE.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const routePath = match[2];
        const lineNumber = content.slice(0, match.index).split('\n').length;
        results.push({
          method,
          path: routePath,
          file_path: path.relative(REPO_ROOT, full),
          line_number: lineNumber,
          area: inferArea(full),
        });
      }
      ROUTE_RE.lastIndex = 0;
    }
  }
  return results;
}

function getSourceRevision() {
  try {
    const revision = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (!revision) throw new Error('empty revision');
    return revision;
  } catch (error) {
    throw new Error(`无法读取 cecelia source revision: ${error.message}`);
  }
}

async function main() {
  try {
    const sourceRevision = getSourceRevision();
    const { replaceFactSnapshot } = await import('../../packages/brain/src/lib/fact-snapshot-store.js');
    const routes = [];
    for (const dir of SCAN_DIRS) {
      routes.push(...scanDir(path.join(REPO_ROOT, dir)));
    }
    console.log(`扫描到 ${routes.length} 条路由`);

    await replaceFactSnapshot(pool, 'api', {
      repo: 'cecelia', sourceRevision, scannerVersion: SCANNER_VERSION, rows: routes,
    });
    console.log('api_registry 填充完成');
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
