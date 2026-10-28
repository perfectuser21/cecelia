import { describe, it, expect } from 'vitest';
import { setImmediate as nativeSetImmediate } from 'node:timers';
import { buildExistingOpsSources as rawBuilder } from '../../existing-ops-source.js';

export async function buildExistingOpsSources(options) {
  try {
    return await rawBuilder(options);
  } finally {
    await new Promise(resolve => nativeSetImmediate(resolve));
  }
}

// 该模块自身也是测试，调用方复用同一导出；被调用方导入时测试会照常注册。
describe('来源测试包装器保留真实校验结果与异常', () => {
  it('合法输入保留原返回值，并先处理已排队原生回调', async () => {
    const input = { scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision: '0'.repeat(40), paths: [], readSource: async () => '' };
    const expected = await rawBuilder(input);
    let observed = false;
    const callback = new Promise(resolve => nativeSetImmediate(() => { observed = true; resolve(); }));
    try {
      expect(await buildExistingOpsSources(input)).toEqual(expected);
      expect(observed).toBe(true);
    } finally { await callback; }
  });
  it('非法输入保留原错误，并在拒绝返回前处理原生回调', async () => {
    let original;
    try { await rawBuilder({}); } catch (error) { original = error; }
    expect(original?.message).toBe('OPS_SOURCE_INPUT_INVALID');
    let observed = false;
    const callback = new Promise(resolve => nativeSetImmediate(() => { observed = true; resolve(); }));
    try {
      await expect(buildExistingOpsSources({})).rejects.toThrow(original.message);
      expect(observed).toBe(true);
    } finally { await callback; }
  });
});
