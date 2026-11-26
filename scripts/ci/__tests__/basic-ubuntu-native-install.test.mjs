import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import yaml from 'js-yaml';

const root=resolve(import.meta.dirname,'../../..');
const workflow=yaml.load(readFileSync(join(root,'.github/workflows/ci.yml'),'utf8'));
const source='Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: resolute resolute-updates resolute-backports\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n';
const mirrors='http://us-west-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';

for(const fault of ['', 'update','install'])test(`真实工具安装链保留官方区域源并传播APT结果：${fault||'成功'}`,t=>{
 const dir=mkdtempSync(join(tmpdir(),'native-apt-install-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const bin=join(dir,'bin'),log=join(dir,'apt.jsonl'),sources=join(dir,'ubuntu.sources');mkdirSync(bin);
 for(const tool of ['rg','jq','zsh','xmllint'])writeFileSync(join(bin,tool),'#!/bin/sh\nexit 1\n',{mode:0o755});
 const helper=join(dir,'scripts/ci/prepare-host-tools.sh');mkdirSync(dirname(helper),{recursive:true});copyFileSync(join(root,'scripts/ci/prepare-host-tools.sh'),helper);
 writeFileSync(join(dir,'package.json'),'{"type":"module"}');writeFileSync(sources,source);
 const preload=join(dir,'runner-profile.mjs');
 writeFileSync(preload,`import fs from 'node:fs';
const read=fs.readFileSync.bind(fs),stat=fs.lstatSync.bind(fs);
Object.defineProperty(process,'platform',{value:'linux'});
fs.readFileSync=(p,...args)=>p==='/etc/os-release'?'ID=ubuntu\\nVERSION_CODENAME=resolute\\n':
 p==='/etc/apt/sources.list.d/ubuntu.sources'?read(process.env.APT_SOURCES,...args):
 p==='/etc/apt/apt-mirrors.txt'||p==='/etc/apt/apt-mirrors-security.txt'?process.env.APT_MIRRORS:read(p,...args);
fs.lstatSync=(p,...args)=>stat(p==='/etc/apt/sources.list.d/ubuntu.sources'?process.env.APT_SOURCES:p,...args);
`);
 writeFileSync(join(bin,'sudo'),`#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2);if(args[0]!=='apt-get')process.exit(90);
fs.appendFileSync(process.env.APT_LOG,JSON.stringify(args)+'\\n');
if(args[1]===process.env.APT_FAULT)process.exit(args[1]==='update'?31:32);
if(args[1]==='install')for(const tool of ['rg','jq','zsh','xmllint'])fs.writeFileSync(new URL(tool,import.meta.url),'#!/bin/sh\\nexit 0\\n',{mode:0o755});
process.exit(0);
`,{mode:0o755});
 const job=workflow.jobs.checks,install=job.steps.findIndex(s=>s.name==='Install test tools');assert.ok(install>=0);
 const context={matrix:{component:'brain-unit',shard:3},github:{event_name:'push'}};
 const steps=job.steps.slice(0,install+1).filter(s=>s.run&&(!s.if||runInNewContext(s.if,context,{timeout:100})));
 const env={...process.env,PATH:bin+':'+process.env.PATH,NODE_OPTIONS:'--import='+pathToFileURL(preload).href,
  GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',
  APT_LOG:log,APT_SOURCES:sources,APT_MIRRORS:mirrors,APT_FAULT:fault};
 let result;
 for(const step of steps){
  const node=/^node (scripts\/[A-Za-z0-9/_.-]+\.mjs)$/.exec(step.run.trim());
  if(node){const target=join(dir,node[1]);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,node[1]),target);}
  result=spawnSync('bash',['-e','-o','pipefail','-c',step.run],{cwd:dir,env,encoding:'utf8',timeout:10000});
  if(result.status!==0)break;
 }
 assert.equal(result.status,fault?(fault==='update'?31:32):0,result.stdout+result.stderr);
 const calls=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(calls[0],['apt-get','update','-qq']);
 if(fault!=='update')assert.deepEqual(calls[1],['apt-get','install','-y','--no-install-recommends','ripgrep','jq','zsh','libxml2-utils']);
 assert.equal(calls.length,fault==='update'?1:2);
 assert.equal(readFileSync(sources,'utf8'),source);
});
