/**
 * WS1 TDD Red Phase — SSE stream 端点尚未实现，以下所有 test 应 FAIL
 * Generator 实现 GET /stream 后变 Green
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BRAIN_URL = process.env.BRAIN_URL ?? 'http://localhost:5221';
const DB_NAME = process.env.DB_NAME ?? 'cecelia';

async function insertCompletedTask(): Promise<string> {
  const { execSync } = await import('child_process');
  const id = execSync(
    `PGUSER=cecelia PGHOST=localhost psql -d ${DB_NAME} -t -c "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('test_sse_vitest','completed','{}','SSE Vitest',NOW()) RETURNING id"`,
    { encoding: 'utf8' }
  ).trim();
  return id;
}

async function insertNodeEvent(taskId: string, nodeName: string, attemptN: number): Promise<void> {
  const { execSync } = await import('child_process');
  const payload = JSON.stringify({ initiativeId: 'test', threadId: 't1', nodeName, attemptN, payloadSummary: {} });
  execSync(
    `PGUSER=cecelia PGHOST=localhost psql -d ${DB_NAME} -c "INSERT INTO task_events (task_id,event_type,payload,created_at) VALUES ('${taskId}','graph_node_update','${payload.replace(/'/g, "''")}',NOW()-interval '1 second')"`,
    { encoding: 'utf8' }
  );
}

async function fetchSSEWithTimeout(planner_task_id: string, ms = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(`${BRAIN_URL}/api/brain/harness/stream?planner_task_id=${planner_task_id}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    const text = await res.text();
    return text;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

describe('Workstream 1 — GET /api/brain/harness/stream [BEHAVIOR]', () => {
  let taskId: string;
  let sseText: string;

  beforeAll(async () => {
    taskId = await insertCompletedTask();
    await insertNodeEvent(taskId, 'proposer', 1);
    sseText = await fetchSSEWithTimeout(taskId);
  }, 20_000);

  it('HTTP 200 Content-Type text/event-stream 返回给有效 planner_task_id', async () => {
    const res = await fetch(`${BRAIN_URL}/api/brain/harness/stream?planner_task_id=${taskId}`, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toContain('text/event-stream');
  });

  it('收到 event: node_update 行，data JSON 含 node="proposer", attempt=1', () => {
    const dataLines = sseText
      .split('\n')
      .filter(l => l.startsWith('data:') && !l.includes('"status"'))
      .map(l => JSON.parse(l.replace('data: ', '')));
    expect(dataLines.length).toBeGreaterThan(0);
    expect(dataLines[0].node).toBe('proposer');
    expect(dataLines[0].attempt).toBe(1);
  });

  it('node_update data JSON — keys 恰好为 ["attempt","label","node","ts"]（无多余字段）', () => {
    const dataLine = sseText
      .split('\n')
      .find(l => l.startsWith('data:') && !l.includes('"status"'));
    expect(dataLine).toBeDefined();
    const obj = JSON.parse(dataLine!.replace('data: ', ''));
    expect(Object.keys(obj).sort()).toEqual(['attempt', 'label', 'node', 'ts']);
  });

  it('node_update data JSON — label 是 string，ts 是 ISO 8601 string', () => {
    const dataLine = sseText
      .split('\n')
      .find(l => l.startsWith('data:') && !l.includes('"status"'));
    const obj = JSON.parse(dataLine!.replace('data: ', ''));
    expect(typeof obj.label).toBe('string');
    expect(typeof obj.ts).toBe('string');
    expect(() => new Date(obj.ts)).not.toThrow();
  });

  it('node_update data JSON — 禁用字段 name/nodeName/timestamp/type 均不存在', () => {
    const dataLine = sseText
      .split('\n')
      .find(l => l.startsWith('data:') && !l.includes('"status"'));
    const obj = JSON.parse(dataLine!.replace('data: ', ''));
    expect('name' in obj).toBe(false);
    expect('nodeName' in obj).toBe(false);
    expect('timestamp' in obj).toBe(false);
    expect('type' in obj).toBe(false);
  });

  it('completed pipeline — 推送 event: done 后关闭连接', () => {
    expect(sseText).toContain('event: done');
    const doneDataLine = sseText
      .split('\n')
      .find(l => l.startsWith('data:') && l.includes('"status"'));
    expect(doneDataLine).toBeDefined();
    const done = JSON.parse(doneDataLine!.replace('data: ', ''));
    expect(['completed', 'failed']).toContain(done.status);
  });

  it('缺少 planner_task_id → 400 + {error: string}，无 message/msg 字段', async () => {
    const res = await fetch(`${BRAIN_URL}/api/brain/harness/stream`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect('message' in body).toBe(false);
    expect('msg' in body).toBe(false);
  });

  it('不存在 UUID → 404 + {error: "pipeline not found"}', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await fetch(`${BRAIN_URL}/api/brain/harness/stream?planner_task_id=${fakeId}`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('pipeline not found');
  });
});
