/**
 * codex-test-gen.js — 每日测试补齐生成器（Sprint 07172225-codex-pool-activation）
 *
 * 职责：
 *   1. 扫描 packages/brain/src/ 下缺配套测试文件的 .js 文件
 *   2. 过滤核心文件黑名单（dispatcher / slot-allocator / migration 等）
 *   3. 7 天去重：同 target_file 7 天内已生成过 codex_test_gen 任务则跳过
 *   4. 每次挑 1-3 个文件，POST /api/brain/tasks 入队 codex_test_gen 任务
 *
 * 调度：由 scheduler-jobs.js JOBS 注册（不走 tick-runner.js deprecated 路径）。
 * brain_url 通过环境变量注入，不硬编码 IP。
 */

import { readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

// 核心文件黑名单（INV-1 铁律：禁 Codex 派核心任务）
const FORBIDDEN_PATTERNS = [
  'dispatcher',
  'slot-allocator',
  'migration',
  'migrations',
  'selfcheck',
  'server',
  'tick',
  'db',
];

// 每次最多入队数量
const MAX_QUEUE_PER_RUN = 3;

// 去重窗口（天）
const DEDUP_DAYS = 7;

/**
 * 判断某文件名是否在黑名单中（基于 FORBIDDEN_PATTERNS）。
 * @param {string} filename - 文件名（不含路径）
 * @returns {boolean}
 */
function isForbidden(filename) {
  const lower = filename.toLowerCase();
  return FORBIDDEN_PATTERNS.some((p) => lower.includes(p));
}

/**
 * 扫描 packages/brain/src/ 下缺配套测试的 .js 文件（过滤黑名单 + 测试文件本身）。
 *
 * "缺测试配套"判据：src/ 目录下不存在同名 .test.js 且 src/__tests__/<name>.test.js 也不存在。
 *
 * @param {Object} [opts]
 * @param {boolean} [opts._dryRun] - 仅扫描，不查 DB（保留参数槽，暂未使用）
 * @param {string} [opts.srcDir] - 可注入扫描目录（测试用）
 * @returns {Promise<string[]>} 需要生成测试的相对文件路径列表
 */
export async function scanMissingTestFiles({ _dryRun = false, srcDir } = {}) {
  const brainSrc = srcDir || join(process.cwd(), 'packages/brain/src');
  if (!existsSync(brainSrc)) return [];

  let files;
  try {
    files = readdirSync(brainSrc, { withFileTypes: true });
  } catch {
    return [];
  }

  const missing = [];
  for (const entry of files) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.endsWith('.js')) continue;
    if (name.includes('.test.') || name.includes('.spec.')) continue;
    if (isForbidden(name)) continue;

    const stem = basename(name, '.js');
    // 检查 src/<stem>.test.js 和 src/__tests__/<stem>.test.js
    const inlinePath = join(brainSrc, `${stem}.test.js`);
    const separatePath = join(brainSrc, '__tests__', `${stem}.test.js`);
    if (!existsSync(inlinePath) && !existsSync(separatePath)) {
      missing.push(`packages/brain/src/${name}`);
    }
  }

  return missing;
}

/**
 * 查询 DB 中 7 天内同 target_file 已有 codex_test_gen 任务的文件集合。
 * @param {import('pg').Pool} pool
 * @returns {Promise<Set<string>>}
 */
export async function getRecentlyQueuedFiles(pool) {
  const { rows } = await pool.query(`
    SELECT payload->>'target_file' AS target_file
    FROM tasks
    WHERE task_type = 'codex_test_gen'
      AND created_at > NOW() - interval '${DEDUP_DAYS} days'
      AND payload->>'target_file' IS NOT NULL
  `);
  return new Set(rows.map((r) => r.target_file));
}

/**
 * 去重检查：target_file 在 7 天内是否已触发过？
 * 供测试直接调用。
 * @param {Object} opts
 * @param {string} opts.targetFile
 * @param {import('pg').Pool} [opts.pool]
 * @param {Set<string>} [opts.recentFiles] - 可直接注入已知集合（测试用）
 * @returns {Promise<{skipped: boolean, reason?: string}>}
 */
export async function checkDedup({ targetFile, pool, recentFiles }) {
  const recent = recentFiles ?? (pool ? await getRecentlyQueuedFiles(pool) : new Set());
  if (recent.has(targetFile)) {
    return { skipped: true, reason: 'dedup_7_days' };
  }
  return { skipped: false };
}

/**
 * 生成候选测试文件路径（基于 target_file stem）。
 * 例：packages/brain/src/drain.js → packages/brain/src/__tests__/drain.test.js
 * @param {string} targetFile
 * @returns {string[]}
 */
function buildCandidateTestPaths(targetFile) {
  const base = basename(targetFile, '.js');
  const dir = targetFile.substring(0, targetFile.lastIndexOf('/'));
  return [`${dir}/__tests__/${base}.test.js`];
}

/**
 * 主函数：扫描 → 去重 → 入队 1-3 个 codex_test_gen 任务。
 *
 * @param {import('pg').Pool} pool - Brain Postgres 连接池
 * @param {string} [brain_url] - Brain API URL（可覆盖环境变量默认值）
 * @param {Object} [opts] - 可选参数（测试注入用）
 * @param {string} [opts.srcDir] - 注入扫描目录（测试用，避免依赖真实文件系统）
 * @returns {Promise<{skipped: boolean, reason?: string} | {queued: string[], count: number}>}
 */
export async function runCodexTestGen(pool, brain_url, opts = {}) {
  const brainUrl =
    brain_url ||
    process.env.BRAIN_URL ||
    process.env.XIAN_BRAIN_URL ||
    'http://localhost:5221';

  // 1. 扫描缺测试文件（支持 srcDir 注入供测试使用）
  const candidates = await scanMissingTestFiles({ srcDir: opts.srcDir });
  if (candidates.length === 0) {
    return { skipped: true, reason: 'no_candidates' };
  }

  // 2. 去重：排除 7 天内已有记录的文件
  const recentFiles = await getRecentlyQueuedFiles(pool);
  const filtered = candidates.filter((f) => !recentFiles.has(f));
  if (filtered.length === 0) {
    return { skipped: true, reason: 'all_deduped' };
  }

  // 3. 随机挑 1-3 个（shuffle 后取前 MAX_QUEUE_PER_RUN）
  const shuffled = filtered.slice().sort(() => Math.random() - 0.5);
  const targets = shuffled.slice(0, MAX_QUEUE_PER_RUN);

  // 4. 入队
  const queued = [];
  for (const targetFile of targets) {
    try {
      const candidateTestPaths = buildCandidateTestPaths(targetFile);
      const description = `为 ${targetFile} 生成 vitest 测试：使用 mock 隔离依赖，覆盖主要分支`;
      const resp = await fetch(`${brainUrl}/api/brain/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_type: 'codex_test_gen',
          title: `[自动生成测试] ${targetFile}`,
          description,
          status: 'queued',
          priority: 'P2',
          payload: {
            base_repo: 'perfectuser21/cecelia',
            target_file: targetFile,
            target_file_path: targetFile,
            candidate_test_paths: candidateTestPaths,
            generation_requirements: 'vitest, mock dependencies, cover main branches',
            trigger: 'codex_test_gen_scheduler',
          },
        }),
      });
      if (!resp.ok) {
        console.warn(`[codex-test-gen] 入队失败 ${targetFile}: HTTP ${resp.status}`);
        continue;
      }
      const json = await resp.json();
      queued.push(targetFile);
      console.log(`[codex-test-gen] 入队成功 id=${json.id} target=${targetFile}`);
    } catch (err) {
      console.warn(`[codex-test-gen] 入队异常 ${targetFile}: ${err.message}`);
    }
  }

  return { queued, count: queued.length };
}
