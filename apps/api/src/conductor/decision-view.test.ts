import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as decisions from './decision-view.mjs';

let directory: string;
let view: ReturnType<typeof decisions.createDecisionView>;
const task={id:'task-abc',title:'给报表加缓存',description:'慢'};
const contract={approach:'服务端Redis缓存',risk:'低',dod:['CI绿']};
beforeEach(()=>{
  directory=mkdtempSync(join(tmpdir(),'conductor-decisions-'));
  expect(decisions.createDecisionView).toBeTypeOf('function');
  view=decisions.createDecisionView({queueDir:directory});
  vi.stubEnv('NOTION_API_KEY','');vi.stubEnv('AUTOPILOT_DECISION_DB_ID','');
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});

describe('裁决真实身份与每例私有队列',()=>{
  it('demo脚本不读文件或网络',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const script=[{action:'redirect',steer:'改方向'},{action:'approve'}];
    expect(await view.readVerdict({mode:'demo',script,round:1,taskId:task.id})).toEqual(script[0]);
    expect(await view.readVerdict({mode:'demo',script,round:2,taskId:task.id})).toEqual(script[1]);
    expect(fetch).not.toHaveBeenCalled();expect(existsSync(join(directory,`${task.id}.contract.json`))).toBe(false);
  });
  it('缺配置时真实落本例文件，再从同队列读回裁决，不串到另一目录',async()=>{
    vi.stubGlobal('fetch',()=>{throw Error('禁止网络');});
    const out=await view.publishContract(task,contract);
    expect(out).toBe(join(directory,`${task.id}.contract.json`));
    expect(JSON.parse(readFileSync(out,'utf8'))).toEqual({task,contract});
    expect(await view.readVerdict({mode:'once',taskId:task.id})).toBeNull();
    writeFileSync(join(directory,`${task.id}.verdict`),JSON.stringify({action:'redirect',steer:'改放服务端'}));
    expect(await view.readVerdict({mode:'once',taskId:task.id})).toEqual({action:'redirect',steer:'改放服务端'});
    const other=decisions.createDecisionView({queueDir:join(directory,'other')});
    expect(await other.readVerdict({mode:'once',taskId:task.id})).toBeNull();
  });
  it('本例裁决文件损坏时返回未获批准，不能中止指挥或冒成功',async()=>{
    writeFileSync(join(directory,`${task.id}.verdict`),'{broken');
    await expect(view.readVerdict({mode:'once',taskId:task.id})).resolves.toBeNull();
  });
  it('普通标题不含id时，写入页面仍能按相同身份查询回来；近似id不串页',async()=>{
    vi.stubEnv('NOTION_API_KEY','fixture-secret');vi.stubEnv('AUTOPILOT_DECISION_DB_ID','db-fixture');
    const pages: any[]=[];
    vi.stubGlobal('fetch',async(url: string,options: RequestInit)=>{
      const body=JSON.parse(options.body as string);
      expect(options.method).toBe('POST');
      expect((options.headers as Record<string,string>).Authorization).toBe('Bearer fixture-secret');
      if(url.endsWith('/pages')){
        expect(body.parent.database_id).toBe('db-fixture');
        const page={id:`page-${pages.length}`,properties:body.properties};pages.push(page);
        return {ok:true,json:async()=>page};
      }
      expect(url).toBe('https://api.notion.com/v1/databases/db-fixture/query');
      const clauses=body.filter.or ?? [body.filter];
      for(const clause of clauses)expect(clause.property).toBe('Task');
      const filtered=pages.filter(page=>{
        const title=page.properties.Task.title.map((t:any)=>t.text.content).join('');
        return clauses.some((clause:any)=>{
          const query=clause.title;
          return query.equals ? title===query.equals : query.starts_with ? title.startsWith(query.starts_with) : title.includes(query.contains);
        });
      });
      return {ok:true,json:async()=>({results:filtered})};
    });
    await view.publishContract({...task,id:'task-abc-other'},contract);
    expect(await view.publishContract(task,contract)).toBe('page-1');
    expect(pages[1].properties.Contract.rich_text.map((t:any)=>t.text.content).join('')).toContain(contract.approach);
    expect(pages[1].properties.风险.rich_text.map((t:any)=>t.text.content).join('')).toBe('低');
    pages[0].properties.状态={select:{name:'approve'}};
    pages[1].properties.状态={select:{name:'redirect'}};
    pages[1].properties.裁决={rich_text:[{plain_text:'改放服务端'}]};
    expect(await view.readVerdict({mode:'once',taskId:task.id})).toEqual({action:'redirect',steer:'改放服务端'});
    expect(await view.readVerdict({mode:'once',taskId:'missing'})).toBeNull();
    // 旧API允许无title而以id作标题，保留精确旧身份，不恢复模糊contains。
    pages.push({properties:{Task:{title:[{text:{content:'old-id-only'}}]},状态:{select:{name:'approve'}}}});
    expect(await view.readVerdict({mode:'once',taskId:'old-id-only'})).toEqual({action:'approve'});
  });
  it.each(['待审','approve','unknown'])('裁决状态%s有明确语义',async status=>{
    vi.stubEnv('NOTION_API_KEY','fixture-secret');vi.stubEnv('AUTOPILOT_DECISION_DB_ID','db-fixture');
    vi.stubGlobal('fetch',async()=>({ok:true,json:async()=>({results:[{properties:{状态:{select:{name:status}}}}]})}));
    expect(await view.readVerdict({mode:'once',taskId:task.id})).toEqual(status==='approve'?{action:'approve'}:null);
  });
  it.each(['network','http'])('查询%s失败不伪造approve',async failure=>{
    vi.stubEnv('NOTION_API_KEY','fixture-secret');vi.stubEnv('AUTOPILOT_DECISION_DB_ID','db-fixture');
    vi.stubGlobal('fetch',async()=>{if(failure==='network')throw Error('offline');return {ok:false,status:503};});
    expect(await view.readVerdict({mode:'once',taskId:task.id})).toBeNull();
  });
});
