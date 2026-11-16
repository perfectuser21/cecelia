import fs from 'node:fs';
import path from 'node:path';
import {identity,directory,read,bytes,hash,writeOnce,owner,ownedResources,result,fail,cli} from './shared.mjs';
export function runCleanup(input){
 const who=identity(input),dir=directory(input,true);ownedResources(dir,who);
 const saved=read(dir,'cleanup.json',false);
 if(saved){owner(saved.owner,who);if(read(dir,'lease.json',false))fs.unlinkSync(path.join(dir,'lease.json'));return saved.result;}
 const report=bytes(dir,'report.json');if(report)owner(read(dir,'report.json').owner,who,false);
 const value=result(input,{released:true,report_present:report!==null,report_sha256:report?hash(report):null},['cleanup.json']);
 writeOnce(dir,'cleanup.json',{owner:who,count:1,result:value});
 if(read(dir,'lease.json',false))fs.unlinkSync(path.join(dir,'lease.json'));
 if(read(dir,'lease.json',false))fail('readiness_resource_not_released');return value;
}
cli(import.meta.url,runCleanup,{stoppedActivity:true});
