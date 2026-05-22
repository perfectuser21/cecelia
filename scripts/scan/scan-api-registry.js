#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
const REPO_ROOT = path.resolve(__dirname, '../..');

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
    if (entry.isDirectory()) {
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

async function main() {
  const routes = [];
  for (const dir of SCAN_DIRS) {
    routes.push(...scanDir(path.join(REPO_ROOT, dir)));
  }
  console.log(`扫描到 ${routes.length} 条路由`);

  for (const r of routes) {
    await pool.query(
      `INSERT INTO api_registry (method, path, file_path, line_number, area)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (method, path) DO UPDATE
         SET file_path=$3, line_number=$4, area=$5, scanned_at=NOW(), updated_at=NOW()`,
      [r.method, r.path, r.file_path, r.line_number, r.area],
    );
  }
  console.log('api_registry 填充完成');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
