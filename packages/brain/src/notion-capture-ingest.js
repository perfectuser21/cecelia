/**
 * notion-capture-ingest.js — Notion 个人 Inbox 增量采集（F6加厚）
 *
 * 每5分钟轮询 Notion Inbox 数据库，增量拉取新增/编辑页面，
 * 通过 dedupe_key='notion:inbox:<page_id>' 幂等写入 captures + capture_atoms。
 *
 * 凭据（均从 process.env 读取，来源 1Password CS "Notion-juke"（bot=cc20260728））：
 *   NOTION_INBOX_TOKEN  — Notion Integration Token（Notion-juke，workspace=Zenithjoy-July）
 *   NOTION_INBOX_DB_ID  — 个人 Inbox 数据库 ID
 *
 * 两项均为可选：未配置时静默跳过，不影响其他 job。
 */

import { pushCapture } from './capture-inbox.js';
import pool from './db.js';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const INTERVAL_MS = 5 * 60 * 1000;
// 首次运行回溯窗口（防止冷启动全量拉历史记录）
const COLD_START_LOOKBACK_MS = 24 * 60 * 60 * 1000;

let lastRunAt = 0;
let lastSyncAt = null;

export function __resetNotionCaptureIngestForTest() {
  lastRunAt = 0;
  lastSyncAt = null;
}

export function getNotionInboxConfig() {
  return {
    token: process.env.NOTION_INBOX_TOKEN ?? null,
    dbId: process.env.NOTION_INBOX_DB_ID ?? null,
  };
}

export async function notionRequest(token, path, method = 'GET', body = null) {
  const url = `${NOTION_API_BASE}${path}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
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

    let res;
    try {
      res = await fetch(url, opts);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }
    const data = await res.json();
    if (res.ok) return data;

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 3) {
      const retryAfterSeconds = Number.parseFloat(res.headers?.get?.('retry-after') ?? '');
      const delayMs = Number.isFinite(retryAfterSeconds)
        ? Math.max(0, retryAfterSeconds * 1000)
        : 500 * (attempt + 1);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }
    const err = new Error(`Notion API ${method} ${path} → ${res.status}: ${data.message ?? 'unknown'}`);
    err.status = res.status;
    err.notionCode = data.code;
    throw err;
  }
  throw new Error(`Notion API ${method} ${path} retry exhausted`);
}

/**
 * 从 Notion 页面 properties 中提取标题文本。
 * 遍历常见标题字段名，再 fallback 至任意 title 类型属性。
 */
export function extractPageTitle(page) {
  const props = page.properties ?? {};
  for (const key of ['Name', 'Title', '名称', '标题']) {
    const prop = props[key];
    if (prop?.title?.length) {
      return prop.title.map(t => t.plain_text ?? '').join('').trim();
    }
  }
  // fallback: 任意 title 类型属性
  for (const prop of Object.values(props)) {
    if (prop?.type === 'title' && Array.isArray(prop.title) && prop.title.length) {
      return prop.title.map(t => t.plain_text ?? '').join('').trim();
    }
  }
  return `Notion page ${page.id}`;
}

/**
 * 分页拉取 Notion Inbox 数据库页面（按 last_edited_time 增量）。
 */
export async function fetchInboxPages(token, dbId, after) {
  const filter = after ? {
    filter: {
      timestamp: 'last_edited_time',
      last_edited_time: { after },
    },
  } : {};

  const pages = [];
  let cursor;
  do {
    const body = {
      ...filter,
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    };
    const data = await notionRequest(token, `/databases/${dbId}/query`, 'POST', body);
    pages.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return pages;
}

/**
 * 主入口（scheduler-jobs handler）。
 * 内置5分钟间隔 gate；NOTION_INBOX_TOKEN / NOTION_INBOX_DB_ID 未配置时静默跳过。
 *
 * @param {object} [poolOverride]  测试注入用 mock pool
 * @returns {{ skipped, pushed, errors, pages } | { skipped, reason }}
 */
export async function runNotionCaptureIngest(poolOverride) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true };

  const { token, dbId } = getNotionInboxConfig();
  if (!token || !dbId) {
    lastRunAt = now;
    return { skipped: true, reason: 'not_configured' };
  }

  lastRunAt = now;
  const db = poolOverride ?? pool;
  const after = lastSyncAt ?? new Date(now - COLD_START_LOOKBACK_MS).toISOString();
  const syncStart = new Date(now).toISOString();

  let pushed = 0, skipped = 0, errors = 0;

  try {
    const pages = await fetchInboxPages(token, dbId, after);

    for (const page of pages) {
      try {
        const pageId = page.id;
        const title = extractPageTitle(page);
        const content = title || `Notion page ${pageId}`;

        const result = await pushCapture(db, {
          content,
          source: 'notion',
          nature: null,
          dedupeKey: `notion:inbox:${pageId}`,
          notionPageId: pageId,
          targetType: 'notes',
          targetSubtype: 'notion_inbox',
        });

        if (!result || result.dedupeHit) skipped++;
        else pushed++;
      } catch (pageErr) {
        console.warn(`[notion-capture-ingest] page ${page.id} error: ${pageErr.message}`);
        errors++;
      }
    }

    lastSyncAt = syncStart;
    console.log(`[notion-capture-ingest] done pages=${pages.length} pushed=${pushed} skipped=${skipped} errors=${errors}`);
    return { pushed, skipped, errors, pages: pages.length };
  } catch (err) {
    console.error(`[notion-capture-ingest] fetch error: ${err.message}`);
    return { pushed, skipped, errors, fatal: err.message };
  }
}
