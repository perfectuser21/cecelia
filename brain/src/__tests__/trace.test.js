/**
 * trace.test.js - Tests for trace SDK (v1.1.1)
 *
 * Covers:
 * - Phase 1: Data model (tables, views, functions)
 * - Phase 2: SDK (sanitize, classifyError, storeArtifact, traceStep, withSpan)
 * - Hard Boundaries validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pool from '../db.js';
import {
  sanitize,
  classifyError,
  storeArtifact,
  getArtifact,
  traceStep,
  withSpan,
  getActiveRuns,
  getRunSummary,
  getStuckRuns,
  getTopFailureReasons,
  getLastAliveSpan,
  EXECUTOR_HOSTS,
  STATUS,
  REASON_KIND,
  LAYER,
} from '../trace.js';
import { randomUUID } from 'crypto';

describe('Trace SDK - Phase 1: Data Model', () => {
  it('run_events table exists', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'run_events'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('run_artifacts table exists', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'run_artifacts'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('v_active_runs view exists', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_active_runs'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('v_run_summary view exists', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_run_summary'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('v_run_last_alive_span view exists', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_run_last_alive_span'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('v_top_failure_reasons view exists', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_top_failure_reasons'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('detect_stuck_runs() function exists', async () => {
    const result = await pool.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name = 'detect_stuck_runs'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('cleanup_expired_runs() function exists', async () => {
    const result = await pool.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name = 'cleanup_expired_runs'
    `);
    expect(result.rows.length).toBe(1);
  });
});

describe('Trace SDK - Phase 2: Sanitization', () => {
  it('sanitize() redacts sensitive keys', () => {
    const input = {
      username: 'test',
      password: 'secret123',
      api_key: 'key-12345',
      data: {
        token: 'abc',
        value: 42,
      },
    };

    const result = sanitize(input);

    expect(result.username).toBe('test');
    expect(result.password).toBe('[REDACTED]');
    expect(result.api_key).toBe('[REDACTED]');
    expect(result.data.token).toBe('[REDACTED]');
    expect(result.data.value).toBe(42);
  });

  it('sanitize() handles arrays', () => {
    const input = [
      { password: 'secret' },
      { value: 1 },
    ];

    const result = sanitize(input);

    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].value).toBe(1);
  });

  it('sanitize() handles null and primitives', () => {
    expect(sanitize(null)).toBe(null);
    expect(sanitize(undefined)).toBe(undefined);
    expect(sanitize(42)).toBe(42);
    expect(sanitize('string')).toBe('string');
  });
});

describe('Trace SDK - Phase 2: Error Classification', () => {
  it('classifyError() detects TRANSIENT errors', () => {
    const error = new Error('Connection timeout');
    const result = classifyError(error);

    expect(result.reason_code).toBe('TIMEOUT');
    expect(result.reason_kind).toBe(REASON_KIND.TRANSIENT);
  });

  it('classifyError() detects RESOURCE errors', () => {
    const error = new Error('out of memory');
    const result = classifyError(error);

    expect(result.reason_code).toBe('RESOURCE_EXHAUSTED');
    expect(result.reason_kind).toBe(REASON_KIND.RESOURCE);
  });

  it('classifyError() detects CONFIG errors', () => {
    const error = new Error('file not found');
    const result = classifyError(error);

    expect(result.reason_code).toBe('CONFIG_ERROR');
    expect(result.reason_kind).toBe(REASON_KIND.CONFIG);
  });

  it('classifyError() detects PERSISTENT errors', () => {
    const error = new Error('unauthorized');
    const result = classifyError(error);

    expect(result.reason_code).toBe('AUTH_OR_SELECTOR_ERROR');
    expect(result.reason_kind).toBe(REASON_KIND.PERSISTENT);
  });

  it('classifyError() defaults to UNKNOWN', () => {
    const error = new Error('something else');
    const result = classifyError(error);

    expect(result.reason_code).toBe('UNKNOWN_ERROR');
    expect(result.reason_kind).toBe(REASON_KIND.UNKNOWN);
  });
});

describe('Trace SDK - Phase 2: Artifact Management', () => {
  let testSpanId;

  beforeEach(async () => {
    // Create a test span
    testSpanId = randomUUID();
    await pool.query(
      `INSERT INTO run_events (span_id, run_id, layer, step_name, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [testSpanId, randomUUID(), LAYER.L0_ORCHESTRATOR, 'test', STATUS.SUCCESS]
    );
  });

  afterEach(async () => {
    // Cleanup
    await pool.query('DELETE FROM run_artifacts WHERE span_id = $1', [testSpanId]);
    await pool.query('DELETE FROM run_events WHERE span_id = $1', [testSpanId]);
  });

  it('storeArtifact() creates artifact with correct format (Hard Boundary #5)', async () => {
    const artifactId = await storeArtifact(
      testSpanId,
      'screenshot',
      'local',
      '/tmp/test.png',
      {
        contentType: 'image/png',
        sizeBytes: 12345,
      }
    );

    expect(artifactId).toMatch(/^[0-9a-f-]{36}$/); // UUID format

    const artifact = await getArtifact(artifactId);
    expect(artifact).not.toBeNull();
    expect(artifact.span_id).toBe(testSpanId);
    expect(artifact.artifact_type).toBe('screenshot');
    expect(artifact.storage_backend).toBe('local');
    expect(artifact.storage_key).toBe('/tmp/test.png');
    expect(artifact.content_type).toBe('image/png');
    expect(artifact.size_bytes).toBe('12345'); // PostgreSQL bigint returns as string
  });

  it('getArtifact() returns null for non-existent artifact', async () => {
    const artifact = await getArtifact(randomUUID());
    expect(artifact).toBeNull();
  });
});

describe('Trace SDK - Phase 2: TraceStep', () => {
  let testRunId;
  let createdSpans = [];

  beforeEach(() => {
    testRunId = randomUUID();
    createdSpans = [];
  });

  afterEach(async () => {
    // Cleanup all created spans
    for (const spanId of createdSpans) {
      await pool.query('DELETE FROM run_events WHERE span_id = $1', [spanId]);
    }
  });

  it('traceStep.start() inserts run_events with correct fields', async () => {
    const step = traceStep({
      runId: testRunId,
      layer: LAYER.L0_ORCHESTRATOR,
      stepName: 'test_step',
      executorHost: EXECUTOR_HOSTS.US_VPS,
      agent: 'test_agent',
      region: 'us',
      inputSummary: { test: 'data' },
    });

    await step.start();
    createdSpans.push(step.spanId);

    const result = await pool.query(
      'SELECT * FROM run_events WHERE span_id = $1',
      [step.spanId]
    );

    expect(result.rows.length).toBe(1);
    const row = result.rows[0];
    expect(row.run_id).toBe(testRunId);
    expect(row.layer).toBe(LAYER.L0_ORCHESTRATOR);
    expect(row.step_name).toBe('test_step');
    expect(row.status).toBe(STATUS.RUNNING);
    expect(row.executor_host).toBe(EXECUTOR_HOSTS.US_VPS);
    expect(row.agent).toBe('test_agent');
    expect(row.region).toBe('us');
  });

  it('traceStep.heartbeat() updates heartbeat_ts', async () => {
    const step = traceStep({
      runId: testRunId,
      layer: LAYER.L0_ORCHESTRATOR,
      stepName: 'test_heartbeat',
    });

    await step.start();
    createdSpans.push(step.spanId);

    const before = await pool.query(
      'SELECT heartbeat_ts FROM run_events WHERE span_id = $1',
      [step.spanId]
    );

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    await step.heartbeat();

    const after = await pool.query(
      'SELECT heartbeat_ts FROM run_events WHERE span_id = $1',
      [step.spanId]
    );

    // Heartbeat should be updated
    expect(new Date(after.rows[0].heartbeat_ts).getTime()).toBeGreaterThan(
      new Date(before.rows[0].heartbeat_ts).getTime()
    );
  });

  it('traceStep.end() updates status and stops heartbeat (Hard Boundary #4)', async () => {
    const step = traceStep({
      runId: testRunId,
      layer: LAYER.L0_ORCHESTRATOR,
      stepName: 'test_end',
    });

    await step.start();
    createdSpans.push(step.spanId);

    await step.end({
      status: STATUS.SUCCESS,
      outputSummary: { result: 'done' },
    });

    const result = await pool.query(
      'SELECT * FROM run_events WHERE span_id = $1',
      [step.spanId]
    );

    const row = result.rows[0];
    expect(row.status).toBe(STATUS.SUCCESS);
    expect(row.ts_end).not.toBeNull();
    expect(row.output_summary).toEqual({ result: 'done' });

    // Heartbeat interval should be stopped
    expect(step.heartbeatInterval).toBeNull();
  });

  it('traceStep.end() classifies error on failure', async () => {
    const step = traceStep({
      runId: testRunId,
      layer: LAYER.L0_ORCHESTRATOR,
      stepName: 'test_error',
    });

    await step.start();
    createdSpans.push(step.spanId);

    await step.end({
      status: STATUS.FAILED,
      error: new Error('timeout'),
    });

    const result = await pool.query(
      'SELECT * FROM run_events WHERE span_id = $1',
      [step.spanId]
    );

    const row = result.rows[0];
    expect(row.status).toBe(STATUS.FAILED);
    expect(row.reason_code).toBe('TIMEOUT');
    expect(row.reason_kind).toBe(REASON_KIND.TRANSIENT);
  });

  it('traceStep.addArtifact() stores artifact with correct format (Hard Boundary #5)', async () => {
    const step = traceStep({
      runId: testRunId,
      layer: LAYER.L0_ORCHESTRATOR,
      stepName: 'test_artifact',
    });

    await step.start();
    createdSpans.push(step.spanId);

    const artifactId = await step.addArtifact(
      'screenshot',
      'local',
      '/tmp/test.png'
    );

    // Check artifact stored
    const artifact = await getArtifact(artifactId);
    expect(artifact).not.toBeNull();
    expect(artifact.span_id).toBe(step.spanId);

    // Check artifacts column updated with correct format
    const result = await pool.query(
      'SELECT artifacts FROM run_events WHERE span_id = $1',
      [step.spanId]
    );

    expect(result.rows[0].artifacts).toEqual({
      screenshot_id: artifactId,
    });

    // Cleanup artifact
    await pool.query('DELETE FROM run_artifacts WHERE id = $1', [artifactId]);
  });
});

describe('Trace SDK - Phase 2: withSpan wrapper', () => {
  let testRunId;
  let createdSpans = [];

  beforeEach(() => {
    testRunId = randomUUID();
    createdSpans = [];
  });

  afterEach(async () => {
    for (const spanId of createdSpans) {
      await pool.query('DELETE FROM run_events WHERE span_id = $1', [spanId]);
    }
  });

  it('withSpan() wraps async function and traces success', async () => {
    const testFn = async (x) => x * 2;

    const wrappedFn = withSpan(testFn, {
      runId: testRunId,
      layer: LAYER.L2_EXECUTOR,
      stepName: 'multiply',
    });

    const result = await wrappedFn(5);
    expect(result).toBe(10);

    // Find the created span
    const spans = await pool.query(
      'SELECT span_id FROM run_events WHERE run_id = $1',
      [testRunId]
    );

    expect(spans.rows.length).toBe(1);
    createdSpans.push(spans.rows[0].span_id);

    // Check status
    const row = await pool.query(
      'SELECT * FROM run_events WHERE span_id = $1',
      [spans.rows[0].span_id]
    );

    expect(row.rows[0].status).toBe(STATUS.SUCCESS);
    expect(row.rows[0].output_summary).toEqual({ result: 10 });
  });

  it('withSpan() wraps async function and traces failure', async () => {
    const testFn = async () => {
      throw new Error('test error');
    };

    const wrappedFn = withSpan(testFn, {
      runId: testRunId,
      layer: LAYER.L2_EXECUTOR,
      stepName: 'failing_fn',
    });

    await expect(wrappedFn()).rejects.toThrow('test error');

    // Find the created span
    const spans = await pool.query(
      'SELECT span_id FROM run_events WHERE run_id = $1',
      [testRunId]
    );

    expect(spans.rows.length).toBe(1);
    createdSpans.push(spans.rows[0].span_id);

    // Check status
    const row = await pool.query(
      'SELECT * FROM run_events WHERE span_id = $1',
      [spans.rows[0].span_id]
    );

    expect(row.rows[0].status).toBe(STATUS.FAILED);
  });
});

describe('Trace SDK - Query Helpers', () => {
  it('getActiveRuns() returns running spans', async () => {
    const runs = await getActiveRuns();
    expect(Array.isArray(runs)).toBe(true);
  });

  it('getStuckRuns() returns stuck spans', async () => {
    const runs = await getStuckRuns();
    expect(Array.isArray(runs)).toBe(true);
  });

  it('getTopFailureReasons() returns failure stats', async () => {
    const failures = await getTopFailureReasons();
    expect(Array.isArray(failures)).toBe(true);
  });
});

describe('Hard Boundaries Validation', () => {
  it('Hard Boundary #2: span_id is always a new UUID', () => {
    const step1 = traceStep({
      runId: randomUUID(),
      layer: LAYER.L0_ORCHESTRATOR,
      stepName: 'test',
    });

    const step2 = traceStep({
      runId: randomUUID(),
      layer: LAYER.L0_ORCHESTRATOR,
      stepName: 'test',
    });

    expect(step1.spanId).not.toBe(step2.spanId);
    expect(step1.spanId).toMatch(/^[0-9a-f-]{36}$/);
    expect(step2.spanId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Hard Boundary #6: executor_host uses standard enum', () => {
    const validHosts = Object.values(EXECUTOR_HOSTS);
    expect(validHosts).toContain('us-vps');
    expect(validHosts).toContain('hk-vps');
    expect(validHosts).toContain('hk-n8n');
    expect(validHosts).toContain('mac-mini');
    expect(validHosts).toContain('node-pc');
  });

  it('Hard Boundary #7: reason_kind enum values', () => {
    const validKinds = Object.values(REASON_KIND);
    expect(validKinds).toContain('TRANSIENT');
    expect(validKinds).toContain('PERSISTENT');
    expect(validKinds).toContain('RESOURCE');
    expect(validKinds).toContain('CONFIG');
    expect(validKinds).toContain('UNKNOWN');
  });
});
