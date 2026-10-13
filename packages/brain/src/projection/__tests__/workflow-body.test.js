import { describe, it, expect, vi } from 'vitest';
import { buildWorkflowBodyBlock, syncWorkflowBodies, BODY_MARKER } from '../workflow-body.js';
const row = { id:'workflow-1', layer:'workflows', workflowObservation:{workflow:{name:'手机巡查',version:'0.1.1'},activities:[{name:'检查',sequence_no:1}],execution:'纯代码',entrypoint:'Agent启动',deployment:'未知',stats:{runs7:1,success_rate:1},recentRuns:[{run_id:'actual-run',notion_id:'page-run',status:'success'}],recentTasks:[],maintenance_owner:'主理人'}};
function backend(children=[]){
 let blocks=children.map(b=>({...b,id:b.id||'body-old'}));let writes=0,next=1;
 const request=vi.fn(async (_token,path,method,body)=>{
  if(method==='DELETE'){blocks=blocks.filter(b=>b.id!==path.split('/').pop());writes++;return {};}
  if(method==='PATCH'){const added=body.children.map(b=>({...b,id:`new-body-${next++}`}));blocks.push(...added);writes++;return {results:added};}
  const id=path.match(/\/blocks\/([^/]+)\/children/)?.[1];
  if(id==='page-workflow')return {results:blocks,has_more:false};
  const b=blocks.find(b=>b.id===id);return {results:b?.toggle?.children||[],has_more:false};
 });return {request,get writes(){return writes;},get blocks(){return blocks;}};
}
const pool={query:vi.fn(async()=>({rows:[{entity_id:row.id,external_id:'page-workflow'}]}))};
describe('Workflow真实正文',()=>{
 it('展示入口、代码和真实Run链接',()=>{
  const b=buildWorkflowBodyBlock(row.workflowObservation);expect(b.toggle.rich_text[0].text.content).toContain(BODY_MARKER);
  expect(JSON.stringify(b)).toContain('Agent启动');expect(JSON.stringify(b)).toContain('https://app.notion.com/p/pagerun');
 });
 it('保留人工正文，第二次读回后无重复写入',async()=>{
  const human={id:'human',type:'paragraph',paragraph:{rich_text:[{text:{content:'人工备注'}}]}};const b=backend([human]);
  expect(await syncWorkflowBodies(pool,{token:'t',notionReq:b.request,rows:[row]})).toMatchObject({rewritten:1,failed:0});
  expect(b.blocks[0]).toEqual(human);const writes=b.writes;
  expect(await syncWorkflowBodies(pool,{token:'t',notionReq:b.request,rows:[row]})).toMatchObject({unchanged:1});expect(b.writes).toBe(writes);
 });
 it('远端读回错误不能报告成功',async()=>{
  const b=backend();let written=false;const request=async(...args)=>{if(args[2]==='PATCH')written=true;const v=await b.request(...args);if(written&&args[1].includes('new-body'))return {results:[],has_more:false};return v;};
  expect(await syncWorkflowBodies(pool,{token:'t',notionReq:request,rows:[row]})).toMatchObject({rewritten:0,failed:1});
 });
 it('已有重复机器块会合并并核验',async()=>{
  const block=buildWorkflowBodyBlock(row.workflowObservation);const b=backend([{...block,id:'dup-1'},{...block,id:'dup-2'}]);
  expect(await syncWorkflowBodies(pool,{token:'t',notionReq:b.request,rows:[row]})).toMatchObject({rewritten:1});expect(b.blocks).toHaveLength(1);
 });
});

it('链接读回被替换也判失败',async()=>{
 const b=backend();let written=false;const request=async(...args)=>{
  if(args[2]==='PATCH')written=true;const v=await b.request(...args);
  if(written&&args[1].includes('new-body')){
   return {...v,results:JSON.parse(JSON.stringify(v.results).replaceAll('https://app.notion.com/p/pagerun','https://app.notion.com/p/wrongpage'))};
  }return v;
 };
 expect(await syncWorkflowBodies(pool,{token:'t',notionReq:request,rows:[row]})).toMatchObject({rewritten:0,failed:1});
});
it('分页循环不会误报正文成功',async()=>{
 const request=async()=>({results:[],has_more:true,next_cursor:'same'});
 expect(await syncWorkflowBodies(pool,{token:'t',notionReq:request,rows:[row]})).toMatchObject({rewritten:0,failed:1});
});
it.each(['append','readback'])('%s失败时保留旧正文且不删除任何旧块',async failure=>{
 const old={...buildWorkflowBodyBlock({...row.workflowObservation,version:'old'}),id:'old-readable'};
 const b=backend([old]);let appended=false;
 const request=async(...args)=>{
  if(args[2]==='PATCH'){if(failure==='append')throw Error('预算耗尽');appended=true;}
  const result=await b.request(...args);
  if(appended&&args[1].includes('new-body-'))return {results:[],has_more:false};
  return result;
 };
 expect(await syncWorkflowBodies(pool,{token:'t',notionReq:request,rows:[row]})).toMatchObject({rewritten:0,failed:1});
 expect(b.blocks.find(block=>block.id==='old-readable')).toEqual(old);
 expect(b.request.mock.calls.some(call=>call[2]==='DELETE')).toBe(false);
});
it('崩溃残留已有正确新区块时复用，不再追加',async()=>{
 const old={...buildWorkflowBodyBlock({...row.workflowObservation,version:'old'}),id:'old'};
 const good={...buildWorkflowBodyBlock(row.workflowObservation),id:'verified-new'};
 const b=backend([old,good]);
 expect(await syncWorkflowBodies(pool,{token:'t',notionReq:b.request,rows:[row]})).toMatchObject({rewritten:1,failed:0});
 expect(b.blocks.map(block=>block.id)).toEqual(['verified-new']);
 expect(b.request.mock.calls.some(call=>call[2]==='PATCH')).toBe(false);
});
it('分页请求及累计条目都有硬上限',async()=>{
 let pages=0;const unbounded=async()=>({results:[],has_more:true,next_cursor:`cursor-${++pages}`});
 expect(await syncWorkflowBodies(pool,{token:'t',notionReq:unbounded,rows:[row]})).toMatchObject({failed:1});expect(pages).toBe(100);
 const oversized=async()=>({results:Array(10001).fill({type:'paragraph'}),has_more:false});
 expect(await syncWorkflowBodies(pool,{token:'t',notionReq:oversized,rows:[row]})).toMatchObject({failed:1});
});

it('Notion省略纯空白片段时20条运行和任务仍保留分隔与链接',async()=>{
 const many={...row,workflowObservation:{...row.workflowObservation,
  recentRuns:Array.from({length:20},(_,i)=>({run_id:`actual-run-${i}`,notion_id:`run-page-${i}`})),
  recentTasks:Array.from({length:20},(_,i)=>({title:`actual-task-${i}`,notion_id:`task-page-${i}`}))}};
 const b=backend();
 const normalizeResponse=value=>{
  if(Array.isArray(value))return value.map(normalizeResponse);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='rich_text'
   ?item.filter(part=>String(part.text?.content??part.plain_text??'').trim()).map(normalizeResponse)
   :normalizeResponse(item)]));
 };
 const request=async(...args)=>normalizeResponse(await b.request(...args));
 expect(await syncWorkflowBodies(pool,{token:'t',notionReq:request,rows:[many]})).toMatchObject({rewritten:1,failed:0});
 const writes=b.writes;
 expect(await syncWorkflowBodies(pool,{token:'t',notionReq:request,rows:[many]})).toMatchObject({unchanged:1,failed:0});
 expect(b.writes).toBe(writes);
 const actual=normalizeResponse(b.blocks[0]);
 const linked=actual.toggle.children.flatMap(block=>block[block.type].rich_text).filter(part=>part.text?.link);
 expect(linked).toHaveLength(40);
 expect(linked.map(part=>part.text.link.url)).toEqual([
  ...Array.from({length:20},(_,i)=>`https://app.notion.com/p/runpage${i}`),
  ...Array.from({length:20},(_,i)=>`https://app.notion.com/p/taskpage${i}`)]);
 expect(linked.filter(part=>part.text.content.startsWith('\n'))).toHaveLength(38);
});
