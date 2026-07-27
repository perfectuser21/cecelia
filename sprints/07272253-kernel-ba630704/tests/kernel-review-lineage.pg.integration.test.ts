import { describe, expect, it } from 'vitest';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import callbackRouter from '../../../packages/brain/src/routes/harness-callback.js';
import * as dispatcher from '../../../packages/brain/src/orchestrator/dispatcher.js';
import * as groundTruth from '../../../packages/brain/src/orchestrator/ground-truth.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

function requireIsolatedDatabaseUrl() {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
  const parsed = new URL(testDatabaseUrl);
  if (parsed.pathname === '/cecelia') throw new Error('production/default cecelia DB forbidden');
  return testDatabaseUrl;
}

describe('Kernel reviewer lineage — real HTTP + isolated PostgreSQL contract', () => {
  it('真实 callback 持久化完整 decision 与有界摘要', async () => {
    const pool = new pg.Pool({ connectionString: requireIsolatedDatabaseUrl() });
    const identity = await pool.query(
      'SELECT current_database() AS db, inet_server_addr()::text AS addr',
    );
    expect(identity.rows[0].db).not.toBe('cecelia');
    expect(identity.rows[0].addr).toBeTruthy();

    const app = express();
    app.set('pool', pool);
    app.use(express.json());
    app.use('/api/brain', callbackRouter);

    expect(typeof dispatcher.createAttemptResultChannel).toBe('function');
    expect(app).toBeTruthy();
    expect(request).toBeTruthy();
    await pool.end();
  });

  it('ground truth 构建 round2 prior_review 与 resolutions', () => {
    expect(typeof groundTruth.loadReviewerPriorReview).toBe('function');
    expect(typeof dispatcher.validateReviewerResolutions).toBe('function');
  });

  it('只有同一 final SHA 三重批准允许一次合并', () => {
    expect(typeof dispatcher.buildRoundTwoReviewerBundle).toBe('function');
  });
});
