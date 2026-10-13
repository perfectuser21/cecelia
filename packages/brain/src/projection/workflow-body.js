/** Workflow 只读观测正文：只维护自己的折叠块，每次远端读回后才报告成功。 */
export const BODY_MARKER = '🤖 流程运行（机器维护';
const TITLE = `${BODY_MARKER}：改事实请改 Brain）`;
const textOf = parts => (parts || []).map(p => p.text?.content ?? p.plain_text ?? '').join('');
const rich = text => (String(text ?? '未知').match(/[\s\S]{1,1900}/g) || ['']).map(content => ({ type:'text',text:{content} }));
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])) : value;
const display = value => typeof value === 'string' ? value : value == null ? '未知' : JSON.stringify(stable(value),null,2);
const paragraph = parts => ({object:'block',type:'paragraph',paragraph:{rich_text:parts}});
const section = (title,value) => [ {object:'block',type:'heading_3',heading_3:{rich_text:rich(title)}},paragraph(rich(display(value))) ];
function recordParts(items) {
 if (!items?.length) return rich('暂无记录');
 return items.flatMap((item,index)=>{
  const id=item.notion_id || item.page_id || item.pageId;
  const url=item.url || (id ? `https://app.notion.com/p/${id.replaceAll('-','')}` : null);
  const label=item.title || item.name || item.run_id || item.id || '真实记录';
  // Notion 会省略纯换行 rich_text；分隔符必须与非空标题处于同一片段。
  return [{type:'text',text:{content:`${index ? '\n' : ''}${String(label).slice(0,1899)}`,...(url ? {link:{url}} : {})}},
   ...rich(`\n${display(item)}`)];
 });
}
export function buildWorkflowBodyBlock(observation={}) {
 const o=observation;
 const children=[...section('Activity 顺序',o.activities),...section('执行层',o.execution),...section('启动入口',o.entrypoint),
  ...section('流程版本',o.version ?? o.workflow?.version),...section('当前部署代码与来源',o.deployment),
  ...section('七天统计与口径',o.stats),...section('维护负责人',o.maintenance_owner ?? o.workflow?.maintenance_owner ?? '未知'),
  {object:'block',type:'heading_3',heading_3:{rich_text:rich('近期真实运行')}},paragraph(recordParts(o.recentRuns)),
  {object:'block',type:'heading_3',heading_3:{rich_text:rich('近期任务（含排队与等待）')}},paragraph(recordParts(o.recentTasks))];
 return {object:'block',type:'toggle',toggle:{rich_text:rich(TITLE),children}};
}
function normalized(block) {
 const type=block.type,body=block[type]||{};
 return {type,rich_text:(body.rich_text||[]).map(p=>({text:p.text?.content ?? p.plain_text ?? '',link:p.text?.link?.url ?? null})),
  children:(body.children||[]).map(normalized)};
}
async function list(token,id,request) {
 const all=[],seen=new Set();let cursor=null,count=0;
 do {
  if(++count>100)throw Error('Workflow正文分页超过上限');
  const response=await request(token,`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`,'GET');
  if(!Array.isArray(response.results)||typeof response.has_more!=='boolean')throw Error('Workflow正文分页响应无效');
  all.push(...response.results);
  if(all.length>10000)throw Error('Workflow正文条目超过上限');
  if(!response.has_more)break;
  if(typeof response.next_cursor!=='string'||!response.next_cursor||seen.has(response.next_cursor))throw Error('Workflow正文分页循环');
  cursor=response.next_cursor;seen.add(cursor);
 }while(cursor);
 return all;
}
async function machineBlocks(token,pageId,request) {
 const children=await list(token,pageId,request);
 const found=children.filter(b=>b.type==='toggle'&&textOf(b.toggle.rich_text).startsWith(BODY_MARKER));
 const loaded=[];
 for(const b of found){if(!b.id)throw Error('Workflow机器区块无身份');loaded.push({...b,toggle:{...b.toggle,children:await list(token,b.id,request)}});}
 return loaded;
}
export async function syncWorkflowBodies(pool,{token,notionReq,rows=[],limit=8}={}) {
 if(!token)return null;
 const links=(await pool.query("SELECT entity_id,external_id FROM projection_links WHERE target='notion-directory' AND entity_type='workflows'")).rows;
 const pages=new Map(links.map(l=>[l.entity_id,l.external_id]));
 const stat={rewritten:0,unchanged:0,failed:0,errors:[]};let count=0;
 for(const row of rows.filter(r=>r.layer==='workflows'&&r.workflowObservation)){
  if(count++>=limit)break;
  try {
   const pageId=pages.get(row.id)||row.pageId;if(!pageId)throw Error('Workflow正文缺少目录页身份');
   const expected=buildWorkflowBodyBlock(row.workflowObservation),want=JSON.stringify(normalized(expected));
   const existing=await machineBlocks(token,pageId,notionReq);
   if(existing.length===1&&JSON.stringify(normalized(existing[0]))===want){stat.unchanged++;continue;}
   // 先追加并核验，再删旧版本；中断时旧正文仍可读。残留正确新区块直接复用。
   let keeper=existing.find(b=>JSON.stringify(normalized(b))===want);
   if(!keeper){
    const appended=await notionReq(token,`/blocks/${pageId}/children`,'PATCH',{children:[expected]});
    const created=(appended?.results||[]).filter(b=>b.type==='toggle'&&textOf(b.toggle?.rich_text).startsWith(BODY_MARKER));
    if(created.length!==1||!created[0].id||existing.some(b=>b.id===created[0].id))throw Error('Workflow正文追加身份不一致');
    const verified=await machineBlocks(token,pageId,notionReq);
    keeper=verified.find(b=>b.id===created[0].id);
    if(!keeper||JSON.stringify(normalized(keeper))!==want)throw Error('Workflow新正文读回不一致');
   }
   // 不移动人工正文，只清本模块其它机器块。
   for(const b of existing)if(b.id!==keeper.id)await notionReq(token,`/blocks/${b.id}`,'DELETE');
   const readback=await machineBlocks(token,pageId,notionReq);
   if(readback.length!==1||JSON.stringify(normalized(readback[0]))!==want)throw Error('Workflow正文读回不一致');
   stat.rewritten++;
  }catch(error){stat.failed++;stat.errors.push({id:row.id,error:error.message});}
 }
 return stat;
}
