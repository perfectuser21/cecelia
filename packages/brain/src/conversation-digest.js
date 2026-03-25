/**
 * Conversation Digest
 * 扫描 Claude Code .jsonl 对话日志，提炼 decisions/ideas/questions 写入 DB
 * Brain 后台每 5 分钟调用一次 runConversationDigest()
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import pool from './db.js';
import { callCortexLLM } from './cortex.js';

// 默认日志目录：~/.claude-account1/projects/
const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR
  || path.join(os.homedir(), '.claude-account1', 'projects');

// 触发分析的阈值
const MIN_HUMAN_MESSAGES = 8;
const IDLE_MINUTES = 30;

/**
 * 扫描日志目录，返回待处理的 .jsonl 文件列表
 * @param {string} dir
 * @returns {Array<{filePath: string, slug: string}>}
 */
export async function scanLogDirectory(dir = CLAUDE_PROJECTS_DIR) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const slugDirs = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const slug of slugDirs) {
    const slugPath = path.join(dir, slug);
    let files;
    try {
      files = fs.readdirSync(slugPath).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      results.push({ filePath: path.join(slugPath, file), slug });
    }
  }
  return results;
}

/**
 * 读取 .jsonl 文件，提取 human/assistant 消息对
 * @param {string} filePath
 * @param {number} fromLine - 从第几行开始读（0-based）
 * @returns {{messages: Array, totalLines: number, humanCount: number, lastTimestamp: Date|null}}
 */
function readLogMessages(filePath, fromLine = 0) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { messages: [], totalLines: 0, humanCount: 0, lastTimestamp: null };
  }

  const lines = content.split('\n').filter(l => l.trim());
  const totalLines = lines.length;
  const messages = [];
  let humanCount = 0;
  let lastTimestamp = null;

  for (let i = fromLine; i < lines.length; i++) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }

    const role = entry?.message?.role || entry?.role;
    const text = entry?.message?.content || entry?.content || '';
    const ts = entry?.timestamp ? new Date(entry.timestamp) : null;
    if (ts) lastTimestamp = ts;

    if (role === 'human' || role === 'user') {
      humanCount++;
      const textStr = typeof text === 'string' ? text : JSON.stringify(text);
      if (textStr.trim()) {
        messages.push({ role: 'human', content: textStr.slice(0, 2000) });
      }
    } else if (role === 'assistant') {
      const textStr = typeof text === 'string' ? text : JSON.stringify(text);
      if (textStr.trim()) {
        messages.push({ role: 'assistant', content: textStr.slice(0, 2000) });
      }
    }
  }

  return { messages, totalLines, humanCount, lastTimestamp };
}

/**
 * 判断是否满足分析阈值
 */
function meetsThreshold(humanCount, lastTimestamp) {
  if (humanCount >= MIN_HUMAN_MESSAGES) return true;
  if (lastTimestamp) {
    const minutesAgo = (Date.now() - lastTimestamp.getTime()) / 60000;
    if (minutesAgo > IDLE_MINUTES && humanCount > 0) return true;
  }
  return false;
}

/**
 * 调用 Cortex 分析对话，提炼 decisions/ideas/questions/tensions
 * @param {Array} messages
 * @param {string} slug
 * @returns {Object|null}
 */
export async function analyzeWithCortex(messages, slug) {
  if (!messages || messages.length === 0) return null;

  const transcript = messages
    .slice(-40) // 最近 40 条，避免太长
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n\n');

  const prompt = `你是 Cecelia Brain 的对话分析模块。
分析以下对话记录（来自项目: ${slug}），提炼出有价值的信息。

对话记录：
---
${transcript}
---

请以 JSON 格式返回（只返回 JSON，不要其他文字）：
{
  "decisions": ["决策1", "决策2"],
  "ideas": ["想法1", "想法2"],
  "open_questions": ["问题1", "问题2"],
  "tensions": ["矛盾/权衡1"],
  "summary": "2-3句话总结本次对话的核心主题"
}

注意：
- decisions: 明确做出的技术/产品决策
- ideas: 提出的新想法、方案、改进建议
- open_questions: 尚未解决的问题、待确认的事项
- tensions: 发现的矛盾、权衡取舍
- 如果某类为空则返回空数组
- summary: 简洁总结，帮助未来回顾时快速理解上下文`;

  try {
    const response = await callCortexLLM(prompt);
    // 尝试从响应中提取 JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn('[conversation-digest] Cortex 分析失败:', e.message);
    return null;
  }
}

/**
 * 将分析结果写入 DB
 * @param {Object} analysis - analyzeWithCortex 的返回值
 * @param {string} filePath
 * @param {string} slug
 * @param {string} captureId - conversation_captures 的 id
 */
export async function persistDigest(analysis, filePath, slug, captureId) {
  if (!analysis) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 写入 decisions 表
    for (const decision of (analysis.decisions || [])) {
      if (!decision.trim()) continue;
      await client.query(
        `INSERT INTO decisions (title, rationale, category, status, made_by, source_ref)
         VALUES ($1, $2, 'technical', 'active', 'user', $3)
         ON CONFLICT DO NOTHING`,
        [decision.slice(0, 200), decision, `conversation:${path.basename(filePath)}`]
      );
    }

    // 更新 conversation_captures 追加 analysis 字段
    if (captureId) {
      await client.query(
        `UPDATE conversation_captures
         SET analysis_result = $1, updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(analysis), captureId]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.warn('[conversation-digest] persistDigest 写入失败:', e.message);
  } finally {
    client.release();
  }
}

/**
 * 主入口：扫描 + 分析 + 写入
 * 每次最多处理 3 个文件，避免占用过多资源
 */
export async function runConversationDigest() {
  const files = await scanLogDirectory();
  if (files.length === 0) return;

  let processed = 0;
  const MAX_PER_RUN = 3;

  for (const { filePath, slug } of files) {
    if (processed >= MAX_PER_RUN) break;

    // 查询 cursor 状态
    let cursor;
    try {
      const res = await pool.query(
        `SELECT * FROM conversation_log_cursors WHERE file_path = $1`,
        [filePath]
      );
      cursor = res.rows[0];
    } catch (e) {
      console.warn('[conversation-digest] 查询 cursor 失败:', e.message);
      continue;
    }

    // 跳过已处理或处于 processing 状态的
    if (cursor?.digest_status === 'processing') continue;
    if (cursor?.digest_status === 'done') continue;

    const fromLine = cursor?.last_line_processed || 0;
    const { messages, totalLines, humanCount, lastTimestamp } = readLogMessages(filePath, fromLine);

    // 如果没有新内容，跳过
    if (totalLines <= fromLine) continue;

    const totalHumanCount = (cursor?.human_message_count || 0) + humanCount;

    // 不满足阈值，只更新 cursor 进度
    if (!meetsThreshold(totalHumanCount, lastTimestamp)) {
      try {
        await pool.query(
          `INSERT INTO conversation_log_cursors
             (file_path, project_slug, last_line_processed, total_lines_seen, human_message_count, digest_status, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', now())
           ON CONFLICT (file_path) DO UPDATE SET
             last_line_processed = $3,
             total_lines_seen = $4,
             human_message_count = $5,
             updated_at = now()`,
          [filePath, slug, totalLines, totalLines, totalHumanCount]
        );
      } catch (e) {
        console.warn('[conversation-digest] cursor 更新失败:', e.message);
      }
      continue;
    }

    processed++;

    // 标记为 processing
    try {
      await pool.query(
        `INSERT INTO conversation_log_cursors
           (file_path, project_slug, last_line_processed, total_lines_seen, human_message_count, digest_status, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'processing', now())
         ON CONFLICT (file_path) DO UPDATE SET
           digest_status = 'processing',
           last_line_processed = $3,
           total_lines_seen = $4,
           human_message_count = $5,
           updated_at = now()`,
        [filePath, slug, totalLines, totalLines, totalHumanCount]
      );
    } catch (e) {
      console.warn('[conversation-digest] 标记 processing 失败:', e.message);
      continue;
    }

    let captureId = null;
    let finalStatus = 'done';

    try {
      // 创建 conversation_captures 记录
      const capRes = await pool.query(
        `INSERT INTO conversation_captures
           (source_file, project_slug, capture_type, raw_content, status)
         VALUES ($1, $2, 'conversation_digest', $3, 'pending')
         RETURNING id`,
        [filePath, slug, JSON.stringify({ message_count: messages.length, human_count: totalHumanCount })]
      );
      captureId = capRes.rows[0]?.id;

      // 调用 Cortex 分析
      const analysis = await analyzeWithCortex(messages, slug);

      if (analysis) {
        await persistDigest(analysis, filePath, slug, captureId);
        // 更新 captures 状态
        if (captureId) {
          await pool.query(
            `UPDATE conversation_captures SET status = 'processed', updated_at = now() WHERE id = $1`,
            [captureId]
          );
        }
      } else {
        finalStatus = 'skipped';
      }
    } catch (e) {
      console.warn('[conversation-digest] 处理失败:', filePath, e.message);
      finalStatus = 'error';
    }

    // 更新 cursor 最终状态
    try {
      await pool.query(
        `UPDATE conversation_log_cursors
         SET digest_status = $1,
             last_processed_at = now(),
             digest_capture_id = $2,
             updated_at = now()
         WHERE file_path = $3`,
        [finalStatus, captureId, filePath]
      );
    } catch (e) {
      console.warn('[conversation-digest] cursor 最终状态更新失败:', e.message);
    }
  }
}
