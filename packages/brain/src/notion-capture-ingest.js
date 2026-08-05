/**
 * notion-capture-ingest.js — Notion 个人 Inbox 增量采集器（F6加厚）
 *
 * 调度：挂 scheduler-jobs.js，每轮由 runScheduler 调用；模块内自 gate 5 分钟。
 *
 * 幂等双锚：
 *   - captures:      dedupe_key = 'notion:inbox:<pageId>'（ON CONFLICT DO UPDATE 刷内容）
 *   - capture_atoms: notion_page_id 唯一索引（ON CONFLICT DO NOTHING 防第二条）
 *
 * 凭据顺序：process.env.NOTION_API_KEY → ~/.credentials/CCAPI2026.env，禁硬编码。
 *
 * 增量游标：working_memory key `notion_capture_ingest:cursor:<dbId>` 存 last_edited_time ISO 串。
 * 自 gate：working_memory key `notion_capture_ingest:last_run` 存最后执行时间戳。
 */

import { readFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION  = '2022-06-28';
const GATE_MS         = 5 * 60 * 1000;
const GATE_KEY        = 'notion_capture_ingest:last_run';
const PAGE_SIZE       = 50;
const MAX_PAGES       = 200; // 单次最多消费页数，防暴走

// ── 凭据解析 ──────────────────────────────────────────────────────

export async function resolveNotionToken(deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFile(p, 'utf8'));
  let token = (process.env.NOTION_API_KEY || '').trim();
  if (token) return token;

  const credsPath = deps.credsPath || path.join(os.homedir(), '.credentials', 'CCAPI2026.env');
  try {
    const content = await readFileFn(credsPath);
    for (const line of String(content).split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?NOTION_API_KEY\s*=\s*(\S+)\s*$/);
      if (m) { token = m[1].trim(); break; }
    }
  } catch { /* 文件不存在 → 继续走 env 分支，最终下面报错 */ }

  if (!token) {
    throw new Error('NOTION_API_KEY 未配置（env 未设，~/.credentials/CCAPI2026.env 未找到）');
  }
  return token;
}

// ── 白名单解析 ────────────────────────────────────────────────────

/**
 * 从 NOTION_INBOX_DB_IDS 环境变量读取白名单（逗号分隔）。
 * 若未配置，模块优雅跳过（无错误）。
 */
export function resolveInboxDbIds() {
  const raw = (process.env.NOTION_INBOX_DB_IDS || '').trim();
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// ── Notion API ────────────────────────────────────────────────────

export async function notionReq(token, path_, method = 'GET', body = null, deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetchFn(`${NOTION_API_BASE}${path_}`, opts);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`Notion ${method} ${path_} → ${res.status}: ${data.message || 'unknown'}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * 分页拉取数据库内 last_edited_time > afterCursor 的页面（升序）。
 */
export async function fetchInboxPages(token, dbId, afterCursor = null, deps = {}) {
  const pages = [];
  let startCursor;
  let fetched = 0;

  while (fetched < MAX_PAGES) {
    const body = {
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
      page_size: PAGE_SIZE,
    };
    if (afterCursor) {
      body.filter = {
        timestamp: 'last_edited_time',
        last_edited_time: { after: afterCursor },
      };
    }
    if (startCursor) body.start_cursor = startCursor;

    const resp = await notionReq(token, `/databases/${dbId}/query`, 'POST', body, deps);
    pages.push(...resp.results);
    fetched += resp.results.length;

    if (!resp.has_more) break;
    startCursor = resp.next_cursor;
  }

  return pages;
}

// ── 内容提取 ──────────────────────────────────────────────────────

export function extractPageTitle(page) {
  const props = page.properties || {};
  for (const val of Object.values(props)) {
    if (val.type === 'title' && Array.isArray(val.title)) {
      const text = val.title.map(t => t.plain_text || '').join('').trim();
      if (text) return text;
    }
  }
  return '';
}

export function buildPageContent(page) {
  const title   = extractPageTitle(page);
  const pageUrl = page.url || '';
  const edited  = page.last_edited_time || '';
  if (!title && !pageUrl) return `[Notion页面] ${page.id}`;
  const parts = [];
  if (title) parts.push(title);
  if (edited) parts.push(`最后编辑：${edited}`);
  if (pageUrl) parts.push(pageUrl);
  return parts.join('\n');
}

// ── 自 gate ───────────────────────────────────────────────────────

async function isGated(pool) {
  try {
    const { rows } = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1',
      [GATE_KEY]
    );
    if (!rows.length) return false;
    const ts = rows[0].value_json?.ts;
    if (!ts) return false;
    return Date.now() - new Date(ts).getTime() < GATE_MS;
  } catch { return false; }
}

async function updateGate(pool) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [GATE_KEY, JSON.stringify({ ts: new Date().toISOString() })]
  );
}

// ── 游标管理 ──────────────────────────────────────────────────────

async function readCursor(pool, dbId) {
  const { rows } = await pool.query(
    'SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1',
    [`notion_capture_ingest:cursor:${dbId}`]
  );
  return rows[0]?.value_json?.last_edited_time || null;
}

async function writeCursor(pool, dbId, lastEditedTime) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [`notion_capture_ingest:cursor:${dbId}`, JSON.stringify({ last_edited_time: lastEditedTime })]
  );
}

// ── 核心单页写入（幂等） ───────────────────────────────────────────

export async function ingestPage(pool, page) {
  const notionPageId = page.id;
  const dedupeKey    = `notion:inbox:${notionPageId}`;
  const content      = buildPageContent(page);
  const MAX_LEN      = 2000;
  const truncated    = content.slice(0, MAX_LEN);

  // 1. 信封 upsert（ON CONFLICT dedupe_key DO UPDATE）
  const { rows } = await pool.query(
    `INSERT INTO captures (content, source, dedupe_key, notion_page_id, status)
     VALUES ($1, 'notion_inbox', $2, $3, 'captured')
     ON CONFLICT (dedupe_key) DO UPDATE
       SET content = EXCLUDED.content,
           notion_page_id = COALESCE(captures.notion_page_id, EXCLUDED.notion_page_id),
           updated_at = now()
     RETURNING id`,
    [truncated, dedupeKey, notionPageId]
  );
  const captureId = rows[0]?.id;
  if (!captureId) return null;

  // 2. 原子 INSERT（ON CONFLICT notion_page_id DO NOTHING → 防重编辑产生第二条）
  await pool.query(
    `INSERT INTO capture_atoms (capture_id, content, target_type, lane, notion_page_id)
     VALUES ($1, $2, 'inbox', 'notion_inbox', $3)
     ON CONFLICT (notion_page_id) DO NOTHING`,
    [captureId, truncated, notionPageId]
  );

  return captureId;
}

// ── 主入口 ────────────────────────────────────────────────────────

/**
 * runNotionCaptureIngest — 由 scheduler-jobs 每轮调用。
 *
 * @returns {{ skipped: boolean, dbsProcessed: number, ingested: number, errors: number }}
 */
export async function runNotionCaptureIngest(pool, deps = {}) {
  if (await isGated(pool)) {
    return { skipped: true, dbsProcessed: 0, ingested: 0, errors: 0 };
  }

  const dbIds = deps.resolveDbIds ? deps.resolveDbIds() : resolveInboxDbIds();
  if (dbIds.length === 0) {
    console.log('[notion-capture-ingest] NOTION_INBOX_DB_IDS 未配置，跳过');
    await updateGate(pool);
    return { skipped: true, dbsProcessed: 0, ingested: 0, errors: 0 };
  }

  let token;
  try {
    const tokenFn = deps.resolveNotionToken || (() => resolveNotionToken(deps));
    token = await tokenFn();
  } catch (err) {
    console.warn(`[notion-capture-ingest] 凭据加载失败（跳过）: ${err.message}`);
    return { skipped: true, dbsProcessed: 0, ingested: 0, errors: 0 };
  }

  await updateGate(pool);

  let totalIngested = 0;
  let totalErrors   = 0;
  let dbsProcessed  = 0;

  for (const dbId of dbIds) {
    try {
      const cursor = await readCursor(pool, dbId);
      const pages  = await fetchInboxPages(token, dbId, cursor, deps);
      console.log(`[notion-capture-ingest] db=${dbId} cursor=${cursor || 'none'} pages=${pages.length}`);

      let lastEditedTime = cursor;
      for (const page of pages) {
        try {
          await ingestPage(pool, page);
          totalIngested++;
          if (!lastEditedTime || page.last_edited_time > lastEditedTime) {
            lastEditedTime = page.last_edited_time;
          }
        } catch (pageErr) {
          console.warn(`[notion-capture-ingest] 页面写入失败 page=${page.id}: ${pageErr.message}`);
          totalErrors++;
        }
      }

      if (lastEditedTime && lastEditedTime !== cursor) {
        await writeCursor(pool, dbId, lastEditedTime);
      }
      dbsProcessed++;
    } catch (dbErr) {
      console.error(`[notion-capture-ingest] 库拉取失败 db=${dbId}: ${dbErr.message}`);
      totalErrors++;
    }
  }

  return {
    skipped: false,
    dbsProcessed,
    ingested: totalIngested,
    errors: totalErrors,
  };
}
