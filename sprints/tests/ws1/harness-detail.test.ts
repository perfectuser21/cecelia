import { describe, it, expect } from 'vitest';

// TDD Red 阶段：GET /api/brain/harness/initiative/:id/detail 端点尚未实现
// Brain 在 localhost:5221，端点不存在时返回 404（Brain 通用 404 handler）
// Generator 实现路由后，所有 test 变 Green

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const TEST_ID = '00000000-0000-0000-0000-000000000001';
const INVALID_ID = 'not-a-uuid';

async function getDetail(id: string) {
  const res = await fetch(`${BRAIN_URL}/api/brain/harness/initiative/${id}/detail`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe('Workstream 1 — GET /api/brain/harness/initiative/:id/detail [BEHAVIOR]', () => {
  it('合法 UUID → HTTP 200（无数据时宽容降级，不返回 404）', async () => {
    const { status } = await getDetail(TEST_ID);
    expect(status).toBe(200);
  });

  it('initiative_id 原样回显请求的 id', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body?.initiative_id).toBe(TEST_ID);
  });

  it('顶层 keys 精确等于 6 个 PRD 字段', async () => {
    const { body } = await getDetail(TEST_ID);
    const keys = Object.keys(body ?? {}).sort();
    expect(keys).toEqual([
      'contract_content',
      'gan_rounds',
      'initiative_id',
      'prd_content',
      'screenshot_urls',
      'step_timing',
    ]);
  });

  it('prd_content 字段类型为 string 或 null', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body?.prd_content === null || typeof body?.prd_content === 'string').toBe(true);
  });

  it('contract_content 字段类型为 string 或 null', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body?.contract_content === null || typeof body?.contract_content === 'string').toBe(true);
  });

  it('gan_rounds 字段类型为 number 或 null', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body?.gan_rounds === null || typeof body?.gan_rounds === 'number').toBe(true);
  });

  it('step_timing 为 array 类型', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(Array.isArray(body?.step_timing)).toBe(true);
  });

  it('screenshot_urls 固定为空数组 []', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body?.screenshot_urls).toEqual([]);
  });

  it('禁用字段 steps 不存在', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body).not.toHaveProperty('steps');
  });

  it('禁用字段 contract 不存在', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body).not.toHaveProperty('contract');
  });

  it('禁用字段 data 不存在', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body).not.toHaveProperty('data');
  });

  it('禁用字段 payload 不存在', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body).not.toHaveProperty('payload');
  });

  it('禁用字段 stages 不存在', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body).not.toHaveProperty('stages');
  });

  it('禁用字段 tasks 不存在', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body).not.toHaveProperty('tasks');
  });

  it('禁用字段 runs 不存在', async () => {
    const { body } = await getDetail(TEST_ID);
    expect(body).not.toHaveProperty('runs');
  });

  it('step_timing 非空时元素含 node/started_at/ended_at/duration_ms 四字段', async () => {
    const { body } = await getDetail(TEST_ID);
    const timing: unknown[] = body?.step_timing ?? [];
    if (timing.length > 0) {
      const elem = timing[0] as Record<string, unknown>;
      const keys = Object.keys(elem).sort();
      expect(keys).toEqual(['duration_ms', 'ended_at', 'node', 'started_at']);
      expect(typeof elem.node).toBe('string');
      expect(typeof elem.started_at).toBe('string');
    } else {
      expect(Array.isArray(timing)).toBe(true);
    }
  });

  it('非法 UUID → HTTP 400', async () => {
    const { status } = await getDetail(INVALID_ID);
    expect(status).toBe(400);
  });

  it('非法 UUID → error 字段为 "invalid id"', async () => {
    const { body } = await getDetail(INVALID_ID);
    expect(body?.error).toBe('invalid id');
  });

  it('HTTP 状态码不为 500（cecelia_events 降级无 500 泄漏）', async () => {
    const { status } = await getDetail(TEST_ID);
    expect(status).not.toBe(500);
  });
});
