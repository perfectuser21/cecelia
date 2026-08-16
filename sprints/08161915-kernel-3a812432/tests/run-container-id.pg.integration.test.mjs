import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DB_URL = process.env.DB_URL || process.env.DATABASE_URL;

// 禁 mock 边：本文件 ↔ 真 Postgres（initiative_runs.container_id 写路径 / harness_attempts 同 run 共享读）。
// 由 brain-integration job 起真 Postgres 跑；无 DB_URL 时跳过（本机 proposer 环境 postgres 未注入）。
const d = DB_URL ? describe : describe.skip;

d('initiative_runs.container_id run-scoped column [BEHAVIOR][pg]', () => {
  it('initiative_runs exposes a container_id column (migration applied, real Postgres, no mock)', async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'initiative_runs' AND column_name = 'container_id'`,
      );
      expect(rows.length).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('harness_attempts exposes a container_id column so same-run attempts can share it', async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'harness_attempts' AND column_name = 'container_id'`,
      );
      expect(rows.length).toBe(1);
    } finally {
      await client.end();
    }
  });
});
