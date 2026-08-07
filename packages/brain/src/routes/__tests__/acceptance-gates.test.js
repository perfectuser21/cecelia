// acceptance-gates.js 的配对单测（lint-test-pairing 配对文件）。
// checkCreateGate 的查库路径覆盖在 integration/acceptance-create-gate.integration.test.js（真库）。
// 本文件覆盖两个无库纯函数：版本戳双源对账与冻结锁四态——都是 fail-closed 判据，域漂移必须显式红。
import { describe, it, expect } from 'vitest';
import { validateVersionStamps, checkFrozenStamps, FROZEN_STAMP_FIELDS } from '../acceptance-gates.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const HEAD_OK = {
  backend_sha: SHA_A, backend_sha_src2: SHA_A,
  frontend_sha: SHA_B, frontend_sha_src2: SHA_B,
  spec_sha: 'c'.repeat(64),
};

describe('validateVersionStamps 双源对账（J12-A）', () => {
  it('两源一致且格式合法 → 放行', () => {
    expect(validateVersionStamps(HEAD_OK)).toBeNull();
  });

  it('backend 两源不等 → sha_source_mismatch', () => {
    const r = validateVersionStamps({ ...HEAD_OK, backend_sha_src2: SHA_B });
    expect(r.error).toBe('sha_source_mismatch');
    expect(r.field).toBe('backend_sha');
  });

  it('非 40 位 sha → sha_format_invalid', () => {
    expect(validateVersionStamps({ ...HEAD_OK, frontend_sha: 'short' }).error).toBe('sha_format_invalid');
  });

  it('spec_sha 缺失 → spec_sha_required', () => {
    const { spec_sha, ...rest } = HEAD_OK;
    expect(validateVersionStamps(rest).error).toBe('spec_sha_required');
  });
});

describe('checkFrozenStamps 冻结锁四态（A9）', () => {
  const RUN_DETAIL = { backend_sha: SHA_A, frontend_sha: SHA_B, spec_sha: 'c'.repeat(64) };

  it('run 未带戳 → skip（历史单不适用，与 missing 机械可分）', () => {
    expect(checkFrozenStamps({}, RUN_DETAIL).kind).toBe('skip');
  });

  it('提交未自报戳 → missing（不许当 unchanged 放行）', () => {
    expect(checkFrozenStamps(RUN_DETAIL, {}).kind).toBe('missing');
  });

  it('三戳一致 → unchanged', () => {
    expect(checkFrozenStamps(RUN_DETAIL, { ...RUN_DETAIL }).kind).toBe('unchanged');
  });

  it('任一戳变化 → changed 并点名字段', () => {
    const r = checkFrozenStamps(RUN_DETAIL, { ...RUN_DETAIL, backend_sha: SHA_B });
    expect(r.kind).toBe('changed');
    expect(r.changed).toEqual(['backend_sha']);
  });

  it('FROZEN_STAMP_FIELDS 恰为三戳', () => {
    expect(FROZEN_STAMP_FIELDS).toEqual(['backend_sha', 'frontend_sha', 'spec_sha']);
  });
});
