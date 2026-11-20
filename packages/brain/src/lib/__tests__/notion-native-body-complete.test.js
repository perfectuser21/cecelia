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
