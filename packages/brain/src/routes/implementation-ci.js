import {PATROL_SCOPE} from '../lib/device-patrol-admission.js';
import {bootstrapPatrolScope,exportPatrolAdmissionSnapshot} from '../lib/device-patrol-registration.js';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import defaultPool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { exportImplementationSnapshot,refreshImplementationSnapshot,registerImplementationRepository } from '../lib/implementation-ci-snapshot.js';
export function createImplementationCiRouter({pool=defaultPool,refreshOptions}={}){
  const router=Router();
  router.use(rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}));
  router.use(rateLimit({windowMs:60000,limit:60,standardHeaders:'draft-7',legacyHeaders:false,skip:req=>req.method!=='POST'}));
  router.use(internalAuthOrLoopback);
  const send=handler=>async(req,res)=>{try{res.json({snapshot:await handler(req)});}catch(error){
    const status=Number.isInteger(error.status)?error.status:500;
    res.status(status).json({error:{code:error.code||'IMPLEMENTATION_CI_INTERNAL_ERROR',message:status===500?'CI快照处理失败':error.message}});
  }};
  router.post('/repositories',async(req,res)=>{try{const result=await registerImplementationRepository(pool,req.body);res.status(result.created?201:200).json(result);}catch(error){res.status(error.status||500).json({error:{code:error.code||'IMPLEMENTATION_CI_INTERNAL_ERROR',message:error.status?error.message:'repo登记失败'}});}});
  router.post('/device-patrol/bootstrap',async(req,res)=>{try{const result=await bootstrapPatrolScope(pool,req.body);res.status(result.created?201:200).json(result);}catch(error){res.status(error.status||500).json({error:{code:error.code||'PATROL_BOOTSTRAP_FAILED',message:error.status?error.message:'巡查来源登记失败'}});}});
  router.get('/snapshot',send(req=>req.query.scope===PATROL_SCOPE?exportPatrolAdmissionSnapshot(pool,req.query):exportImplementationSnapshot(pool,req.query)));
  router.post('/refresh',send(req=>refreshImplementationSnapshot(pool,req.body,refreshOptions)));
  return router;
}
export default createImplementationCiRouter;
