#!/usr/bin/env node
// 总关系图扫描器(刀A1):import(dependency-cruiser)+ spawn/http(graph-extract)三类边,
// 按 repo 全量替换写入 graph_edges。由 run-all-scans.sh 每日调用,继承照相层账龄哨兵。
// spec: docs/superpowers/specs/2026-07-18-graph-photo-layer-design.md
// v2: 多仓库扫描扩展——cecelia / zenithjoy-workspace / zenithjoy-skills
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { cruise } from 'dependency-cruiser';
import { extractSpawnEdges, extractHttpEdges } from '../../packages/brain/src/lib/graph-extract.js';
import { replaceRepoEdges } from '../../packages/brain/src/lib/graph-store.js';
import { computeFreshness } from '../../packages/brain/src/lib/registry-freshness.js';
import { readGitRevision } from '../../packages/brain/src/lib/git-revision.js';

const SCANNER_VERSION = 'graph-v3';

// 多仓库清单：每项支持环境变量覆盖
const DEFAULT_REPOS = [
  {
    name: 'cecelia',
    root: process.env.REPO_ROOT_CECELIA || '/Users/administrator/perfect21/cecelia',
  },
  {
    name: 'zenithjoy-workspace',
    root: process.env.REPO_ROOT_ZJ_WORKSPACE || '/Users/administrator/perfect21/zenithjoy-workspace',
  },
  {
    name: 'zenithjoy-skills',
    root: process.env.REPO_ROOT_ZJ_SKILLS || '/Users/administrator/perfect21/zenithjoy-skills',
  },
];
export const REPOS = process.env.SCAN_REPO_NAME && process.env.SCAN_REPO_ROOT
  ? [{ name: process.env.SCAN_REPO_NAME, root: process.env.SCAN_REPO_ROOT }]
  : DEFAULT_REPOS;

export function selectGraphRepos(repos, rawSelection) {
  if (rawSelection === undefined) return repos;
  if (rawSelection.trim() === '') throw new Error('GRAPH_REPOS 不能为空；请提供逗号分隔的仓库名');
  const names = rawSelection.split(',').map((name) => name.trim());
  if (names.some((name) => name === '')) throw new Error('GRAPH_REPOS 不能为空；逗号之间必须是仓库名');
  const byName = new Map(repos.map((repo) => [repo.name, repo]));
  const unknown = names.filter((name) => !byName.has(name));
  if (unknown.length > 0) throw new Error(`GRAPH_REPOS 包含未知仓库: ${unknown.join(',')}`);
  return names.map((name) => byName.get(name));
}

const FILE_RE = /\.(js|mjs|cjs|ts|tsx)$/;
// .claude 含 worktrees，扫它会把临时分支代码污染入图谱
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.claude']);

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

// 获取 cecelia repo 的默认扫描目录
function getCeceliaScanDirs(root) {
  return [
    'packages/brain/src', 'packages/brain/server.js',
    'packages/engine', 'packages/quality', 'packages/workflows',
    'apps/api/src', 'apps/dashboard/src', 'scripts',
  ].filter((d) => fs.existsSync(path.join(root, d)));
}

// 获取通用扫描目录：对 skills/文档仓库直接扫根目录，避免只扫 scripts/ 而遗漏 skill 子目录
function getGenericScanDirs(_root) {
  // 返回 '.' 让 walk 扫整个 repo（.claude worktrees 已由 SKIP_DIRS 排除）
  return ['.'];
}

/**
 * 扫描单个 repo，返回结果对象
 * @param {{ name: string, root: string }} repo
 * @param {pg.Pool} pool
 * @returns {Promise<{ name: string, skipped?: boolean, reason?: string, error?: Error, inserted?: number, freshness?: object }>}
 */
export async function scanRepo(repo, pool) {
  if (!fs.existsSync(repo.root)) {
    console.warn(`WARN: repo=${repo.name} 路径不存在，跳过`);
    return { name: repo.name, skipped: true, reason: 'path_not_found' };
  }

  try {
    const sourceRevision = readGitRevision(repo.root);

    const edges = [];

    // 确定扫描目录
    const scanDirs = repo.name === 'cecelia'
      ? getCeceliaScanDirs(repo.root)
      : getGenericScanDirs(repo.root);

    // 若没有任何扫描目录，对整个 root 做基础扫描
    const effectiveDirs = scanDirs.length > 0 ? scanDirs : ['.'];

    let importCount = 0;
    // 1) import 边：dependency-cruiser 程序化 API
    const cruiseResult = await cruise(effectiveDirs, {
      baseDir: repo.root,
      doNotFollow: { path: 'node_modules' },
      exclude: { path: 'node_modules' },
    });
    const out = typeof cruiseResult.output === 'string'
      ? JSON.parse(cruiseResult.output)
      : cruiseResult.output;
    const modules = out.modules || [];
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

    // 2) spawn/http 边：walk + 纯抽取器
    let spawnCount = 0, httpCount = 0;
    const files = [];
    for (const d of effectiveDirs) {
      const full = path.join(repo.root, d);
      if (!fs.existsSync(full)) continue;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full, files);
      else if (FILE_RE.test(full)) files.push(full);
    }
    for (const f of files) {
      const rel = path.relative(repo.root, f);
      const content = fs.readFileSync(f, 'utf8');
      const se = extractSpawnEdges(content, rel);
      const he = extractHttpEdges(content, rel);
      spawnCount += se.length;
      httpCount += he.length;
      edges.push(...se, ...he);
    }

    // 3) 去重
    const seen = new Set();
    const deduped = edges.filter((e) => {
      const k = `${e.src_path}|${e.dst_path}|${e.edge_type}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // 4) 全量替换写库（I-1: BEGIN;DELETE;INSERT;COMMIT），携带 revision 信息
    const { inserted } = await replaceRepoEdges(pool, repo.name, deduped, {
      sourceRevision,
      scannerVersion: SCANNER_VERSION,
    });

    // 5) per-repo freshness（I-3: 各仓独立查询，禁止跨仓合并）
    const { rows: frRows } = await pool.query(
      `SELECT scanned_at, source_revision, scanner_version, row_count
         FROM fact_snapshot_headers WHERE kind='graph' AND repo=$1`, [repo.name]
    );
    const freshness = computeFreshness(frRows[0] ?? null);

    // 7) 打印每仓摘要
    console.log(
      `repo=${repo.name} import=${importCount} spawn=${spawnCount} http=${httpCount}` +
      ` 入库=${inserted} stale=${freshness.stale} age_hours=${freshness.age_hours ?? 'N/A'}` +
      ` revision=${sourceRevision?.slice(0, 8) ?? 'unknown'}`
    );

    return { name: repo.name, inserted, freshness, sourceRevision };
  } catch (err) {
    console.error(`ERROR: repo=${repo.name} 扫描失败: ${err.message}`);
    return { name: repo.name, error: err };
  }
}

/**
 * 扫描多个 repo 列表，收集结果
 * @param {Array<{ name: string, root: string }>} repos
 * @param {pg.Pool} pool
 * @returns {Promise<Array<object>>}
 */
export async function scanRepoList(repos, pool) {
  const results = [];
  for (const repo of repos) {
    const result = await scanRepo(repo, pool);
    results.push(result);
  }
  return results;
}

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia',
  });

  let hasError = false;

  try {
    const selectedRepos = selectGraphRepos(REPOS, process.env.GRAPH_REPOS);
    const results = await scanRepoList(selectedRepos, pool);
    for (const r of results) {
      if (r.skipped || r.error) {
        hasError = true;
      }
    }
  } finally {
    await pool.end();
  }

  if (hasError) process.exit(1);
}

// 仅在直接运行时执行 main()，import 时不执行（支持测试 import 导出）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
