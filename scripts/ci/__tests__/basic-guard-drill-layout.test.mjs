import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const docker=readFileSync(join(root,'packages/brain/Dockerfile'),'utf8');
for(const mode of ['real','missing','throwing','wrong-guard','incomplete']){
 test(`standalone guard演习 ${mode}`,t=>{
  const home=mkdtempSync(join(tmpdir(),'guard-standalone-')),app=join(home,'app');
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const write=(path,body)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);};
  write(join(app,'package.json'),'{"type":"module"}');
  write(join(app,'src/guard-drill.js'),readFileSync(join(root,'packages/brain/src/guard-drill.js')));
  write(join(app,'src/db.js'),`export const state=new Map();export default {query:async(sql,params)=>{if(sql.includes('SELECT value_json'))return {rows:[{value_json:state.get(params[0])}]};if(sql.includes('INSERT INTO working_memory'))state.set(params[0],JSON.parse(params[1]));return {rows:[]};}};`);
  write(join(app,'src/alerting.js'),'export async function raise(){}');
  write(join(app,'src/notifier.js'),'export async function sendBark(){}');
  for(const path of ['scripts/test-pyramid-guard.mjs','scripts/lib/test-contract-paths.cjs','scripts/extract-contract-e2e.cjs']){
   if(!docker.split('\n').some(line=>line.startsWith(`COPY ${path} `)))continue;
   mkdirSync(dirname(join(app,path)),{recursive:true});copyFileSync(join(root,path),join(app,path));
  }
  const guard=join(app,'scripts/test-pyramid-guard.mjs');
  if(mode==='missing')rmSync(guard,{force:true});
  if(mode==='throwing')write(guard,"throw Error('guard unavailable');");
  if(mode==='wrong-guard')write(guard,"export const runGuard=()=>({pass:false,unregistered_orphans:{total:1},failures:['A3 永久池棘轮']});");
  if(mode==='incomplete')write(guard,"export const runGuard=()=>({});");
  write(join(app,'runner.mjs'),`import {state} from './src/db.js';import {runGuardDrill} from './src/guard-drill.js';console.log=()=>{};console.warn=()=>{};const previous='2020-01-01T00:00:00.000Z';state.set('guard-drill-status',{'heartbeat-sentinel':{last_verified_at:new Date().toISOString()},'test-pyramid-guard':{last_verified_at:previous}});const result=await runGuardDrill({force:true});process.stdout.write(JSON.stringify({result,record:state.get('guard-drill-status')['test-pyramid-guard']}));process.exit(0);`);
  const out=JSON.parse(execFileSync(process.execPath,[join(app,'runner.mjs')],{cwd:app,encoding:'utf8',timeout:20000}));
  assert.equal(out.result.fired,mode==='real',JSON.stringify(out));
  if(mode==='real'){
   assert.match(out.result.detail,/A1.*孤儿棘轮/);
   assert.ok(out.result.verified_at);
   assert.equal(out.record.last_verified_at,out.result.verified_at);
  }else{
   assert.equal(out.result.verified_at,null);
   assert.equal(out.record.last_verified_at,'2020-01-01T00:00:00.000Z');
  }
 });
}
