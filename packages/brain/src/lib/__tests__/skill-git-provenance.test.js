import {afterEach,beforeEach,expect,it} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {auditSkillGitSource} from '../skill-git-provenance.js';
let repo,skill;
const git=(...args)=>execFileSync('git',['-C',repo,...args],{stdio:['ignore','pipe','pipe']}).toString().trim();
const write=(name,content)=>{const p=path.join(repo,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);};
beforeEach(()=>{repo=fs.mkdtempSync(path.join(os.tmpdir(),'skill-source-'));skill=path.join(repo,'skills/publish/SKILL.md');
 git('init','-q');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');
 git('remote','add','origin','git@github.com:owner/repo.git');
 write('skills/publish/SKILL.md','publish fixture');write('skills/publish/scripts/run.sh','echo fixture');git('add','.');git('commit','-qm','fixture');});
afterEach(()=>fs.rmSync(repo,{recursive:true,force:true}));
it('真实Git固定提交与安装文件核验，仅返回路径及摘要；SSH与HTTPS归一',()=>{
 const a=auditSkillGitSource({skill_id:'fixture-id',source_path:skill});expect(a.status).toBe('verified');
 expect(a.source_commit).toBe(git('rev-parse','HEAD'));expect(a.source_repo).toBe('https://github.com/owner/repo');
 expect(a.manifest.map(x=>x.path)).toEqual(['SKILL.md','scripts/run.sh']);expect(JSON.stringify(a)).not.toContain('publish fixture');
 git('remote','set-url','origin','https://github.com/owner/repo.git');expect(auditSkillGitSource({source_path:skill}).source_repo).toBe(a.source_repo);
});
it('本地修改、删除、未跟踪及被ignore的执行文件均不能冒充固定版本',()=>{
 write('skills/publish/scripts/run.sh','changed');expect(auditSkillGitSource({source_path:skill})).toMatchObject({status:'unresolved',reason:'local_drift'});
 git('restore','.');fs.unlinkSync(path.join(repo,'skills/publish/scripts/run.sh'));expect(auditSkillGitSource({source_path:skill}).status).toBe('unresolved');
 git('restore','.');write('skills/publish/.gitignore','hidden.sh\n');git('add','.');git('commit','-qm','ignore');write('skills/publish/hidden.sh','echo extra');
 expect(auditSkillGitSource({source_path:skill})).toMatchObject({status:'unresolved',reason:'local_drift'});
});
it('缺源、目录无Git、未跟踪SKILL和缺origin均保留未核实',()=>{
 expect(auditSkillGitSource({source_path:path.join(repo,'absent/SKILL.md')})).toMatchObject({status:'unresolved',reason:'source_missing'});
 write('untracked/SKILL.md','extra');expect(auditSkillGitSource({source_path:path.join(repo,'untracked/SKILL.md')})).toMatchObject({status:'unresolved',reason:'manifest_not_tracked'});
 git('remote','remove','origin');expect(auditSkillGitSource({source_path:skill})).toMatchObject({status:'unresolved',reason:'repo_identity_missing'});
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'skill-nogit-'));try{fs.writeFileSync(path.join(outside,'SKILL.md'),'x');expect(auditSkillGitSource({source_path:path.join(outside,'SKILL.md')}).status).toBe('unresolved');}finally{fs.rmSync(outside,{recursive:true,force:true});}
});
it('remote含凭据或查询参数均拒绝且不输出，目录中的链接也拒绝',()=>{
 for(const url of ['https://fake-token@github.com/owner/repo.git','https://github.com/owner/repo.git?token=fake-token']){
 git('remote','set-url','origin',url);const result=auditSkillGitSource({source_path:skill});expect(result.status).toBe('unresolved');expect(JSON.stringify(result)).not.toContain('fake-token');}
 git('remote','set-url','origin','https://github.com/owner/repo.git');fs.symlinkSync('/tmp',path.join(repo,'skills/publish/outside'));git('add','.');git('commit','-qm','link');
 expect(auditSkillGitSource({source_path:skill})).toMatchObject({status:'unresolved',reason:'unsupported_file_type'});
});
it('清除进程继承的Git定位变量，不使用别的仓库冒充来源',()=>{
 const old=process.env.GIT_DIR;process.env.GIT_DIR='/tmp/nonexistent-fixture-git';try{expect(auditSkillGitSource({source_path:skill}).status).toBe('verified');}finally{if(old===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=old;}
});

it('本地refs/replace不能把原commit指向的文件摘要偷偷替换',()=>{
 const original=git('rev-parse','HEAD:skills/publish/SKILL.md');
 write('skills/publish/SKILL.md','replacement content');const replacement=git('hash-object','-w','skills/publish/SKILL.md');git('replace',original,replacement);
 expect(auditSkillGitSource({source_path:skill})).toMatchObject({status:'unresolved',reason:'local_drift'});
});

it('末端字节相同的外部目录链接也拒绝，执行权限漂移不能漏掉',()=>{
 const external=fs.mkdtempSync(path.join(os.tmpdir(),'skill-external-'));
 try {
   fs.writeFileSync(path.join(external,'run.sh'),'echo fixture');
   fs.rmSync(path.join(repo,'skills/publish/scripts'),{recursive:true});fs.symlinkSync(external,path.join(repo,'skills/publish/scripts'));
   expect(auditSkillGitSource({source_path:skill})).toMatchObject({status:'unresolved',reason:'unsupported_file_type'});
   fs.unlinkSync(path.join(repo,'skills/publish/scripts'));git('restore','.');fs.chmodSync(path.join(repo,'skills/publish/scripts/run.sh'),0o755);
   expect(auditSkillGitSource({source_path:skill})).toMatchObject({status:'unresolved',reason:'local_drift'});
 }finally{fs.rmSync(external,{recursive:true,force:true});}
});
it('真实Git读取期间HEAD改变时不返回verified',()=>{
 const original=git('rev-parse','HEAD');write('README.md','new head');git('add','.');git('commit','-qm','new head');const next=git('rev-parse','HEAD');git('reset','--hard',original);
 const wrapper=fs.mkdtempSync(path.join(os.tmpdir(),'skill-git-wrapper-')),oldPath=process.env.PATH;
 const real=execFileSync('which',['git']).toString().trim(),quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 try {
   fs.writeFileSync(path.join(wrapper,'git'),`#!/bin/sh\n${quote(real)} "$@"\nstatus=$?\ncase "$*" in *"cat-file blob"*) ${quote(real)} -C ${quote(repo)} update-ref HEAD ${next} ;; esac\nexit "$status"\n`,{mode:0o755});
   process.env.PATH=wrapper+path.delimiter+oldPath;
   expect(auditSkillGitSource({source_path:skill})).toMatchObject({status:'unresolved',reason:'head_changed'});
 }finally{process.env.PATH=oldPath;fs.rmSync(wrapper,{recursive:true,force:true});}
});
it('真实CLI生成600权限本地核验报告，声明远端提交未认证',()=>{
 const input=path.join(repo,'snapshot.json'),output=path.join(repo,'report.json');
 fs.writeFileSync(input,JSON.stringify({skills:[{id:'fixture-id',source_path:skill,presence:'present',status:'active'}]}));
 const cli=new URL('../../../scripts/audit-skill-git-sources.mjs',import.meta.url);
 const summary=JSON.parse(execFileSync(process.execPath,[cli.pathname,'--input',input,'--output',output]).toString());
 expect(summary).toMatchObject({total:1,states:{verified:1},production_migration_applied:false});
 expect(JSON.parse(fs.readFileSync(output))[0]).toMatchObject({verification_scope:'local_git_installation',remote_revision_verified:false});
 expect(fs.statSync(output).mode&0o777).toBe(0o600);
 const before=fs.readFileSync(input,'utf8');
 for(const [alias,link] of [['symbolic',fs.symlinkSync],['hard',fs.linkSync]]) {
   const target=path.join(repo,alias+'.json');link(input,target);
   expect(()=>execFileSync(process.execPath,[cli.pathname,'--input',input,'--output',target],{stdio:'pipe'})).toThrow();
   expect(fs.readFileSync(input,'utf8')).toBe(before);
 }
 expect(()=>execFileSync(process.execPath,[cli.pathname,'--input',input,'--output',input],{stdio:'pipe'})).toThrow();expect(fs.readFileSync(input,'utf8')).toBe(before);
});
