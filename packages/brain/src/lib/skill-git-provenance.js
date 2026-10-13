import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const relative=p=>p&&p!=='.'&&!p.startsWith('/')&&!p.includes('\\')&&!/^[A-Za-z]:/.test(p)&&!p.split('/').some(x=>!x||x==='.'||x==='..');
function canonicalRepo(remote) {
  const ssh=remote.match(/^git@([a-zA-Z0-9.-]+):([^?#]+)$/);
  if(ssh)remote=`https://${ssh[1]}/${ssh[2]}`;
  let url;try{url=new URL(remote);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port)return null;
  const repo=url.pathname.replace(/\.git$/,'').replace(/\/$/,'');
  if(!relative(repo.slice(1))||repo.split('/').length<3)return null;
  return `https://${url.hostname}${repo}`;
}

// 仅本地只读；失败不输出Git stderr、remote原文或任何源文件正文。
export function auditSkillGitSource({skill_id,source_path}={}) {
  const result={...(skill_id?{skill_id}:{}),status:'unresolved'};
  const fail=reason=>({...result,reason});
  if(typeof source_path!=='string'||!path.isAbsolute(source_path)||!fs.existsSync(source_path))return fail('source_missing');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  const git=(cwd,...args)=>execFileSync('git',['--no-replace-objects','--literal-pathspecs','-C',cwd,...args],{env,timeout:10000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
  try {
    const file=fs.realpathSync(source_path);
    if(path.basename(file)!=='SKILL.md'||!fs.lstatSync(file).isFile())return fail('source_missing');
    const directory=path.dirname(file),repo=fs.realpathSync(git(directory,'rev-parse','--show-toplevel').toString().trim());
    const sourcePath=path.relative(repo,directory).split(path.sep).join('/');
    if(!relative(sourcePath))return fail('unsupported_source_path');
    const commit=git(repo,'rev-parse','HEAD').toString().trim();if(!/^[0-9a-f]{40}$/.test(commit))return fail('invalid_commit');
    let sourceRepo;try{sourceRepo=canonicalRepo(git(repo,'remote','get-url','origin').toString().trim());}catch{}
    if(!sourceRepo)return fail('repo_identity_missing');
    const tree=git(repo,'ls-tree','-rz',commit,'--',sourcePath).toString().split('\0').filter(Boolean);
    if(tree.length>500)return fail('source_limit');
    const files=tree.map(entry=>{const split=entry.indexOf('\t');return{meta:entry.slice(0,split),name:entry.slice(split+1)};});
    if(!files.some(x=>x.name===sourcePath+'/SKILL.md'))return fail('manifest_not_tracked');
    const manifest=[],changed=[];
    for(const entry of files) {
      const short=entry.name.slice(sourcePath.length+1);
      if(!entry.name.startsWith(sourcePath+'/')||!relative(short))return fail('unsupported_source_path');
      const local=path.join(repo,entry.name);
      let parent=directory;
      for(const part of short.split('/').slice(0,-1)) {
        parent=path.join(parent,part);
        if(fs.existsSync(parent)&&!fs.lstatSync(parent).isDirectory())return fail('unsupported_file_type');
      }
      if(!/^(100644|100755) blob [0-9a-f]{40}$/.test(entry.meta))return fail('unsupported_file_type');
      const content=git(repo,'cat-file','blob',entry.meta.split(' ')[2]),digest=sha(content);
      const stat=fs.existsSync(local)?fs.lstatSync(local):null;
      if(stat&&!stat.isFile())return fail('unsupported_file_type');
      if(!stat||Boolean(stat.mode&0o111)!==(entry.meta.startsWith('100755'))||sha(fs.readFileSync(local))!==digest)changed.push(short);
      manifest.push({path:short,sha256:digest});
    }
    // 未跟踪包含被ignore的文件；运行目录不能静默带入未封存执行内容。
    const extra=git(repo,'ls-files','--others','-z','--',sourcePath).toString().split('\0').filter(Boolean);
    if(changed.length||extra.length)return fail('local_drift');
    if(git(repo,'rev-parse','HEAD').toString().trim()!==commit)return fail('head_changed');
    manifest.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
    return {...result,status:'verified',source_repo:sourceRepo,source_path:sourcePath,source_commit:commit,manifest};
  }catch{return fail('git_provenance_unavailable');}
}
