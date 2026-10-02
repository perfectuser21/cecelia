import { Router } from 'express';
import defaultPool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { exportImplementationSnapshot,refreshImplementationSnapshot,registerImplementationRepository } from '../lib/implementation-ci-snapshot.js';
export function createImplementationCiRouter({pool=defaultPool,refreshOptions}={}){
  const router=Router();router.use(internalAuthOrLoopback);
  const send=handler=>async(req,res)=>{try{res.json({snapshot:await handler(req)});}catch(error){
    const status=Number.isInteger(error.status)?error.status:500;
    res.status(status).json({error:{code:error.code||'IMPLEMENTATION_CI_INTERNAL_ERROR',message:status===500?'CI快照处理失败':error.message}});
  }};
  router.post('/repositories',async(req,res)=>{try{const result=await registerImplementationRepository(pool,req.body);res.status(result.created?201:200).json(result);}catch(error){res.status(error.status||500).json({error:{code:error.code||'IMPLEMENTATION_CI_INTERNAL_ERROR',message:error.status?error.message:'repo登记失败'}});}});
  router.get('/snapshot',send(req=>exportImplementationSnapshot(pool,req.query)));
  router.post('/refresh',send(req=>refreshImplementationSnapshot(pool,req.body,refreshOptions)));
  return router;
}
export default createImplementationCiRouter;
