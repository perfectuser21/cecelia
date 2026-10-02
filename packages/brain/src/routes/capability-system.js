import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { runConsistentMapRead } from '../lib/map-read-service.js';
import { readCapabilitySystem,listSystemReleases,listSystemRuns,readSystemReleaseEvidence,readSystemRunEvidence } from '../lib/capability-system.js';
import { readImplementationImpact } from '../lib/implementation-impact.js';
import { systemImpactProjection } from '../lib/capability-system-impact.js';
import { UUID } from '../lib/release-index.js';
const invalid=message=>{throw Object.assign(Error(message),{status:400});};
export function createCapabilitySystemRouter({pool}){
  const router=Router();
  router.use(rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}));
  const read=fn=>async(req,res)=>{
    try{res.json(await runConsistentMapRead(pool,db=>fn(db,req)));}
    catch(error){const status=Number.isInteger(error.status)?error.status:500;res.status(status).json({error:{code:error.code||'MAP_SYSTEM_READ_ERROR',message:status===500?'能力系统读取失败':error.message}});}
  };
  function options(q){
    if(q.workflow_id!==undefined&&(typeof q.workflow_id!=='string'||!UUID.test(q.workflow_id)))invalid('workflow_id须为UUID');
    for(const k of ['limit','offset'])if(q[k]!==undefined&&(typeof q[k]!=='string'||!/^\d+$/.test(q[k])))invalid('分页参数须为整数');
    return {workflowId:q.workflow_id,limit:q.limit===undefined?20:Number(q.limit),offset:q.offset===undefined?0:Number(q.offset)};
  }
  router.get('/registry',read(db=>readCapabilitySystem(db)));
  router.get('/releases',read((db,req)=>listSystemReleases(db,options(req.query))));
  router.get('/runs',read((db,req)=>listSystemRuns(db,options(req.query))));
  router.get('/releases/:id/evidence',read((db,req)=>{if(!UUID.test(req.params.id))invalid('release id须为UUID');return readSystemReleaseEvidence(db,req.params.id);}));
  router.get('/runs/:run_id/evidence',read((db,req)=>{if(req.params.run_id.length>512)invalid('run_id过长');return readSystemRunEvidence(db,req.params.run_id);}));
  router.get('/implementation-impact',read((db,req)=>{
    const q=req.query;
    if(typeof q.changed_files!=='string'||q.changed_files.length>32768)invalid('changed_files须为JSON数组');
    let changed_files;try{changed_files=JSON.parse(q.changed_files);}catch{invalid('changed_files不是有效JSON');}
    return readImplementationImpact(db,{scope:q.scope,repo:q.repo,base_revision:q.base_revision,head_revision:q.head_revision,changed_files}).then(systemImpactProjection);
  }));
  return router;
}
