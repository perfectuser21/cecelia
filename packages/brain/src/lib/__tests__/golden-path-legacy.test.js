/**
 * golden-path-legacy.test.js — golden_path*（L4 step 旧表）退役闸单测（任务 7d312fd8）。
 * 写路径一律 410；读路径默认 410，GOLDEN_PATH_LEGACY_READ=1 放行。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  GOLDEN_PATH_LEGACY_READ_ENV,
  GOLDEN_PATH_RETIRED_HINT,
  legacyReadEnabled,
  goldenPathRetiredBody,
  sendGoldenPathRetired,
  guardLegacyRead,
} from '../golden-path-legacy.js';

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  return res;
}

describe('legacyReadEnabled', () => {
  it('env 缺省 → false（默认关）', () => {
    expect(legacyReadEnabled({})).toBe(false);
  });
  it('只认字面 "1"，"true"/"yes" 不算开', () => {
    expect(legacyReadEnabled({ [GOLDEN_PATH_LEGACY_READ_ENV]: '1' })).toBe(true);
    expect(legacyReadEnabled({ [GOLDEN_PATH_LEGACY_READ_ENV]: 'true' })).toBe(false);
    expect(legacyReadEnabled({ [GOLDEN_PATH_LEGACY_READ_ENV]: 'yes' })).toBe(false);
    expect(legacyReadEnabled({ [GOLDEN_PATH_LEGACY_READ_ENV]: '' })).toBe(false);
  });
});

describe('goldenPathRetiredBody / sendGoldenPathRetired', () => {
  it('读路径 410 体：error + retired + hint 指向 /api/brain/steps + 放行 env 名', () => {
    const body = goldenPathRetiredBody({ write: false });
    expect(body.error).toBe('golden_path retired');
    expect(body.retired).toBe(true);
    expect(body.path_kind).toBe('read');
    expect(body.hint).toBe(GOLDEN_PATH_RETIRED_HINT);
    expect(body.hint).toContain('/api/brain/steps');
    expect(body.legacy_read_env).toBe(`${GOLDEN_PATH_LEGACY_READ_ENV}=1`);
  });
  it('写路径 410 体：path_kind=write，不给放行 env（写永远不放行）', () => {
    const body = goldenPathRetiredBody({ write: true });
    expect(body.path_kind).toBe('write');
    expect(body).not.toHaveProperty('legacy_read_env');
  });
  it('sendGoldenPathRetired 写 410 + json', () => {
    const res = makeRes();
    sendGoldenPathRetired(res, { write: true });
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.body.path_kind).toBe('write');
  });
});

describe('guardLegacyRead', () => {
  it('flag 关 → 发 410 并返回 true（调用方应 return）', () => {
    const res = makeRes();
    expect(guardLegacyRead(res, {})).toBe(true);
    expect(res.statusCode).toBe(410);
    expect(res.body.path_kind).toBe('read');
  });
  it('flag 开 → 不动 res，返回 false', () => {
    const res = makeRes();
    expect(guardLegacyRead(res, { [GOLDEN_PATH_LEGACY_READ_ENV]: '1' })).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });
});
