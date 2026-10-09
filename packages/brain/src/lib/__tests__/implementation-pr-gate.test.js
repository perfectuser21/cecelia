import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('../../../../../scripts/ci/implementation-pr-gate.mjs',import.meta.url));
function gitFixture(){
 const dir=mkdtempSync(join(tmpdir(),'native-scoped-cli-')),repo=join(dir,'repo');mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 git('init','-q');git('remote','add','origin','https://github.com/perfectuser21/cecelia.git');
 writeFileSync(join(repo,'source.js'),'export const value=1;\n');
 const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
 const base=commit();writeFileSync(join(repo,'source.js'),'export const value=2;\n');const head=commit();
 return {dir,repo,base,head};
}
it('既有pr-gate实际Node CLI经scopes-file调用联合引擎/原生collector，缺源明确失败无PASS',()=>{
 const f=gitFixture();try{
  const scopes=join(f.dir,'scopes.json'),out=join(f.dir,'out');
  writeFileSync(scopes,JSON.stringify(['cecelia-kr','fixture-second-source'].map(scope=>({scope,snapshotBase:join(f.dir,'missing.json'),snapshotHead:join(f.dir,'missing.json')}))));
  const child=spawnSync(process.execPath,[entry,'--repo-root',f.repo,'--base',f.base,'--head',f.head,'--mode','pr','--scopes-file',scopes,'--output-dir',out],{encoding:'utf8'});
  expect(child.status).toBe(1);expect(existsSync(join(out,'gap.json')),child.stderr).toBe(true);
  const gap=JSON.parse(readFileSync(join(out,'gap.json'),'utf8'));expect(gap.stage).toBe('scoped_admission');expect(gap.code).toBe('ENOENT');
  expect(JSON.parse(readFileSync(join(out,'cecelia-kr/gap.json'),'utf8')).stage).toBe('snapshot_or_gate');
  expect(child.stdout).not.toContain('PASS');
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
it('旧single CLI完整参数保持原collector缺源错误，不被可选multi分支劫持',()=>{
 const f=gitFixture();try{
  const out=join(f.dir,'out'),missing=join(f.dir,'missing.json');
  const child=spawnSync(process.execPath,[entry,'--repo-root',f.repo,'--scope','cecelia-kr','--base',f.base,'--head',f.head,'--mode','pr','--snapshot-base',missing,'--snapshot-head',missing,'--output-dir',out],{encoding:'utf8'});
  expect(child.status).toBe(1);const gap=JSON.parse(readFileSync(join(out,'gap.json'),'utf8'));expect(gap.stage).toBe('snapshot_or_gate');expect(gap.code).toBe('ENOENT');
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
it('正式extract-scopes CLI只读验证固定源，坏schema/缺companion明确拒绝且不产伪scope文件',()=>{
 const f=gitFixture();try{
  const input=join(f.dir,'snapshot.json'),request=join(f.dir,'request.json'),out=join(f.dir,'out');
  writeFileSync(input,JSON.stringify({snapshot:{schema_version:1,scope:'cecelia-kr',repo:'perfectuser21/cecelia',revision:f.head}}));
  writeFileSync(request,JSON.stringify({schema_version:2,scopes:['cecelia-kr','cecelia-factory']}));
  const child=spawnSync(process.execPath,[entry,'--extract-scopes','--snapshot-file',input,'--scopes-file',request,'--side','base','--output-dir',out],{encoding:'utf8'});
  expect(child.status).toBe(1);expect(child.stderr).toMatch(/ADMISSION_SCOPES_INVALID/);expect(existsSync(join(out,'base-cecelia-factory.json'))).toBe(false);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
