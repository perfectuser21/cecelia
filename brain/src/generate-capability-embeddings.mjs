#!/usr/bin/env node
/**
 * Generate Embeddings for Capabilities
 *
 * Reads all capabilities from the database and generates vector embeddings
 * for each capability using OpenAI's text-embedding-3-small model.
 *
 * The embedding is generated from the capability's name + description.
 *
 * Usage:
 *   node src/generate-capability-embeddings.mjs
 */

import pkg from 'pg';
const { Pool } = pkg;
import { generateEmbedding } from './openai-client.js';
import { DB_DEFAULTS } from './db-config.js';

// Database connection
const pool = new Pool(DB_DEFAULTS);

/**
 * Generate embedding text from capability
 * Combines name + description for richer semantic representation
 */
function generateEmbeddingText(capability) {
  const parts = [
    capability.name,
    capability.description || ''
  ].filter(Boolean);

  return parts.join('\n\n');
}

/**
 * Main execution
 */
async function main() {
  let client;

  try {
    console.log('🚀 Starting capability embeddings generation...\n');

    // Connect to database
    client = await pool.connect();
    console.log('✅ Connected to database');

    // Fetch all capabilities
    const result = await client.query(
      'SELECT id, name, description FROM capabilities ORDER BY id'
    );

    const capabilities = result.rows;
    console.log(`📊 Found ${capabilities.length} capabilities\n`);

    if (capabilities.length === 0) {
      console.log('⚠️  No capabilities found. Exiting.');
      return;
    }

    // Generate embeddings
    let successCount = 0;
    let failCount = 0;

    for (const capability of capabilities) {
      try {
        console.log(`Processing: ${capability.id}`);
        console.log(`  Name: ${capability.name}`);

        // Generate embedding text
        const text = generateEmbeddingText(capability);
        console.log(`  Text length: ${text.length} chars`);

        // Call OpenAI API
        const embedding = await generateEmbedding(text);
        console.log(`  Generated embedding: ${embedding.length} dimensions`);

        // Update database
        // pgvector accepts embedding as array or string
        await client.query(
          'UPDATE capabilities SET embedding = $1::vector WHERE id = $2',
          [JSON.stringify(embedding), capability.id]
        );

        successCount++;
        console.log(`  ✅ Updated\n`);

        // Rate limiting: wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        failCount++;
        console.error(`  ❌ Failed: ${error.message}\n`);
      }
    }

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Success: ${successCount}/${capabilities.length}`);
    console.log(`❌ Failed:  ${failCount}/${capabilities.length}`);

    // Verify results
    const verifyResult = await client.query(
      'SELECT COUNT(*) FROM capabilities WHERE embedding IS NOT NULL'
    );
    console.log(`📊 Total capabilities with embeddings: ${verifyResult.rows[0].count}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (failCount > 0) {
      console.log('\n⚠️  Some embeddings failed. You may need to re-run this script.');
      process.exit(1);
    } else {
      console.log('\n🎉 All embeddings generated successfully!');
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

// Run
main();
