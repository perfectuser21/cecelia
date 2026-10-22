import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {publishMainSnapshots,validatePublishedSnapshot} from '../implementation-main-snapshot.mjs';
import {infraSnapshot,repo,scope} from './fixtures/infra-snapshot.mjs';
const base='b'.repeat(40),head='a'.repeat(40);
test('infra历史来源只消费独立同SHA可信main产物，不混用KR bundle',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'infra-artifact-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 validatePublishedSnapshot(infraSnapshot(base),{scope,repo,revision:base,complete:true});
 const bin=join(dir,'bin');mkdirSync(bin);writeFileSync(join(dir,'head.json'),JSON.stringify(infraSnapshot(base)));
 execFileSync('zip',['-q',join(dir,'artifact.zip'),'head.json'],{cwd:dir});
 const name=`implementation-infra-snapshot-${base}`;
 writeFileSync(join(bin,'gh'),`#!/usr/bin/env node
const fs=require('fs'),p=process.argv[3];
const item={id:5,name:'${name}',expired:false,created_at:'2026-10-22T00:00:00Z',workflow_run:{id:8,head_branch:'main',head_sha:'${base}',repository_id:1,head_repository_id:1}};
if(p.includes('artifacts?'))console.log(JSON.stringify({total_count:p.includes('name=${name}')?1:0,artifacts:p.includes('name=${name}')?[item]:[]}));
else if(p.endsWith('/artifacts/5'))console.log(JSON.stringify(item));
else if(p.endsWith('/runs/8'))console.log(JSON.stringify({id:8,head_sha:'${base}',head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/implementation-impact.yml',repository:{full_name:'${repo}'},head_repository:{full_name:'${repo}'}}));
else if(p.includes('/jobs?'))console.log(JSON.stringify({total_count:1,jobs:[{name:'snapshot-infra',status:'completed',conclusion:'success'}]}));
else if(p.endsWith('/zip'))process.stdout.write(fs.readFileSync('${dir}/artifact.zip'));
else process.exit(8);
`,{mode:0o700});
 const old=process.env.PATH;process.env.PATH=bin+':'+old;t.after(()=>{process.env.PATH=old;});
 await publishMainSnapshots({brainUrl:'https://brain.invalid',token:'fixture',scope,repo,base,head,output:join(dir,'output')},{readMain:()=>head,fetchFn:async url=>new Response(JSON.stringify(infraSnapshot(new URL(url).searchParams.get('revision'),{unknown:new URL(url).searchParams.get('revision')===base}))) });
 const result=JSON.parse(readFileSync(join(dir,'output/base.json')));assert.equal(result.snapshot.scope,scope);assert.equal(result.snapshot.revision,base);assert.equal(result.snapshot.execution_status,'unknown');
});
