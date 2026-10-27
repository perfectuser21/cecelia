import { beforeEach, expect, it, vi } from 'vitest';
import { setImmediate as nativeSetImmediate } from 'node:timers';

const { rawBuilder } = vi.hoisted(() => ({ rawBuilder: vi.fn() }));
vi.mock('../existing-ops-source.js', () => ({ buildExistingOpsSources: rawBuilder }));
import { buildExistingOpsSources } from './helpers/existing-ops-proof-builder.js';

beforeEach(() => { rawBuilder.mockReset(); });

async function observeNativeCallback(options) {
  let observed = false;
  const callback = new Promise(resolve => nativeSetImmediate(() => {
    observed = true;
    resolve();
  }));
  let value, error;
  try { value = await buildExistingOpsSources(options); }
  catch (caught) { error = caught; }
  const observedBeforeReturn = observed;
  await callback;
  return { value, error, observedBeforeReturn };
}

it('成功proof处理原生回调并保留原输入和结果对象', async () => {
  const options = { scope: 'unchanged' }, value = { consumers: [] };
  rawBuilder.mockResolvedValue(value);
  const result = await observeNativeCallback(options);
  expect(rawBuilder).toHaveBeenCalledTimes(1);
  expect(rawBuilder).toHaveBeenCalledWith(options);
  expect(rawBuilder.mock.calls[0][0]).toBe(options);
  expect(result.value).toBe(value);
  expect(result.error).toBeUndefined();
  expect(result.observedBeforeReturn).toBe(true);
});

it('异步拒绝proof处理原生回调并保留同一错误对象及字段', async () => {
  const options = { scope: 'unchanged' };
  const error = Object.assign(new Error('original'), { code: 'ORIGINAL', status: 503 });
  rawBuilder.mockRejectedValue(error);
  const result = await observeNativeCallback(options);
  expect(rawBuilder).toHaveBeenCalledTimes(1);
  expect(rawBuilder).toHaveBeenCalledWith(options);
  expect(result.error).toBe(error);
  expect(result.error.code).toBe('ORIGINAL');
  expect(result.error.status).toBe(503);
  expect(result.observedBeforeReturn).toBe(true);
});

it('同步抛出proof也处理原生回调且不改错误身份', async () => {
  const options = { scope: 'unchanged' }, error = new Error('original sync');
  rawBuilder.mockImplementation(() => { throw error; });
  const result = await observeNativeCallback(options);
  expect(rawBuilder).toHaveBeenCalledTimes(1);
  expect(rawBuilder).toHaveBeenCalledWith(options);
  expect(result.error).toBe(error);
  expect(result.observedBeforeReturn).toBe(true);
});
