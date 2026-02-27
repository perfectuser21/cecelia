/**
 * memory_stream L1 历史记录反推脚本
 *
 * 为存量 memory_stream 记录批量生成 l1_content（结构化摘要）。
 * 新增记录由 reflection.js 的 generateMemoryStreamL1Async 自动处理，
 * 本脚本专门处理 PR #73 之前的历史存量。
 *
 * 使用方法：
 *   node src/scripts/backfill-l1.js              # 处理最多 100 条
 *   node src/scripts/backfill-l1.js --limit 20   # 最多处理 20 条
 *   node src/scripts/backfill-l1.js --dry-run    # 只查看数量，不生成
 *   npm run backfill:l1 -- --dry-run             # 同上
 */

/* global process, console */

import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { loadActiveProfile } from '../model-profile.js';

const { Pool } = pg;

// ─── L1 Prompt（与 memory-utils.js 保持一致）────────────────────────────────

export const L1_PROMPT_TEMPLATE = (content) =>
  `你是 Cecelia 的记忆整理系统。请将以下记忆内容提炼为结构化 L1 摘要（200字以内）。

记忆内容：
${content.slice(0, 1500)}

请严格按照以下格式输出，每项一行：
**核心事实**：[1-2句最关键的信息]
**背景场景**：[这条记忆发生的场景或触发条件]
**关键判断**：[这条记忆说明了什么，对决策有何意义]
**相关实体**：[涉及的人/系统/任务名称]

要求：简洁、结构化、不超过200字。`;

// ─── CLI 参数解析 ────────────────────────────────────────────────────────────

export function parseArgs(argv = process.argv.slice(2)) {
  let limit = 100;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) {
      const n = parseInt(argv[i + 1], 10);
      if (!isNaN(n) && n > 0) limit = n;
      i++;
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { limit, dryRun };
}

// ─── 查询待处理记录 ──────────────────────────────────────────────────────────

export async function fetchPendingRecords(pool, limit) {
  const { rows } = await pool.query(`
    SELECT id, content, importance
    FROM memory_stream
    WHERE l1_content IS NULL
      AND content IS NOT NULL
      AND content != ''
      AND (source_type IS NULL OR source_type != 'self_model')
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY importance DESC, created_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

// ─── 单条记录处理 ────────────────────────────────────────────────────────────

export async function processRecord(pool, callLLM, record) {
  const prompt = L1_PROMPT_TEMPLATE(record.content);

  const result = await callLLM('memory', prompt, {
    timeout: 30000,
    maxTokens: 300,
  });

  if (!result?.text) {
    throw new Error('LLM 返回空内容');
  }

  await pool.query(
    'UPDATE memory_stream SET l1_content = $1 WHERE id = $2',
    [result.text.trim(), record.id]
  );

  return result.text.trim();
}

// ─── 批量处理主逻辑 ──────────────────────────────────────────────────────────

const BATCH_SIZE = 10;
const BATCH_SLEEP_MS = 2000;

export async function runBackfill(pool, callLLM, records, { dryRun = false } = {}) {
  const total = records.length;

  if (dryRun) {
    console.log(`[backfill-l1] --dry-run 模式`);
    console.log(`[backfill-l1] 待处理: ${total} 条（l1_content IS NULL，按 importance DESC 排序）`);
    return { total, success: 0, failed: 0, skipped: total };
  }

  console.log(`[backfill-l1] 开始处理 ${total} 条记录...`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    try {
      await processRecord(pool, callLLM, record);
      success++;
      console.log(`[backfill-l1] [${i + 1}/${total}] ✅ ${record.id} (importance=${record.importance})`);
    } catch (err) {
      failed++;
      console.warn(`[backfill-l1] [${i + 1}/${total}] ❌ ${record.id}: ${err.message}`);
    }

    // 批间 sleep（每处理 BATCH_SIZE 条后）
    if ((i + 1) % BATCH_SIZE === 0 && i + 1 < records.length) {
      console.log(`[backfill-l1] 批次完成，等待 ${BATCH_SLEEP_MS}ms...`);
      await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS));
    }
  }

  console.log(`[backfill-l1] 完成：成功 ${success} 条，失败 ${failed} 条`);
  return { total, success, failed, skipped: 0 };
}

// ─── 主入口（直接运行时） ────────────────────────────────────────────────────

async function main() {
  const { limit, dryRun } = parseArgs();
  const pool = new Pool(DB_DEFAULTS);

  try {
    // 加载 model profile（callLLM 依赖 getActiveProfile）
    await loadActiveProfile(pool);

    const { callLLM } = await import('../llm-caller.js');

    // 查询待处理记录（dry-run 也查，用于显示数量）
    const records = await fetchPendingRecords(pool, limit);

    await runBackfill(pool, callLLM, records, { dryRun });
  } finally {
    await pool.end();
  }
}

// 直接运行时执行 main
const isMain = process.argv[1] && process.argv[1].includes('backfill-l1');
if (isMain) {
  main().catch((err) => {
    console.error('[backfill-l1] 致命错误:', err);
    process.exit(1);
  });
}
