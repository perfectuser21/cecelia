import { it, expect } from 'vitest';
import { parse as acorn } from 'acorn';
import { buildSelectorEnabled } from '../existing-ops-build-envelopes.js';
const parse=text=>acorn(text,{ecmaVersion:'latest',sourceType:'module'});
  it('独立marker缺省或0保旧，未知/动态/重复/可变拒绝',()=>{
    for(const text of ['', '// export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1;', 'const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1;', 'export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=0;'])expect(buildSelectorEnabled(text,parse)).toBe(false);
    expect(buildSelectorEnabled('export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1;',parse)).toBe(true);
    for(const text of ['export let EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1;','export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=2;','export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=process.env.X;','export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1; export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=0;'])expect(()=>buildSelectorEnabled(text,parse)).toThrow();
  });
