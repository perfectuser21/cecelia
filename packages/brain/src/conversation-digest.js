/**
 * Conversation Digest - Brain 自动读取 Claude Code 对话日志
 *
 * 机制：Brain tick 每 5 分钟调用一次 runConversationDigest()
 * 来源：~/.claude-account1/projects/{slug}/*.jsonl（Claude Code 写入）
 * 条件：session 内 human 消息 >= 8 条，或最后消息距今 >= 30 分钟
 * 动作：读新增消息 → LLM 提炼 5 维度 → 写入 conversation_captures + decisions
 * 游标：conversation_log_cursors 表，按行追踪处理进度，避免重复处理
 */

/* global console, process */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import pool from './db.js';
import { callLLM } from './llm-caller.js';

const HUMAN_MSG_THRESHOLD = 8;          // 触发阈值：human 消息条数
const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 触发阈值：最后消息距今 30 分钟
const MAX_MESSAGES_PER_DIGEST = 200;    // 单次分析最多消息数，防超 token
const LOG_DIRS = [
  path.join(os.homedir(), '.claude-account1', 'projects'),
  path.join(os.homedir(), '.claude-account2', 'projects'),
  path.join(os.homedir(), '.claude-account3', 'projects'),
  path.join(os.homedir(), '.claude', 'projects'),
];

// ─── 扫描日志目录 ────────────────────────────────────────────────────────────

/**
 * 扫描所有可能的 Claude Code 日志目录，收集 .jsonl 文件路径
 * @returns {string[]} 所有 .jsonl 文件的绝对路径
 */
export function scanLogDirectory() {
  const files = [];
  for (const baseDir of LOG_DIRS) {
    if (!fs.existsSync(baseDir)) continue;
    try {
      const slugDirs = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const slug of slugDirs) {
        if (!slug.isDirectory()) continue;
        const slugPath = path.join(baseDir, slug.name);
        try {
          const entries = fs.readdirSync(slugPath);
          for (const entry of entries) {
            if (entry.endsWith('.jsonl')) {
              files.push(path.join(slugPath, entry));
            }
          }
        } catch {
          // 目录无读取权限，跳过
        }
      }
    } catch {
      // 基础目录无读取权限，跳过
    }
  }
  return files;
}

// ─── 读取新增消息 ─────────────────────────────────────────────────────────────

/**
 * 从 .jsonl 文件中读取 fromLine 行之后的新消息
 * @param {string} filePath
 * @param {number} fromLine - 上次处理到的行号（0 表示从头读）
 * @returns {{ messages: Array<{role:string,content:string,ts:number}>, totalLines: number }}
 */
export function readNewMessages(filePath, fromLine = 0) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const newLines = lines.slice(fromLine);
    const messages = [];

    for (const line of newLines) {
      try {
        const entry = JSON.parse(line);
        // Claude Code .jsonl 格式：{ type, message: { role, content }, timestamp }
        const role = entry?.message?.role || entry?.role;
        const content = entry?.message?.content || entry?.content;
        const ts = entry?.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

        if (!role || !content) continue;
        if (role !== 'human' && role !== 'assistant') continue;

        const text = typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.map(c => c?.text || c?.content || '').filter(Boolean).join('\n')
            : String(content);

        if (text.trim()) {
          messages.push({ role, content: text.trim(), ts });
        }
      } catch {
        // 单行 JSON 解析失败，跳过
      }
    }

    return { messages, totalLines: lines.length };
  } catch (err) {
    console.warn(`[conversation-digest] readNewMessages error: ${filePath}: ${err.message}`);
    return { messages: [], totalLines: fromLine };
  }
}

// ─── 触发阈值判断 ─────────────────────────────────────────────────────────────

/**
 * 判断是否满足触发 digest 的阈值
 * @param {Array<{role:string,content:string,ts:number}>} messages
 * @returns {boolean}
 */
export function shouldTriggerDigest(messages) {
  if (!messages || messages.length === 0) return false;

  const humanCount = messages.filter(m => m.role === 'human').length;
  if (humanCount >= HUMAN_MSG_THRESHOLD) return true;

  const lastMsg = messages[messages.length - 1];
  if (lastMsg && Date.now() - lastMsg.ts >= IDLE_THRESHOLD_MS && humanCount >= 2) return true;

  return false;
}

// ─── LLM 分析 ─────────────────────────────────────────────────────────────────

/**
 * 调用 LLM 提炼对话的 5 个维度
 * @param {Array<{role:string,content:string,ts:number}>} messages
 * @returns {Promise<{decisions:string[],ideas:string[],open_questions:string[],tensions:string[],summary:string}>}
 */
export async function analyzeWithLLM(messages) {
  // 裁剪到最多 MAX_MESSAGES_PER_DIGEST 条，优先保留最新的
  const trimmed = messages.slice(-MAX_MESSAGES_PER_DIGEST);

  const dialogue = trimmed
    .map(m => `[${m.role === 'human' ? 'User' : 'Assistant'}] ${m.content.slice(0, 500)}`)
    .join('\n\n');

  const prompt = `你是一个对话分析助手。请分析以下 Claude Code 工作对话，提炼关键信息。

<dialogue>
${dialogue}
</dialogue>

请严格按如下 JSON 格式输出（不要有任何其他文字）：
{
  "decisions": ["明确做出的决定1", "决定2"],
  "ideas": ["提出的新想法1", "想法2"],
  "open_questions": ["待确认的问题1", "问题2"],
  "tensions": ["存在矛盾或分歧1", "矛盾2"],
  "summary": "整体对话摘要，3-5句话，描述本次对话的主要目标、完成情况和关键结论。"
}

规则：
- 每个数组最多 5 条，每条不超过 100 字
- summary 不超过 300 字
- 若某维度没有内容，返回空数组 []
- 只提炼真实出现的内容，不要编造`;

  try {
    const { text } = await callLLM('thalamus', prompt, { maxTokens: 800, timeout: 60000 });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM 返回格式错误，未找到 JSON 块');
    const result = JSON.parse(jsonMatch[0]);
    return {
      decisions: Array.isArray(result.decisions) ? result.decisions : [],
      ideas: Array.isArray(result.ideas) ? result.ideas : [],
      open_questions: Array.isArray(result.open_questions) ? result.open_questions : [],
      tensions: Array.isArray(result.tensions) ? result.tensions : [],
      summary: String(result.summary || '').slice(0, 500),
    };
  } catch (err) {
    console.error(`[conversation-digest] analyzeWithLLM failed: ${err.message}`);
    return { decisions: [], ideas: [], open_questions: [], tensions: [], summary: '' };
  }
}

// ─── 持久化结果 ───────────────────────────────────────────────────────────────

/**
 * 将分析结果写入 conversation_captures + decisions 表
 * @param {string} sessionId
 * @param {string} sourceFile
 * @param {{ decisions, ideas, open_questions, tensions, summary }} result
 */
export async function persistDigest(sessionId, sourceFile, result) {
  if (!result.summary) return; // 无实质内容，跳过

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 写 conversation_captures
    await client.query(`
      INSERT INTO conversation_captures (
        session_id, session_date, summary,
        key_decisions, key_insights, action_items,
        ideas, open_questions, tensions,
        source_file, digest_method,
        author, made_by
      ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'cecelia', 'system')
      ON CONFLICT DO NOTHING
    `, [
      sessionId,
      result.summary,
      result.decisions,
      result.ideas,
      [],
      result.ideas,
      result.open_questions,
      result.tensions,
      sourceFile,
      'conversation_digest',
    ]);

    // 2. 写 decisions 表（每条 decision 单独写，去重）
    for (const decision of result.decisions) {
      if (!decision || !decision.trim()) continue;
      const contentHash = crypto
        .createHash('sha256')
        .update(`${sessionId}\n${decision}`)
        .digest('hex');
      await client.query(`
        INSERT INTO decisions (title, content, category, source, content_hash, priority, status, is_active)
        VALUES ($1, $2, 'conversation_decision', 'conversation_digest', $3, 1, 'active', true)
        ON CONFLICT (content_hash) DO NOTHING
      `, [decision.slice(0, 120), decision, contentHash]);
    }

    await client.query('COMMIT');
    console.log(`[conversation-digest] persistDigest: session=${sessionId}, decisions=${result.decisions.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[conversation-digest] persistDigest failed: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

// ─── 游标管理 ─────────────────────────────────────────────────────────────────

/**
 * 读取或初始化文件游标
 * @param {string} filePath
 * @returns {Promise<{id:string, lastLine:number, status:string}>}
 */
async function getCursor(filePath) {
  const result = await pool.query(
    `SELECT id, last_line_processed, digest_status FROM conversation_log_cursors WHERE file_path = $1`,
    [filePath]
  );
  if (result.rows.length > 0) {
    return {
      id: result.rows[0].id,
      lastLine: result.rows[0].last_line_processed,
      status: result.rows[0].digest_status,
    };
  }
  const insert = await pool.query(
    `INSERT INTO conversation_log_cursors (file_path, digest_status) VALUES ($1, 'pending') RETURNING id`,
    [filePath]
  );
  return { id: insert.rows[0].id, lastLine: 0, status: 'pending' };
}

/**
 * 更新游标
 * @param {string} id
 * @param {number} lastLine
 * @param {string} status
 * @param {string|null} sessionId
 */
async function updateCursor(id, lastLine, status, sessionId = null) {
  await pool.query(
    `UPDATE conversation_log_cursors
     SET last_line_processed = $2, digest_status = $3, session_id = COALESCE($4, session_id),
         last_processed_at = now(), updated_at = now()
     WHERE id = $1`,
    [id, lastLine, status, sessionId]
  );
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

let _running = false;

/**
 * Brain tick 调用的主入口：扫描日志目录，处理满足阈值的 session
 */
export async function runConversationDigest() {
  if (_running) {
    console.log('[conversation-digest] 上一轮仍在运行，跳过');
    return;
  }
  _running = true;
  try {
    const files = scanLogDirectory();
    if (files.length === 0) {
      console.log('[conversation-digest] 未发现 .jsonl 日志文件');
      return;
    }

    let processed = 0;
    for (const filePath of files) {
      try {
        const cursor = await getCursor(filePath);
        if (cursor.status === 'done') continue;

        const { messages, totalLines } = readNewMessages(filePath, cursor.lastLine);
        if (messages.length === 0) continue;

        if (!shouldTriggerDigest(messages)) continue;

        await updateCursor(cursor.id, totalLines, 'processing');

        const sessionId = path.basename(filePath, '.jsonl');
        const result = await analyzeWithLLM(messages);
        await persistDigest(sessionId, filePath, result);

        await updateCursor(cursor.id, totalLines, 'done', sessionId);
        processed++;
      } catch (fileErr) {
        console.error(`[conversation-digest] 处理失败: ${filePath}: ${fileErr.message}`);
      }
    }

    if (processed > 0) {
      console.log(`[conversation-digest] 本轮完成，处理了 ${processed} 个 session`);
    }
  } finally {
    _running = false;
  }
}
