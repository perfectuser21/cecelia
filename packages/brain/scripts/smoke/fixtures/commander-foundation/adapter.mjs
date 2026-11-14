// 仅供隔离验收的受信adapter；Code与真Agent消费相同Activity契约。
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export async function createRuntime({profile}) {
  const {callActivityProcess}=await import(pathToFileURL(path.join(profile.runtimeRoot,'src/orchestrator/activity-process.js')));
  const {callCodexJudge}=await import(pathToFileURL(path.join(profile.runtimeRoot,'scripts/coding-workflow/lib/codex-judge.mjs')));
  const root=profile.cwd;
  const stopped=pid=>{try{process.kill(pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}};
  return {
    decide:async(request,{timeoutMs,signal})=>{
      const raw=await callActivityProcess({budget:{max_duration_s:timeoutMs/1000,heartbeat_s:1},runtime:{entry:'commander.mjs'}},{request,root,scenario:profile.scenario},{cwd:root,signal});
      if(raw.exit_code!==0)throw Error('fixture_commander_died');return JSON.parse(raw.stdout);
    },
    executeActivity:async(activity,input,{identity,...options})=>{
      if(activity.runtime.executor_kind==='agent'&&profile.realAgent){
        fs.writeFileSync(path.join(root,`${activity.key}.pid`),String(process.pid));
        const reply=await callCodexJudge({system:fs.readFileSync(path.join(root,'skill.txt'),'utf8'),user:JSON.stringify(input)},
          {...profile.commander,timeoutMs:Math.ceil(activity.budget.max_duration_s*1000),transcriptPath:path.join(root,'agent-native.jsonl')});
        const result=JSON.parse(reply.content);
        fs.appendFileSync(path.join(root,`${activity.key}.effects`),'x');
        fs.writeFileSync(path.join(root,`${activity.key}.json`),JSON.stringify({identity,result}));return result;
      }
      return callActivityProcess(activity,{...input,root,scenario:profile.scenario,action_identity:identity},options);
    },
    inspectActivity:async(activity,_input,{identity})=>{
      fs.appendFileSync(path.join(root,'readbacks.jsonl'),JSON.stringify({activity_key:activity.key,action_id:identity.action_id})+'\n');
      if(profile.scenario==='unknown-readback')return {state:'unknown'};
      const stored=JSON.parse(fs.readFileSync(path.join(root,`${activity.key}.json`),'utf8'));
      const pid=Number(fs.readFileSync(path.join(root,`${activity.key}.pid`),'utf8'));
      return {state:'completed',execution_stopped:stopped(pid),identity:stored.identity,result:stored.result};
    },
    checkActivity:async(activity,result,{phase,input})=>{
      if(phase==='start')return {verdict:'pass'};
      try{
        const stored=JSON.parse(fs.readFileSync(path.join(root,`${activity.key}.json`),'utf8'));
        const expected=activity.key==='prepare'?{base:21}:{answer:42};
        return {verdict:stored.identity.action_id===input.action_id&&stored.result.run_tag===input.run_tag
          &&JSON.stringify(stored.result.outputs)===JSON.stringify(expected)&&JSON.stringify(result.outputs)===JSON.stringify(expected)
          &&fs.readFileSync(path.join(root,`${activity.key}.effects`),'utf8')==='x'?'pass':'fail',evidence:[`${activity.key}.json`]};
      }catch{return {verdict:'unknown'};}
    },
    onEvent:async event=>fs.appendFileSync(path.join(root,'events.jsonl'),JSON.stringify(event)+'\n'),
  };
}
