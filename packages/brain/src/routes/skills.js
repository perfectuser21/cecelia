import { Router } from 'express';
import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import pool from '../db.js';
import { selectBestAccount } from '../account-usage.js';

const router = Router();
const VALID_STATUSES = ['active', 'deprecated', 'planned'];

/**
 * 从 claude --output-format stream-json 的单行 NDJSON 中提取增量文本。
 *
 * 真实格式（嵌套）：
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"Hello!"}]}}
 *
 * 注意：stream-json 每行是快照（不是 delta）。调用方需传入 lastLength 并取
 * fullText.slice(lastLength) 作为本次增量。本函数返回累积全文，delta 由调用方计算。
 *
 * @param {string} rawLine - NDJSON 一行
 * @returns {string|null} 当前累积全文（type=assistant）；其他 type 返回 null
 */
export function parseSkillChatStreamLine(rawLine) {
  const line = rawLine.trim();
  if (!line) return null;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (obj.type !== 'assistant') return null;
  const content = obj.message?.content;
  if (!Array.isArray(content)) return null;
  return content
    .filter(c => c && c.type === 'text')
    .map(c => c.text || '')
    .join('');
}

// GET /api/brain/skills
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const params = [];
    const clauses = [];

    if (req.query.status) {
      if (!VALID_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      params.push(req.query.status);
      clauses.push(`status = $${params.length}`);
    }
    const search = req.query.search || req.query.q;
    if (search) {
      const qv = `%${search}%`;
      params.push(qv, qv);
      clauses.push(`(name ILIKE $${params.length - 1} OR description ILIKE $${params.length})`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT id, notion_id, name, description, location, status, area_id, metadata, notion_synced_at, created_at, updated_at
       FROM skill_registry
       ${where}
       ORDER BY name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return res.json(rows);
  } catch (err) {
    console.error('[skills] GET error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/skills
router.post('/', async (req, res) => {
  try {
    const { name, description, location, status = 'active', metadata = {}, area_id, notion_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    const { rows } = await pool.query(
      `INSERT INTO skill_registry (name, description, location, status, metadata, area_id, notion_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name) DO UPDATE SET
         description = EXCLUDED.description,
         location = EXCLUDED.location,
         status = EXCLUDED.status,
         metadata = EXCLUDED.metadata,
         area_id = EXCLUDED.area_id,
         notion_id = EXCLUDED.notion_id,
         updated_at = NOW()
       RETURNING *`,
      [name, description || null, location || null, status, JSON.stringify(metadata), area_id || null, notion_id || null]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[skills] POST error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/skills/:id
router.patch('/:id', async (req, res) => {
  try {
    const { description, location, status, metadata, notion_id, area_id, notion_synced_at } = req.body;
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    const sets = [];
    const vals = [];
    if (description       !== undefined) { vals.push(description);              sets.push(`description = $${vals.length}`); }
    if (location          !== undefined) { vals.push(location);                 sets.push(`location = $${vals.length}`); }
    if (status            !== undefined) { vals.push(status);                   sets.push(`status = $${vals.length}`); }
    if (metadata          !== undefined) { vals.push(JSON.stringify(metadata)); sets.push(`metadata = $${vals.length}`); }
    if (notion_id         !== undefined) { vals.push(notion_id);                sets.push(`notion_id = $${vals.length}`); }
    if (area_id           !== undefined) { vals.push(area_id);                  sets.push(`area_id = $${vals.length}`); }
    if (notion_synced_at  !== undefined) { vals.push(notion_synced_at);         sets.push(`notion_synced_at = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    sets.push(`updated_at = NOW()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE skill_registry SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[skills] PATCH error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/skills/chat/stream
 * 对话式创建 Skill — SSE 端点
 *
 * 两个修复点：
 * ① 账号：通过 selectBestAccount 选 account1/account2 账号池，不用默认 OAuth（mmv 上已过期）
 * ② 格式：解析 stream-json 真实嵌套格式 {type:assistant,message:{content:[{type:text,text}]}}
 *         而非错误的平铺格式 {type:text,text}
 *
 * Body: { message: string, system?: string }
 * Response: text/event-stream
 *   data: {"delta":"..."}\n\n   (文本片段)
 *   event: done\ndata: {}\n\n  (结束)
 */
router.post('/chat/stream', async (req, res) => {
  const { message, system } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  res.on('close', () => { closed = true; });

  try {
    // ① 选账号池而非默认 OAuth（mmv 默认账号已过期）
    const FALLBACK_ACCOUNT = process.env.CECELIA_FALLBACK_ACCOUNT || 'account1';
    let accountId = FALLBACK_ACCOUNT;
    try {
      const selection = await selectBestAccount({ model: 'haiku' });
      if (selection) accountId = selection.accountId;
    } catch (selErr) {
      console.warn('[skills/chat/stream] selectBestAccount 失败，使用 fallback:', selErr.message);
    }

    const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude';
    const configDir = join(homedir(), `.claude-${accountId}`);
    const systemPrompt = (typeof system === 'string' && system.trim())
      ? system.trim()
      : '你是一个 Skill 设计助手，帮助用户设计和创建 Claude Code Skill（技能包）。';
    const fullPrompt = `${systemPrompt}\n\n用户：${message.trim()}`;

    const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
    delete env.CLAUDECODE; // 防止嵌套 claude 实例标志干扰

    const child = spawn(CLAUDE_BIN, ['-p', fullPrompt, '--output-format', 'stream-json'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastTextLength = 0;
    let stderr = '';
    let lineBuffer = '';

    child.stderr.on('data', d => { stderr += d.toString(); });

    child.stdout.on('data', chunk => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const rawLine of lines) {
        // ② 正确解析嵌套 stream-json 格式（非平铺 {type:text,text}）
        const fullText = parseSkillChatStreamLine(rawLine);
        if (fullText === null) continue;
        const delta = fullText.slice(lastTextLength);
        if (delta && !closed) {
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          lastTextLength = fullText.length;
        }
      }
    });

    child.on('close', code => {
      if (!closed) {
        if (code !== 0 && lastTextLength === 0) {
          res.write(`data: ${JSON.stringify({ error: `claude 退出码 ${code}: ${stderr.slice(0, 300)}` })}\n\n`);
        }
        res.write('event: done\ndata: {}\n\n');
        res.end();
      }
    });

    child.on('error', err => {
      if (!closed) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.write('event: done\ndata: {}\n\n');
        res.end();
      }
    });
  } catch (err) {
    console.error('[skills/chat/stream] error:', err.message);
    if (!closed) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  }
});

export default router;
