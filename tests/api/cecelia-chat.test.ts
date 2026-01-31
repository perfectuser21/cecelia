import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:5212/api/cecelia/chat';

async function chat(message: unknown) {
  return fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

describe('Cecelia Chat API', () => {
  it('should return 200 with reply/intent/action_result for create_task', async () => {
    const res = await chat('创建任务：测试聊天API');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.reply).toBeTruthy();
    expect(body.intent).toBeTruthy();
    expect(body.intent.type).toBeTruthy();
    expect(body.intent.confidence).toBeGreaterThan(0);
    expect('action_result' in body).toBe(true);
  });

  it('should create records for create_task intent', async () => {
    const res = await chat('添加任务：验证聊天API创建功能');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action_result).toBeTruthy();
    expect(body.action_result.type).toBe('created');
    expect(body.action_result.data).toBeTruthy();
  });

  it('should return query results for query_status intent', async () => {
    const res = await chat('当前有哪些任务');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.intent.type).toBe('query_status');
    expect(body.action_result).toBeTruthy();
    expect(body.action_result.type).toBe('query');
    expect(Array.isArray(body.action_result.data)).toBe(true);
  });

  it('should return unknown intent with friendly reply for gibberish', async () => {
    const res = await chat('asdfghjkl');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.reply).toBeTruthy();
    expect(body.action_result).toBeNull();
  });

  it('should return 400 when message is missing', async () => {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('should return 400 when message is not a string', async () => {
    const res = await chat(123);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
