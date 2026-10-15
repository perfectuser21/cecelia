import {afterEach, expect, it} from 'vitest';
import yaml from 'js-yaml';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {reverseImplementationPaths} from '../../../src/lib/implementation-impact.js';
const sourceRoot=fileURLToPath(new URL('../../../../../',import.meta.url));
// Missing API is reported separately; the real old-tool scratch failure is recorded before implementation.
const {collectWorkspaceTestEdges}=await import('../../../../../scripts/ci/workspace-test-source.mjs').catch(()=>({}));
const CI='.github/workflows/ci.yml',PKG='apps/api/package.json',CONFIG='apps/api/vitest.config.ts',SETUP='apps/api/test/setup.ts';
const PREFIX='apps/api/features/planning/pages/capability-system/';
const names=['BusinessInputs','CapabilitySystem','InvocationPanel'];
const paths=['packages/brain/package.json','packages/brain/package-lock.json','apps/api/tsconfig.json','apps/api/features/tsconfig.json',CI,'package.json','package-lock.json','apps/api/package-lock.json',PKG,CONFIG,SETUP,...names.flatMap(n=>[PREFIX+n+'.test.tsx',PREFIX+n+'.tsx'])];
const roots=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'workspace-source-'));roots.push(root);
 const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');git('remote','add','origin','https://github.com/perfectuser21/cecelia.git');
 for(const path of paths){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),readFileSync(join(sourceRoot,path)));}
 const put=(path,text)=>writeFileSync(join(root,path),text);
 const change=(path,a,b)=>{const s=readFileSync(join(root,path),'utf8');expect(s.includes(a),a).toBe(true);put(path,s.replace(a,b));};
 const commit=()=>{git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD');};
 const snapshot=()=>{const revision=git('rev-parse','HEAD');const digest=hash(execFileSync('git',['show',revision+':'+CI],{cwd:root}));return {scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,definitions:{activities:[{activity_id:'0466016e-6d9f-4325-aeb4-d8bc70424a48',payload:{definition_scope:'consumer_evidence',source_scope:'cecelia-factory',implementation_bindings:[{kind:'code',status:'verified',repo:'perfectuser21/cecelia',path:CI,revision,digest:'sha256:'+digest,content_sha256:digest}]}}]}};};
 commit();return {root,git,put,change,commit,snapshot};
}
afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
function collect(f,s=f.snapshot()){expect(collectWorkspaceTestEdges,'固定Git workspace consumer proof API').toBeTypeOf('function');return collectWorkspaceTestEdges(f.root,s);}
it('固定Git的真实workspace-test调用链让三个owner反向到原ci.yml锚，不更改冻结定义',()=>{
 const f=fixture(),s=f.snapshot(),before=JSON.stringify(s),edges=collect(f,s);
 for(const n of names)expect(reverseImplementationPaths(edges,[PREFIX+n+'.tsx'],{}).paths).toContain(CI);
 expect(JSON.stringify(s)).toBe(before);expect(edges).toHaveLength(13);
 for(const e of edges){expect(e.detail.source_revision).toBe(s.revision);expect(e.detail.proof_version).toBe('workspace-test-v1');expect(e.detail.source_sha256).toMatch(/^[a-f0-9]{64}$/);expect(e.detail.target_sha256).toMatch(/^[a-f0-9]{64}$/);}
});
it('仅读固定commit，脏工作树替换测试不改变历史证明',()=>{
 const f=fixture(),s=f.snapshot(),before=collect(f,s);f.put(PREFIX+'BusinessInputs.test.tsx','throw Error("uncommitted");');expect(collect(f,s)).toEqual(before);
});
it('生产owner正常修改仍由当前真实export绑定且hash改变，不硬锁旧owner内容',()=>{
 const f=fixture(),before=collect(f);f.change(PREFIX+'BusinessInputs.tsx','后端尚未提供业务输入合同。','等待输入合同。');f.commit();const edges=collect(f);
 expect(edges).toHaveLength(13);expect(edges.find(e=>e.dst_path===PREFIX+'BusinessInputs.tsx').detail.target_sha256).not.toBe(before.find(e=>e.dst_path===PREFIX+'BusinessInputs.tsx').detail.target_sha256);
});
it('未审格式变化也保守拒绝固定原文封套',()=>{
 const f=fixture();f.change(PREFIX+'BusinessInputs.test.tsx',"import { afterEach",'import {  afterEach');f.commit();expect(collect(f)).toEqual([]);
});
const negatives=[
 ['JSX注释会替换运行时',PREFIX+'BusinessInputs.test.tsx',"import { afterEach","/** @jsxImportSource ./nonexistent-proof-runtime */\nimport { afterEach"],
 ['未审注释保守不补边',PREFIX+'BusinessInputs.test.tsx',"import { afterEach","// unreviewed comment\nimport { afterEach"],
 ['类型组件导入没有运行时消费',PREFIX+'BusinessInputs.test.tsx','import BusinessInputs','import type BusinessInputs'],
 ['类型render导入没有运行时调用',PREFIX+'BusinessInputs.test.tsx','cleanup, render','cleanup, type render'],
 ['类型it导入不符合显式注册合同',PREFIX+'BusinessInputs.test.tsx','expect, it','expect, type it'],
 ['using注册前处置语义',PREFIX+'CapabilitySystem.test.tsx','const registry','using registry'],
 ['using目标不是原const',PREFIX+'InvocationPanel.test.tsx','const target','using target'],

 ['CI路径选择排除apps',CI,"grep -qE '^apps/'","grep -qE '^elsewhere/'"],
 ['输出接错',CI,'workspace: ${{ steps.detect.outputs.workspace }}','workspace: ${{ steps.detect.outputs.brain }}'],
 ['job不执行',CI,"  workspace-test:\n    needs: changes\n    if: needs.changes.outputs.workspace == 'true'","  workspace-test:\n    needs: changes\n    if: false"],
 ['needs缺失',CI,'needs: [secrets-scan,','needs: [secrets-scan,'],
 ['CI失败出口被吞',CI,'check "workspace-test"','echo "workspace-test"'],
 ['job容错',CI,'  workspace-test:\n','  workspace-test:\n    continue-on-error: true\n'],
 ['测试step换shell',CI,'      - name: Test apps/api\n','      - name: Test apps/api\n        shell: python\n'],
 ['测试step换目录',CI,'      - name: Test apps/api\n','      - name: Test apps/api\n        working-directory: /tmp\n'],
 ['CI全局defaults',CI,'jobs:\n','defaults:\n  run:\n    shell: python\njobs:\n'],
 ['CI测试环境注入',CI,'  CODEX_RELAY_HOME: /tmp/ci-fake-codex-home','  CODEX_RELAY_HOME: /tmp/ci-fake-codex-home\n  NODE_OPTIONS: --require /tmp/inject.cjs'],
 ['checkout外仓',CI,'      - uses: actions/checkout@v4\n','      - uses: actions/checkout@v4\n        with:\n          repository: other/repo\n'],
 ['npm test空跑',PKG,"NODE_OPTIONS='--max-old-space-size=2048' vitest run",'echo pass'],
 ['npm test筛选',PKG,'vitest run','vitest run absent.test.tsx'],
 ['npm pretest覆盖',PKG,'"test:watch":','"pretest": "echo overwritten", "test:watch":'],
 ['根install脚本覆盖','package.json','"test":','"postinstall": "echo overwrite", "test":'],
 ['config无目标include',CONFIG,'**/*.{test,spec}.{ts,tsx}','src/**/*.test.ts'],
 ['config排除目标',CONFIG,"exclude: ['node_modules'","exclude: ['**/capability-system/**', 'node_modules'"],
 ['config动态',CONFIG,'defineConfig({','defineConfig(() => ({'],
 ['setup提前throw',SETUP,"import '@testing-library/jest-dom';","import '@testing-library/jest-dom'; throw Error('stop');"],
 ['仅导入未render',PREFIX+'BusinessInputs.test.tsx','  render(','  // render('],
 ['skip测试',PREFIX+'BusinessInputs.test.tsx',"it('","it.skip('"],
 ['only测试',PREFIX+'BusinessInputs.test.tsx',"it('","it.only('"],
 ['惰性未调用render',PREFIX+'BusinessInputs.test.tsx','  render(','  const dead = () => render('],
 ['条件分支render',PREFIX+'BusinessInputs.test.tsx','  render(','  if(false) render('],
 ['提前return',PREFIX+'BusinessInputs.test.tsx','  render(','  return; render('],
 ['提前throw',PREFIX+'BusinessInputs.test.tsx','  render(',"  throw Error('stop'); render("],
 ['同名遮蔽',PREFIX+'BusinessInputs.test.tsx','  render(','  const BusinessInputs = () => null; render('],
 ['mock组件',PREFIX+'BusinessInputs.test.tsx',"afterEach(cleanup);","afterEach(cleanup); vi.mock('./BusinessInputs',()=>({default:()=>null}));"],
 ['假import',PREFIX+'BusinessInputs.test.tsx',"from './BusinessInputs'","from './Elsewhere'"],
 ['owner无真实default出口',PREFIX+'BusinessInputs.tsx','export default function BusinessInputs','function BusinessInputs'],
 ['改 describe 为 skip',PREFIX+'InvocationPanel.test.tsx',"describe('","describe.skip('"],
 ['额外only排除witness',PREFIX+'BusinessInputs.test.tsx','afterEach(cleanup);',"afterEach(cleanup); it.only('empty',()=>{});"],
];
it.each(negatives)('%s不补来源边',(_label,path,a,b)=>{
 const f=fixture();
 if(_label==='needs缺失')f.change(CI,'workspace-build, workspace-test, e2e-smoke','workspace-build, e2e-smoke');
 else f.change(path,a,b);
 f.commit();expect(collect(f)).toEqual([]);
});
it.each(['repo','scope','bindingRepo','bindingRevision','bindingDigest','activity','missingBinding'])('身份或原生binding %s不匹配时不补边',kind=>{
 const f=fixture(),s=f.snapshot(),a=s.definitions.activities[0],b=a.payload.implementation_bindings[0];
 if(kind==='repo')s.repo='perfectuser21/other';if(kind==='scope')s.scope='cecelia-kr';if(kind==='bindingRepo')b.repo='other/repo';if(kind==='bindingRevision')b.revision='a'.repeat(40);if(kind==='bindingDigest')b.digest='sha256:'+'0'.repeat(64);if(kind==='activity')a.activity_id='00000000-0000-4000-8000-000000000000';if(kind==='missingBinding')a.payload.implementation_bindings=[];
 expect(collect(f,s)).toEqual([]);
});
it('Git remote不匹配不能借自仓snapshot补边',()=>{const f=fixture();f.git('remote','set-url','origin','https://github.com/other/repo.git');expect(collect(f)).toEqual([]);});
it('symlink源码即使指向真实文本也不作固定blob证明',()=>{const f=fixture();const path=PREFIX+'BusinessInputs.test.tsx';rmSync(join(f.root,path));symlinkSync('InvocationPanel.test.tsx',join(f.root,path));f.commit();expect(collect(f)).toEqual([]);});
it('历史revision缺文件不补边，不破坏其它原生图路径',()=>{const f=fixture();rmSync(join(f.root,CONFIG));f.commit();expect(collect(f)).toEqual([]);});
it.each(['npm-shrinkwrap.json','apps/api/npm-shrinkwrap.json','.npmrc','apps/api/.npmrc','apps/api/vitest.workspace.ts','apps/api/vitest.config.js','apps/api/vite.config.ts'])('新增可影响npm/Vitest执行的%s不补边',path=>{const f=fixture();f.put(path,'export default [];\n');f.commit();expect(collect(f)).toEqual([]);});
it('其他workspace安装生命周期不能提前覆盖API测试',()=>{const f=fixture();const p='packages/evil/package.json';mkdirSync(dirname(join(f.root,p)),{recursive:true});f.put(p,JSON.stringify({name:'evil',scripts:{postinstall:'echo overwrite'}}));f.commit();expect(collect(f)).toEqual([]);});
it.each(['package.json','apps/api/package.json'])('%s不能用包解析覆盖把vitest替换成别的程序',path=>{const f=fixture();const pkg=JSON.parse(readFileSync(join(f.root,path),'utf8'));pkg.overrides={vitest:'npm:fake-vitest@1.0.0'};f.put(path,JSON.stringify(pkg));f.commit();expect(collect(f)).toEqual([]);});

it('仅函数声明没有运行时default出口不能补边',()=>{const f=fixture();f.put(PREFIX+'BusinessInputs.tsx','export default function BusinessInputs(): any;\n');f.commit();expect(collect(f)).toEqual([]);});

it.each([['package-lock.json','apps/api/node_modules/vitest'],['apps/api/package-lock.json','node_modules/vitest']])('%s不能把真实vitest锁解析替换为伪CLI',(path,key)=>{const f=fixture(),j=JSON.parse(readFileSync(join(f.root,path),'utf8'));j.packages[key].resolved='https://example.invalid/false-runner.tgz';j.packages[key].bin={vitest:'echo-pass.js'};f.put(path,JSON.stringify(j));f.commit();expect(collect(f)).toEqual([]);});
it('正式版本机器人只改本地包版本元数据不改变真实Vitest消费',()=>{const f=fixture();for(const path of ['package.json','apps/api/package.json','package-lock.json','apps/api/package-lock.json']){const p=JSON.parse(readFileSync(join(f.root,path),'utf8'));p.version='9.9.9';if(p.packages){p.packages[''].version='9.9.9';if(p.packages['apps/api'])p.packages['apps/api'].version='9.9.9';}f.put(path,JSON.stringify(p));}f.commit();expect(collect(f)).toHaveLength(13);});

it.each(['apps/api/tsconfig.json','apps/api/features/tsconfig.json'])('%s不能替换JSX运行时',(path)=>{const f=fixture(),p=JSON.parse(readFileSync(join(f.root,path),'utf8'));p.compilerOptions.jsxImportSource='./nonexistent-proof-runtime';f.put(path,JSON.stringify(p));f.commit();expect(collect(f)).toEqual([]);});
it.each(['tsconfig.json','apps/tsconfig.json','apps/api/test/tsconfig.json','apps/api/features/planning/tsconfig.json','apps/api/features/planning/pages/tsconfig.json','apps/api/features/planning/pages/capability-system/tsconfig.json'])('不接受消费路径上新增更近编译配置%s',path=>{const f=fixture();mkdirSync(dirname(join(f.root,path)),{recursive:true});f.put(path,JSON.stringify({compilerOptions:{jsxImportSource:'./false-runtime'}}));f.commit();expect(collect(f)).toEqual([]);});

function parserBoundary(f,{trusted=false,fakeCandidate=false,applicable=true,wrongVersion=false}={}){
 const root=mkdtempSync(join(tmpdir(),'workspace-parser-tooling-'));roots.push(root);
 for(const path of ['scripts/ci/workspace-test-source.mjs','scripts/ci/workspace-test-envelopes.mjs','packages/brain/src/lib/gp-assertion-command.js','packages/brain/src/lib/step-probe-spec.js']){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),readFileSync(join(sourceRoot,path)));}
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
 const req=createRequire(import.meta.url);mkdirSync(join(root,'node_modules'),{recursive:true});symlinkSync(dirname(req.resolve('js-yaml/package.json')),join(root,'node_modules/js-yaml'),'dir');
 if(trusted){mkdirSync(join(root,'packages/brain/node_modules'),{recursive:true});symlinkSync(dirname(realpathSync(req.resolve('typescript/package.json'))),join(root,'packages/brain/node_modules/typescript'),'dir');}
 if(wrongVersion){const path=join(root,'packages/brain/node_modules/typescript');mkdirSync(path,{recursive:true});writeFileSync(join(path,'package.json'),JSON.stringify({main:'index.cjs'}));writeFileSync(join(path,'index.cjs'),"module.exports={version:'0.0.0'};");}
 if(fakeCandidate){const path=join(f.root,'node_modules/typescript');mkdirSync(path,{recursive:true});writeFileSync(join(path,'package.json'),JSON.stringify({main:'index.cjs'}));writeFileSync(join(path,'index.cjs'),"throw Error('CANDIDATE_PARSER_MUST_NOT_LOAD');");}
 writeFileSync(join(root,'snapshot.json'),JSON.stringify(applicable?f.snapshot():{repo:'other/repo'}));
 writeFileSync(join(root,'probe.mjs'),"import fs from 'node:fs';import {collectWorkspaceTestEdges} from './scripts/ci/workspace-test-source.mjs';try { console.log(JSON.stringify({edges:collectWorkspaceTestEdges(process.argv[2],JSON.parse(fs.readFileSync(new URL('./snapshot.json',import.meta.url))))})); } catch(e){ console.log(JSON.stringify({code:e.code,message:e.message})); }");
 const result=spawnSync(process.execPath,[join(root,'probe.mjs'),f.root],{encoding:'utf8',env:{...process.env,NODE_PATH:''}});expect(result.stderr).toBe('');expect(result.status).toBe(0);return JSON.parse(result.stdout);
}
it('不适用消费者可导入且不安装TypeScript，不触发解析器加载',()=>{expect(parserBoundary(fixture(),{applicable:false})).toEqual({edges:[]});});
it('适用消费者缺可信解析器明确失败，不吞成空边成功',()=>{expect(parserBoundary(fixture())).toMatchObject({code:'WORKSPACE_TEST_PARSER_UNAVAILABLE'});});
it('候选仓自带解析器不能替代缺失的可信解析器',()=>{expect(parserBoundary(fixture(),{fakeCandidate:true})).toMatchObject({code:'WORKSPACE_TEST_PARSER_UNAVAILABLE'});});
it('仅可信Brain包解析器安装即证明真实消费，无需API依赖',()=>{expect(parserBoundary(fixture(),{trusted:true}).edges).toHaveLength(13);});

it('可信位置解析器版本漂移明确拒绝',()=>{expect(parserBoundary(fixture(),{wrongVersion:true})).toMatchObject({code:'WORKSPACE_TEST_PARSER_VERSION_MISMATCH'});});

const BRAIN_PACKAGE='packages/brain/package.json',BRAIN_LOCK='packages/brain/package-lock.json';
it('真实root workspace安装输入和Brain缓存键分别回溯到CI，不把缓存称为npm解析',()=>{
 const f=fixture(),s=f.snapshot(),edges=collect(f,s);
 for(const path of ['package.json','package-lock.json',BRAIN_PACKAGE]){
  const e=edges.find(e=>e.src_path===CI&&e.dst_path===path);
  expect(e?.detail.via).toBe('fixed_root_workspace_npm_ci_input');
  expect(e?.detail.target_sha256).toBe(hash(readFileSync(join(f.root,path))));
  expect(reverseImplementationPaths(edges,[path],{}).paths).toContain(CI);
 }
 const cache=edges.find(e=>e.dst_path===BRAIN_LOCK);
 expect(cache?.detail.via).toBe('fixed_runner_setup_node_cache_key');
 expect(cache?.detail.selector).toContain('cache-dependency-path');
 expect(cache?.detail.execution_claim).toContain('dependency_only');
 expect(cache?.detail.source_revision).toBe(s.revision);
});
it.each(['npm ci --workspaces=false','cd /tmp && npm ci','echo no-install'])('根安装命令变为%s不能借旧封套补边',command=>{
 const f=fixture();f.change(CI,'- name: Install root deps\n        run: npm ci','- name: Install root deps\n        run: '+command);f.commit();expect(collect(f)).toEqual([]);
});
it('根工作区不再匹配Brain时不能声称消费其manifest',()=>{
 const f=fixture(),p=JSON.parse(readFileSync(join(f.root,'package.json'),'utf8'));p.workspaces=['apps/*'];f.put('package.json',JSON.stringify(p));f.commit();expect(collect(f)).toEqual([]);
});
const cacheMutations=[
 ['路径错误',j=>{j.steps[1].with['cache-dependency-path']='elsewhere/package-lock.json';}],
 ['路径缺失',j=>{delete j.steps[1].with['cache-dependency-path'];}],
 ['缓存关闭',j=>{delete j.steps[1].with.cache;}],
 ['非可信action',j=>{j.steps[1].uses='other/setup-node@v4';}],
 ['job条件替换',j=>{j.if='false';}],
 ['job依赖缺失',j=>{delete j.needs;}],
 ['job容错',j=>{j['continue-on-error']=true;}],
 ['缓存step条件',j=>{j.steps[1].if='false';}],
 ['缓存step容错',j=>{j.steps[1]['continue-on-error']=true;}],
 ['job目录',j=>{j.defaults={run:{'working-directory':'/tmp'}};}],
 ['job环境',j=>{j.env={NODE_OPTIONS:'--require /tmp/inject.cjs'};}],
 ['失败出口被吞',j=>{j.steps[4].run=j.steps[4].run.replace('bash "$t" || exit 1','bash "$t" || true');}],
];
it.each(cacheMutations)('runner缓存封套%s只拒绝未证明的缓存边，保留已证明UI与安装消费',(_label,mutate)=>{
 const f=fixture(),ci=yaml.load(readFileSync(join(f.root,CI),'utf8'));mutate(ci.jobs['runner-tests-shell']);f.put(CI,yaml.dump(ci));f.commit();const edges=collect(f);
 expect(edges).toHaveLength(12);expect(edges.some(e=>e.dst_path===BRAIN_LOCK)).toBe(false);
 expect(reverseImplementationPaths(edges,[PREFIX+'BusinessInputs.tsx'],{}).paths).toContain(CI);
});
it('runner路径选择被替换不能借缓存job字符串补边',()=>{
 const f=fixture();f.change(CI,"grep -qE '^docker/cecelia-runner/'","grep -qE '^elsewhere/'");f.commit();expect(collect(f)).toEqual([]);
});
it.each(['missing','symlink'])('Brain缓存输入%s不能用工作树或非blob补证',kind=>{
 const f=fixture();rmSync(join(f.root,BRAIN_LOCK));if(kind==='symlink')symlinkSync('../../package-lock.json',join(f.root,BRAIN_LOCK));f.commit();const edges=collect(f);
 expect(edges).toHaveLength(12);expect(edges.some(e=>e.dst_path===BRAIN_LOCK)).toBe(false);
});
it('Brain workspace manifest不存在不伪造安装消费边',()=>{
 const f=fixture();rmSync(join(f.root,BRAIN_PACKAGE));f.commit();expect(collect(f).some(e=>e.dst_path===BRAIN_PACKAGE)).toBe(false);
});
it('普通Brain依赖内容更新仍是安装和缓存输入，内容hash绑定新Git而非锁死本PR',()=>{
 const f=fixture(),before=collect(f);
 for(const path of [BRAIN_PACKAGE,BRAIN_LOCK,'package-lock.json']){const p=JSON.parse(readFileSync(join(f.root,path),'utf8'));if(path===BRAIN_PACKAGE)p.devDependencies.typescript='5.9.4';else if(path===BRAIN_LOCK)p.packages[''].devDependencies.typescript='5.9.4';else p.packages['packages/brain'].devDependencies.typescript='5.9.4';f.put(path,JSON.stringify(p));}
 f.commit();const edges=collect(f);expect(edges).toHaveLength(13);
 for(const path of [BRAIN_PACKAGE,BRAIN_LOCK,'package-lock.json'])expect(edges.find(e=>e.dst_path===path).detail.target_sha256).not.toBe(before.find(e=>e.dst_path===path)?.detail.target_sha256);
});
