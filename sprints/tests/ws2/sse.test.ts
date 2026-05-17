import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:5221';
const INIT_ID = 'bbbbbbbb-cccc-dddd-eeee-ff0000000001';

describe('WS2 — Brain SSE 端点 GET /api/brain/harness/stream [BEHAVIOR]', () => {
  it('Content-Type 为 text/event-stream', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(
      `${BASE}/api/brain/harness/stream?initiative_id=${INIT_ID}`,
      { signal: controller.signal }
    ).catch(() => null);
    clearTimeout(timer);
    expect(resp).not.toBeNull();
    expect(resp!.headers.get('content-type')).toContain('text/event-stream');
    await resp!.body?.cancel().catch(() => {});
  });

  it('缺少 initiative_id 参数返 400，body 含 error 字段（禁用 message/msg）', async () => {
    const resp = await fetch(`${BASE}/api/brain/harness/stream`);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(typeof body.error).toBe('string');
    expect(body.message).toBeUndefined();
    expect(body.msg).toBeUndefined();
  });

  it('不存在的 initiative_id 返 404，body 含 error 字段（禁用 message/msg）', async () => {
    const resp = await fetch(
      `${BASE}/api/brain/harness/stream?initiative_id=00000000-0000-0000-0000-000000000000`
    );
    expect(resp.status).toBe(404);
    const body = await resp.json();
    expect(typeof body.error).toBe('string');
    expect(body.message).toBeUndefined();
    expect(body.msg).toBeUndefined();
  });

  it('node_update data keys 恰好为 [attempt,label,node,ts]，禁用字段 name/step/timestamp 不存在', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(
      `${BASE}/api/brain/harness/stream?initiative_id=${INIT_ID}`,
      { signal: controller.signal }
    ).catch(() => null);
    clearTimeout(timer);

    expect(resp).not.toBeNull();
    const text = await resp!.text().catch(() => '');
    const dataLine = text.split('\n').find(l => l.startsWith('data:') && !l.includes('keepalive'));
    expect(dataLine).toBeTruthy();
    const data = JSON.parse(dataLine!.replace('data: ', ''));

    const keys = Object.keys(data).sort();
    expect(keys).toEqual(['attempt', 'label', 'node', 'ts']);
    expect(data.name).toBeUndefined();
    expect(data.step).toBeUndefined();
    expect(data.timestamp).toBeUndefined();
    expect(data.nodeName).toBeUndefined();
  });
});
