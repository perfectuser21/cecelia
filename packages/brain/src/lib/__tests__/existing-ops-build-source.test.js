import { describe, it, expect } from 'vitest';
import { parse as acorn } from 'acorn';
const parse = text => acorn(text, { ecmaVersion: 'latest', sourceType: 'module' });

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

import { BUILD_SOURCE_PATHS, proveBuildSources, buildSelectorEnabled } from '../existing-ops-build-source.js';
const buildSources=()=>Object.fromEntries(['test','helper','activity','cli','protocol'].map(key=>[key,key==='test'?explicitProvider(fixedBuild(BUILD_SOURCE_PATHS[key])):fixedBuild(BUILD_SOURCE_PATHS[key])]));
const mutateBuild=(key,before,after)=>{const s=buildSources();expect(s[key]).toContain(before);s[key]=s[key].replace(before,after);return s;};
describe('固定 build 执行封套反例（只解析，不执行 payload）',()=>{
  it('真实固定封套及第二棒新增 INTENT_PATH 普通参数均可证明',()=>{
    const s=buildSources();expect(proveBuildSources(s,parse)).toBe(true);
    s.activity=s.activity.replace("import { intentHeading, prKindOf } from '../lib/pr-kind.mjs';","import { intentHeading, prKindOf } from '../lib/pr-kind.mjs';\nimport { INTENT_FILE } from '../lib/spec-check.mjs';")
      .replace('    TASK_ID: input.task_id,','    TASK_ID: input.task_id,\n    INTENT_PATH: path.join(dir, INTENT_FILE),');
    expect(proveBuildSources(s,parse)).toBe(true);
  });
  it.each([
    ['未固定provider','test',"CODING_WF_PROVIDER: 'claude', ",''],
    ['不同provider','test',"CODING_WF_PROVIDER: 'claude'","CODING_WF_PROVIDER: 'codex'"],
    ['describe.skip','test',"describe('build 活动","describe.skip('build 活动"],
    ['it.skip','test',"it('claude 参数：","it.skip('claude 参数："],
    ['ENTRY改向','test',"'../activities/build.mjs'","'../activities/spec.mjs'"],
    ['FAKE改向','test',"'fixtures/fake-claude.mjs'","'fixtures/other.mjs'"],
    ['run重赋','test',"  it('claude 参数：","  run=()=>{};\n  it('claude 参数："],
    ['第三参数覆盖CLI','test',"    const r = await run('build-ok');\n    expect(r.stderr)","    const r = await run('build-ok', {}, {CODING_WF_CLAUDE_BIN:'/bin/true'});\n    expect(r.stderr)"],
    ['helper调用替换','test','runActivityProcess(ENTRY, input(patch)','unused(ENTRY, input(patch)'],
    ['helper argv扩大','helper','[entry]','["-e",entry]'],
    ['helper提前返回','helper','    const child = spawn','    return;\n    const child = spawn'],
    ['关键对象别名逃逸','helper','    const child = spawn','    const alias=process; alias.execPath="/bin/true";\n    const child = spawn'],
    ['env别名逃逸','activity','  const specPath =','  const alias=process.env; alias.CODING_WF_PROVIDER="codex";\n  const specPath ='],
    ['入口不调用main','activity','const result = await main(input);','const result = {};'],
    ['main提前返回','activity','  const specPath =','  return {};\n  const specPath ='],
    ['模板未进参数','activity',"const args = ['-p', prompt,","const args = ['-p', 'ignored',"],
    ['prompt重新赋值','activity',"  const args = ['-p', prompt,","  prompt='ignored';\n  const args = ['-p', prompt,"],
    ['vars副作用调用','activity','    TASK_ID: input.task_id,','    EXTRA: poison(),\n    TASK_ID: input.task_id,'],
    ['加载另一个模板','activity',"loadPrompt('build',","loadPrompt('spec',"],
    ['reader改向','cli',"'../prompts'","'../other-prompts'"],
    ['reader未用模板','cli',"return renderPrompt(fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8'), vars);","return 'ignored';"],
    ['默认bin改向','cli',"bin = process.env.CODING_WF_CLAUDE_BIN || 'claude'","bin = '/bin/true'"],
    ['isolate分支bin替换','cli','bin: native?.bin,','bin: "other",'],
    ['真实spawn改bin','cli','child = spawn(bin, args,','child = spawn("other", args,'],
    ['protocol不调用handler','protocol','await handler(input)','{}'],
  ])('%s 必须拒绝',(_name,key,before,after)=>{expect(proveBuildSources(mutateBuild(key,before,after),parse)).toBe(false);});
  it('跳过、提前返回及未调用函数中的 run 不算活跃调用',()=>{
    const prefix="it('claude 参数：acceptEdits，允许 Bash，禁 git push 与 gh；prompt 带 S-n 列表与 03 路径', async () => {";
    for(const statement of ['return;','if(false) return;','const unused=async()=>{ await run("build-ok"); }; return;','switch(1){case 1:return;}','do {} while(true);'])
      expect(proveBuildSources(mutateBuild('test',prefix,prefix+statement),parse)).toBe(false);
  });
  it('独立marker缺省或0保旧，未知/动态/重复/可变拒绝',()=>{
    for(const text of ['', '// export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1;', 'const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1;', 'export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=0;'])expect(buildSelectorEnabled(text,parse)).toBe(false);
    expect(buildSelectorEnabled('export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1;',parse)).toBe(true);
    for(const text of ['export let EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1;','export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=2;','export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=process.env.X;','export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1; export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA=0;'])expect(()=>buildSelectorEnabled(text,parse)).toThrow();
  });
  it('真实exclude未选择build测试时不凭文件存在认领活动模板与假CLI',async()=>{
    const config='packages/brain/vitest.config.js';
    const f3=(await collectBuild(enabledBuild,{[config]:fixedBuild(config).replace('exclude: [',"exclude: ['scripts/coding-workflow/__tests__/build.test.mjs',")})).consumers[1];
    expect(f3.status,JSON.stringify(f3.gaps)).toBe('verified');
    for(const key of ['activity','prompt','fake'])expect(f3.bindings.map(b=>b.path)).not.toContain(BUILD_SOURCE_PATHS[key]);
  });
});

import { provePublishSources } from '../existing-ops-build-source.js';
const publishTest=buildPrefix+'__tests__/publish.test.mjs';
describe('固定 publish 原生入口来源',()=>{
  it('现有活跃 publish 子进程在新协议中认领真实入口，不泛化其它活动或假GH',async()=>{
    expect(provePublishSources(fixedBuild(publishTest),fixedBuild(BUILD_SOURCE_PATHS.helper),parse)).toBe(true);
    const f3=(await collectBuild(enabledBuild)).consumers[1];
    expect(f3.status,JSON.stringify(f3.gaps)).toBe('verified');
    expect(f3.bindings.map(b=>b.path)).toContain(buildPrefix+'activities/publish.mjs');
    expect(f3.input_relations).toContainEqual(expect.objectContaining({input_path:buildPrefix+'activities/publish.mjs',kind:'native_publish_activity_spawn'}));
    expect(f3.bindings.map(b=>b.path)).not.toContain(buildPrefix+'__tests__/fixtures/fake-gh.mjs');
  });
  it.each([
    ['skip',"it('new：","it.skip('new："],
    ['不同入口',"'../activities/publish.mjs'","'../activities/spec.mjs'"],
    ['未执行helper','runActivityProcess(ENTRY, input(patch)','unused(ENTRY, input(patch)'],
    ['覆盖参数',"const r = await run('new');","const r = await run('new', {}, {CODING_WF_GH_BIN:'other'});"],
    ['return提前终止',"const r = await run('new');","return; const r = await run('new');"],
    ['绑定篡改',"  it('new：","  ENTRY='other';\n  it('new："],
  ])('publish %s 无执行证明',(_label,before,after)=>{
    const original=fixedBuild(publishTest);expect(original).toContain(before);
    expect(provePublishSources(original.replace(before,after),fixedBuild(BUILD_SOURCE_PATHS.helper),parse)).toBe(false);
  });
});

describe('固定 witness 的测试选择与 setup 封套',()=>{
  it('其它 it.only 或 describe.only/链式 each.only 不得排除 build witness 后仍认领',()=>{
    const original=buildSources();
    for(const [before,after] of [["it('02-spec.md 不存在", "it.only('02-spec.md 不存在"], ["describe('build 活动","describe.only('build 活动"], ["    it.each(['CLAUDE.md'", "    it.each.only(['CLAUDE.md'"]]) {
      expect(original.test).toContain(before);
      expect(proveBuildSources({...original,test:original.test.replace(before,after)},parse)).toBe(false);
    }
  });
  it('build与publish的 setup 提前终止或被替换时没有活跃witness',()=>{
    for(const prefix of ['throw Error("stop");','return;','if(true)return;','process.exit(0);']) {
      const original=buildSources();original.test=original.test.replace('beforeEach(() => {','beforeEach(() => {'+prefix);
      expect(proveBuildSources(original,parse)).toBe(false);
      expect(provePublishSources(fixedBuild(publishTest).replace('beforeEach(() => {','beforeEach(() => {'+prefix),fixedBuild(BUILD_SOURCE_PATHS.helper),parse)).toBe(false);
    }
  });
});

describe('有限注册期和执行前置合同',()=>{
  it.each([
    ['嵌套describe抛错',"throw Error('blocked');"],
    ['嵌套describe返回','return;'],
    ['嵌套describe立即读取',"fs.readFileSync('/missing');"],
    ['嵌套describe危险初始化',"const stop=fs.readFileSync('/missing');"],
    ['嵌套describe立即IIFE',"const stop=(()=>{throw Error('stop')})();"],
  ])('%s 不得认领尚未注册的witness',(_label,statement)=>{
    const before="describe('防篡改与防误操作', () => {";
    expect(proveBuildSources(mutateBuild('test',before,before+statement),parse)).toBe(false);
    const test=fixedBuild(publishTest).replace("  it('new：", "  describe('blocked',()=>{"+statement+"});\n  it('new：");
    expect(provePublishSources(test,fixedBuild(BUILD_SOURCE_PATHS.helper),parse)).toBe(false);
  });
  it.each(['exit','abort','kill'])('先行测试 process.%s 终止进程不得认领后续witness',(method)=>{
    expect(proveBuildSources(mutateBuild('test','const before = head();',`process.${method}(0); const before = head();`),parse)).toBe(false);
    const test=fixedBuild(publishTest).replace("  it('new：",`  it('stop',()=>{process.${method}(0);});\n  it('new：`);
    expect(provePublishSources(test,fixedBuild(BUILD_SOURCE_PATHS.helper),parse)).toBe(false);
  });
  it.each([
    ['specIds','activity','function specIds(specPath) {','return [];'],
    ['readStdin','protocol','function readStdin() {',"throw Error('blocked');"],
    ['validateBase','protocol','function validateBase(input) {',"throw Error('blocked');"],
    ['resolveSprintDir','protocol','function resolveSprintDir(worktree, sprintDir) {',"throw Error('blocked');"],
    ['headSha','cli','async function headSha(worktree) {','return null;'],
    ['gitOut','cli','async function gitOut(worktree, args) {','return null;'],
    ['gitRun','cli','function gitRun(worktree, args) {',"throw Error('blocked');"],
  ])('执行前置 %s 被替换时拒绝',(_label,key,before,statement)=>{
    expect(proveBuildSources(mutateBuild(key,before,before+statement),parse)).toBe(false);
  });
});

it('注册 callback 不能是立即执行表达式，根 describe 不能异步注册',()=>{
  const s=buildSources();
  expect(proveBuildSources({...s,test:s.test.replace("describe('build 活动（子进程 + 假 claude + 真实 git 提交）', () => {", "describe('build 活动（子进程 + 假 claude + 真实 git 提交）', async () => {")},parse)).toBe(false);
  expect(proveBuildSources({...s,test:s.test.replace("  it('claude 参数：", "  it('blocked',(()=>{throw Error('blocked')})());\n  it('claude 参数：")},parse)).toBe(false);
});
