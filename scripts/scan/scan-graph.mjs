#!/usr/bin/env node
// 总关系图扫描器(刀A1):import(dependency-cruiser)+ spawn/http(graph-extract)三类边,
// 按 repo 全量替换写入 graph_edges。由 run-all-scans.sh 每日调用,继承照相层账龄哨兵。
// spec: docs/superpowers/specs/2026-07-18-graph-photo-layer-design.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { cruise } from 'dependency-cruiser';
import { extractSpawnEdges, extractHttpEdges } from '../../packages/brain/src/lib/graph-extract.js';
import { replaceRepoEdges } from '../../packages/brain/src/lib/graph-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = 'cecelia';
const SCAN_DIRS = [
  'packages/brain/src', 'packages/brain/server.js',
  'packages/engine', 'packages/quality', 'packages/workflows',
  'apps/api/src', 'apps/dashboard/src', 'scripts',
].filter((d) => fs.existsSync(path.join(ROOT, d)));
const FILE_RE = /\.(js|mjs|cjs|ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (FILE_RE.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

async function main() {
  process.chdir(ROOT);
  const edges = [];

  // 1) import 边:dependency-cruiser 程序化 API
  const cruiseResult = await cruise(SCAN_DIRS, {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules' },
  });
  // 兼容:程序化 API 的 output 依版本可能是对象或 JSON 字符串
  const out = typeof cruiseResult.output === 'string' ? JSON.parse(cruiseResult.output) : cruiseResult.output;
  const modules = out.modules;
  let importCount = 0;
  for (const m of modules) {
    if (m.source.includes('node_modules')) continue;
    for (const d of m.dependencies || []) {
      const dst = d.resolved || '';
      if (d.couldNotResolve || !dst || dst.includes('node_modules')) continue;
      if (d.dependencyTypes && d.dependencyTypes.includes('core')) continue;
      edges.push({
        src_path: m.source, dst_path: dst, edge_type: 'import',
        detail: { via: 'import', dynamic: d.dynamic === true },
      });
      importCount++;
    }
  }

  // 2) spawn/http 边:walk + 纯抽取器
  let spawnCount = 0, httpCount = 0;
  const files = [];
  for (const d of SCAN_DIRS) {
    const full = path.join(ROOT, d);
    if (fs.statSync(full).isDirectory()) walk(full, files);
    else if (FILE_RE.test(full)) files.push(full);
  }
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const content = fs.readFileSync(f, 'utf8');
    const se = extractSpawnEdges(content, rel);
    const he = extractHttpEdges(content, rel);
    spawnCount += se.length;
    httpCount += he.length;
    edges.push(...se, ...he);
  }

  // 3) 去重 + 全量替换写库
  const seen = new Set();
  const deduped = edges.filter((e) => {
    const k = `${e.src_path}|${e.dst_path}|${e.edge_type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
  try {
    const { inserted } = await replaceRepoEdges(pool, REPO, deduped);
    console.log(`graph_edges 全量重拍完成: import=${importCount} spawn=${spawnCount} http=${httpCount} 去重后入库=${inserted}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
