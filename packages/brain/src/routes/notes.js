/**
 * Notion 写入路由 — Brain API
 *
 * POST /api/brain/notes            → 写 AI Notes DB，返回 {id, url, title}
 * POST /api/brain/notion/project   → 加 [Sprint] 前缀，写 Notion Projects DB
 * POST /api/brain/notion/task      → 加 [WSn] 前缀，写 Notion Tasks DB
 *
 * 所有端点复用 notionReq/getToken（与 recurring-notion-sync.js 同源）
 */

import { Router } from 'express';
import { notionReq, getToken } from '../recurring-notion-sync.js';

// Notion DB IDs
const AI_NOTES_DB = '185c40c2-ba63-828c-973f-81a9c4582cd6';
const PROJECTS_DB = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const TASKS_DB    = '185c40c2-ba63-828c-973f-81a9c4582cd6';

function buildRichText(text) {
  if (!text) return [];
  return [{ type: 'text', text: { content: String(text).slice(0, 2000) } }];
}

const router = Router();

/**
 * POST /api/brain/notes
 * Body: { title, content, type, initiative_id?, sprint_dir? }
 * Success 201: { id, url, title }
 * Error 400: { error } — missing required fields
 * Error 502: { error } — Notion API failure
 */
router.post('/notes', async (req, res) => {
  const { title, content, type } = req.body || {};

  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!content) return res.status(400).json({ error: 'content is required' });

  try {
    const token = getToken();
    const page = await notionReq(token, '/pages', 'POST', {
      parent: { database_id: AI_NOTES_DB },
      properties: {
        Title: { title: [{ text: { content: title } }] },
        ...(type && { Type: { select: { name: type } } }),
      },
      children: [{
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: buildRichText(content) },
      }],
    });

    return res.status(201).json({ id: page.id, url: page.url, title });
  } catch (err) {
    console.error('[POST /api/brain/notes]', err.message);
    return res.status(502).json({ error: `notion api error: ${err.message}` });
  }
});

/**
 * POST /api/brain/notion/project
 * Body: { title, status?, journey_id?, sprint_dir?, pr_url? }
 * Automatically prefixes title with "[Sprint]"
 * Success 201: { id, url, title }
 */
router.post('/notion/project', async (req, res) => {
  const { title, status } = req.body || {};

  if (!title) return res.status(400).json({ error: 'title is required' });

  const fullTitle = `[Sprint] ${title}`;

  try {
    const token = getToken();
    const properties = {
      Name: { title: [{ text: { content: fullTitle } }] },
    };
    if (status) properties.Status = { select: { name: status } };

    const page = await notionReq(token, '/pages', 'POST', {
      parent: { database_id: PROJECTS_DB },
      properties,
    });

    return res.status(201).json({ id: page.id, url: page.url, title: fullTitle });
  } catch (err) {
    console.error('[POST /api/brain/notion/project]', err.message);
    return res.status(502).json({ error: `notion api error: ${err.message}` });
  }
});

/**
 * POST /api/brain/notion/task
 * Body: { title, ws_number?, status?, sprint_dir? }
 * Prefixes title with "[WSn]" unless title already contains a WS prefix.
 * Success 201: { id, url, title }
 */
router.post('/notion/task', async (req, res) => {
  const { title, ws_number, status } = req.body || {};

  if (!title) return res.status(400).json({ error: 'title is required' });

  // Skip prefix if title already contains [WSn] or "WSn " pattern
  const wsAlreadyPresent = /\[WS\d+\]/.test(title) || /^WS\d+[\s:]/.test(title);
  const fullTitle = wsAlreadyPresent
    ? title
    : ws_number != null
      ? `[WS${ws_number}] ${title}`
      : title;

  try {
    const token = getToken();
    const properties = {
      Title: { title: [{ text: { content: fullTitle } }] },
    };

    const page = await notionReq(token, '/pages', 'POST', {
      parent: { database_id: TASKS_DB },
      properties,
      ...(status && {
        children: [{
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: buildRichText(`Status: ${status}`) },
        }],
      }),
    });

    return res.status(201).json({ id: page.id, url: page.url, title: fullTitle });
  } catch (err) {
    console.error('[POST /api/brain/notion/task]', err.message);
    return res.status(502).json({ error: `notion api error: ${err.message}` });
  }
});

export default router;
