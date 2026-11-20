import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import './helpers/scheduler-jobs-fixture.js';
import {JOBS} from '../scheduler-jobs.js';
const {summarizeSession}=await vi.importActual('../conversation-capture.js');
import {createOpenClawCommanderTransport} from '../orchestrator/runner-commander-transport.js';
vi.mock('../lib/ssh-exec.js',()=>({sshRun:vi.fn(),sshWithStdin:vi.fn(async()=>'{"finalAssistantVisibleText":"old summary"}')}));
import {sshWithStdin} from '../lib/ssh-exec.js';

it('默认scheduler保留原始会话采集与历史收尾',()=>{
 const names=JOBS.map(j=>j.name);
 expect(names).toContain('conversation-capture');
 expect(names).toContain('notion-capture-ingest');
 expect(names).toContain('openclaw-agent-reaper');
});
it('默认摘要关闭且零SSH，显式注入摘要器仍处理完整正文',async()=>{
 expect(await summarizeSession('完整原文')).toBeNull();
 expect(sshWithStdin).not.toHaveBeenCalled();
 const llm=vi.fn(async()=>({text:'{"topics":["保留显式摘要能力"]}'}));
 expect(await summarizeSession('完整原文',llm)).toBe('1. 保留显式摘要能力');
 expect(llm.mock.calls[0][1]).toContain('完整原文');
});
it('旧OpenClaw Commander配置不可用，零启动且不能伪造成功回执',async()=>{
 const execute=vi.fn(async()=>({stdout:'{"status":"ok"}'}));
 const cwd=mkdtempSync(join(tmpdir(),'retired-commander-'));
 writeFileSync(join(cwd,'skill.md'),'observe');
 const transport=createOpenClawCommanderTransport({cwd,profile:{kind:'openclaw',skill:{entry:'skill.md',version:'1'}},files:{'skill.md':createHash('sha256').update('observe').digest('hex')},execute});
 try{
 await expect(transport({run_id:'original',phase:'wake'})).rejects.toThrow('commander_openclaw_unavailable');
 expect(execute).not.toHaveBeenCalled();
 expect(await transport.reconcile({run_id:'original'})).toEqual({execution_stopped:false});
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
