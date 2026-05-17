/**
 * Harness v2 M4 — harness-ci-gate 分支覆盖率补充
 *
 * 覆盖 harness-ci-gate.test.js 未覆盖到的分支：
 *   - runGhChecks: exec 返回 Buffer；exec 返回非数组 JSON；JSON 解析异常
 *   - fetchLogSnippet: link 不匹配 actions/runs 正则；gh run view 抛错；Buffer 返回
 *   - classifyChecks: mixed 无 skipping 的 pending；state 字段小写/大写
 *   - pollPRChecks: 空数组（PENDING 走 timeout）；deadline=0（立刻超时，不进入 loop）
 */

import { describe, it, expect, vi } from 'vitest';
import { pollPRChecks, classifyChecks } from '../harness-ci-gate.js';

describe('runGhChecks 分支覆盖（通过 pollPRChecks 驱动）', () => {
  const sleep = async () => {};

  it('exec 返回 Buffer 对象 → toString 后解析', async () => {
    const exec = vi.fn(() => Buffer.from(JSON.stringify([{ name: 'L1', bucket: 'pass' }])));
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 10000,
    });
    expect(r.status).toBe('PASS');
  });

  it('exec 返回非 JSON 字符串 → JSON.parse 抛错 → 当作空数组（PENDING → TIMEOUT）', async () => {
    const exec = vi.fn(() => 'not json at all');
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 3,
    });
    expect(r.status).toBe('TIMEOUT');
  });

  it('exec 返回非数组 JSON（如 object） → 返回空数组 → PENDING → TIMEOUT', async () => {
    const exec = vi.fn(() => JSON.stringify({ bogus: 'object' }));
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 3,
    });
    expect(r.status).toBe('TIMEOUT');
  });

  it('exec 返回空字符串 → 解析为 [] → PENDING → TIMEOUT', async () => {
    const exec = vi.fn(() => '');
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 3,
    });
    expect(r.status).toBe('TIMEOUT');
  });

  it('exec 返回 null/undefined → 解析为 [] → PENDING → TIMEOUT', async () => {
    const exec = vi.fn(() => null);
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 3,
    });
    expect(r.status).toBe('TIMEOUT');
  });
});

describe('fetchLogSnippet 分支覆盖', () => {
  const sleep = async () => {};

  it('link 不匹配 /actions/runs/ 正则 → logSnippet=""', async () => {
    const exec = vi.fn((cmd) => {
      if (String(cmd).includes('gh run view')) {
        throw new Error('should not be called');
      }
      return JSON.stringify([
        { name: 'L1', bucket: 'fail', link: 'https://example.com/weird-link' },
      ]);
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toBe('');
  });

  it('gh run view 抛错 → logSnippet 含 "failed to fetch log"', async () => {
    const exec = vi.fn((cmd) => {
      if (String(cmd).includes('gh run view')) {
        throw new Error('network down');
      }
      return JSON.stringify([
        { name: 'L1', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/1/job/2' },
      ]);
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toMatch(/failed to fetch log.*network down/);
  });

  it('gh run view 返回 Buffer → toString 后截断', async () => {
    const huge = Buffer.from('y'.repeat(5000));
    const exec = vi.fn((cmd) => {
      if (String(cmd).includes('gh run view')) return huge;
      return JSON.stringify([
        { name: 'L1', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/1' },
      ]);
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet.length).toBeLessThanOrEqual(4000);
  });

  it('gh run view 返回短字符串 → 不截断', async () => {
    const exec = vi.fn((cmd) => {
      if (String(cmd).includes('gh run view')) return 'short log';
      return JSON.stringify([
        { name: 'L1', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/99/job/88' },
      ]);
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toBe('short log');
  });

  it('link 只有 /actions/runs/{id} 没有 /job/{id} → 正则 m[2] 为 undefined 但仍取 runId', async () => {
    const exec = vi.fn((cmd) => {
      if (String(cmd).includes('gh run view 42')) return 'runid42 log';
      return JSON.stringify([
        { name: 'L1', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/42' },
      ]);
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toBe('runid42 log');
  });

  it('gh run view 返回 null → 空字符串', async () => {
    const exec = vi.fn((cmd) => {
      if (String(cmd).includes('gh run view')) return null;
      return JSON.stringify([
        { name: 'L1', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/1' },
      ]);
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toBe('');
  });
});

describe('classifyChecks 分支补充', () => {
  it('非数组输入（字符串） → PENDING', () => {
    expect(classifyChecks('not array').overall).toBe('PENDING');
  });

  it('数字输入 → PENDING', () => {
    expect(classifyChecks(42).overall).toBe('PENDING');
  });

  it('含 failure 大写 state → FAIL', () => {
    const r = classifyChecks([{ name: 'L1', state: 'FAILURE' }]);
    expect(r.overall).toBe('FAIL');
  });

  it('bucket=cancelled 全写 → FAIL', () => {
    const r = classifyChecks([{ name: 'L1', bucket: 'cancelled' }]);
    expect(r.overall).toBe('FAIL');
  });

  it('bucket=skip （不是 skipping）→ pass fallback', () => {
    const r = classifyChecks([
      { name: 'L1', bucket: 'pass' },
      { name: 'L2', bucket: 'skip' },
    ]);
    expect(r.overall).toBe('PASS');
  });

  it('bucket 和 state 都为空 → PENDING（回退）', () => {
    const r = classifyChecks([{ name: 'L1' }]);
    expect(r.overall).toBe('PENDING');
  });

  it('state 字段小写 success → PASS', () => {
    const r = classifyChecks([{ name: 'L1', state: 'success' }]);
    expect(r.overall).toBe('PASS');
  });
});

describe('pollPRChecks 特殊边界', () => {
  const sleep = async () => {};

  it('intervalMs=NaN/undefined → 使用默认', async () => {
    const exec = vi.fn(() => JSON.stringify([{ name: 'L1', bucket: 'pass' }]));
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      // intervalMs 故意不传
      timeoutMs: 10000,
    });
    expect(r.status).toBe('PASS');
  });

  it('timeoutMs=0 → 立即 TIMEOUT，不进入循环', async () => {
    const exec = vi.fn();
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 0,
    });
    expect(r.status).toBe('TIMEOUT');
    expect(exec).not.toHaveBeenCalled();
  });

  it('prUrl 为 undefined → FAIL', async () => {
    const r = await pollPRChecks(undefined, { exec: () => '[]', sleep });
    expect(r.status).toBe('FAIL');
  });

  it('prUrl 为数字 → FAIL', async () => {
    const r = await pollPRChecks(42, { exec: () => '[]', sleep });
    expect(r.status).toBe('FAIL');
  });

  it('FAIL 时 failedCheck.link 为 undefined（未定义） → logSnippet=""', async () => {
    const exec = vi.fn(() => JSON.stringify([
      { name: 'lint', bucket: 'fail' }, // 无 link 字段
    ]));
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toBe('');
    expect(r.failedCheck.name).toBe('lint');
  });
});
