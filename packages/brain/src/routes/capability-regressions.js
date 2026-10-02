import { Router } from 'express';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { registerCapabilityRegression } from '../lib/capability-regressions.js';
export function createCapabilityRegressionsRouter({pool}){
  const router=Router();router.post('/',internalAuthOrLoopback,async(req,res)=>{
    try{const result=await registerCapabilityRegression(pool,req.body);res.status(result.created?201:200).json(result);}
    catch(error){const status=error.status||500;res.status(status).json({error:{code:error.code||'REGRESSION_REGISTRATION_FAILED',message:status===500?'回归登记失败':error.message}});}
  });return router;
}
