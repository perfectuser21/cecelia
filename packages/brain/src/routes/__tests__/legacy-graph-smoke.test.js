import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
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
 writeFileSync(join(bin,'curl'),'#!/bin/bash\nargs=()\nfor arg in "$@"; do\n case "$arg" in localhost:5221/*) arg="$BRAIN_URL/\${arg#localhost:5221/}";; esac\n args+=("$arg")\ndone\nexec /usr/bin/curl -q --max-time 2 "\${args[@]}"\n',{mode:0o755});

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
  const child=spawn('bash',[smoke],{env:{...process.env,PATH:bin+':'+process.env.PATH,BRAIN_URL:`http://127.0.0.1:${server.address().port}`},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const code=await new Promise((r,j)=>{child.on('error',j);child.on('close',r);});
  return {code,stdout,stderr,requests};
 }finally{await new Promise(r=>server.close(r));rmSync(bin,{recursive:true,force:true});}
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
