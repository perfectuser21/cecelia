import { describe, it, expect } from 'vitest';
import { parse as acorn } from 'acorn';
import { runtimeSelectorEnabled } from '../existing-ops-runtime-source.js';
const parse = text => acorn(text, { ecmaVersion: 'latest', sourceType: 'module' });

describe('existing-ops-runtime-source 显式固定来源协议', () => {
  it('缺省、私有或注释标记不启用，合法 export const 1 才启用', () => {
    for (const text of ['', '// export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=1;',
      'const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=1;', 'export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=0;'])
      expect(runtimeSelectorEnabled(text, parse)).toBe(false);
    expect(runtimeSelectorEnabled('export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=1;', parse)).toBe(true);
  });
  it('动态、可变、未知与重复声明不猜为可执行来源', () => {
    for (const text of ['export let EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=1;',
      'export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=2;',
      'export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=process.env.SCHEMA;',
      'export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=1; export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=0;'])
      expect(() => runtimeSelectorEnabled(text, parse)).toThrow();
  });
});
