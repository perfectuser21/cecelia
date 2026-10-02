import { Router } from 'express';
import { internalAuth } from '../middleware/internal-auth.js';
export function createLinuxPoolRouter(service){
 const router=Router();
 router.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!process.env.CECELIA_INTERNAL_TOKEN)return res.status(503).json({error:'linux_pool_internal_auth_unconfigured'});
  return internalAuth(req,res,next);
 });
 const handle=operation=>async(req,res)=>{
  try{return res.json(await operation(req));}
  catch(e){const known=/^linux_pool_[a-z_]+$/.test(e.message??'');return res.status(known?409:503).json({error:known?e.message:'linux_pool_unavailable'});}
 };
 router.get('/:id',handle(req=>service.get(req.params.id)));
 router.post('/:id/challenges',handle(req=>service.challenge(req.params.id,req.body)));
 router.post('/:id/attest',handle(req=>service.attest(req.params.id,req.body)));
 router.post('/:id/activate',handle(req=>service.activate(req.params.id,req.body)));
 router.post('/:id/revoke',handle(req=>service.revoke(req.params.id,req.body)));
 return router;
}
