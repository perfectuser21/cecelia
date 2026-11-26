import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAuxiliarySourceEvidence } from '../../../../../scripts/ci/implementation-auxiliary-evidence.mjs';

const roots=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const hash=text=>createHash('sha256').update(text).digest('hex');
const rows=[
 {owner_path:'src/owner.js',path:'docs/one.md',role:'documentation'},
 {owner_path:'src/owner.js',path:'docs/two.md',role:'documentation'},
 {owner_path:'src/owner.js',path:'docs/three.md',role:'documentation'},
];
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'auxiliary-read-reuse-'));roots.push(root);
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 git('init','-q');git('config','user.email','ci@example.invalid');git('config','user.name','ci');
 git('remote','add','origin','https://github.com/example/repo.git');
 mkdirSync(join(root,'src'));mkdirSync(join(root,'docs'));
 writeFileSync(join(root,'src/owner.js'),'export const value=1;\n');
 for(const row of rows)writeFileSync(join(root,row.path),row.path+'\n');
 writeFileSync(join(root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:'example/repo',relations:rows}));
 const commit=()=>{git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD');};
 const sha=commit();
 return {root,git,commit,source:{repo:'example/repo',base_revision:sha,head_revision:sha}};
}
// 只观察并转发真实Git调用；生产模块在独立Node中加载，不复制collector实现。
function tracedCollect(f,repeat=1){
 const moduleUrl=new URL('../../../../../scripts/ci/implementation-auxiliary-evidence.mjs',import.meta.url).href;
 const code=`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
 const original=cp.execFileSync,calls=[];
 cp.execFileSync=function(file,args,options){if(file==='git')calls.push(args);return original(file,args,options);};
 syncBuiltinESMExports();
 const {collectAuxiliarySourceEvidence}=await import(${JSON.stringify(moduleUrl)});
 let evidence;for(let i=0;i<${repeat};i++)evidence=collectAuxiliarySourceEvidence(${JSON.stringify(f.root)},${JSON.stringify(f.source)});
 process.stdout.write(JSON.stringify({evidence,calls}));`;
 return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'}));
}
it('同次固定SHA的重复owner与相同base/head只读一次真实Git字节',()=>{
 const f=fixture(),{evidence,calls}=tracedCollect(f);
 const ownerShows=calls.filter(args=>args[0]==='show'&&args[1].endsWith(':src/owner.js'));
 const ownerTrees=calls.filter(args=>args[0]==='ls-tree'&&args.at(-1)==='src/owner.js');
 expect(ownerShows).toHaveLength(1);expect(ownerTrees).toHaveLength(1);
 // 五个不同路径各一次ls-tree/show，加一次origin身份读取。
 expect(calls).toHaveLength(11);
 expect(evidence.base).toEqual(evidence.head);
 expect(evidence.head.relations).toEqual([...rows].sort((a,b)=>a.path.localeCompare(b.path)).map(row=>({...row,owner_sha256:hash('export const value=1;\n'),sha256:hash(row.path+'\n')})));
});
it('同进程连续采集相同root与SHA也重新读取，缓存不逃出单次调用',()=>{
 const f=fixture(),{calls}=tracedCollect(f,2);
 expect(calls).toHaveLength(22);
 expect(calls.filter(args=>args[0]==='show'&&args[1].endsWith(':src/owner.js'))).toHaveLength(2);
});
it('不同完整SHA的base/head分别固定读取并保留不同owner摘要',()=>{
 const f=fixture();writeFileSync(join(f.root,'src/owner.js'),'export const value=2;\n');f.source.head_revision=f.commit();
 const {evidence,calls}=tracedCollect(f);
 expect(calls.filter(args=>args[0]==='show'&&args[1].endsWith(':src/owner.js')).map(args=>args[1])).toEqual([
  `${f.source.base_revision}:src/owner.js`,`${f.source.head_revision}:src/owner.js`,
 ]);
 expect(evidence.base.relations[0].owner_sha256).toBe(hash('export const value=1;\n'));
 expect(evidence.head.relations[0].owner_sha256).toBe(hash('export const value=2;\n'));
 expect(calls).toHaveLength(21);
});
it('跨次调用重读固定仓库，后续提交与工作区修改不会污染旧SHA',()=>{
 const f=fixture(),before=collectAuxiliarySourceEvidence(f.root,f.source);
 writeFileSync(join(f.root,'src/owner.js'),'export const value=2;\n');f.source.head_revision=f.commit();
 const after=collectAuxiliarySourceEvidence(f.root,f.source);
 expect(after.base).toEqual(before.base);
 expect(after.head.relations[0].owner_sha256).toBe(hash('export const value=2;\n'));
 writeFileSync(join(f.root,'src/owner.js'),'uncommitted bytes');
 expect(collectAuxiliarySourceEvidence(f.root,f.source)).toEqual(after);
 // 即使同SHA已被读过，下一次也必须重新检查真实仓库身份。
 f.git('remote','set-url','origin','https://github.com/other/repo.git');
 expect(()=>collectAuxiliarySourceEvidence(f.root,f.source)).toThrow('AUXILIARY_REPO_MISMATCH');
});
it('相同SHA不能把另一个仓库的缺失对象变成成功证据',()=>{
 const f=fixture();collectAuxiliarySourceEvidence(f.root,f.source);
 const other=fixture();
 // 保持相同origin，但移除第二个仓库的对象；失败不能由上次调用缓存补齐。
 rmSync(join(other.root,'.git/objects'),{recursive:true});mkdirSync(join(other.root,'.git/objects'));
 expect(()=>collectAuxiliarySourceEvidence(other.root,f.source)).toThrow();
});
it.each(['owner','auxiliary'])('已读过合法文件后，后续%s软链接提交仍严格拒绝',kind=>{
 const f=fixture();collectAuxiliarySourceEvidence(f.root,f.source);
 const name=kind==='owner'?'src/owner.js':'docs/two.md';
 rmSync(join(f.root,name));symlinkSync(kind==='owner'?'../docs/one.md':'../src/owner.js',join(f.root,name));
 f.source.head_revision=f.commit();
 expect(()=>collectAuxiliarySourceEvidence(f.root,f.source)).toThrow('AUXILIARY_SOURCE_NOT_REGULAR_FILE');
});
it('合法可执行mode仍保留字节摘要，缺失与Git失败每次都传播',()=>{
 const f=fixture();f.git('update-index','--chmod=+x','src/owner.js');f.git('commit','-qm','executable owner');
 f.source.head_revision=f.git('rev-parse','HEAD');
 expect(collectAuxiliarySourceEvidence(f.root,f.source).head.relations[0].owner_sha256).toBe(hash('export const value=1;\n'));
 rmSync(join(f.root,'docs/two.md'));f.source.head_revision=f.commit();
 for(let attempt=0;attempt<2;attempt++)expect(()=>collectAuxiliarySourceEvidence(f.root,f.source)).toThrow('AUXILIARY_SOURCE_MISSING');
 expect(()=>collectAuxiliarySourceEvidence(f.root,{...f.source,head_revision:'HEAD'})).toThrow('AUXILIARY_SOURCE_INVALID');
});
