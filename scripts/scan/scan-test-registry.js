#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
const REPO_ROOT = path.resolve(__dirname, '../..');

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
  const scanDirs = ['packages', 'apps', 'sprints'];
  const files = [];
  for (const d of scanDirs) files.push(...scanDir(path.join(REPO_ROOT, d)));

  console.log(`扫描到 ${files.length} 个测试文件`);

  for (const f of files) {
    await pool.query(
      `INSERT INTO test_registry (file_path, test_count, covered_behaviors, area, test_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (file_path) DO UPDATE
         SET test_count=$2, covered_behaviors=$3, area=$4, test_type=$5,
             scanned_at=NOW(), updated_at=NOW()`,
      [f.file_path, f.test_count, f.covered_behaviors, f.area, f.test_type],
    );
  }
  console.log('test_registry 填充完成');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
