import { it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// 红测也在底层拒绝真实DB/环境文件；它不代替实际db模块的身份断言。
vi.mock('dotenv/config',()=>({}));
vi.mock('dotenv',()=>({default:{config:()=>({parsed:{}})},config:()=>({parsed:{}})}));
vi.mock('pg',()=>({default:{Pool:class {query=boundary.unboundQuery;},types:{setTypeParser:vi.fn()}}}));
// Mock ops.js 的所有重依赖，确保测试轻量
vi.mock('../../db.js', () => ({ default: { query: boundary.forbidden } }));
vi.mock('../../llm-caller.js', () => ({ callLLM: boundary.forbidden, callLLMStream: boundary.forbidden }));
vi.mock('../../orchestrator-chat.js', () => ({ handleChat: vi.fn() }));
vi.mock('../../tick.js', () => ({ check48hReport: vi.fn() }));
vi.mock('../../task-weight.js', () => ({ getTaskWeights: vi.fn() }));
vi.mock('../../task-cleanup.js', () => ({
  getCleanupStats: vi.fn(),
  runTaskCleanup: vi.fn(),
  getCleanupAuditLog: vi.fn(),
}));
vi.mock('../../dispatch-stats.js', () => ({ getDispatchStats: vi.fn() }));
vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {},
}));
vi.mock('../../decision-executor.js', () => ({ executeDecision: vi.fn() }));
vi.mock('../../suggestion-triage.js', () => ({
  createSuggestion: vi.fn(),
  executeTriage: vi.fn(),
  getTopPrioritySuggestions: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  cleanupExpiredSuggestions: vi.fn(),
  getTriageStats: vi.fn(),
}));
vi.mock('../../decomposition-checker.js', () => ({ runDecompositionChecks: vi.fn() }));
vi.mock('../../pr-callback-handler.js', () => ({
  verifyWebhookSignature: vi.fn(),
  extractPrInfo: vi.fn(),
  handlePrMerged: vi.fn(),
}));
vi.mock('../shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn(),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));
const boundary = vi.hoisted(() => ({unboundQuery:vi.fn(()=>{throw Error('unbound database query forbidden');}),owned:null,redirectRoot:null,spawn:vi.fn(), write:vi.fn(), receipt:vi.fn(async()=> 'fixture-receipt'), forbidden:vi.fn(() => {throw Error('external action forbidden');})}));
vi.mock('child_process', () => ({spawn:boundary.spawn,exec:boundary.forbidden,execSync:boundary.forbidden,execFile:boundary.forbidden,execFileSync:boundary.forbidden}));
vi.mock('node:child_process', () => ({spawn:boundary.spawn,exec:boundary.forbidden,execSync:boundary.forbidden,execFile:boundary.forbidden,execFileSync:boundary.forbidden}));
vi.mock('../../receipt-collector.js', () => ({recordActionReceipt:boundary.receipt,resolveActionReceipt:boundary.forbidden}));
vi.mock('fs', async original=>{
 const fs=await original();const {resolve}=await import('node:path');const {fileURLToPath}=await import('node:url');
 const root=resolve(process.cwd(),'../..');
 function safe(file){let p=file instanceof URL?fileURLToPath(file):resolve(String(file));const oldRoot=root+'/packages/docs/instruction-book';if(boundary.redirectRoot&&(p===oldRoot||p.startsWith(oldRoot+'/')))p=boundary.redirectRoot+p.slice(oldRoot.length);if((!p.startsWith(root+'/')&&!p.startsWith(boundary.owned+'/'))||/\/\.env|credential|auth\.json/.test(p))throw Error('host read forbidden');return p;}
 return {...fs,readFileSync:(file,...args)=>fs.readFileSync(safe(file),...args),readdirSync:(file,...args)=>fs.readdirSync(safe(file),...args),writeFileSync:boundary.forbidden,mkdirSync:boundary.forbidden,openSync:boundary.forbidden};
});
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
let app,server,fs;
const docs=resolve(process.cwd(),'../../docs/instruction-book');
beforeAll(async()=>{fs=await vi.importActual('node:fs');boundary.owned=fs.mkdtempSync(join(tmpdir(),'book-http-'));vi.stubGlobal('fetch',boundary.forbidden);const m=await import('../ops.js');expect(boundary.forbidden).not.toHaveBeenCalled();expect(boundary.unboundQuery).not.toHaveBeenCalled();app=express().use('/api/brain',m.default);server=await new Promise(resolve=>{const ownedServer=app.listen(0,'127.0.0.1',()=>resolve(ownedServer));});});
beforeEach(()=>{vi.clearAllMocks();boundary.redirectRoot=null;vi.unstubAllEnvs();});
afterEach(()=>vi.unstubAllEnvs());
afterAll(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(boundary.owned,{recursive:true,force:true});vi.unstubAllGlobals();});
const get=()=>request(server).get('/api/brain/docs/instruction-book');
function book(name){const p=join(boundary.owned,name);for(const k of ['skills','features'])fs.mkdirSync(join(p,k),{recursive:true});return p;}
const flatten=e=>Object.values(e.sections).map(s=>s.content+'\n'+s.subsections.map(x=>x.title+'\n'+x.content).join('\n')).join('\n');
it('真实ops注册GET读取所有仓内条目且ID非空唯一，零DB/外部动作',async()=>{
 const r=await get();expect(r.status).toBe(200);
 for(const k of ['skills','features']){const files=fs.readdirSync(join(docs,k)).filter(x=>x.endsWith('.md'));expect(r.body[k]).toHaveLength(files.length);expect(files.length).toBeGreaterThan(0);}
 const entries=[...r.body.skills,...r.body.features];expect(entries.every(x=>typeof x.id==='string'&&x.id.length>0)).toBe(true);expect(new Set(entries.map(x=>x.id)).size).toBe(entries.length);expect(boundary.forbidden).not.toHaveBeenCalled();
});
it.each([
 ['content-pipeline-llm-calling','Content Pipeline LLM 调用','executeCopywriting','previous_feedback','llm_generated','无需重启服务'],
 ['post-publish-data-collection','功能说明：发布后数据回收（内容飞轮 I3）','content_publish','source_publish_task_id','/api/brain/pipelines/:id/stats','migration 207','post-publish-data-collector.js'],
 ['social-trending-api','Social Trending API','GET /api/brain/social/trending','内容选题','platform | string','v_all_platforms','HTTP 200'],
 ['topics-api','GET /api/brain/topics — 内容选题候选库 API','GET /api/brain/topics?date=YYYY-MM-DD','"total": 10','priority_score','POST /api/brain/pipelines/trigger-topics'],
 ['system-registry','System Registry (`/api/brain/registry`)','GET `/api/brain/registry/exists`','metadata | JSONB','创建新 skill 前','197_system_registry.sql'],
])('真实无frontmatter中文文档%s正文进入UI现用sections',async(name,title,...markers)=>{
 // 仅在格式回归中把旧错误根映射到真实文档，独立于路径修复证明原parser缺口。
 boundary.redirectRoot=docs;const r=await get();expect(r.status).toBe(200);const e=r.body.features.find(x=>x.title===title);expect(e,'真实文档必达').toBeDefined();expect.soft(e.id).toBe('feature:'+name);if(name!=='topics-api')expect(e.sections.what).toBeDefined();for(const marker of markers)expect(flatten(e)).toContain(marker);expect(boundary.forbidden).not.toHaveBeenCalled();
});
it('显式合法两空目录是200空，不回落源码其它根',async()=>{vi.stubEnv('INSTRUCTION_BOOK_DOCS_ROOT',book('empty'));const r=await get();expect(r.status).toBe(200);expect(r.body).toEqual({skills:[],features:[]});expect(boundary.forbidden).not.toHaveBeenCalled();});
it.each(['missing','bad-entry','empty-entry'])('%s不能200空或部分成功',async mode=>{
 const p=book(mode);if(mode==='missing')fs.rmSync(join(p,'features'),{recursive:true});if(mode==='bad-entry')fs.mkdirSync(join(p,'features/broken.md'));if(mode==='empty-entry')fs.writeFileSync(join(p,'features/broken.md'),'');vi.stubEnv('INSTRUCTION_BOOK_DOCS_ROOT',p);const r=await get();expect(r.status).toBe(503);expect(r.body).toEqual({error:'instruction_book_unavailable'});expect(boundary.forbidden).not.toHaveBeenCalled();
});
it('既有英文章节、子章节、显式ID及changelog保持',async()=>{
 const p=book('english');fs.writeFileSync(join(p,'skills/fixture.md'),'---\nid: explicit-id\nversion: 1.2.3\nchangelog:\n  - 1.2.3: owned change\n---\n# Owned English\n## What it is\nowned body\n## Trigger\nowned trigger\n## How to use\nowned usage\n### Child\nowned child\n## Output\nowned output\n## Added in\nowned version');vi.stubEnv('INSTRUCTION_BOOK_DOCS_ROOT',p);boundary.redirectRoot=p;const r=await get();expect(r.status).toBe(200);expect(r.body.skills).toEqual([{id:'explicit-id',version:'1.2.3',changelog:[{version:'1.2.3',description:'owned change'}],title:'Owned English',category:'skill',sections:{what:{content:'owned body',subsections:[]},trigger:{content:'owned trigger',subsections:[]},howToUse:{content:'owned usage',subsections:[{title:'Child',content:'owned child'}]},output:{content:'owned output',subsections:[]},addedIn:{content:'owned version',subsections:[]}}}]);expect(boundary.forbidden).not.toHaveBeenCalled();
});

it('Ops实际导入的DB与模型函数必须绑定本测试拒绝spy，真实pool零query',async()=>{
 const {default:pool}=await import('../../db.js');const model=await import('../../llm-caller.js');
 expect(pool.query).toBe(boundary.forbidden);expect(model.callLLM).toBe(boundary.forbidden);expect(model.callLLMStream).toBe(boundary.forbidden);
 expect((await get()).status).toBe(200);expect(pool.query).not.toHaveBeenCalled();expect(model.callLLM).not.toHaveBeenCalled();expect(model.callLLMStream).not.toHaveBeenCalled();expect(boundary.unboundQuery).not.toHaveBeenCalled();
});
it.each(['fs','node:fs'])('真实%s别名对越界读必须先由安全边界拒绝',async name=>{
 const filesystem=await import(name);const outside=resolve(boundary.owned,'../instruction-reader-outside-no-file-'+boundary.owned.split('/').pop(), 'unknown');
 expect(()=>filesystem.readFileSync(outside,'utf8')).toThrow('host read forbidden');expect(()=>filesystem.readdirSync(outside)).toThrow('host read forbidden');
});

it('全部15个已跟踪条目的非标题正文逐行进入前端既有sections，不以数量冒称正文完整',async()=>{
 const response=await get();expect(response.status).toBe(200);
 for(const category of ['skills','features'])for(const name of fs.readdirSync(join(docs,category)).filter(x=>x.endsWith('.md'))){
  const lines=fs.readFileSync(join(docs,category,name),'utf8').split('\n');const titleAt=lines.findIndex(line=>line.startsWith('# '));expect(titleAt).toBeGreaterThanOrEqual(0);
  const title=lines[titleAt].slice(2).trim();const entry=response.body[category].find(e=>e.title===title);expect(entry,name).toBeDefined();const body=flatten(entry);
  for(const line of lines.slice(titleAt+1).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')))expect.soft(body,name+': '+line).toContain(line);
 }
 expect(boundary.forbidden).not.toHaveBeenCalled();expect(boundary.unboundQuery).not.toHaveBeenCalled();
});

it('真实门禁说明里的Markdown模板留在使用方式代码块，不能污染英文章节',async()=>{
 const r=await get();expect(r.status).toBe(200);const entry=r.body.features.find(e=>e.id==='instruction-dev-registration-gate');expect(entry).toBeDefined();
 expect(entry.sections.what.content).toContain('CI 自动检查机制');expect(entry.sections.what.content).not.toContain('（一句话描述）');
 expect(entry.sections.trigger.content).not.toContain('（什么时候触发）');
 const usage=entry.sections.howToUse.subsections.find(s=>s.title==='满足门禁要求');expect(usage).toBeDefined();expect(usage.content).toContain('```markdown\n# My New Feature — 功能名\n\n## What it is\n（一句话描述）');
 expect(entry.sections.addedIn.content).toBe('PR #1644（封堵孤岛 Day3-4）');expect(boundary.forbidden).not.toHaveBeenCalled();
});
