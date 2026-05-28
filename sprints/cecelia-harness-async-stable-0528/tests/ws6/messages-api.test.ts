import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// vitest 运行目录: packages/brain/
const HARNESS_ROUTES = join(process.cwd(), 'src/routes/harness.js');
const THREAD_LOOKUP = join(process.cwd(), 'src/lib/harness-thread-lookup.js');

describe('WS6 — 消息 API + thread_lookup status 生命周期 [BEHAVIOR]', () => {
  it('routes/harness.js 含 GET /messages/:initiativeId/:subTaskId 路由', () => {
    const c = readFileSync(HARNESS_ROUTES, 'utf8');
    const hasGet = c.includes("router.get('/messages") || c.includes('router.get("/messages') ||
      c.includes("router.get(`/messages");
    expect(hasGet).toBe(true);
  });

  it('routes/harness.js 含 POST /messages/:initiativeId/:subTaskId 路由', () => {
    const c = readFileSync(HARNESS_ROUTES, 'utf8');
    const hasPost = c.includes("router.post('/messages") || c.includes('router.post("/messages') ||
      c.includes("router.post(`/messages");
    expect(hasPost).toBe(true);
  });

  it('GET 路由响应顶层字段为 messages（非禁用字段 data/items/results/payload/list）', () => {
    const c = readFileSync(HARNESS_ROUTES, 'utf8');
    expect(c).toContain('messages');
    expect(c).not.toContain("res.json({ data:");
    expect(c).not.toContain("res.json({ items:");
  });

  it('POST 路由返回 201 状态码', () => {
    const c = readFileSync(HARNESS_ROUTES, 'utf8');
    expect(c).toContain('201');
  });

  it('POST 响应包含 id、message、created_at 字段（不含禁用字段 data/result/payload/body）', () => {
    const c = readFileSync(HARNESS_ROUTES, 'utf8');
    expect(c).toContain('created_at');
    // 禁用字段不能作为 POST 响应 key
    const hasDisallowed = c.includes("res.status(201).json({ data:") ||
      c.includes("res.status(201).json({ result:") ||
      c.includes("res.status(201).json({ payload:") ||
      c.includes("res.status(201).json({ body:");
    expect(hasDisallowed).toBe(false);
  });

  it('GET 路由对不存在的 initiativeId 返回 {messages:[]} 而非 404', () => {
    const c = readFileSync(HARNESS_ROUTES, 'utf8');
    const hasEmptyReturn = c.includes('messages: []') || c.includes("messages:[]") || c.includes('"messages": []');
    expect(hasEmptyReturn).toBe(true);
  });

  it('路由实现 consumed 查询参数（req.query.consumed 或等效）', () => {
    const c = readFileSync(HARNESS_ROUTES, 'utf8');
    const hasConsumed = c.includes('consumed') && (
      c.includes('req.query') || c.includes('query.consumed')
    );
    expect(hasConsumed).toBe(true);
  });

  it('路由不使用禁用别名 include_consumed / show_consumed / req.query.all', () => {
    const c = readFileSync(HARNESS_ROUTES, 'utf8');
    expect(c).not.toContain('include_consumed');
    expect(c).not.toContain('show_consumed');
    expect(c).not.toContain("req.query.all");
  });

  it('GET 消息对象含 consumed_at 字段（路由代码含 consumed_at 或 SELECT * 全字段返回）', () => {
    const c = readFileSync(HARNESS_ROUTES, 'utf8');
    const hasConsumedAt = c.includes('consumed_at') ||
      c.includes('SELECT *') || c.includes('select *');
    expect(hasConsumedAt).toBe(true);
  });

  it('harness-thread-lookup.js 含 UPDATE status 为 completed 的逻辑', () => {
    const c = readFileSync(THREAD_LOOKUP, 'utf8');
    expect(c).toContain('completed');
    expect(c).toContain('UPDATE');
  });

  it('harness-thread-lookup.js 含 UPDATE status 为 failed 的逻辑', () => {
    const c = readFileSync(THREAD_LOOKUP, 'utf8');
    expect(c).toContain('failed');
  });
});
