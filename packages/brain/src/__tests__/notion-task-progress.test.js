// 真实07ab发布交接（只含可投影事实与证据）。
const handoff={
  "schema_version": 1,
  "task_id": "07ab0f99-f210-4a4a-9e17-195c78c297b2",
  "project_id": "67bd1fc3-3027-4f13-83c8-c656e3408bfc",
  "title": "ZenithJoy首批发布准入、隔离候选与回退门禁修复",
  "verdict": "PASS",
  "actor": "codex",
  "scope": "首批F01-F05/F08发布链；不代表真实获客采集业务通过或全部86个workflow债务清完",
  "done": [
    "ZenithJoy PR2231/2232、Brain PR6579通过正常CI合并；main严格保留14项必需检查，未admin绕过。",
    "App生产准入核对同SHA最新staging部署和真实验收；Pilot只允许隔离候选，手机晋级要求真实候选业务run证据。",
    "API固定镜像/现场回退、前端原子切换/版本读回、HK共享fetch锁与Staff健康轮询已补，并通过回归。",
    "authoring中断恢复保留各owner原始快照与active地图CAS；最终11条来源任务完成，旧2条失败任务准确收尾保留回执。",
    "最终81c5a1f1的API/Dashboard/Staff staging均成功，HTTP与GitHub双源版本一致。",
    "Pilot39470471409 attempt2三scope verified/gaps=0；手机候选39472321202成功；MMV243/西安237文件独立摘要及Brain release/observation/gate实读一致。",
    "Brain7b3be052/1.445.44已上线healthy，候选Commander路径冻结配套修复部署生效；Gate3成功。",
    "未完成项已登记原项目6条queued后续，source_task_id回链；本次两个ZenithJoy worktree已清理。"
  ],
  "not_done": [
    "手机真实采集/获客/发布/触达业务未执行，business_runtime_status=not_evaluated；手机生产未晋级。",
    "手机整包生产回退、其他CI/CD审计项及Brain先生产后staging顺序仍需续办。",
    "跨仓Activity登记死锁已定位；本轮重跑通过但根因修复未完成，已留独立任务。",
    "Notion目前任务基本信息可见；详细进度正文和Project关系投影缺失，尚未修复。",
    "真微信nightly红、Staff既有生产重启及smoke超时后子进程清理均留后续。"
  ],
  "next_steps": [
    {
      "kind": "task",
      "task_id": "75a0b76f-6dbb-422e-8a55-b00572f7f1ed",
      "title": "修复跨仓 Activity 登记的数据库死锁",
      "already_registered": true
    },
    {
      "kind": "task",
      "task_id": "e93b6e23-c794-425e-b03b-71ffbfe1625a",
      "title": "补齐手机整包回退与候选真实业务验收",
      "already_registered": true
    },
    {
      "kind": "task",
      "task_id": "07752352-88e1-4bb5-9811-d876b633384a",
      "title": "完成其余 CI/CD 审计项及 Brain staging 顺序核查",
      "already_registered": true
    },
    {
      "kind": "task",
      "task_id": "791ca619-5d7d-450f-b25a-a41ad3536c05",
      "title": "补齐 Notion 任务详细进度与 Project 关联投影",
      "already_registered": true
    },
    {
      "kind": "task",
      "task_id": "2e86a63c-cb02-43e2-ac42-bbe5ae5c9125",
      "title": "排查真微信 nightly 失败并恢复真实业务验收证据",
      "already_registered": true
    },
    {
      "kind": "task",
      "task_id": "b123e183-7a0c-48d2-8e3e-036de7938089",
      "title": "排查 Staff Hub 既有生产容器持续重启",
      "already_registered": true
    }
  ],
  "data_sources": [
    "GET /api/brain/tasks/07ab0f99-f210-4a4a-9e17-195c78c297b2",
    "GET /api/brain/tasks/45a6113c-529c-4719-9372-95232061c9a9",
    "/Users/administrator/research/zenithjoy-cicd-audit-20261020/findings.json",
    "/tmp/zj-staging-81c5a1f1-evidence.json",
    "/tmp/zj-phone-evidence-81c5.json",
    "/tmp/zj-phone-candidate-hosts-81c5.json",
    "/tmp/zj-pilot-81c5-postgres-deadlock.log"
  ],
  "artifacts": {
    "pr_urls": [
      "https://github.com/perfectuser21/zenithjoy-workspace/pull/2231",
      "https://github.com/perfectuser21/zenithjoy-workspace/pull/2232",
      "https://github.com/perfectuser21/cecelia/pull/6579"
    ],
    "docs": [],
    "run_urls": [
      "https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/39470470735",
      "https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/39470495900",
      "https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/39470499585",
      "https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/39470471409",
      "https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/39472321202",
      "https://github.com/perfectuser21/cecelia/actions/runs/39470944493"
    ]
  },
  "created_at": "2026-10-20T18:23:09.011769+00:00"
};
import {beforeEach,expect,it,vi} from 'vitest';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../recurring-notion-sync.js',()=>({notionReq:request,getToken:()=> 'token'}));
import {pushTasksForTest,buildTaskNotionProperties,ingestDelegatedPage} from '../notion-push-sync.js';

let blocks,sequence,query;
const task=()=>({id:'task-one',title:'修复发布门禁',description:'最初目标不能遗忘',status:'in_progress',priority:'P1',task_type:'dev',
 notion_id:'page-one',notion_props:{pushed_status:'in_progress'},project_notion_id:'project-one',content_hash:'hash-one',
 result:{phase:'验证',facts:['采集已读回'],pr_url:'https://github.com/owner/repo/pull/12',handoff:{summary:'已完成门禁修复',next_steps:[{kind:'task',title:'实际部署核验'}]}}});
beforeEach(()=>{
 blocks=[{id:'human',type:'paragraph',paragraph:{rich_text:[{text:{content:'人写的备注必须保留'}}]}}];sequence=0;query=vi.fn(async()=>({rows:[]}));
 request.mockReset();request.mockImplementation(async(_token,path,method='GET',body)=>{
  if(path==='/pages/page-one'&&method==='PATCH')return {id:'page-one'};
  if(path.startsWith('/blocks/page-one/children')&&method==='GET')return {results:blocks,has_more:false};
  if(path==='/blocks/page-one/children'&&method==='PATCH'){
   const added=body.children.map(b=>({...b,id:`machine-${++sequence}`}));blocks.push(...added);return {results:added};
  }
  const id=path.split('/')[2],block=blocks.find(b=>b.id===id);
  if(block&&method==='GET')return {results:block.toggle.children,has_more:false};
  if(block&&method==='DELETE'){blocks=blocks.filter(b=>b.id!==id);return {};}
  throw Error(`unexpected request ${method} ${path}`);
 });
});
it('投影真实目标、事实、PR与交接，保留人工正文；重复同步不堆积',async()=>{
 const t=task();await pushTasksForTest({query},'token',[t]);await pushTasksForTest({query},'token',[t]);
 const body=JSON.stringify(blocks);
 for(const text of ['最初目标不能遗忘','采集已读回','https://github.com/owner/repo/pull/12','实际部署核验','人写的备注必须保留'])expect(body).toContain(text);
 expect(blocks.filter(b=>b.type==='toggle')).toHaveLength(1);
 expect(query.mock.calls.some(([sql,args])=>sql.includes('UPDATE tasks')&&args.includes('hash-one'))).toBe(true);
});
it('正文写入或读回失败，不推进任务同步指纹；恢复重试只留一份机器正文',async()=>{
 const normal=request.getMockImplementation();let fail=true;
 request.mockImplementation(async(...args)=>{if(fail&&args[1].includes('/children')&&args[2]==='PATCH'){fail=false;await normal(...args);throw Error('断网后返回丢失');}return normal(...args);});
 await pushTasksForTest({query},'token',[task()]);
 expect(query.mock.calls.filter(([sql])=>sql.includes('UPDATE tasks'))).toHaveLength(0);
 await pushTasksForTest({query},'token',[task()]);
 expect(blocks.filter(b=>b.type==='toggle')).toHaveLength(1);
 expect(query.mock.calls.filter(([sql])=>sql.includes('UPDATE tasks'))).toHaveLength(1);
});
it('Project已在Brain移除时清空原机器关联；从未关联时不动人工Project',()=>{
 expect(buildTaskNotionProperties({...task(),project_notion_id:null,notion_props:{pushed_project:'old'}}).Project).toEqual({relation:[]});
 expect(buildTaskNotionProperties({...task(),project_notion_id:null,notion_props:{}}).Project).toBeUndefined();
});
it('机器进度不作为新排单回灌',async()=>{
 const result=await ingestDelegatedPage({query},'token',{id:'page-one',properties:{Name:{title:[{text:{content:'修复'}}]},Description:{rich_text:[{text:{content:'dev · brain:task-one'}}]}}});
 expect(result.kind).toBe('skipped');expect(request).not.toHaveBeenCalled();
});

it('现行发布交接完整投影已完成、未完成、范围、证据与下一棒，敏感无关字段不显示',async()=>{
 const t=task();t.result={handoff,heartbeat_count:25,secret:'NEVER_PROJECT'};
 await pushTasksForTest({query},'token',[t]);const content=JSON.stringify(blocks);
 for(const value of [...handoff.done,...handoff.not_done,handoff.scope,...handoff.artifacts.pr_urls,...handoff.artifacts.run_urls,...handoff.next_steps.map(s=>s.task_id)])expect(content).toContain(value);
 expect(content).not.toContain('NEVER_PROJECT');expect(content).not.toContain('heartbeat_count');
});
it('创建成功但Brain保存页身份失败，按brain标记找回同页并补正文',async()=>{
 const t={...task(),notion_id:null,notion_props:null};let created=null,failed=false;
 const normal=request.getMockImplementation();
 request.mockImplementation(async(...args)=>{
  if(args[1].startsWith('/databases/'))return {results:created?[created]:[],has_more:false};
  if(args[1]==='/pages'&&args[2]==='POST'){created={id:'page-one',properties:args[3].properties};return created;}
  return normal(...args);
 });
 query.mockImplementation(async sql=>{if(sql.includes('UPDATE tasks')&&!failed){failed=true;throw Error('数据库写回丢失');}return {rows:[]};});
 await pushTasksForTest({query},'token',[t]);await pushTasksForTest({query},'token',[t]);
 expect(request.mock.calls.filter(([,path,method])=>path==='/pages'&&method==='POST')).toHaveLength(1);
 expect(blocks.filter(b=>b.type==='toggle')).toHaveLength(1);
 expect(query.mock.calls.some(([sql])=>sql.includes('notion_synced_at'))).toBe(true);
});
it('正文400不是错库，不清除已确定的任务页身份',async()=>{
 const normal=request.getMockImplementation();request.mockImplementation(async(...args)=>{
  if(args[1].includes('/children'))throw Error('Notion 400: body invalid');return normal(...args);
 });
 await pushTasksForTest({query},'token',[task()]);expect(query.mock.calls.filter(([sql])=>sql.includes('UPDATE tasks'))).toHaveLength(0);
});
