import {test,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runActivityContract} from '../activity-runtime.js';
import {validateActivity} from '../workflow-validator.js';
import {judgeActivityCheck} from '../activity-judgment.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const activity=(key,order)=>({key,order,budget:{max_duration_s:3,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:['review']}},runtime:{protocol:'json-stdio-v1',phase:'source',entry:'work.mjs',argv:[key]}});

test.each([[{mode:'hard',pass:true,name:'format_only'}],[{mode:'checkpoint',pass:false,name:'observation_only'}]])('独立质量否决不能被附属检查覆盖并推进下一业务动作 %j',async check=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'independent-quality-'));
 try{
  const work=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);fs.appendFileSync('effects',process.argv[2]+'\\n');console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{answer:7},metrics:{},evidence:[{path:'effects'}]}));`;
  const validator=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify({verdict:'fail',acceptance_ref:x.acceptance.ref,evidence:[{observed:7,required:42}],checks:${JSON.stringify([check])}}));`;
  fs.writeFileSync(path.join(cwd,'work.mjs'),work);fs.writeFileSync(path.join(cwd,'check.mjs'),validator);
  const profile={cwd,files:{'work.mjs':hash(work),'check.mjs':hash(validator)},metadata:{work:{questions:{A4:{ref:'quality@1'}}}},validators:{work:{entry:'check.mjs',acceptance:{ref:'quality@1'}}}};
  const independent=[];
  const receipt=await runActivityContract({workflow:'quality',activities:[activity('work',1),activity('later',2)]},{run_tag:'quality'},{cwd,checkActivity:async(a,result,options)=>{
   if(options.phase==='start')return {verdict:'pass'};
   const verdict=await validateActivity(profile,a,result,options);independent.push(verdict.verdict);return verdict;
  }});
  expect(independent).toEqual(['fail']);
  expect(receipt.status).toBe('needs_review');
  expect(receipt.activities[0].validator_verdict).toMatchObject({verdict:'fail',acceptance_ref:'quality@1',evidence:[{observed:7,required:42}]});
  expect(fs.readFileSync(path.join(cwd,'effects'),'utf8').trim().split('\n')).toEqual(['work']);
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});

test.each([{verdict:'unknown',checks:[]},{verdict:'unknown',checks:[{mode:'hard',pass:true}]},{verdict:'unsupported',checks:[{mode:'hard',pass:true}]}])('独立未知或非法判词不能由检查数组升级为pass %j',value=>{
 expect(judgeActivityCheck(value).verdict).toBe('unknown');
});

test('仅checkpoint且未声明独立质量判词仍按只记录策略放行',()=>{
 const result=judgeActivityCheck({checks:[{mode:'checkpoint',pass:false}]});
 expect(result.verdict).toBe('pass');expect(result.checks).toEqual([{mode:'checkpoint',pass:false}]);
});

test.each([{verdict:'pass',checks:[{mode:'hard',pass:false}],expected:'fail'},{verdict:'pass',checks:[{mode:'hard',pass:null}],expected:'unknown'},{verdict:'fail',checks:[{mode:'hard',pass:null}],expected:'fail'}])('独立质量判词与hard检查取严格合取 %j',({expected,...value})=>{
 expect(judgeActivityCheck(value).verdict).toBe(expected);
});
