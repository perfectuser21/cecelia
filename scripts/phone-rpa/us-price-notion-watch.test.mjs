import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRequest, watchOnce } from './us-price-notion-watch.mjs';
import { buildCompletion, failurePatch } from './us-price-keyword-core.mjs';
const description='【执行参数】\n执行Agent：us-price-compare\n模型：openai/gpt-6-sol\n【执行参数结束】\n关键词：DEWALT drill kit\n数量：1\n邮编：53132';
const task={id:'existing-id',status:'queued',task_type:'qiumi_task',description,payload:{source:'notion_gtd'}};
test('只接受现有Notion回灌且明确Agent，拒绝人类lane/其它Agent/未明确参数',()=>{
 assert.equal(selectRequest(task).keyword,'DEWALT drill kit');
 for(const patch of [{lane:'员工'},{payload:{...task.payload,lane:'我'}},{description:description.replace('us-price-compare','skill-factory')},{description:'关键词：drill'},{status:'in_progress'},{payload:{source:'other'}},{claimed_by:'other'},{payload:{...task.payload,notion_props:{qiumi_human_hold:true}}}]) assert.equal(selectRequest({...task,...patch}),null);
});
test('数量与ZIP明确校验，缺省3和53132；正文fallback',()=>{
 assert.equal(selectRequest({...task,description:description.replace('数量：1\n','')}).count,3);
 assert.equal(selectRequest({...task,description:description.replace('53132','00501')}),null);
 assert.equal(selectRequest({...task,description:'',payload:{...task.payload,qiumi_source:{body:description}}}).count,1);
});
test('watcher只GET原任务并调用同task-id；claim409不派发/不创建/不重试',async()=>{
 const calls=[];
 const output=await watchOnce({request:async(path,method)=>{calls.push([path,method]);return [task];},run:async(args)=>{calls.push(args);throw new Error('HTTP 409 /claim');}});
 assert.equal(output.outcome,'claim_conflict');assert.equal(calls.length,2);
 assert.equal(calls[0][1],'GET');assert.ok(calls[1].includes('existing-id'));
});
test('summary回流原任务时含库链接/任务ID/报价数量；失败error_message可见',()=>{
 const result={matched_sku_count:1,claimed_result:'passed',quotes:[],run_id:'r'};
 const c=buildCompletion(result,{keyword:'drill',count:1},[{id:'p'}],'/cache/existing-id','existing-id');
 assert.ok(c.summary.includes('existing-id'));assert.ok(c.summary.includes('7452049ef7de4da5822d4ff682869172'));assert.ok(c.summary.includes('1'));
 assert.equal(failurePatch({},'证据审计失败','/cache',[]).error_message,'证据审计失败');
});
