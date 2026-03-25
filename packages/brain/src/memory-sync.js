/** @module memory-sync
 * memory-sync.js
 *
 * Claude Code auto-memory ↔ Cecelia 文档系统同步器
 *
 * 每次 Tick 末尾调用 memorySyncIfNeeded()，扫描 auto-memory 文件夹，
 * 将 memory/*.md 文件按类型同步到 design_docs / decisions 表。
 *
 * 类型映射：
 *   project / reference → design_docs（type='architecture'）
 *   feedback           → decisions（category='process'）
 *   user               → 跳过（个人偏好，不入库）
 *
 * 幂等：用 title 去重，已存在则跳过。
 */

/* global process, console */

import { readdir, readFile } from 'fs/promises';
import { join, homedir } from 'path';

// auto-memory 目录路径（兼容多 account）
const MEMORY_DIRS = [
  join(homedir(), '.claude-account1', 'projects', '-Users-administrator-perfect21-cecelia', 'memory'),
  join(homedir(), '.claude', 'projects', '-Users-administrator-perfect21-cecelia', 'memory'),
];

// 同步间隔：30 分钟
const SYNC_INTERVAL_MS = 30 * 60 * 1000;
let _lastSyncTime = 0;

/**
 * 解析 memory/*.md 文件的 frontmatter
 * @param {string} content - 文件内容
 * @returns {{ name: string, description: string, type: string, body: string }}
 */
function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { name: '', description: '', type: '', body: content };
  }
  const fmLines = fmMatch[1].split('\n');
  const meta = {};
  for (const line of fmLines) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return {
    name: meta.name || '',
    description: meta.description || '',
    type: meta.type || '',
    body: fmMatch[2].trim(),
  };
}

/**
 * 将 project/reference 类型文件同步到 design_docs
 * @param {import('pg').Pool} pool
 * @param {{ name: string, description: string, body: string }} meta
 */
async function syncToDesignDocs(pool, meta) {
  const title = meta.name || '（未命名）';

  // 查重：按 title 检查是否已存在
  const existing = await pool.query(
    `SELECT id FROM design_docs WHERE title = $1 LIMIT 1`,
    [title]
  );
  if (existing.rows.length > 0) {
    return 'skipped';
  }

  const content = [
    meta.description ? `> ${meta.description}\n` : '',
    meta.body,
  ].filter(Boolean).join('\n');

  await pool.query(
    `INSERT INTO design_docs (type, title, content, status, area, author)
     VALUES ($1, $2, $3, 'adopted', 'cecelia', 'cecelia')`,
    ['architecture', title, content]
  );
  return 'inserted';
}

/**
 * 将 feedback 类型文件同步到 decisions
 * @param {import('pg').Pool} pool
 * @param {{ name: string, description: string, body: string }} meta
 */
async function syncToDecisions(pool, meta) {
  const topic = meta.name || '（未命名）';

  // 查重：按 topic 检查是否已存在
  const existing = await pool.query(
    `SELECT id FROM decisions WHERE topic = $1 LIMIT 1`,
    [topic]
  );
  if (existing.rows.length > 0) {
    return 'skipped';
  }

  // 提取 body 第一段作为 decision，其余作为 reason
  const paragraphs = meta.body.split(/\n\n+/);
  const decision = paragraphs[0]?.trim() || meta.description || topic;
  const reason = [
    meta.description ? `描述：${meta.description}` : '',
    paragraphs.slice(1).join('\n\n').trim(),
  ].filter(Boolean).join('\n\n') || null;

  await pool.query(
    `INSERT INTO decisions (category, topic, decision, reason, status)
     VALUES ('process', $1, $2, $3, 'active')`,
    [topic, decision, reason]
  );
  return 'inserted';
}

/**
 * 扫描并同步 auto-memory 文件夹
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ scanned: number, inserted: number, skipped: number, errors: number }>}
 */
async function runMemorySync(pool) {
  let stats = { scanned: 0, inserted: 0, skipped: 0, errors: 0 };

  // 找到第一个存在的 memory 目录
  let memoryDir = null;
  for (const dir of MEMORY_DIRS) {
    try {
      const files = await readdir(dir);
      if (files.length > 0) {
        memoryDir = dir;
        break;
      }
    } catch { /* 目录不存在 */ }
  }

  if (!memoryDir) {
    console.log('[memory-sync] 未找到 auto-memory 目录，跳过');
    return stats;
  }

  const files = (await readdir(memoryDir)).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  stats.scanned = files.length;

  for (const file of files) {
    try {
      const content = await readFile(join(memoryDir, file), 'utf8');
      const meta = parseFrontmatter(content);

      let result = 'skipped';
      if (meta.type === 'project' || meta.type === 'reference') {
        result = await syncToDesignDocs(pool, meta);
      } else if (meta.type === 'feedback') {
        result = await syncToDecisions(pool, meta);
      }
      // user type → 跳过

      if (result === 'inserted') stats.inserted++;
      else stats.skipped++;
    } catch (err) {
      console.warn(`[memory-sync] 处理 ${file} 失败: ${err.message}`);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * 每 30 分钟同步一次（供 tick.js 调用）
 * @param {import('pg').Pool} pool
 */
export async function memorySyncIfNeeded(pool) {
  const now = Date.now();
  if (now - _lastSyncTime < SYNC_INTERVAL_MS) return;

  _lastSyncTime = now;
  try {
    const stats = await runMemorySync(pool);
    if (stats.inserted > 0 || stats.errors > 0) {
      console.log(`[memory-sync] 完成: 扫描 ${stats.scanned} 个，新增 ${stats.inserted} 条，跳过 ${stats.skipped} 条，错误 ${stats.errors} 个`);
    }
  } catch (err) {
    console.warn('[memory-sync] 同步失败:', err.message);
  }
}

export { runMemorySync };
