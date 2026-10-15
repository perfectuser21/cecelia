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

// 固定正式祖先的真实源码；CI checkout fetch-depth: 0，不依赖其它未合并分支对象。
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildExistingOpsSources } from '../existing-ops-source.js';
const buildBase = '2eb4d0557365befafed1953140c9c47e20bab495';
const buildRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const buildPrefix = 'packages/brain/scripts/coding-workflow/';
const buildPaths = execFileSync('git', ['ls-tree', '-rz', '--name-only', buildBase], {cwd:buildRoot,encoding:'utf8'}).replace(/\0$/,'').split('\0');
const buildCache = new Map();
const fixedBuild = path => {
  if (!buildCache.has(path)) buildCache.set(path,execFileSync('git',['show',`${buildBase}:${path}`],{cwd:buildRoot,encoding:'utf8',maxBuffer:16*1024*1024}));
  return buildCache.get(path);
};
const buildSchema = 'packages/brain/src/lib/existing-ops-source.js';
const buildTest = buildPrefix+'__tests__/build.test.mjs';
const explicitProvider = source => source.replace('CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,', "CODING_WF_PROVIDER: 'claude', CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,");
const collectBuild = (marker='', overrides={}) => buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:buildBase,paths:buildPaths,
  readSource:async path=>overrides[path] ?? (path===buildSchema?fixedBuild(path)+marker:path===buildTest?explicitProvider(fixedBuild(path)):fixedBuild(path))});
const enabledBuild = '\nexport const EXISTING_OPS_BUILD_SELECTOR_SCHEMA = 1;';
describe('固定 build 原生执行来源合同',()=>{
  it('激活后仅沿真实活跃 build 子进程认领活动、模板与假 CLI 输入',async()=>{
    const f3=(await collectBuild(enabledBuild)).consumers[1];
    expect(f3.status,JSON.stringify(f3.gaps)).toBe('verified');
    for(const path of ['activities/build.mjs','prompts/build.md','__tests__/fixtures/fake-claude.mjs'])
      expect(f3.bindings.map(b=>b.path)).toContain(buildPrefix+path);
    expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:buildPrefix+'activities/build.mjs',input_path:buildPrefix+'prompts/build.md',kind:'executed_build_prompt_input'}));
  });
  it('缺省与0标记读取固定旧Git时保留完整输出逐字一致',async()=>{
    const original=await collectBuild('',{[buildTest]:fixedBuild(buildTest)});
    const disabled=await collectBuild('\nexport const EXISTING_OPS_BUILD_SELECTOR_SCHEMA = 0;',{[buildTest]:fixedBuild(buildTest)});
    expect(JSON.stringify(disabled)).toBe(JSON.stringify(original));
  });
});
