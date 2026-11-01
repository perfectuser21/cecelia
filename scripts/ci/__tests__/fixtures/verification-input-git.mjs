/** 每例私有可写Git仅共享不可变68对象；不改变调用仓的refs/index。 */
import {mkdtempSync,realpathSync,writeFileSync,rmSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
let legacySeed;
export function disposeVerificationSeed(){if(legacySeed)rmSync(legacySeed,{recursive:true,force:true});}
export function immutableVerificationSeed(root){
 if(legacySeed)return legacySeed;legacySeed=realpathSync(mkdtempSync(join(tmpdir(),'derived-immutable-git-')));
 const git=(...args)=>execFileSync('git',args,{cwd:legacySeed,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','--bare','-q');const objects=execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim()+'/objects';
 writeFileSync(join(legacySeed,'objects/info/alternates'),objects+'\n');git('update-ref','refs/heads/immutable-68','68b996a5641b69e6f21705a114a4524e407fe097');git('symbolic-ref','HEAD','refs/heads/immutable-68');return legacySeed;
}
export function fixedInputFixture(t,{kind='regular'}={}){
 const root=mkdtempSync(join(tmpdir(),'derived-input-git-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('remote','add','origin','https://github.com/perfectuser21/cecelia.git');
 const path='packages/brain/src/__tests__/actual.test.js';mkdirSync(join(root,'packages/brain/src/__tests__'),{recursive:true});
 writeFileSync(join(root,'packages/brain/src/business.js'),'export const business=true;\n');
 writeFileSync(join(root,path),'export const before=true;\n');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: base');const base=git('rev-parse','HEAD');
 if(kind==='deleted')rmSync(join(root,path));else if(kind==='symlink'){rmSync(join(root,path));symlinkSync('../business.js',join(root,path));}else writeFileSync(join(root,path),'export const after=true;\n');
 git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: head');const head=git('rev-parse','HEAD');
 return{root,path,git,source:{repo:'perfectuser21/cecelia',base_revision:base,head_revision:head,changed_files:[{path}]}};
}
