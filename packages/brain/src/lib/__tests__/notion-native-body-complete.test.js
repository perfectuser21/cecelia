import {expect,test} from 'vitest';
import {readPageContent} from '../notion-page-content.js';
test('执行任务的严格正文读取：分页失败不能把前半段当完整指令',async()=>{
 const request=async path=>{if(path.includes('start_cursor'))throw Error('fixture page unavailable');return {results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:'任务开头'}]}}],has_more:true,next_cursor:'more'};};
 await expect(readPageContent('page',{request,requireComplete:true})).rejects.toThrow('fixture page unavailable');
});
test('严格模式嵌套块失败同样拒绝；其他非执行消费者仍可读取已取得部分',async()=>{
 const request=async path=>{if(path.includes('/nested/'))throw Error('fixture nested unavailable');return {results:[{id:'nested',type:'toggle',has_children:true,toggle:{rich_text:[{plain_text:'执行约束在子块'}]}}],has_more:false};};
 await expect(readPageContent('page',{request,requireComplete:true})).rejects.toThrow('fixture nested unavailable');
 expect(await readPageContent('page',{request})).toBe('执行约束在子块');
});
test('严格任务正文不能把截断或未读取更深块当作完整输入',async()=>{
 const request=async()=>({results:[{id:'more',type:'toggle',has_children:true,toggle:{rich_text:[{plain_text:'完整要求'.repeat(30)}]}}],has_more:false});
 await expect(readPageContent('page',{request,requireComplete:true,maxChars:20})).rejects.toThrow();
 await expect(readPageContent('page',{request,requireComplete:true,maxDepth:0})).rejects.toThrow();
});
for(const response of [undefined,{}, {results:[],has_more:true,next_cursor:null},{results:[{type:'toggle',has_children:true,toggle:{rich_text:[]}}],has_more:false}])test('严格完整读取拒绝损坏响应和不可下钻块：'+JSON.stringify(response),async()=>{
 await expect(readPageContent('page',{request:async()=>response,requireComplete:true})).rejects.toThrow('native_agent_body_incomplete');
});
test('重复分页cursor必须明确阻塞，不能无限分页或把重复片段当完整',async()=>{
 let calls=0;const request=async()=>{if(++calls>3)throw Error('fixture excessive pagination');return {results:[],has_more:true,next_cursor:'same'};};
 await expect(readPageContent('page',{request,requireComplete:true})).rejects.toThrow('native_agent_body_incomplete');
 expect(calls).toBe(2);
});
