#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');
const { execSync } = require('child_process');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCANNER_VERSION = 'test-registry-v2';

function readGitRevision(dir) {
  try { return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { return null; }
}

async function replaceFactSnapshot(pool, kind, { repo, sourceRevision, scannerVersion, rows }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fact-snapshot:test_registry:${repo}`]);
    await client.query(`DELETE FROM test_registry WHERE repo = $1`, [repo]);
    for (const f of rows) {
      await client.query(
        `INSERT INTO test_registry (file_path, test_count, covered_behaviors, area, test_type, repo, source_revision, scanner_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (repo, file_path) DO UPDATE
           SET test_count=$2, covered_behaviors=$3, area=$4, test_type=$5,
               source_revision=$7, scanner_version=$8,
               scanned_at=NOW(), updated_at=NOW()`,
        [f.file_path, f.test_count, f.covered_behaviors, f.area, f.test_type, repo, sourceRevision, scannerVersion],
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

const AREA_REPO = { zenithjoy: 'zenithjoy-workspace', cecelia: 'cecelia', unknown: 'cecelia' };

const AREA_MAP = [
  ['apps/api', 'zenithjoy'],
  ['apps/dashboard', 'zenithjoy'],
  ['packages/brain', 'cecelia'],
  ['packages/engine', 'cecelia'],
];

function inferArea(filePath) {
  for (const [prefix, area] of AREA_MAP) {
    if (filePath.includes(prefix)) return area;
  }
  return 'unknown';
}

function inferType(filePath) {
  if (filePath.includes('e2e') || filePath.includes('spec')) return 'e2e';
  if (filePath.includes('integration')) return 'integration';
  return 'unit';
}

function scanDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.includes('node_modules')) {
      results.push(...scanDir(full));
    } else if (entry.isFile() && /\.(test|spec)\.(ts|js)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      const behaviors = [];
      const itRe = /(?:it|test)\s*\(\s*['"`]([^'"`]{3,100})['"`]/g;
      let m;
      while ((m = itRe.exec(content)) !== null) behaviors.push(m[1]);
      results.push({
        file_path: path.relative(REPO_ROOT, full),
        test_count: behaviors.length,
        covered_behaviors: behaviors,
        area: inferArea(full),
        test_type: inferType(full),
      });
    }
  }
  return results;
}

async function main() {
  try {
    const scanDirs = ['packages', 'apps', 'sprints'];
    const files = [];
    for (const d of scanDirs) files.push(...scanDir(path.join(REPO_ROOT, d)));

    console.log(`扫描到 ${files.length} 个测试文件`);

    const sourceRevision = readGitRevision(REPO_ROOT);

    await replaceFactSnapshot(pool, 'test', {
      repo: 'cecelia',
      sourceRevision,
      scannerVersion: SCANNER_VERSION,
      rows: files,
    });
    console.log(`test_registry 填充完成 revision=${sourceRevision?.slice(0,8) ?? 'unknown'}`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
