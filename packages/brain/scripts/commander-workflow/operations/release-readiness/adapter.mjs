import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function withReadinessIdentity(input,run,profile){
 return {...input,run_tag:run.input.run_tag,expected_brain_sha:run.input.expected_brain_sha,expected_brain_version:run.input.expected_brain_version,_readiness:{root:profile.cwd,task_id:run.task_id,run_id:run.run_id}};
}
export async function createRuntime(args){
 const module=await import(pathToFileURL(path.join(args.profile.runtimeRoot,'scripts/commander-workflow/skill-adapter.mjs')).href);
 const runtime=await module.createRuntime(args),bound=input=>withReadinessIdentity(input,args.run,args.profile);
 return {...runtime,
  executeActivity:(activity,input,options)=>runtime.executeActivity(activity,bound(input),options),
  inspectActivity:(activity,input,options)=>runtime.inspectActivity(activity,bound(input),options),
  checkActivity:(activity,value,options)=>runtime.checkActivity(activity,value,{...options,input:bound(options.input)})};
}
