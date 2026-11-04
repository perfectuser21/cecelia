import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import {spawn,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdtempSync,writeFileSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
const boundary=vi.hoisted(()=>({query:vi.fn(),release:vi.fn()}));
vi.mock('../../db.js',()=>({default:{connect:vi.fn(async()=>boundary),query:boundary.query}}));
import router from '../graph.js';
const smoke=resolve('../../scripts/smoke/e2e/relay-85806b9a.sh');
async function run(mode){
 const requests=[];
 const bin=mkdtempSync(join(tmpdir(),'graph-smoke-boundary-'));
 // The old script ignores BRAIN_URL: redirect every legacy literal URL, and refuse SQL/scans.
 writeFileSync(join(bin,'psql'),'#!/bin/sh\nexit 2\n',{mode:0o755});
 writeFileSync(join(bin,'node'),`#!/bin/bash\nif [[ "\${1:-}" == /workspace/* ]]; then exit 2; fi\nexec '${process.execPath}' "$@"\n`,{mode:0o755});
 writeFileSync(join(bin,'curl'),`#!${process.execPath}
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);let method='GET',url=null;const allowed=[];
for(let i=0;i<args.length;i++){
 const value=args[i];
 if(value==='-s'){allowed.push(value);continue;}
 if(['-X','-H','-d'].includes(value)){
  const next=args[++i];if(next===undefined)process.exit(91);
  if(value==='-X')method=next;
  allowed.push(value,next);continue;
 }
 if(url!==null)process.exit(92);url=value;
}
if(!url||!((method==='GET'&&url.startsWith('localhost:5221/api/brain/graph/locate?'))||(method==='POST'&&url==='localhost:5221/api/brain/graph/radius')))process.exit(93);
const base=new URL(process.env.BRAIN_URL);if(base.hostname!=='127.0.0.1')process.exit(94);
allowed.push(new URL(url.slice('localhost:5221'.length),base).href);
const result=spawnSync('/usr/bin/curl',['-q','--max-time','2',...allowed],{encoding:'utf8'});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??95);
`,{mode:0o755});
 for(const name of ['ssh','scp','docker','wget','nc'])writeFileSync(join(bin,name),'#!/bin/sh\nexit 96\n',{mode:0o755});
 boundary.query.mockReset();boundary.query.mockImplementation(async(sql,args)=>{
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
  if(sql.includes('FROM graph_edges'))return {rows:mode==='empty'?[]:[{src_path:`${args[0]}/a.js`,dst_path:`${args[0]}/b.js`,edge_type:'import'}]};
  if(sql.includes('FROM fact_snapshot_headers'))return {rows:[{repo:args[1],source_revision:'a'.repeat(40),scanner_version:'graph-v3',scanned_at:new Date(mode==='stale'?0:Date.now()),row_count:mode==='empty'?0:1}]};
  if(sql.includes('FROM journey_features'))return {rows:[]};
  throw Error('unexpected isolated query');
 });
 const app=express().use(express.json()).use((req,res,next)=>{
  requests.push([req.method,req.originalUrl]);
  if(mode==='http-failure')return res.status(503).json({error:'fixture'});
  if(mode==='malformed')return res.type('text').send('not json');
  if(mode==='wrong-repo'){
   const json=res.json.bind(res);res.json=data=>json({...data,freshness:{...data.freshness,repo:'different-repo'}});
  }
  next();
 }).use('/api/brain/graph',router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const env={...process.env,PATH:bin+':'+process.env.PATH,BRAIN_URL:`http://127.0.0.1:${server.address().port}`};
  // Verify interception before executing the retained real shell. Unknown destinations/methods fail closed.
  for(const [command,args] of [['curl',['https://example.invalid/']],['curl',['-X','DELETE','localhost:5221/api/brain/graph/radius']],['psql',[]],['node',['/workspace/scripts/scan/scan-graph.mjs']],['ssh',['example.invalid']]]){
   const proof=spawnSync(command,args,{env,encoding:'utf8'});expect(proof.status).not.toBe(0);
  }
  expect(requests).toEqual([]);
  const probe=spawn('curl',['-s','localhost:5221/api/brain/graph/locate?q=.&repo=cecelia'],{env,stdio:['ignore','pipe','pipe']});
  let probeError='';probe.stderr.on('data',b=>probeError+=b);probe.stdout.resume();
  expect(await new Promise(r=>probe.on('close',r)),probeError).toBe(0);
  expect(requests).toEqual([['GET','/api/brain/graph/locate?q=.&repo=cecelia']]);
  requests.length=0;boundary.query.mockClear();
  const child=spawn('bash',[smoke],{env:{...process.env,PATH:bin+':'+process.env.PATH,BRAIN_URL:`http://127.0.0.1:${server.address().port}`},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const code=await new Promise((r,j)=>{child.on('error',j);child.on('close',r);});
  return {code,stdout,stderr,requests};
 }finally{if(process.env.GRAPH_SMOKE_EVIDENCE_FILE)appendFileSync(process.env.GRAPH_SMOKE_EVIDENCE_FILE,JSON.stringify({mode,base:`http://127.0.0.1:${server.address().port}`,requests})+'\n');await new Promise(r=>server.close(r));rmSync(bin,{recursive:true,force:true});}
}
describe('真实graph路由→旧nightly smoke消费，不执行扫描写库',()=>{
 it('三仓真实API快照和radius均必达才绿',async()=>{
  const r=await run('fresh');expect(r.code,r.stderr).toBe(0);expect(r.requests).toHaveLength(6);
  expect(r.requests.filter(([method])=>method==='POST')).toHaveLength(3);
  const repos=boundary.query.mock.calls.filter(([sql])=>sql.includes('FROM graph_edges')).map(([,args])=>args[0]);
  expect([...new Set(repos)]).toEqual(['cecelia','zenithjoy-workspace','zenithjoy-skills']);
  expect(boundary.query.mock.calls.every(([sql])=>!/INSERT|UPDATE|DELETE/.test(sql))).toBe(true);
 });
 it.each(['stale','empty','http-failure','malformed','wrong-repo'])('%s必须非零，不能被nightly计PASS',async mode=>{
  const r=await run(mode);expect(r.code).not.toBe(0);expect(r.requests.length).toBeGreaterThan(0);
 });
});
