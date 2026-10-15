import {afterEach, expect, it} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {reverseImplementationPaths} from '../../../src/lib/implementation-impact.js';
const sourceRoot=fileURLToPath(new URL('../../../../../',import.meta.url));
// Missing API is reported separately; the real old-tool scratch failure is recorded before implementation.
const {collectWorkspaceTestEdges}=await import('../../../../../scripts/ci/workspace-test-source.mjs').catch(()=>({}));
const CI='.github/workflows/ci.yml',PKG='apps/api/package.json',CONFIG='apps/api/vitest.config.ts',SETUP='apps/api/test/setup.ts';
const PREFIX='apps/api/features/planning/pages/capability-system/';
const names=['BusinessInputs','CapabilitySystem','InvocationPanel'];
const paths=['apps/api/tsconfig.json','apps/api/features/tsconfig.json',CI,'package.json','package-lock.json','apps/api/package-lock.json',PKG,CONFIG,SETUP,...names.flatMap(n=>[PREFIX+n+'.test.tsx',PREFIX+n+'.tsx'])];
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
 expect(JSON.stringify(s)).toBe(before);expect(edges).toHaveLength(9);
 for(const e of edges){expect(e.detail.source_revision).toBe(s.revision);expect(e.detail.proof_version).toBe('workspace-test-v1');expect(e.detail.source_sha256).toMatch(/^[a-f0-9]{64}$/);expect(e.detail.target_sha256).toMatch(/^[a-f0-9]{64}$/);}
});
it('仅读固定commit，脏工作树替换测试不改变历史证明',()=>{
 const f=fixture(),s=f.snapshot(),before=collect(f,s);f.put(PREFIX+'BusinessInputs.test.tsx','throw Error("uncommitted");');expect(collect(f,s)).toEqual(before);
});
it('生产owner正常修改仍由当前真实export绑定且hash改变，不硬锁旧owner内容',()=>{
 const f=fixture(),before=collect(f);f.change(PREFIX+'BusinessInputs.tsx','后端尚未提供业务输入合同。','等待输入合同。');f.commit();const edges=collect(f);
 expect(edges).toHaveLength(9);expect(edges.find(e=>e.dst_path===PREFIX+'BusinessInputs.tsx').detail.target_sha256).not.toBe(before.find(e=>e.dst_path===PREFIX+'BusinessInputs.tsx').detail.target_sha256);
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
it('正式版本机器人只改本地包版本元数据不改变真实Vitest消费',()=>{const f=fixture();for(const path of ['package.json','apps/api/package.json','package-lock.json','apps/api/package-lock.json']){const p=JSON.parse(readFileSync(join(f.root,path),'utf8'));p.version='9.9.9';if(p.packages){p.packages[''].version='9.9.9';if(p.packages['apps/api'])p.packages['apps/api'].version='9.9.9';}f.put(path,JSON.stringify(p));}f.commit();expect(collect(f)).toHaveLength(9);});

it.each(['apps/api/tsconfig.json','apps/api/features/tsconfig.json'])('%s不能替换JSX运行时',(path)=>{const f=fixture(),p=JSON.parse(readFileSync(join(f.root,path),'utf8'));p.compilerOptions.jsxImportSource='./nonexistent-proof-runtime';f.put(path,JSON.stringify(p));f.commit();expect(collect(f)).toEqual([]);});
it.each(['tsconfig.json','apps/tsconfig.json','apps/api/test/tsconfig.json','apps/api/features/planning/tsconfig.json','apps/api/features/planning/pages/tsconfig.json','apps/api/features/planning/pages/capability-system/tsconfig.json'])('不接受消费路径上新增更近编译配置%s',path=>{const f=fixture();mkdirSync(dirname(join(f.root,path)),{recursive:true});f.put(path,JSON.stringify({compilerOptions:{jsxImportSource:'./false-runtime'}}));f.commit();expect(collect(f)).toEqual([]);});
