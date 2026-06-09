/**
 * decisions.js 测试
 * 覆盖：createDecisionsMatchRouter — 接受 prd 和 query 双参数名
 */
import { describe, it, expect, vi } from 'vitest';
import createDecisionsMatchRouter from '../decisions.js';

describe('createDecisionsMatchRouter — prd/query 双参数名', () => {
  const handler = createDecisionsMatchRouter();

  const makeReqRes = (body) => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const req = { body };
    return { req, res };
  };

  it('body.prd 参数正常工作', async () => {
    const { req, res } = makeReqRes({ prd: '这是一段 PRD 文本' });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ matched: expect.any(Array), missing: expect.any(Array) })
    );
  });

  it('body.query 参数也能正常工作（向后兼容）', async () => {
    const { req, res } = makeReqRes({ query: '这是一段 query 文本' });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ matched: expect.any(Array), missing: expect.any(Array) })
    );
  });

  it('body 既无 prd 也无 query 时返回 400', async () => {
    const { req, res } = makeReqRes({});
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'prd or query field required' })
    );
  });

  it('body 为 null/undefined 时返回 400', async () => {
    const { req, res } = makeReqRes(null);
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
