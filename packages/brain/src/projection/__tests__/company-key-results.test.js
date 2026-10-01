import { describe, expect, it, vi } from 'vitest';
import { runCompanyKrProjection, readCompanySnapshot } from '../company-key-results.js';

describe('公司库列级投影门', () => {
  it('未登记零请求，无token零写', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) }, notionReq = vi.fn();
    expect(await runCompanyKrProjection(pool, { token: 'fake', notionReq })).toMatchObject({ skipped: true });
    expect(notionReq).not.toHaveBeenCalled();
    expect(await runCompanyKrProjection(pool, { token: null, notionReq })).toMatchObject({ skipped: true });
  });
  it('库schema类型不符必须拒绝，不把其它列当指标', async () => {
    await expect(readCompanySnapshot({ token: 'fake', notionReq: vi.fn(async () => ({ properties: {} })) })).rejects.toThrow();
  });
});
