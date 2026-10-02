import express from 'express';
import {timingSafeEqual} from 'node:crypto';
import {createBaselineVersionStore} from '../execution-directory/baseline-version.js';
export function createExecutionBaselineRouter({pool,env=process.env,store=createBaselineVersionStore({pool})}){
 const router=express.Router();
 router.use((req,res,next)=>{const token=env.CECELIA_INTERNAL_TOKEN,provided=req.headers['x-cecelia-token'];
  if(typeof token!=='string'||token.length<32)return res.status(503).json({error:'execution_baseline_auth_unconfigured'});
  if(typeof provided!=='string'||Buffer.byteLength(provided)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))return res.status(401).json({error:'unauthorized'});next();
 });
 const run=operation=>async(req,res)=>{try{const result=await operation(req);res.status(result.directory_refresh_confirmed===false?503:200).json(result);}
  catch(error){const code=/^execution_baseline_[a-z_0-9]+$/.test(error.message)?error.message:'execution_baseline_unconfirmed';res.status(code==='execution_baseline_request_invalid'?400:409).json({error:code});}};
 router.post('/nodes/:machineId/baseline-version',run(req=>store.publish(req.params.machineId,req.body)));
 router.post('/nodes/:machineId/baseline-version/compensate',run(req=>store.compensate(req.params.machineId,req.body)));
 return router;
}
