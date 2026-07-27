import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createHarnessCommanderRouter } from '../harness-commander.js';

const runId = randomUUID();
const messageId = randomUUID();

function makeApp(pool) {
  const app = express();
  app.use('/api/brain/harness', createHarnessCommanderRouter({ pool }));
  return app;
}

function poolForReads() {
  return {
    connect: vi.fn(),
    query: vi.fn(async (sql) => {
      if (sql.includes('harness_commander_state')) {
        return {
          rows: [{
            run_id: runId,
            commander_id: randomUUID(),
            commander_mode: 'hybrid',
            provider: 'codex',
            account_id: 'team4',
            model: 'GPT-5.5',
            provider_session_id: 'private-session',
            event_cursor: '9',
            strategy_summary: {},
            active_risks: [],
            latest_guidance: {},
            status: 'ready',
            message_count: 1,
            message_token_count: 10,
            updated_at: new Date('2026-07-28T00:00:00.000Z'),
            callback_secret_hash: 'private',
          }],
        };
      }
      if (sql.includes('harness_run_events')) {
        return {
          rows: [{
            run_id: runId,
            cursor: '9',
            event_type: 'attempt.running',
            source_type: 'harness_attempt',
            source_id: randomUUID(),
            source_version: '2',
            payload: {
              status: 'running',
              task_bundle: { prompt: 'private raw prompt' },
            },
            occurred_at: new Date('2026-07-28T00:00:00.000Z'),
            created_at: new Date('2026-07-28T00:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('harness_actor_messages')) {
        return {
          rows: [{
            message_cursor: '3',
            message_id: messageId,
            run_id: runId,
            sender_role: 'commander',
            recipient_role: 'planner',
            thread_id: randomUUID(),
            correlation_id: randomUUID(),
            source_attempt_id: null,
            event_cursor: '9',
            message_type: 'instruction',
            payload: { guidance: 'Keep scope bounded.', prompt: 'private raw prompt' },
            evidence_refs: ['event:9'],
            dedupe_key: 'commander:planner:1',
            token_estimate: 10,
            delivery_status: 'accepted',
            provider_session_id: 'private-session',
          }],
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}

describe('Harness Commander read-only routes', () => {
  it('returns the strict Commander state whitelist', async () => {
    const response = await request(makeApp(poolForReads()))
      .get(`/api/brain/harness/runs/${runId}/commander`)
      .expect(200);

    expect(response.body).toMatchObject({
      run_id: runId,
      commander_mode: 'hybrid',
      event_cursor: 9,
    });
    expect(response.body).not.toHaveProperty('provider_session_id');
    expect(response.body).not.toHaveProperty('callback_secret_hash');
  });

  it('returns ascending bounded event and inbox projections without raw private fields', async () => {
    const pool = poolForReads();
    const app = makeApp(pool);
    const events = await request(app)
      .get(`/api/brain/harness/runs/${runId}/events?after=0&limit=100`)
      .expect(200);
    const inbox = await request(app)
      .get(`/api/brain/harness/runs/${runId}/actors/planner/inbox?after=0&limit=100`)
      .expect(200);

    expect(events.body.events[0]).toMatchObject({ cursor: 9, event_type: 'attempt.running' });
    expect(inbox.body.messages[0]).toMatchObject({ message_cursor: 3, message_id: messageId });
    expect(JSON.stringify({ events: events.body, inbox: inbox.body })).not.toMatch(
      /private-session|private raw prompt|task_bundle|provider_session_id/i,
    );
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('ORDER BY cursor ASC'))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('ORDER BY m.message_cursor ASC'))).toBe(true);
  });

  it('validates UUID, Actor key, cursor, and limit before querying', async () => {
    const pool = poolForReads();
    const app = makeApp(pool);

    await request(app).get('/api/brain/harness/runs/not-a-uuid/commander').expect(400);
    await request(app)
      .get(`/api/brain/harness/runs/${runId}/events?after=-1`)
      .expect(400);
    await request(app)
      .get(`/api/brain/harness/runs/${runId}/actors/root/inbox`)
      .expect(400);
    await request(app)
      .get(`/api/brain/harness/runs/${runId}/events?limit=201`)
      .expect(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 404 when Commander state is absent', async () => {
    const pool = {
      connect: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    await request(makeApp(pool))
      .get(`/api/brain/harness/runs/${runId}/commander`)
      .expect(404);
  });
});
