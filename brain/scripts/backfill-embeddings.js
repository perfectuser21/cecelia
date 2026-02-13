/**
 * Backfill Embeddings Script
 *
 * Generates embeddings for existing tasks, projects, and goals.
 * Run after migration 028 to populate embedding columns.
 *
 * Usage:
 *   node brain/scripts/backfill-embeddings.js [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run: Show what would be updated without actually updating
 *   --limit N: Only process N records per table (for testing)
 */

import pool from '../src/db.js';
import { generateEmbedding } from '../src/openai-client.js';

const BATCH_SIZE = 100;  // Process in batches to avoid memory issues
const RATE_LIMIT_DELAY = 100;  // ms between API calls (10 calls/sec)

// Parse CLI arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : null;

console.log('🔄 Backfill Embeddings Script');
console.log(`   Dry run: ${dryRun ? 'YES' : 'NO'}`);
if (limit) console.log(`   Limit: ${limit} records per table`);
console.log('');

/**
 * Backfill embeddings for a specific table
 * @param {string} tableName - Table name (tasks, projects, goals)
 * @param {string} textColumn - Column to use for embedding (title, name, etc.)
 * @param {string} descriptionColumn - Description column (optional)
 */
async function backfillTable(tableName, textColumn, descriptionColumn = null) {
  console.log(`📊 Processing table: ${tableName}`);

  // Count total records
  const countQuery = `SELECT COUNT(*) FROM ${tableName} WHERE embedding IS NULL`;
  const countResult = await pool.query(countQuery);
  const total = parseInt(countResult.rows[0].count, 10);

  if (total === 0) {
    console.log(`   ✅ No records to backfill`);
    console.log('');
    return { processed: 0, failed: 0 };
  }

  console.log(`   Total records: ${total}`);

  // Build query
  let selectQuery = `
    SELECT id, ${textColumn}${descriptionColumn ? `, ${descriptionColumn}` : ''}
    FROM ${tableName}
    WHERE embedding IS NULL
    ORDER BY created_at DESC
  `;

  if (limit) {
    selectQuery += ` LIMIT ${limit}`;
  }

  const result = await pool.query(selectQuery);
  const records = result.rows;

  console.log(`   Records to process: ${records.length}`);

  let processed = 0;
  let failed = 0;
  const failedRecords = [];

  // Process in batches
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, Math.min(i + BATCH_SIZE, records.length));
    console.log(`   Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(records.length / BATCH_SIZE)}...`);

    for (const record of batch) {
      try {
        // Build text for embedding
        let text = record[textColumn] || '';
        if (descriptionColumn && record[descriptionColumn]) {
          text += ' ' + record[descriptionColumn];
        }

        if (!text.trim()) {
          console.warn(`     ⚠️  Record ${record.id} has no text, skipping`);
          continue;
        }

        // Generate embedding
        const embedding = await generateEmbedding(text);

        // Update database
        if (!dryRun) {
          const embeddingStr = `[${embedding.join(',')}]`;
          await pool.query(
            `UPDATE ${tableName} SET embedding = $1::vector WHERE id = $2`,
            [embeddingStr, record.id]
          );
        }

        processed++;

        // Rate limiting
        if (processed % 10 === 0) {
          console.log(`     Progress: ${processed}/${records.length}`);
        }

        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

      } catch (error) {
        console.error(`     ❌ Failed to process record ${record.id}:`, error.message);
        failed++;
        failedRecords.push({ id: record.id, error: error.message });
      }
    }
  }

  console.log(`   ✅ Processed: ${processed}`);
  if (failed > 0) {
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   Failed records:`, failedRecords);
  }
  console.log('');

  return { processed, failed, failedRecords };
}

/**
 * Main function
 */
async function main() {
  try {
    // Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OPENAI_API_KEY not set in environment');
      process.exit(1);
    }

    // Test OpenAI connection
    console.log('🔌 Testing OpenAI connection...');
    try {
      await generateEmbedding('test');
      console.log('   ✅ OpenAI API connection OK');
      console.log('');
    } catch (error) {
      console.error('   ❌ OpenAI API connection failed:', error.message);
      process.exit(1);
    }

    const startTime = Date.now();
    const results = {};

    // Backfill tasks
    results.tasks = await backfillTable('tasks', 'title', 'description');

    // Backfill projects
    results.projects = await backfillTable('projects', 'name', 'description');

    // Backfill goals (KRs)
    results.goals = await backfillTable('key_results', 'title', null);

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Summary
    console.log('📋 Summary:');
    console.log(`   Tasks: ${results.tasks.processed} processed, ${results.tasks.failed} failed`);
    console.log(`   Projects: ${results.projects.processed} processed, ${results.projects.failed} failed`);
    console.log(`   Goals: ${results.goals.processed} processed, ${results.goals.failed} failed`);
    console.log(`   Total time: ${elapsed}s`);
    console.log('');

    const totalFailed = results.tasks.failed + results.projects.failed + results.goals.failed;
    if (totalFailed > 0) {
      console.warn('⚠️  Some records failed. Review logs and retry.');
      process.exit(1);
    }

    console.log('✅ Backfill completed successfully');
    process.exit(0);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run
main();
