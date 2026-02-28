/**
 * 一次性脚本：为 memory_stream 历史记录批量生成 embedding
 * 优先处理高重要性记录（importance DESC）
 */
import pg from 'pg';
import OpenAI from 'openai';

const { Pool } = pg;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'cecelia',
  user: 'cecelia',
  password: 'cecelia',
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 4000),
    encoding_format: 'float',
  });
  return response.data[0].embedding;
}

async function main() {
  // 查询没有 embedding 的记录，按重要性排序
  const { rows: total } = await pool.query(
    `SELECT COUNT(*) as n FROM memory_stream WHERE embedding IS NULL`
  );
  console.log(`待处理记录总数: ${total[0].n}`);

  const { rows } = await pool.query(`
    SELECT id, content, importance
    FROM memory_stream
    WHERE embedding IS NULL
      AND (source_type IS NULL OR source_type != 'self_model')
    ORDER BY importance DESC, created_at DESC
    LIMIT 2000
  `);

  console.log(`本次处理: ${rows.length} 条（importance DESC 排序，最多2000条）\n`);

  const BATCH_SIZE = 20;
  let done = 0, failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (row) => {
      try {
        const text = (row.content || '').substring(0, 4000);
        const embedding = await generateEmbedding(text);
        const embStr = '[' + embedding.join(',') + ']';
        await pool.query(
          `UPDATE memory_stream SET embedding = $1::vector WHERE id = $2`,
          [embStr, row.id]
        );
        done++;
      } catch (err) {
        failed++;
        console.error(`  ✗ id=${row.id} importance=${row.importance}: ${err.message}`);
      }
    }));

    const pct = Math.round((i + batch.length) / rows.length * 100);
    console.log(`  进度: ${i + batch.length}/${rows.length} (${pct}%) ✓${done} ✗${failed}`);

    // 批次间停顿 200ms，避免触发速率限制
    if (i + BATCH_SIZE < rows.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // 最终统计
  const { rows: after } = await pool.query(
    `SELECT COUNT(*) n FROM memory_stream WHERE embedding IS NOT NULL`
  );
  console.log(`\n完成！memory_stream 已有 embedding: ${after[0].n} 条`);
  console.log(`成功: ${done}  失败: ${failed}`);

  await pool.end();
}

main().catch(err => {
  console.error('脚本失败:', err.message);
  process.exit(1);
});
