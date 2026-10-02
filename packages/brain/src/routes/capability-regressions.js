import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { registerCapabilityRegression } from '../lib/capability-regressions.js';
export function createCapabilityRegressionsRouter({pool}){
  const router=Router();
  router.use(rateLimit({windowMs:60000,limit:60,standardHeaders:'draft-7',legacyHeaders:false}));
  router.post('/',internalAuthOrLoopback,async(req,res)=>{
    try{const result=await registerCapabilityRegression(pool,req.body);res.status(result.created?201:200).json(result);}
    catch(error){const status=error.status||500;res.status(status).json({error:{code:error.code||'REGRESSION_REGISTRATION_FAILED',message:status===500?'回归登记失败':error.message}});}
  });return router;
}
