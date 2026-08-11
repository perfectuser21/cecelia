#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');
const { execSync } = require('child_process');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
const REPO_ROOT = path.resolve(__dirname, '../..');

const SCANNER_VERSION = 'api-registry-v2';

function readGitRevision(dir) {
  try { return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { return null; }
}

async function replaceFactSnapshot(pool, kind, { repo, sourceRevision, scannerVersion, rows }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `INSERT INTO api_registry (method, path, file_path, line_number, area, repo, source_revision, scanner_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (repo, method, path) DO UPDATE
           SET file_path=$3, line_number=$4, area=$5,
               source_revision=$7, scanner_version=$8,
               scanned_at=NOW(), updated_at=NOW()`,
        [r.method, r.path, r.file_path, r.line_number, r.area, repo, sourceRevision, scannerVersion],
      );
    }
    await client.query(
      `INSERT INTO fact_snapshot_headers (kind, repo, source_revision, scanner_version, scanned_at, row_count)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (kind, repo) DO UPDATE
         SET source_revision = EXCLUDED.source_revision,
             scanner_version = EXCLUDED.scanner_version,
             scanned_at = EXCLUDED.scanned_at,
             row_count = EXCLUDED.row_count`,
      [kind, repo, sourceRevision, scannerVersion, rows.length],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// repo 归属：area → scope_key
const AREA_REPO = { zenithjoy: 'zenithjoy-workspace', cecelia: 'cecelia', unknown: 'cecelia' };

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

async function main() {
  try {
    const routes = [];
    for (const dir of SCAN_DIRS) {
      routes.push(...scanDir(path.join(REPO_ROOT, dir)));
    }
    console.log(`扫描到 ${routes.length} 条路由`);

    const sourceRevision = readGitRevision(REPO_ROOT);

    await replaceFactSnapshot(pool, 'api', {
      repo: 'cecelia',
      sourceRevision,
      scannerVersion: SCANNER_VERSION,
      rows: routes,
    });
    console.log(`api_registry 填充完成 revision=${sourceRevision?.slice(0,8) ?? 'unknown'}`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
