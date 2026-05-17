import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Workstream 2 — Brain SSE 端点 [BEHAVIOR]', () => {
  it('harness.js 含 /stream 路由（GET）', () => {
    const content = readFileSync('packages/brain/src/routes/harness.js', 'utf8');
    expect(content).toContain('/stream');
  });

  it('harness.js 含 text/event-stream Content-Type', () => {
    const content = readFileSync('packages/brain/src/routes/harness.js', 'utf8');
    expect(content).toContain('text/event-stream');
  });

  it('harness.js 使用 initiative_id 参数（禁用 taskId/task_id/pipeline_id/run_id）', () => {
    const content = readFileSync('packages/brain/src/routes/harness.js', 'utf8');
    expect(content).toContain('initiative_id');
    expect(content).not.toMatch(/req\.query\.(taskId|task_id|pipeline_id|run_id)\b/);
  });

  it('harness.js 推 event: node_update（不是 event: done）', () => {
    const content = readFileSync('packages/brain/src/routes/harness.js', 'utf8');
    expect(content).toContain('event: node_update');
    expect(content).not.toContain('event: done');
  });

  it('harness.js 推 event: run_completed（正确完成事件名）并在 data 里包含 initiative_run_id', () => {
    const content = readFileSync('packages/brain/src/routes/harness.js', 'utf8');
    expect(content).toContain('event: run_completed');
    expect(content).toContain('initiative_run_id');
  });

  it('initiativeRunEvents.js 导出 writeInitiativeRunEvent 函数', async () => {
    const m = await import('../../../../packages/brain/src/events/initiativeRunEvents.js');
    expect(typeof m.writeInitiativeRunEvent).toBe('function');
  });

  it('GET /stream?initiative_id 返回 SSE 流，Content-Type 含 text/event-stream', async () => {
    const response = await fetch(
      'http://localhost:5221/api/brain/harness/stream?initiative_id=bbbbbbbb-cccc-dddd-eeee-ff0000000020',
      { signal: AbortSignal.timeout(6000) }
    ).catch(() => null);
    expect(response?.headers.get('content-type')).toMatch(/text\/event-stream/);
  });

  it('缺 initiative_id → 400 {error: string}，无 message/msg 字段', async () => {
    const res = await fetch('http://localhost:5221/api/brain/harness/stream');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect(body).not.toHaveProperty('message');
    expect(body).not.toHaveProperty('msg');
  });

  it('未知 initiative_id → 404 {error: string}，无 message/reason 字段', async () => {
    const res = await fetch(
      'http://localhost:5221/api/brain/harness/stream?initiative_id=00000000-0000-0000-0000-000000000000'
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect(body).not.toHaveProperty('message');
    expect(body).not.toHaveProperty('reason');
  });
});
