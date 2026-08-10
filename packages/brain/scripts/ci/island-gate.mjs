#!/usr/bin/env node
/**
 * island-gate.mjs — CI 孤岛闸
 *
 * 检测 PR 新增的 packages/brain/src 源文件是否为孤岛（isolated）。
 * 孤岛文件（无任何 import/spawn/http 出边）→ exit 1（CI 红）
 * 有出边文件 → exit 0（CI 绿）
 * 无新增文件 → exit 0（跳过）
 *
 * 合同: B1/B2/B3/B4
 * 约束注意: CI 环境 cecelia_test DB graph_edges 初始为空，
 *   判断"connected"不依赖目标节点已在图中，
 *   而是判断"新文件有出边（import 了其他节点）"即视为 connected。
 *
 * 用法:
 *   node packages/brain/scripts/ci/island-gate.mjs
 *   node packages/brain/scripts/ci/island-gate.mjs --fixture-files="packages/brain/src/foo.js"
 *   ISLAND_GATE_NO_DB=1 FIXTURE_CONTENT_0="..." FIXTURE_PATH_0="..." node ...
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ci/ → brain → packages → workspace(root)，需上4级
const REPO_ROOT = path.resolve(__dirname, '../../../..');

// ─── 启发式 action-hint 分类（纯函数，可导出供测试）─────────────────────────────
export function actionHint(filePath) {
  const p = filePath.replace(/\\/g, '/');
  if (/(^|\/)__tests__\//.test(p) || /\.test\./.test(p) || /\.spec\./.test(p)) {
    return '[ACTION:挂起]';
  }
  if (/\/src\//.test(p) && !/test/i.test(p)) {
    return '[ACTION:收编]';
  }
  return '[ACTION:挂起]';
}

// ─── import 边提取（纯文本扫描，不走 dependency-cruiser）─────────────────────
function extractImportEdges(content, srcPath) {
  const edges = [];
  // ESM static imports: import X from '...' / import '...'
  const esmRe = /^\s*import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm;
  let m;
  while ((m = esmRe.exec(content)) !== null) {
    edges.push({ src: srcPath, dst: m[1], type: 'import' });
  }
  // CommonJS require: require('...')
  const cjsRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = cjsRe.exec(content)) !== null) {
    edges.push({ src: srcPath, dst: m[1], type: 'require' });
  }
  return edges;
}

function extractSpawnEdges(content, srcPath) {
  const edges = [];
  const re = /\b(?:spawn|execFile|execSync|exec)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    edges.push({ src: srcPath, dst: m[1], type: 'spawn' });
  }
  return edges;
}

function extractHttpEdges(content, srcPath) {
  const edges = [];
  const re = /(?:localhost|127\.0\.0\.1):5221|['"`](\/api\/[^'"`\s]+)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) {
      edges.push({ src: srcPath, dst: m[1], type: 'http' });
    }
  }
  return edges;
}


// ─── 入边检测(2026-07-18 修盲区)──────────────────────────────────────────────
// 零出边的叶子模块(只用内建/全局 fetch)可能被仓内其他生产文件 import——
// 静态扫仓判入边,不依赖 DB。测试文件不算入边源(只被自己单测引用的仍是孤岛,闸保牙)。
const IN_EDGE_ROOTS = ['packages/brain/src', 'packages/brain/server.js', 'packages/brain/scripts', 'scripts'];
const TEST_PATH_RE = /(^|\/)__tests__\/|\.test\.|\.spec\.|(^|\/)tests\//;

function hasInEdges(filePath) {
  const base = path.basename(filePath).replace(/\.(js|mjs|cjs|ts)$/, '');
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const QUOTE = '[\'"`]';
  const needle = new RegExp(
    '(from\\s+|require\\(|import\\()\\s*' + QUOTE + '[^\'"`]*\\/' + escaped + '(\\.(js|mjs|cjs))?' + QUOTE
  );
  const target = path.resolve(REPO_ROOT, filePath);
  const stack = IN_EDGE_ROOTS.map((r) => path.resolve(REPO_ROOT, r)).filter((q) => fs.existsSync(q));
  while (stack.length > 0) {
    const cur = stack.pop();
    let st;
    try { st = fs.statSync(cur); } catch { continue; }
    if (st.isDirectory()) {
      if (path.basename(cur) === 'node_modules') continue;
      for (const e of fs.readdirSync(cur)) stack.push(path.join(cur, e));
      continue;
    }
    if (!/\.(js|mjs|cjs|ts)$/.test(cur)) continue;
    if (cur === target) continue;
    const rel = path.relative(REPO_ROOT, cur);
    if (TEST_PATH_RE.test(rel)) continue;
    try {
      if (needle.test(fs.readFileSync(cur, 'utf8'))) return true;
    } catch { /* unreadable, skip */ }
  }
  return false;
}

function hasOutEdges(content, srcPath) {
  const all = [
    ...extractImportEdges(content, srcPath),
    ...extractSpawnEdges(content, srcPath),
    ...extractHttpEdges(content, srcPath),
  ];
  return all.length > 0;
}

// ─── 获取新增文件列表 ──────────────────────────────────────────────────────────
// __tests__ 下的非代码文件是测试 fixture 资产（yaml/json/sql…），天然只被测试
// readFileSync——出边判定对它们无意义，入边扫描又刻意排除测试文件（保牙），
// 不豁免则任何测试 fixture 必判孤岛。生产目录下的非代码文件不豁免，仍要人显式处理。
export function isTestFixtureAsset(f) {
  return /(^|\/)__tests__\//.test(f) && !/\.(js|mjs|cjs|ts)$/.test(f);
}

// SQL migration 文件由 migrate.js 通过 readdirSync 动态读取，无静态 import 出边，
// 但它们通过 migrate.js 连通，不是孤岛——豁免静态边检测。
export function isMigrationFile(f) {
  return /\/db\/migrations\/.*\.sql$/.test(f);
}

function getAddedFiles(args) {
  // --fixture-files= 参数（供测试 / E2E 本地验证）
  const fixtureArg = args.find((a) => a.startsWith('--fixture-files='));
  if (fixtureArg !== undefined) {
    const val = fixtureArg.replace('--fixture-files=', '').trim();
    if (!val) return [];
    return val
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
      .filter((f) => f.includes('packages/brain/src'))
      .filter((f) => !isTestFixtureAsset(f))
      .filter((f) => !isMigrationFile(f));
  }

  // 真实 CI 模式: git diff
  try {
    const base = process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : 'origin/main';
    const out = execSync(
      `git diff --diff-filter=A --name-only ${base}...HEAD 2>/dev/null || git diff --diff-filter=A --name-only HEAD~1...HEAD`,
      { encoding: 'utf8', cwd: REPO_ROOT }
    ).trim();
    if (!out) return [];
    return out
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.startsWith('packages/brain/src'))
      .filter((f) => !isTestFixtureAsset(f))
      .filter((f) => !isMigrationFile(f));
  } catch (e) {
    console.error('[ISLAND-GATE] git diff 失败，当作无新增文件处理:', e.message);
    return [];
  }
}

// ─── 读取文件内容（测试模式支持 env 注入内容）────────────────────────────────
function readFileContent(filePath) {
  // 测试 env 注入模式：FIXTURE_PATH_0 + FIXTURE_CONTENT_0
  for (let i = 0; i < 10; i++) {
    const envPath = process.env[`FIXTURE_PATH_${i}`];
    const envContent = process.env[`FIXTURE_CONTENT_${i}`];
    if (envPath && envContent && (envPath === filePath || filePath.endsWith(envPath) || envPath.endsWith(filePath))) {
      return envContent;
    }
  }

  // 尝试从磁盘读取
  const candidates = [
    filePath,
    path.resolve(REPO_ROOT, filePath),
  ];
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, 'utf8');
    } catch {
      // try next
    }
  }
  return null;
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const noDb = process.env.ISLAND_GATE_NO_DB === '1';

  const addedFiles = getAddedFiles(args);

  if (addedFiles.length === 0) {
    console.log('[ISLAND-GATE] SKIP: no new files detected in packages/brain/src');
    process.exit(0);
  }

  console.log(`[ISLAND-GATE] 检测到 ${addedFiles.length} 个新增文件:`);
  for (const f of addedFiles) {
    console.log(`  ${f}`);
  }

  // 连接 DB（非测试模式）并运行 migrate + scan-graph
  // 注意：CI 环境初始 graph_edges 为空，我们不依赖 DB 连通性判断，
  // 而是通过分析文件内容的出边来判断是否连通。
  if (!noDb) {
    try {
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbPort = process.env.DB_PORT || '5432';
      const dbName = process.env.DB_NAME || 'cecelia_test';
      const dbUser = process.env.DB_USER || 'cecelia';
      const dbPass = process.env.DB_PASSWORD || '';

      // 运行 migrations
      console.log('[ISLAND-GATE] 运行全量 migrations...');
      const migrateEnv = {
        ...process.env,
        DB_HOST: dbHost,
        DB_PORT: dbPort,
        DB_NAME: dbName,
        DB_USER: dbUser,
        DB_PASSWORD: dbPass,
        NODE_ENV: 'test',
      };
      execSync('node src/migrate.js', {
        cwd: path.resolve(REPO_ROOT, 'packages/brain'),
        env: migrateEnv,
        stdio: 'inherit',
      });
      console.log('[ISLAND-GATE] migrations 完成');
    } catch (err) {
      console.error('[ISLAND-GATE] migrate 失败（忽略，继续用出边判断）:', err.message);
    }
  }

  let hasIsolated = false;
  const results = [];

  for (const filePath of addedFiles) {
    const content = readFileContent(filePath);

    if (content === null) {
      // 文件不存在（已删除 / fixture 无内容），视为有边（豁免）
      console.log(`[ISLAND-GATE] SKIP(not readable): ${filePath}`);
      results.push({ filePath, verdict: 'connected_unclaimed', hasEdge: true });
      continue;
    }

    const outEdge = hasOutEdges(content, filePath);
    const connected = outEdge || hasInEdges(filePath);
    if (!outEdge && connected) {
      console.log(`[ISLAND-GATE] in-edge: ${filePath} 零出边但被仓内生产文件引用,判连通`);
    }

    if (!connected) {
      // 无出边 → isolated（孤岛）
      console.error(`[ISLAND-GATE] FAIL: isolated file detected — ${filePath}`);
      hasIsolated = true;
      results.push({ filePath, verdict: 'isolated', hasEdge: false });
    } else {
      // 有出边 → connected_unclaimed（暂未认领，但连通）
      const hint = actionHint(filePath);
      console.log(`[ISLAND-GATE] OK: connected_unclaimed — ${hint} ${filePath}`);
      results.push({ filePath, verdict: 'connected_unclaimed', hasEdge: true });
    }
  }

  if (hasIsolated) {
    const isolated = results.filter((r) => r.verdict === 'isolated').map((r) => r.filePath);
    console.error('[ISLAND-GATE] FAIL: 以下新增文件为孤岛（无 import/spawn/http 出边），请将其接入关系图:');
    for (const f of isolated) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  console.log('[ISLAND-GATE] PASS: 所有新增文件均已连通或无新增文件');
  process.exit(0);
}

// 仅在直接执行时运行 main（不在 import 时运行）
if (process.argv[1] && (
  process.argv[1].endsWith('island-gate.mjs') ||
  process.argv[1].includes('island-gate')
)) {
  main().catch((err) => {
    console.error('[ISLAND-GATE] 未预期错误:', err);
    process.exit(1);
  });
}
