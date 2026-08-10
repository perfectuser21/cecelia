#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCANNER_VERSION = 'test-registry-v2';

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
    const scanDirs = ['packages', 'apps', 'sprints'];
    const files = [];
    for (const d of scanDirs) files.push(...scanDir(path.join(REPO_ROOT, d)));

    console.log(`扫描到 ${files.length} 个测试文件`);

    await replaceFactSnapshot(pool, 'test', {
      repo: 'cecelia', sourceRevision, scannerVersion: SCANNER_VERSION, rows: files,
    });
    console.log('test_registry 填充完成');
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
