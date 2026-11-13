import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {parse} from 'acorn';
import {createRequire} from 'node:module';
import yaml from 'js-yaml';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {cruise} from 'dependency-cruiser';
import {VERIFICATION_GIT_OPTIONS,cleanupVerificationFixture,immutableVerificationSeed,disposeVerificationSeed,fixedInputFixture as inputFixture,assertTypedResolverOutputLayout,assertFunctionalConsumerInputs} from './fixtures/verification-input-git.mjs';
// 根扫描器依赖只在npm ci全根的CI来源suite执行；Brain-only单测保留运行配置行为测试。
test('默认运行配置由原生依赖图绑定到实际读取器',async()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  const readerPath='packages/brain/src/lib/factory-workflow-config.js';
  const configPath='packages/brain/config/factory-workflows.json';
  const result=await cruise([join(root,readerPath)],{baseDir:root,doNotFollow:{path:'node_modules'},exclude:{path:'node_modules'}});
  const graph=typeof result.output==='string'?JSON.parse(result.output):result.output;
  const reader=graph.modules.find(m=>resolve(process.cwd(),m.source)===join(root,readerPath));
  assert.ok(reader);
  assert.equal(reader.dependencies.filter(d=>!d.couldNotResolve&&resolve(process.cwd(),d.resolved)===join(root,configPath)).length,1);
});
// 派生输入是只读选择证据；不加载配置或测试正文，不把它当作运行回执。
const finite = await import('../implementation-verification-selectors.mjs').catch(error => {
  if(error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const configuration = test => `import {defineConfig} from 'vitest/config';export default defineConfig({test:${test}});`;
const selected = (filePath,configText,configPath='apps/api/vitest.config.ts') => {
  assert.equal(typeof finite.selectVitestVerificationInput,'function','需要真实的有限选择器证明，不能只按测试路径认领');
  return finite.selectVitestVerificationInput({filePath,configPath,configText});
};
for(const [name,file,config,configPath,wanted]of[
 ['字面include','apps/api/features/unit.test.ts',configuration("{include:['features/**/*.{test,spec}.{ts,tsx}'],exclude:['features/excluded/**']}"),undefined,true],
 ['零层globstar','apps/api/unit.test.ts',configuration("{include:['**/*.{test,spec}.{ts,tsx}']}"),undefined,true],
 ['默认Quality include','packages/quality/__tests__/cli.test.js',configuration('{}'),'packages/quality/vitest.config.ts',true],
 ['Brain跨包include','tests/regression/entry/check.test.js',configuration("{include:['../../tests/regression/**/*.{test,spec}.?(c|m)[jt]s?(x)']}"),'packages/brain/vitest.config.js',true],
 ['默认不含dot','apps/api/.hidden/unit.test.ts',configuration("{include:['**/*.test.ts']}"),undefined,false],
 ['默认不含node_modules','apps/api/src/node_modules/unit.test.ts',configuration("{include:['**/*.test.ts']}"),undefined,false],
 ['显式exclude','apps/api/features/excluded/unit.test.ts',configuration("{include:['features/**/*.test.ts'],exclude:['features/excluded/**']}"),undefined,false],
 ['无选择','apps/api/features/unit.test.ts',configuration("{include:[]}"),undefined,false],
 ['后缀不相同','apps/api/features/unit.test.ts.map',configuration("{include:['**/*']}"),undefined,false],
])test(`派生Vitest输入 ${name}`,()=>{
 const result=selected(file,config,configPath);
 assert.equal(result.selected,wanted);
 if(wanted){assert.equal(result.witness.kind,'finite_vitest_selector');assert.match(result.witness.config_sha256,/^[a-f0-9]{64}$/);}
});
test('Engine两project真实常量与spread按各自include减exclude，不把并行文件混进serial',()=>{
 const config="import{defineConfig}from'vitest/config';const PARALLEL_TESTS=['tests/a.test.ts'];export default defineConfig({test:{projects:[{test:{name:'parallel',include:PARALLEL_TESTS}},{test:{name:'serial',include:['tests/**/*.test.ts'],exclude:[...PARALLEL_TESTS]}}]}});";
 const result=selected('packages/engine/tests/a.test.ts',config,'packages/engine/vitest.config.ts');
 assert.equal(result.selected,true);assert.deepEqual(result.witness.selected_projects,['parallel']);
});
for(const [name,config]of[
 ['project root重定位',configuration("{projects:[{root:'elsewhere',test:{name:'unit',include:['**/*.test.ts']}}]}")],
 ['project继承未知配置',configuration("{projects:[{extends:'./other.config.ts',test:{name:'unit',include:['**/*.test.ts']}}]}")],
 ['错误meta路径',"import path from'path';import{fileURLToPath}from'url';import{defineConfig}from'vitest/config';const __dirname=path.dirname(fileURLToPath(import.meta.resolve));export default defineConfig({test:{include:['**/*.test.ts']}});"],
 ['动态include',configuration('{include:process.env.TESTS}')],
 ['函数配置',"import{defineConfig}from'vitest/config';export default defineConfig(()=>({test:{include:['**/*.test.ts']}}));"],
 ['root重定位',configuration("{root:process.env.ROOT,include:['**/*.test.ts']}")],
 ['name过滤',configuration("{include:['**/*.test.ts'],testNamePattern:'nothing'}")],
 ['环境选择条件',configuration("{include:process.env.CI?['**/*.test.ts']:[]}")],
 ['未知spread',configuration("{include:['**/*.test.ts'],exclude:[...process.env.EXCLUDE]}")],
 ['配置提前退出',"import{defineConfig}from'vitest/config';process.exit(0);export default defineConfig({test:{include:['**/*.test.ts']}});"],
 ['const死前置',"import{defineConfig}from'vitest/config';const stop=process.exit(0);export default defineConfig({test:{include:['**/*.test.ts']}});"],
 ['外跳glob',configuration("{include:['../../../outside/*.test.ts']}")],
])test(`未知Vitest选择 ${name}拒绝`,()=>assert.throws(()=>selected('apps/api/unit.test.ts',config),/VERIFICATION_SELECTOR/));
test('业务src文件不能借测试import或宽include成为派生verification输入',()=>{
 assert.throws(()=>selected('apps/api/src/planning.ts',configuration("{include:['src/**']}")),/VERIFICATION_(?:SELECTOR|INPUT)/);
});
test('Engine parallel直接skillSourceExcludes调用只由封印的真实selector还原',()=>{
 // 自包含固定输入，仅按数据解码；实际helper的完整SHA由可信只读解析器验证。
 const skillText=Buffer.from('Ly8g6L+Z5Lqb5rWL6K+V5qC46aqM5Zu65a6a5aSW572uU2tpbGzmraPmlofvvJvljp/nlJ/ot6/nlLHjgIFSdW5uZXLlkoxsYXVuY2hlcua1i+ivleS7jeWcqOe7hOS7tuWNlea1i+S4reOAggpleHBvcnQgY29uc3QgU0tJTExfU09VUkNFX1JPT1RTID0ge2JyYWluOidwYWNrYWdlcy9icmFpbicsIGVuZ2luZToncGFja2FnZXMvZW5naW5lJywgcXVhbGl0eToncGFja2FnZXMvcXVhbGl0eScsIHJvb3Q6Jy4nfTsKZXhwb3J0IGNvbnN0IFNLSUxMX1NPVVJDRV9URVNUUyA9IHsKICBicmFpbjogWwogICAgJ3NjcmlwdHMvY2kvX190ZXN0c19fL3NraWxsLWNvbnRyYWN0LnRlc3QubWpzJywKICAgICdzcmMvX190ZXN0c19fL3VuaWZpZWQtbWFwLWNvbnN1bWVycy50ZXN0LmpzJywKICAgICdzcmMvd29ya2Zsb3dzL19fdGVzdHNfXy9iMjAtcGxhbm5lci10aGluLXByZC1zdWJqZWN0LnRlc3QuanMnLAogICAgJ3NyYy93b3JrZmxvd3MvX190ZXN0c19fL2IzMS1ldmFsLWNvb2tpZS1pc29sYXRlLnRlc3QuanMnLAogICAgJ3NyYy93b3JrZmxvd3MvX190ZXN0c19fL2hhcm5lc3MtY29udHJhY3QtdmFsaWRhdGlvbi1pZGVudGl0eS1za2lsbC50ZXN0LmpzJywKICAgICdzcmMvd29ya2Zsb3dzL19fdGVzdHNfXy9wbGFubmVyLXJvbGUtYnJhbmNoLWNvbnRyYWN0LnRlc3QuanMnLAogICAgJ3NyYy9vcmNoZXN0cmF0b3IvX190ZXN0c19fL2hhcm5lc3MtZXZhbHVhdG9yLXJlcXVpcmVkLWV2aWRlbmNlLXNraWxsLnRlc3QuanMnLAogICAgJ3NyYy9vcmNoZXN0cmF0b3IvX190ZXN0c19fL2hhcm5lc3MtZ2VuZXJhdG9yLWZyb3plbi1iYXNlbGluZS1za2lsbC50ZXN0LmpzJywKICAgICcqKi8qLnNraWxsLXNvdXJjZS50ZXN0LionLAogIF0sCiAgZW5naW5lOiBbCiAgICAndGVzdHMvcHJveHkvcGhhc2U4MS0xMy1wb2ludHMudGVzdC50cycsCiAgICAndGVzdHMvcHJveHkvcGhhc2U4Mi0xMC1wb2ludHMudGVzdC50cycsCiAgICAndGVzdHMvc2tpbGxzL2NvZGluZy13b3JrZmxvdy1lbnRyeS1kb2NzLnRlc3QudHMnLAogICAgJ3Rlc3RzL3NraWxscy9oYXJuZXNzLWdlbmVyYXRvci50ZXN0LnRzJywKICAgICd0ZXN0cy9za2lsbHMvaGFybmVzcy1jb250cmFjdC1wcm9wb3Nlci50ZXN0LnRzJywKICAgICd0ZXN0cy9za2lsbHMvbGFuZ3VhZ2UtcnVsZS50ZXN0LnRzJywKICAgICd0ZXN0cy9za2lsbHMvcmVzZWFyY2gtcHJveHktaW50ZWdyYXRpb24udGVzdC50cycsCiAgICAnKiovKi5za2lsbC1zb3VyY2UudGVzdC4qJywKICBdLAogIHF1YWxpdHk6IFsndGVzdHMvcmVncmVzc2lvbi9oYXJuZXNzLWFuZHJvaWQtdGFyZ2V0LWVudmlyb25tZW50LnRlc3QudHMnLCAnKiovKi5za2lsbC1zb3VyY2UudGVzdC4qJ10sCiAgcm9vdDogWyd0ZXN0cy9za2lsbHMvaGFybmVzcy1wbGFubmVyLXB1c2gtbm9pc2UudGVzdC5qcycsICd0ZXN0cy8qKi8qLnNraWxsLXNvdXJjZS50ZXN0LionXSwKfTsKCi8vIOWOn+aWh+S7tuW3suaYjuehrmRlc2NyaWJlLnNraXDvvJp2NeWQiOWQjOWcqHY25Y2H57qn5ZCO5YGc55So77yM5LiN6K6h5YWl5Lu75L2V5bey6aqM6K+B5L+d6Zqc44CCCmV4cG9ydCBjb25zdCBSRVRJUkVEX1NLSUxMX1RFU1RTID0gewogIGVuZ2luZTogWyd0ZXN0cy9za2lsbHMvaGFybmVzcy1jb250cmFjdC1yZXZpZXdlci50ZXN0LnRzJ10sCn07CgpleHBvcnQgZnVuY3Rpb24gc2tpbGxTb3VyY2VFeGNsdWRlcyhjb21wb25lbnQpIHsKICBpZiAoIU9iamVjdC5oYXNPd24oU0tJTExfU09VUkNFX1RFU1RTLCBjb21wb25lbnQpKSB0aHJvdyBuZXcgRXJyb3IoYOacquefpVNraWxs5ZCI5ZCM57uE5Lu277yaJHtjb21wb25lbnR9YCk7CiAgcmV0dXJuIFsKICAgIC4uLlNLSUxMX1NPVVJDRV9URVNUU1tjb21wb25lbnRdLCAuLi4oUkVUSVJFRF9TS0lMTF9URVNUU1tjb21wb25lbnRdIHx8IFtdKSwKICAgIC4uLihjb21wb25lbnQgPT09ICdicmFpbicgPyBTS0lMTF9TT1VSQ0VfVEVTVFMucm9vdC5tYXAocGF0aCA9PiBgLi4vLi4vJHtwYXRofWApIDogW10pLAogIF07Cn0KCmV4cG9ydCBmdW5jdGlvbiBza2lsbFNvdXJjZUNvbmZpZyhjb21wb25lbnQsIGJhc2UgPSB7fSkgewogIGlmICghT2JqZWN0Lmhhc093bihTS0lMTF9TT1VSQ0VfVEVTVFMsIGNvbXBvbmVudCkpIHRocm93IG5ldyBFcnJvcihg5pyq55+lU2tpbGzlkIjlkIznu4Tku7bvvJoke2NvbXBvbmVudH1gKTsKICByZXR1cm4gey4uLmJhc2UsIHRlc3Q6IHsKICAgIC4uLmJhc2UudGVzdCwgZ2xvYmFsczogdHJ1ZSwgZW52aXJvbm1lbnQ6ICdub2RlJywgcHJvamVjdHM6IHVuZGVmaW5lZCwKICAgIGluY2x1ZGU6IFNLSUxMX1NPVVJDRV9URVNUU1tjb21wb25lbnRdLCBleGNsdWRlOiBbJyoqL25vZGVfbW9kdWxlcy8qKiddLAogICAgZmlsZVBhcmFsbGVsaXNtOiBmYWxzZSwKICB9fTsKfQo=','base64').toString('utf8');
 const config="import{defineConfig}from'vitest/config';import{skillSourceExcludes}from'../../scripts/ci/skill-source-tests.mjs';const PARALLEL_TESTS=['tests/a.test.ts'];export default defineConfig({test:{projects:[{test:{name:'parallel',include:PARALLEL_TESTS,exclude:skillSourceExcludes('engine')}}]}});";
 assert.equal(finite.selectVitestVerificationInput({filePath:'packages/engine/tests/a.test.ts',configPath:'packages/engine/vitest.config.ts',configText:config,skillText,component:'engine'}).selected,true);
});

test('纯selector只持AST与字面量能力，不加载Brain受保护reader或候选配置',()=>{
 const tree=parse(readFileSync(new URL('../implementation-verification-selectors.mjs',import.meta.url),'utf8'),{ecmaVersion:'latest',sourceType:'module'});
 const permitted=new Set(['acorn','node:module','node:path','node:crypto']);
 assert.ok(tree.body.filter(n=>n.type==='ImportDeclaration').every(n=>permitted.has(n.source.value)));
});

const fixedInputs=await import('../implementation-verification-inputs.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return{};});
const facts=(fixture,side,options={})=>{
 assert.equal(typeof fixedInputs.readVerificationInputFacts,'function','必须从实际固定Git证明输入，不能自填摘要');
 return fixedInputs.readVerificationInputFacts(fixture.root,{source:fixture.source,side,path:fixture.path,...options});
};
test('输入facts独立冻结真实side/commit/tree/普通blob，不把摘要称为入口或owner资格',t=>{
 const f=inputFixture(t),row=facts(f,'head');
 assert.equal(row.source.revision,f.source.head_revision);assert.equal(row.source.tree_sha1,f.git('rev-parse','HEAD^{tree}'));
 assert.equal(row.git_blob_sha1,f.git('rev-parse','HEAD:'+f.path));assert.equal(row.mode,'100644');assert.equal(row.role,'verification_input');
 assert.equal(row.entry_verified,false);assert.equal(row.owner_verified,false);
 assert.doesNotThrow(()=>fixedInputs.verifyVerificationInputFacts(f.root,{source:f.source,row}));
 for(const edit of[r=>{r.sha256='f'.repeat(64);},r=>{r.source.side='base';},r=>{r.git_blob_sha1='e'.repeat(40);},r=>{r.source.tree_sha1='d'.repeat(40);}]){
  const altered=structuredClone(row);edit(altered);assert.throws(()=>fixedInputs.verifyVerificationInputFacts(f.root,{source:f.source,row:altered}),/VERIFICATION_INPUT/);
 }
});
test('deleted仅在存在的base侧生成facts，head缺失不能造行',t=>{
 const f=inputFixture(t,{kind:'deleted'});assert.ok(facts(f,'base'));assert.throws(()=>facts(f,'head'),/VERIFICATION_INPUT|FIXED_GIT/);
 assert.equal(facts(f,'head',{allowMissing:true}),null);
});
test('真实symlink输入拒绝；不得把链接文字或外跳目标作为被验证文件',t=>{
 const f=inputFixture(t,{kind:'symlink'});assert.throws(()=>facts(f,'head'),/REGULAR_BLOB|VERIFICATION_INPUT/);
});
test('业务模块、外跳路径、不在真实delta、错误side及main/release用途均拒绝',t=>{
 const f=inputFixture(t);
 for(const options of[{path:'packages/brain/src/business.js'},{path:'../outside.test.js'},{path:'packages/brain/src/__tests__/missing.test.js'},{side:'other'},{purpose:'main_verification'},{purpose:'release'}])
  assert.throws(()=>facts(f,'head',options),/VERIFICATION_INPUT/);
 const wrong={...f,source:structuredClone(f.source)};wrong.source.repo='foreign/repo';assert.throws(()=>facts(wrong,'head'),/VERIFICATION_INPUT/);
});

after(disposeVerificationSeed);
function currentEntryFixture(t,{path='packages/brain/src/__tests__/derived-input.test.js',deleted=false}={}){
 const root=mkdtempSync(join(tmpdir(),'derived-entry-git-'));t.after(()=>cleanupVerificationFixture(root));
 const git=(...args)=>execFileSync('git',[...VERIFICATION_GIT_OPTIONS,'--no-replace-objects','-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024}).trim();
 git('clone','--shared','--no-checkout',immutableVerificationSeed(fileURLToPath(new URL('../../../',import.meta.url))),'.');
 git('sparse-checkout','set','--no-cone','/.github/','/scripts/ci/','/scripts/skill_source_ownership.py','/packages/brain/vitest.config.js','/packages/brain/vitest.skill-source.config.mjs','/scripts/ci/skill-source-tests.mjs','/packages/engine/vitest.config.ts','/packages/quality/vitest.config.ts','/vitest.skill-source.config.mjs','/apps/api/vitest.config.ts','/apps/dashboard/vitest.config.ts','/'+path);
 git('checkout','--detach','d06de84e9f7d2d489a151e0b13b38f81651dd3fa');git('remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');
 mkdirSync(join(root,path.slice(0,path.lastIndexOf('/'))),{recursive:true});writeFileSync(join(root,path),'export const baseInput=true;\n');
 const commit=()=>{git('add','--sparse','-A');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','test: fixed input source');return git('rev-parse','HEAD');};
 const base=commit();if(deleted)rmSync(join(root,path));else writeFileSync(join(root,path),'export const headInput=true;\n');const head=commit();
 return{root,path,git,commit,source:{repo:'perfectuser21/cecelia',base_revision:base,head_revision:head,changed_files:[{path}]}};
}
function derived(fixture,options={}){
 assert.equal(typeof fixedInputs.collectVerificationInputEvidence,'function','配置被选中还不够，必须证明真实CI入口和changed-path组件条件');
 return fixedInputs.collectVerificationInputEvidence(fixture.root,{source:fixture.source,...options});
}
test('当前固定Git声明与有限config选择冻结两侧input，不授予执行资格',t=>{
 const f=currentEntryFixture(t),proof=derived(f);
 const rows=proof.rows.filter(r=>r.input_facts.path===f.path);assert.deepEqual(rows.map(r=>r.input_facts.source.side).sort(),['base','head']);
 for(const row of rows){assert.equal(row.witness.kind,'vitest_config_input');assert.equal(row.witness.component_selected,true);assert.equal(row.execution_status,'not_evaluated');assert.equal(row.input_facts.entry_verified,false);}
 assert.doesNotThrow(()=>fixedInputs.verifyVerificationInputEvidence(f.root,{source:f.source,evidence:proof}));
 const forged=structuredClone(proof);forged.rows[0].witness.entry.canonical_sha256='f'.repeat(64);
 assert.throws(()=>fixedInputs.verifyVerificationInputEvidence(f.root,{source:f.source,evidence:forged}),/VERIFICATION_INPUT/);
});

test('delete只冻结存在且真实selected的base；不能把head配置或blob填给base',t=>{
 const f=currentEntryFixture(t,{deleted:true}),proof=derived(f),rows=proof.rows.filter(r=>r.input_facts.path===f.path);
 assert.equal(rows.length,1);assert.equal(rows[0].input_facts.source.side,'base');assert.equal(rows[0].input_facts.source.revision,f.source.base_revision);
});

test('有限glob把字面量加号保留为文件名，不能把aa当作a+',()=>{
 const config=configuration("{include:['tests/a+.test.js']}");
 assert.equal(selected('apps/api/tests/a+.test.js',config).selected,true);
 assert.equal(selected('apps/api/tests/aa.test.js',config).selected,false);
});
test('配置根目录带加号同样不能变成正则量词',()=>{
 const config=configuration("{include:['tests/*.test.ts']}");
 assert.equal(selected('apps/api+/tests/a.test.ts',config,'apps/api+/vitest.config.ts').selected,true);
 assert.equal(selected('apps/apii/tests/a.test.ts',config,'apps/api+/vitest.config.ts').selected,false);
});

// 已审Dashboard配置仅以固定数据解码；不执行plugin/createRequire。
const dashboardConfig = Buffer.from('aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZXN0L2NvbmZpZyc7CmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7CmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnOwppbXBvcnQgeyBjcmVhdGVSZXF1aXJlIH0gZnJvbSAnbm9kZTptb2R1bGUnOwoKLy8gbnBtIOWPr+WwhuS+nei1luaPkOWNh+WIsOagueebruW9leaIluijhei/myB3b3Jrc3BhY2XvvJvmjIkgRGFzaGJvYXJkIOWunumZheS+nei1luagkeWumuS9jeOAggpjb25zdCBkYXNoYm9hcmRSZXF1aXJlID0gY3JlYXRlUmVxdWlyZShwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAncGFja2FnZS5qc29uJykpOwpjb25zdCByb3V0ZXJSZXF1aXJlID0gY3JlYXRlUmVxdWlyZShkYXNoYm9hcmRSZXF1aXJlLnJlc29sdmUoJ3JlYWN0LXJvdXRlci1kb20vcGFja2FnZS5qc29uJykpOwoKZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHsKICBwbHVnaW5zOiBbcmVhY3QoKV0sCiAgdGVzdDogewogICAgZ2xvYmFsczogdHJ1ZSwKICAgIGVudmlyb25tZW50OiAnaGFwcHktZG9tJywKICAgIHNldHVwRmlsZXM6IFsnLi9zcmMvdGVzdC9zZXR1cC50cyddLAogICAgaW5jbHVkZTogWydzcmMvKiovKi57dGVzdCxzcGVjfS57dHMsdHN4fSddLAogICAgc2VydmVyOiB7CiAgICAgIGRlcHM6IHsKICAgICAgICAvLyDorqkgcmVhY3QtbWFya2Rvd24g6LWwIHZpdGUgdHJhbnNmb3JtIOeuoemBk++8iOW6lOeUqOS4i+aWuSByZWFjdCBhbGlhc++8ie+8jAogICAgICAgIC8vIOWQpuWImeWug+S8muiiqyBvcHRpbWl6ZURlcHMg6aKE5omT5YyF5bm25oqK5qC56YOoIFJlYWN0IDE5IOeDmOeEmei/m+WOuyDihpIg5LiOIGRhc2hib2FyZCBSZWFjdCAxOCDmkp7ovaYKICAgICAgICBpbmxpbmU6IFsvcmVhY3Qtcm91dGVyLywgL2x1Y2lkZS1yZWFjdC8sIC9yZWFjdC1tYXJrZG93bi8sIC9yZW1hcmstLywgL21pY3JvbWFyay8sIC9tZGFzdC8sIC9oYXN0LywgL3VuaXN0LywgL3ZmaWxlLywgL3VuaWZpZWQvLCAvcHJvcGVydHktaW5mb3JtYXRpb24vLCAvc3BhY2Utc2VwYXJhdGVkLXRva2Vucy8sIC9jb21tYS1zZXBhcmF0ZWQtdG9rZW5zLywgL2h0bWwtdXJsLWF0dHJpYnV0ZXMvLCAvZGV2bG9wLywgL3RyaW0tbGluZXMvLCAvZGVjb2RlLW5hbWVkLWNoYXJhY3Rlci1yZWZlcmVuY2UvLCAvY2hhcmFjdGVyLWVudGl0aWVzLywgL2Njb3VudC8sIC9lc2NhcGUtc3RyaW5nLXJlZ2V4cC8sIC9tYXJrZG93bi10YWJsZS8sIC96d2l0Y2gvLCAvbG9uZ2VzdC1zdHJlYWsvLCAvYmFpbC8sIC9pcy1wbGFpbi1vYmovLCAvZXh0ZW5kLywgL2VzdHJlZS11dGlsLWlzLWlkZW50aWZpZXItbmFtZS9dLAogICAgICB9LAogICAgfSwKICB9LAogIHJlc29sdmU6IHsKICAgIGFsaWFzOiB7CiAgICAgICdAJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjJyksCiAgICAgICdAZmVhdHVyZXMvY29yZSc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9hcGkvZmVhdHVyZXMnKSwKICAgICAgLy8g5by65Yi2IFJlYWN0IOWNleWunuS+i++8iOWQqyByZWFjdC9qc3gtcnVudGltZSDlrZDot6/lvoTvvInvvIzplIHliLAgZGFzaGJvYXJkIOacrOWcsCBSZWFjdCAxOOOAggogICAgICAvLyDlkKbliJkgbW9ub3JlcG8g5Lya5oqKIHJlYWN0LW1hcmtkb3duIOeahCByZWFjdCBwZWVyIOaPkOWNh+WIsOague+8iFJlYWN0IDE577yJ77yMCiAgICAgIC8vIOS4jue7hOS7tueUqOeahCBSZWFjdCAxOCDmkp7ovaYg4oaSICJPYmplY3RzIGFyZSBub3QgdmFsaWQgYXMgYSBSZWFjdCBjaGlsZCLjgIIKICAgICAgcmVhY3Q6IHBhdGguZGlybmFtZShkYXNoYm9hcmRSZXF1aXJlLnJlc29sdmUoJ3JlYWN0L3BhY2thZ2UuanNvbicpKSwKICAgICAgJ3JlYWN0LWRvbSc6IHBhdGguZGlybmFtZShkYXNoYm9hcmRSZXF1aXJlLnJlc29sdmUoJ3JlYWN0LWRvbS9wYWNrYWdlLmpzb24nKSksCiAgICAgICdyZWFjdC1yb3V0ZXItZG9tJzogZGFzaGJvYXJkUmVxdWlyZS5yZXNvbHZlKCdyZWFjdC1yb3V0ZXItZG9tL2Rpc3QvaW5kZXguanMnKSwKICAgICAgJ3JlYWN0LXJvdXRlcic6IHJvdXRlclJlcXVpcmUucmVzb2x2ZSgncmVhY3Qtcm91dGVyL2Rpc3QvaW5kZXguanMnKSwKICAgICAgJ2x1Y2lkZS1yZWFjdCc6IGRhc2hib2FyZFJlcXVpcmUucmVzb2x2ZSgnbHVjaWRlLXJlYWN0L2Rpc3QvZXNtL2x1Y2lkZS1yZWFjdC5qcycpLAogICAgfSwKICAgIGRlZHVwZTogWydyZWFjdCcsICdyZWFjdC1kb20nLCAncmVhY3Qtcm91dGVyLWRvbSddLAogIH0sCn0pOwo=','base64').toString('utf8');
test('Dashboard已审完整配置保留真实include，plugin只作固定数据不执行',()=>{
 const result=selected('apps/dashboard/src/pages/live-monitor/OpsPanoramaCard.test.tsx',dashboardConfig,'apps/dashboard/vitest.config.ts');
 assert.equal(result.selected,true);assert.equal(result.witness.reviewed_config_profile,'dashboard-default-v1');
 assert.equal(result.witness.config_sha256,'a5899ed07ee4aa8ff262f7da361d695ef8eb26005571c5e09988aac53c1cc261');
 assert.equal(selected('apps/dashboard/outside/other.test.tsx',dashboardConfig,'apps/dashboard/vitest.config.ts').selected,false);
});
test('Dashboard固定profile不外借路径或接受被改include/root/plugin与未知配置',()=>{
 for(const [config,path]of[
  [dashboardConfig,'apps/api/vitest.config.ts'],
  [dashboardConfig.replace("src/**/*.{test,spec}.{ts,tsx}","**/*"),'apps/dashboard/vitest.config.ts'],
  [dashboardConfig.replace('globals: true','root: process.cwd(), globals: true'),'apps/dashboard/vitest.config.ts'],
  [dashboardConfig.replace('react()]','react(), process.exit(0)]'),'apps/dashboard/vitest.config.ts'],
  [dashboardConfig+'\n// unreviewed bytes\n','apps/dashboard/vitest.config.ts'],
 ])assert.throws(()=>selected('apps/dashboard/src/pages/live-monitor/OpsPanoramaCard.test.tsx',config,path),/VERIFICATION_SELECTOR/);
});
// 稳定68树上的自包含已审输入overlay，只解压为数据，绝不执行fixture脚本。
function basicEntryFixture(t,path){return currentEntryFixture(t,{path});}
for(const path of[
 'scripts/ci/__tests__/basic-selected-input.test.mjs',
 'apps/dashboard/src/pages/live-monitor/selected.test.tsx',
 'packages/brain/src/__tests__/ci-defense.skill-source.test.js',
])test(`真实Basic/Pinned入口只证明实际被选中的输入 ${path}`,t=>{
 const f=basicEntryFixture(t,path),proof=derived(f),rows=proof.rows.filter(r=>r.input_facts.path===path);
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.execution_status==='not_evaluated'&&r.coverage==='unknown'));
 assert.ok(rows.every(r=>r.eligible_owner_paths.includes('.github/workflows/ci.yml')||r.eligible_owner_paths.includes('.github/workflows/skills-source-check.yml')));
});
test('Basic有限Node选择不接收匹配basename目录内文件或未选择的Node单测',t=>{
 for(const path of['scripts/ci/__tests__/basic-fake.test.mjs/nested.test.mjs','scripts/ci/__tests__/unselected.test.mjs']){
  const f=basicEntryFixture(t,path);assert.equal(derived(f).rows.length,0);
 }
});

for(const path of[
 'packages/brain/vitest.skill-source.config.mjs',
 'scripts/ci/run-skill-source-check.mjs',
 'scripts/ci/dep-audit-critical.sh',
])test(`真实入口或schema reader将固定CI输入与输入执行区分 ${path}`,t=>{
 const f=basicEntryFixture(t,'scripts/ci/__tests__/basic-anchor.test.mjs');
 // 输入正文来自同一自包含overlay/68；仅注释字节改变普通YAML或shell输入。
 const actual=f.git('show',f.source.base_revision+':'+path);writeFileSync(join(f.root,path),actual+(path.endsWith('.yml')||path.endsWith('.sh')?'\n# input change\n':''));
 f.source.head_revision=f.commit();f.source.changed_files=f.git('diff','--no-renames','--name-only',f.source.base_revision,f.source.head_revision).split('\n').filter(Boolean).map(path=>({path}));
 if(!f.source.changed_files.some(c=>c.path===path)){
  // 新增的Pinned文件只有head侧存在，其base侧改为不存在，避免改已封印包装器正文。
  f.git('reset','--hard',f.source.base_revision);f.git('rm','--sparse',path);const before=f.commit();writeFileSync(join(f.root,path),actual);f.source.base_revision=before;f.source.head_revision=f.commit();f.source.changed_files=[{path}];
 }
 const proof=derived(f),rows=proof.rows.filter(r=>r.input_facts.path===path);
 assert.ok(rows.length>0,JSON.stringify(proof.unproven));assert.ok(rows.every(r=>r.execution_status==='not_evaluated'));
 if(path.endsWith('.yml'))assert.ok(rows.every(r=>r.witness.kind==='workflow_yaml_schema_input'&&r.witness.workflow_jobs_execution==='not_evaluated'));
});


const verificationContext=await import('../implementation-verification-context.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return{};});
function nativeOwnerReport(source,{headOnly=false}={}){
 const owner='packages/brain/vitest.config.js',consumer='.github/workflows/ci.yml',report={scope_key:'cecelia-factory',registry_repo:'cecelia-factory-source',source:structuredClone(source),ci_context:{purpose:'admission_only'},affected_usages:[],verification_owner_coverage:{}};
 for(const side of['base','head']){
  const revision=source[side+'_revision'],matched=headOnly&&side==='base'?[]:[consumer];
  report[side]={revision,mapping_status:'verified',graph_snapshot:{source_revision:revision,digest:'a'.repeat(64)},traversal:{truncated:false},file_coverage:source.changed_files.map((c,i)=>({change_index:i,path:c.path,matched_paths:[],truncated:false}))};
  report.verification_owner_coverage[side]=[{path:owner,matched_paths:matched,truncated:false,source_revision:revision,graph_sha256:'a'.repeat(64)}];
  if(matched.length)report.affected_usages.push({evidence:[{side,revision,implementation:{path:consumer,repo:source.repo,registry_repo:report.registry_repo,revision}}]});
 }
 return report;
}
const buildContext=(f,evidence,reports,options={})=>{
 assert.equal(typeof verificationContext.buildVerificationInputContext,'function','派生owner必须由同side原生报告独立证明');
 return verificationContext.buildVerificationInputContext({source:f.source,evidence,reports,purpose:'admission_only',...options});
};
test('验证输入context只允许同侧原生config owner；any-side规则不向base填head资格',t=>{
 const f=currentEntryFixture(t),evidence=derived(f),report=nativeOwnerReport(f.source,{headOnly:true}),context=buildContext(f,evidence,[report]);
 assert.deepEqual(context.joint_files.map(r=>r.path),[f.path]);
 assert.equal(context.authorized_inputs.length,1);assert.equal(context.authorized_inputs[0].side,'head');
 assert.equal(context.execution_status,'not_evaluated');assert.equal(context.coverage,'unknown');
 assert.ok(context.input_evidence.rows.every(r=>r.input_facts.owner_verified===false));
 assert.doesNotThrow(()=>verificationContext.verifyVerificationInputContext(f.root,{source:f.source,reports:[report],context}));
});
test('context拒绝aux/governance/derived owner继承、空命中、截断、错图及错side，不能把未知输入批量认领',t=>{
 const f=currentEntryFixture(t),evidence=derived(f);
 for(const edit of[
  r=>{r.verification_owner_coverage.head[0].coverage_kind='auxiliary_source';},
  r=>{r.verification_owner_coverage.head[0].native_matched_paths=[];},
  r=>{r.verification_owner_coverage.head[0].truncated=true;},
  r=>{r.verification_owner_coverage.head[0].graph_sha256='b'.repeat(64);},
  r=>{r.verification_owner_coverage.head[0].source_revision=f.source.base_revision;},
  r=>{r.verification_owner_coverage.head[0].matched_paths=['apps/api/src/business.ts'];},
  r=>{r.head.mapping_status='unknown';},
  r=>{r.head.traversal.truncated=true;},
 ]){const report=nativeOwnerReport(f.source);edit(report);assert.throws(()=>buildContext(f,evidence,[report]),/VERIFICATION_CONTEXT/);}
 const report=nativeOwnerReport(f.source,{headOnly:true});report.verification_owner_coverage.head[0].matched_paths=[];
 assert.equal(buildContext(f,evidence,[report]).joint_files.length,0);
 for(const purpose of['release','main_verification'])assert.throws(()=>buildContext(f,evidence,[report],{purpose}),/ADMISSION_ONLY/);
});
test('context在使用时从真实Git重建入口、input与owner查询绑定，摘要自改或witness篡改均拒绝',t=>{
 const f=currentEntryFixture(t),evidence=derived(f),report=nativeOwnerReport(f.source),context=buildContext(f,evidence,[report]);
 for(const edit of[c=>{c.input_evidence.rows[0].witness.selector.config_sha256='e'.repeat(64);},c=>{c.authorized_inputs[0].owner_claims[0].owner_path='apps/api/src/business.ts';},c=>{c.source.head_revision=f.source.base_revision;}]){
  const forged=structuredClone(context);edit(forged);assert.throws(()=>verificationContext.verifyVerificationInputContext(f.root,{source:f.source,reports:[report],context:forged}),/VERIFICATION_CONTEXT|VERIFICATION_INPUT/);
 }
});

test('test目录helper只通过真实selected测试的静态import获得输入证据，业务src不继承',t=>{
 const path='packages/brain/src/__tests__/helpers/input-fixture.js',reader='packages/brain/src/__tests__/input-reader.test.js',f=basicEntryFixture(t,path);
 writeFileSync(join(f.root,reader),"import {fixture} from './helpers/input-fixture.js';import{test}from'vitest';test('actual',()=>fixture);\n");
 f.source.head_revision=f.commit();f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').map(path=>({path}));
 const proof=derived(f,{readerPaths:{base:[],head:[reader]}}),row=proof.rows.find(r=>r.input_facts.path===path&&r.input_facts.source.side==='head');
 assert.ok(row);assert.equal(row.witness.kind,'selected_test_static_import_input');assert.equal(row.witness.reader.path,reader);
 assert.ok(row.eligible_owner_paths.includes('packages/brain/vitest.config.js'));
 assert.doesNotThrow(()=>fixedInputs.verifyVerificationInputEvidence(f.root,{source:f.source,evidence:proof}));
 assert.equal(fixedInputs.verificationInputKind('packages/brain/src/business.js'),null);
});
test('helper不能借死分支dynamic import、未selected reader或假reader路径成为输入',t=>{
 const path='packages/brain/src/__tests__/helpers/input-fixture.js',reader='packages/brain/src/__tests__/input-reader.test.js',f=basicEntryFixture(t,path);
 for(const content of["if(false)import('./helpers/input-fixture.js');","const fake=()=>import('./helpers/input-fixture.js');","const fake=\"import './helpers/input-fixture.js'\";"]){
  writeFileSync(join(f.root,reader),content);f.source.head_revision=f.commit();f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').map(path=>({path}));
  assert.equal(derived(f,{readerPaths:{base:[],head:[reader]}}).rows.some(r=>r.input_facts.path===path&&r.input_facts.source.side==='head'),false);
 }
 assert.throws(()=>derived(f,{readerPaths:{base:[],head:['../escape.test.js']}}),/VERIFICATION_INPUT/);
});

test('typed multi CLI只接受显式PR双root与artifact目录，legacy scopes-file路径保留互斥',async t=>{
 const multi=await import('../implementation-multi-pr-gate.mjs'),root=fileURLToPath(new URL('../../../',import.meta.url)),output=mkdtempSync(join(tmpdir(),'derived-typed-cli-'));t.after(()=>rmSync(output,{recursive:true,force:true}));
 const common=['--repo-root',root,'--base','a'.repeat(40),'--head','b'.repeat(40),'--mode','pr','--output-dir',output];
 const typed=['--tooling-root',root,'--ci-admission-input-dir',output];
 const options=multi.parseImplementationMultiArgs([...common,...typed]);
 assert.equal(options.ciAdmissionInputDir,realpathSync(output));assert.equal(options.toolingRoot,realpathSync(root));assert.equal(options.scopes,undefined);
 for(const args of[[...common,...typed,'--scopes-file',join(output,'scopes.json')],[...common,...typed.slice(0,2)],[...common,...typed.slice(2)],common.map(v=>v==='pr'?'main':v).concat(typed)])
  assert.throws(()=>multi.parseImplementationMultiArgs(args),/IMPACT_MULTISCOPE/);
});

test('共享scratch的PR收集入口拒绝release/main和不完整固定来源，不自建或连接数据库',async()=>{
 const pr=await import('../implementation-pr-gate.mjs');
 assert.equal(typeof pr.collectImplementationPrEvidenceInScratch,'function');
 for(const options of[{mode:'main'},{mode:'release'},{mode:'pr',scope:'cecelia-factory',base:'latest',head:'b'.repeat(40)}])
  await assert.rejects(pr.collectImplementationPrEvidenceInScratch(options),/ADMISSION_ONLY|INPUT_INVALID/);
});

test('extensionless Vitest helper import只接受实际唯一可解析普通文件，歧义时失败关闭',t=>{
 const path='packages/brain/src/__tests__/helpers/actual-fixture.ts',reader='packages/brain/src/__tests__/actual-reader.test.ts',f=basicEntryFixture(t,path);
 mkdirSync(join(f.root,'packages/brain/src/__tests__'),{recursive:true});writeFileSync(join(f.root,reader),"import{actual}from'./helpers/actual-fixture';import{test}from'vitest';test('actual',()=>actual);\n");
 f.source.head_revision=f.commit();f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').map(path=>({path}));
 assert.ok(derived(f,{readerPaths:{base:[],head:[reader]}}).rows.some(r=>r.input_facts.path===path));
 writeFileSync(join(f.root,path.replace('.ts','.js')),'export const shadow=true;\n');f.source.head_revision=f.commit();f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').map(path=>({path}));
 assert.equal(derived(f,{readerPaths:{base:[],head:[reader]}}).rows.some(r=>r.input_facts.path===path),false);
});



// 此处是纯聚合合同数据；不把合成producer身份作为正式来源或运行资格。
function aggregateNativeOwnerFixture(source){
 const first=nativeOwnerReport(source);first.required_assertions=[{assertion_ref:'manual:bash tests/real-regression.sh',source_bindings:[{capability_id:'fixture-cap',activity_id:'fixture-activity',step_id:null}]}];
 first.gaps=[{code:'changed_file_unclaimed',path:source.changed_files[0].path}];first.unclaimed_paths=structuredClone(source.changed_files);first.mapping_status='unknown';
 first.ci_context={purpose:'admission_only',base_snapshot_sha256:'c'.repeat(64),head_snapshot_sha256:'d'.repeat(64)};
 for(const side of['base','head']){
  first[side].gaps=[];first[side].projection={projection_run_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',manifest_version_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',projection_digest:'c'.repeat(64),manifest_digest:'d'.repeat(64)};
  first[side].definition_versions={workflows:[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',payload_sha256:'e'.repeat(64)}],activities:[{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',payload_sha256:'f'.repeat(64)}]};
 }
 for(const usage of first.affected_usages)for(const e of usage.evidence){e.capability_id='fixture-cap';e.activity_id='fixture-activity';}
 const second=structuredClone(first);second.scope_key='cecelia-kr';second.registry_repo='cecelia-kr-source';for(const u of second.affected_usages)for(const e of u.evidence)e.implementation.registry_repo=second.registry_repo;return [second,first];
}
test('联合准入只凭独立verification context解除file_unclaimed，原生图/owner/required assertions保持原值',async t=>{
 const f=currentEntryFixture(t),input=derived(f),raw=aggregateNativeOwnerFixture(f.source),context=buildContext(f,input,raw),multi=await import('../implementation-multi-scope.mjs');
 const options={source:f.source,expectedScopes:['cecelia-kr','cecelia-factory'],reports:raw,verification_input_context:context};
 const resolution=multi.resolveScopedImplementationReports(options);
 assert.deepEqual(resolution.source_reports,raw);assert.ok(raw.every(r=>r.mapping_status==='unknown'));
 assert.equal(resolution.evidence.verification_input_context.context_sha256,context.context_sha256);
 assert.equal(resolution.evidence.file_coverage[0].claims[0].coverage_kind,'verification_input');
 for(const report of resolution.evidence.scope_reports){
  assert.deepEqual(report.source.changed_files,[]);assert.deepEqual(report.required_assertions,raw.find(r=>r.scope_key===report.scope_key).required_assertions);
  assert.deepEqual(report.affected_usages,raw.find(r=>r.scope_key===report.scope_key).affected_usages);
 }
 assert.doesNotThrow(()=>multi.verifyScopedImplementationGitSource(f.root,resolution.evidence));
 for(const edit of[o=>{o.purpose='main_verification';},o=>{o.reports[0].gaps.push({code:'regression_missing'});},o=>{o.verification_input_context.authorized_inputs[0].owner_claims[0].source_revision='f'.repeat(40);}]){
  const altered=structuredClone(options);edit(altered);assert.throws(()=>multi.resolveScopedImplementationReports(altered));
 }
});
test('security两个bash都被echo替换时，不能把validator文字路径当成真实Node调用',t=>{
 const path='scripts/ci/validate-npm-audit.mjs',f=basicEntryFixture(t,path);
 for(const script of['scripts/ci/dep-audit-critical.sh','scripts/ci/dep-audit-runtime-high.sh'])writeFileSync(join(f.root,script),'#!/bin/bash\necho node validate-npm-audit.mjs\n');
 f.source.head_revision=f.commit();f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').map(path=>({path}));
 assert.equal(derived(f).rows.some(r=>r.input_facts.path===path&&r.input_facts.source.side==='head'),false);
});


for(const [path,kind]of[['docs/current/CI_PIPELINE.md','documentation_change'],['docs/registry/test-registry.yml','reference_catalog_change']])test(`独立非执行变更不冒充verification_input ${path}`,t=>{
 const f=currentEntryFixture(t,{path});assert.equal(typeof fixedInputs.readNonExecutableChangeFacts,'function');
 const row=fixedInputs.readNonExecutableChangeFacts(f.root,{source:f.source,side:'head',path});assert.equal(row.role,kind);assert.equal(row.non_executable,true);assert.equal(row.owner_verified,false);
 assert.throws(()=>fixedInputs.readNonExecutableChangeFacts(f.root,{source:f.source,side:'head',path:'packages/brain/src/business.js'}),/VERIFICATION_INPUT/);
});
test('raw graph事实必须逐侧核row_count与完整摘要；反向路径保留业务/未知reader并拒绝篡改',()=>{
 assert.equal(typeof verificationContext.buildVerificationConsumerGraphFacts,'function');
 const source={repo:'perfectuser21/cecelia',base_revision:'a'.repeat(40),head_revision:'b'.repeat(40),changed_files:[{path:'docs/current/README.md'}]};
 const edges=[{src_path:'src/business.js',dst_path:'docs/current/README.md',edge_type:'import',detail:null}],graphSnapshot={repo:source.repo,source_revision:source.base_revision,row_count:1};
 const proof=verificationContext.buildVerificationConsumerGraphFacts({source,side:'base',graphSnapshot,edges,paths:['docs/current/README.md']});
 assert.deepEqual(proof.rows[0].reverse_paths,['docs/current/README.md','src/business.js']);assert.equal(proof.rows[0].truncated,false);
 for(const change of[o=>{o.side='head';},o=>{o.graphSnapshot.row_count=2;},o=>{o.graphSnapshot.repo='foreign/repo';}]){
  const options={source,side:'base',graphSnapshot:structuredClone(graphSnapshot),edges,paths:['docs/current/README.md']};change(options);assert.throws(()=>verificationContext.buildVerificationConsumerGraphFacts(options),/VERIFICATION_CONTEXT/);
 }
});
test('文档仅以独立非执行合同解除file gap，原生业务owner和coverage不被改写',async t=>{
 const path='docs/current/README.md',f=basicEntryFixture(t,path),input=derived(f),raw=aggregateNativeOwnerFixture(f.source);
 assert.ok(input.metadata_candidates?.some(r=>r.input_facts.path===path&&r.kind==='documentation_change'));
 assert.equal(input.rows.some(r=>r.input_facts.path===path),false);
 const graphs={scopes:raw.map(report=>{const registryRepo=report.scope_key+'-source';report.registry_repo=registryRepo;const value={scope_key:report.scope_key,registry_repo:registryRepo};
  for(const side of['base','head']){value[side]=verificationContext.buildVerificationConsumerGraphFacts({source:f.source,side,registryRepo,graphSnapshot:{repo:registryRepo,source_revision:f.source[side+'_revision'],row_count:0},edges:[],paths:[path]});
   report[side].graph_snapshot.digest=value[side].graph_snapshot_digest;report[side].graph_snapshot.row_count=0;report.verification_owner_coverage[side]=[];}return value;})};
 const context=buildContext(f,input,raw,{raw_consumer_graph_facts:graphs});assert.equal(context.joint_files[0].resolution_kind,'documentation_change');
 const multi=await import('../implementation-multi-scope.mjs'),proof=multi.resolveScopedImplementationReports({source:f.source,expectedScopes:['cecelia-kr','cecelia-factory'],reports:raw,verification_input_context:context}).evidence;
 assert.equal(proof.file_coverage[0].claims[0].scope_key,null);assert.equal(proof.file_coverage[0].claims[0].non_executable,true);assert.equal(context.authorized_inputs.length,0);
 await assert.rejects(multi.runScopedImplementationGate({repoRoot:f.root,evidence:proof}),/SCRATCH_REQUIRED/);
 const altered=structuredClone(graphs);altered.scopes[0].base.rows[0].reverse_paths.push('src/business.js');
 assert.throws(()=>buildContext(f,input,raw,{raw_consumer_graph_facts:altered}),/VERIFICATION_CONTEXT/);
});

test('raw graph按真实scope registry别名读回，不把同SHA三张不同原生图混成canonical repo',()=>{
 const source={repo:'perfectuser21/cecelia',base_revision:'a'.repeat(40),head_revision:'b'.repeat(40),changed_files:[{path:'docs/current/README.md'}]};
 const registryRepo='cecelia-factory-source',proof=verificationContext.buildVerificationConsumerGraphFacts({source,side:'base',registryRepo,graphSnapshot:{repo:registryRepo,source_revision:source.base_revision,row_count:0},edges:[],paths:['docs/current/README.md']});
 assert.equal(proof.registry_repo,registryRepo);assert.equal(proof.repo,source.repo);
});

test('非执行metadata不得用head清白覆盖base业务consumer，反向或任一scope未知reader同样拒绝',t=>{
 const path='docs/current/README.md',f=basicEntryFixture(t,path),input=derived(f);
 for(const sideWithReader of['base','head'])for(const nativeClaim of[true,false]){
  const raw=aggregateNativeOwnerFixture(f.source),graphs={scopes:raw.map((report,index)=>{const registryRepo=report.scope_key+'-source';report.registry_repo=registryRepo;const scope={scope_key:report.scope_key,registry_repo:registryRepo};
   for(const side of['base','head']){const edges=side===sideWithReader&&index===0?[{src_path:nativeClaim?'src/business.js':'scripts/unknown-reader.mjs',dst_path:path,edge_type:'import',detail:null}]:[];
    scope[side]=verificationContext.buildVerificationConsumerGraphFacts({source:f.source,side,registryRepo,graphSnapshot:{repo:registryRepo,source_revision:f.source[side+'_revision'],row_count:edges.length},edges,paths:[path]});
    report[side].graph_snapshot.digest=scope[side].graph_snapshot_digest;report[side].graph_snapshot.row_count=edges.length;report.verification_owner_coverage[side]=[];
    if(edges.length&&nativeClaim)report[side].file_coverage[0].matched_paths=['src/business.js'];}return scope;})};
  const context=buildContext(f,input,raw,{raw_consumer_graph_facts:graphs});assert.equal(context.joint_files.some(r=>r.path===path),false,sideWithReader+' '+nativeClaim);
 }
});

for(const [level,config]of[['test',configuration("{include:['**/*.test.ts'],typecheck:{enabled:true,only:true}}")],['root',"import{defineConfig}from'vitest/config';export default defineConfig({typecheck:{enabled:true,only:true},test:{include:['**/*.test.ts']}});"],['project',configuration("{projects:[{typecheck:{enabled:true,only:true},test:{name:'only',include:['**/*.test.ts']}}]}")],['project.test',configuration("{projects:[{test:{name:'only',include:['**/*.test.ts'],typecheck:{enabled:true,only:true}}}]}")]])
 test(`typecheck选择改变普通测试集合时有限解释器拒绝 ${level}`,()=>assert.throws(()=>selected('apps/api/ordinary.test.ts',config),/VERIFICATION_SELECTOR/));

test('head原生owner不能借base revision或foreign repo/registry carrier伪装，同side源字段缺失也拒绝',t=>{
 const f=currentEntryFixture(t),input=derived(f);
 for(const edit of[e=>{e.revision=f.source.base_revision;},e=>{e.implementation.revision=f.source.base_revision;},e=>{e.implementation.repo='foreign/repo';},e=>{e.implementation.registry_repo='foreign-registry';},e=>{delete e.revision;},e=>{delete e.implementation.revision;}]){
  const report=nativeOwnerReport(f.source),carrier=report.affected_usages.flatMap(u=>u.evidence).find(e=>e.side==='head');edit(carrier);
  assert.throws(()=>buildContext(f,input,[report]),/VERIFICATION_CONTEXT/);
 }
});
test('原生registry身份本身缺失或非法时，不以双方undefined相等当作同源',t=>{
 const f=currentEntryFixture(t),input=derived(f);
 for(const identity of[undefined,'','../foreign','a//b','foreign\nrepo','foreign\n','-foreign']){const report=nativeOwnerReport(f.source);report.registry_repo=identity;for(const u of report.affected_usages)for(const e of u.evidence)e.implementation.registry_repo=identity;assert.throws(()=>buildContext(f,input,[report]),/VERIFICATION_CONTEXT/);}
});

test('typed输出边界拒绝裸legacy文件与report内嵌snapshot，普通报告不借此获得资格',async t=>{
 const multi=await import('../implementation-multi-pr-gate.mjs'),root=mkdtempSync(join(tmpdir(),'typed-output-contract-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 assert.equal(typeof multi.assertCiAdmissionOutputFiles,'function');mkdirSync(join(root,'cecelia-factory'));const report=join(root,'cecelia-factory/report.json');writeFileSync(report,'{}');assert.doesNotThrow(()=>multi.assertCiAdmissionOutputFiles(root));
 assertTypedResolverOutputLayout(root,multi.assertCiAdmissionOutputFiles);
 const candidate=join(root,'cecelia-factory/candidate.json');writeFileSync(candidate,'{}');assert.throws(()=>multi.assertCiAdmissionOutputFiles(root),/ADMISSION_OUTPUT/);rmSync(candidate);
 writeFileSync(report,JSON.stringify({schema_version:1,scope:'cecelia-factory',snapshot_sha256:'a'.repeat(64)}));assert.throws(()=>multi.assertCiAdmissionOutputFiles(root),/ADMISSION_OUTPUT/);
});
test('Pinned包装器的base配置缺失或提前退出时，不能只凭include表宣称实际选择输入',t=>{
 const path='packages/brain/src/__tests__/ci-defense.skill-source.test.js',f=basicEntryFixture(t,path),base='packages/brain/vitest.config.js';
 for(const code of["process.exit(0);\n",null]){if(code===null){rmSync(join(f.root,base),{force:true});f.git('update-index','--force-remove',base);}else writeFileSync(join(f.root,base),code);f.source.head_revision=f.commit();f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').map(path=>({path}));assert.equal(derived(f).rows.some(r=>r.input_facts.path===path&&r.input_facts.source.side==='head'),false);}
});

test('旧CI base元数据symlink不能借head普通blob与清白图取得非执行合同',t=>{
 const path='docs/current/README.md',f=basicEntryFixture(t,path),ci='.github/workflows/ci.yml',headCi=f.git('show',f.source.head_revision+':'+ci);
 writeFileSync(join(f.root,ci),f.git('show','68b996a5641b69e6f21705a114a4524e407fe097:'+ci));rmSync(join(f.root,path));symlinkSync('../../scripts/quickcheck.sh',join(f.root,path));f.source.base_revision=f.commit();
 rmSync(join(f.root,path));writeFileSync(join(f.root,path),'actual document\n');writeFileSync(join(f.root,ci),headCi);f.source.head_revision=f.commit();f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').map(path=>({path}));
 assert.throws(()=>derived(f),/REGULAR_BLOB|VERIFICATION_INPUT/);
});
test('非执行变更缺失侧显式冻结absence，不能给已删除head造普通blob',t=>{
 const path='docs/current/README.md',f=currentEntryFixture(t,{path,deleted:true}),proof=derived(f);
 assert.ok(proof.metadata_git_facts.some(r=>r.path===path&&r.side==='base'&&r.exists===true));assert.ok(proof.metadata_git_facts.some(r=>r.path===path&&r.side==='head'&&r.exists===false));
});
test('当前功能跑道仅为Dashboard features及选中Ops读者提供验证输入',t=>assertFunctionalConsumerInputs(t,{basicEntryFixture,derived,root:fileURLToPath(new URL('../../../',import.meta.url))}));

test('当前候选输入入口逐项读取完整封组及共享身份解析器，篡改后失去入口资格',t=>{
 const path='scripts/ci/__tests__/basic-candidate-source.test.mjs',f=basicEntryFixture(t,path);
 const live=fileURLToPath(new URL('../../../',import.meta.url));
 const module=parse(readFileSync(join(live,'scripts/ci/implementation-verification-inputs.mjs'),'utf8'),{ecmaVersion:'latest',sourceType:'module'});
 const declaration=module.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='CURRENT_BASIC_ENTRY_PROTOCOLS'));
 const protocols=declaration.declarations[0].init;
 assert.equal(protocols.type,'ArrayExpression');
 const members=protocols.elements.at(-1).properties.map(p=>p.key.value);
 assert.ok(members.includes('scripts/skill_source_ownership.py'));
 for(const member of ['.github/workflows/ci.yml',...members]){mkdirSync(join(f.root,member,'..'),{recursive:true});writeFileSync(join(f.root,member),readFileSync(join(live,member)));}
 f.git('rm','--sparse','-r','scripts/ci/check-w19-frozen.mjs','scripts/ci/__tests__/basic-w19-freeze.test.mjs','playground');
 f.source.base_revision=f.commit();writeFileSync(join(f.root,path),'export const currentCandidateSource=true;\n');f.source.head_revision=f.commit();f.source.changed_files=[{path}];
 const row=derived(f).rows.find(r=>r.input_facts.path===path&&r.input_facts.source.side==='head');
 assert.ok(row);assert.ok(row.eligible_owner_paths.includes('scripts/ci/run-basic-check.mjs'));
 assert.ok(row.witness.entry.support.some(r=>r.path==='scripts/skill_source_ownership.py'));
 assert.equal(row.input_facts.entry_verified,false);assert.equal(row.execution_status,'not_evaluated');
 for(const [member,revision] of [
  ...['scripts/ci/run-basic-check.mjs','packages/brain/vitest.config.js'].map(path=>[path,'d06de84e9f7d2d489a151e0b13b38f81651dd3fa']),
  ...['scripts/ci/prepare-ubuntu-archive.mjs','scripts/ci/__tests__/basic-ubuntu-archive.test.mjs','scripts/ci/__tests__/basic-skill-source-coverage.test.mjs'].map(path=>[path,'4d8bed7c7504f8e3e2d84b283bde735927642f8b']),
 ]){
  const candidate=readFileSync(join(f.root,member));
  const main=execFileSync('git',[...VERIFICATION_GIT_OPTIONS,'--no-replace-objects','show',revision+':'+member],{cwd:f.root});
  writeFileSync(join(f.root,member),main);f.source.head_revision=f.commit();
  f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').filter(Boolean).map(path=>({path}));
  const mixed=derived(f);assert.equal(mixed.rows.some(r=>r.input_facts.path===path&&r.input_facts.source.side==='head'),false);
  assert.ok(mixed.unproven.some(r=>r.path===path&&r.reason==='entry_unproven'));
  writeFileSync(join(f.root,member),candidate);f.source.head_revision=f.commit();
 }
 writeFileSync(join(f.root,'scripts/skill_source_ownership.py'),readFileSync(join(f.root,'scripts/skill_source_ownership.py'),'utf8')+'\n# unknown source\n');
 f.source.head_revision=f.commit();f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').filter(Boolean).map(path=>({path}));
 const rejected=derived(f);assert.equal(rejected.rows.some(r=>r.input_facts.path===path&&r.input_facts.source.side==='head'),false);
 assert.ok(rejected.unproven.some(r=>r.path===path&&r.reason==='entry_unproven'));
 f.git('rm','--sparse','scripts/skill_source_ownership.py');f.source.head_revision=f.commit();
 f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').filter(Boolean).map(path=>({path}));
 const missing=derived(f);assert.equal(missing.rows.some(r=>r.input_facts.path===path&&r.input_facts.source.side==='head'),false);
 assert.ok(missing.unproven.some(r=>r.path===path&&r.reason==='entry_unproven'));
});

test('退役publisher不再授予publishing资格；历史读取仍要求已完成真实run',async t=>{
 const {authorityFixture}=await import('./fixtures/ci-admission-authority.mjs');
 const {verifyCiAdmissionAuthority,ciAuthorityProof}=await import('../ci-admission-authority.mjs');
 const f=authorityFixture(t);
 assert.equal(ciAuthorityProof(await f.run()).publisher.run_id,22);
 await assert.rejects(verifyCiAdmissionAuthority({...f.options,publisher:{...f.options.publisher,phase:'publishing'}},{api:f.api}),/CI_ADMISSION_PUBLISHER_INPUT/);
 const run=f.data.get('repos/perfectuser21/cecelia/actions/runs/22');run.status='in_progress';run.conclusion=null;
 await assert.rejects(f.run(),/CI_ADMISSION_RUN_INVALID/);
});
