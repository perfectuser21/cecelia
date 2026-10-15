import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { resolveInvocation } from '../invocations/resolve.js';
import { invoke, invocationReadback, publicResolution } from '../invocations/store.js';
export function createInvocationsRouter({db=pool,...options}={}){
  const router=Router();router.use(internalAuthOrLoopback);
  router.use((req,res,next)=>{
    const tenant=String(req.get('x-tenant-id')??'default').trim();
    if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(tenant))return res.status(400).json({error:'INVALID_TENANT'});
    req.invocationTenant=tenant;next();
  });
  const handle=(fn,status=200)=>async(req,res)=>{
    try{res.status(status).json(await fn(req));}
    catch(error){const code=error.statusCode??error.status??500;
      res.status(code).json({error:error.code??'INVOCATION_FAILED',message:code<500?error.message:'调用状态无法确认，请按原请求键读回',...(error.resolution?{resolution:error.resolution}: {})});}
  };
  router.post('/resolve',handle(async req=>publicResolution(await resolveInvocation(db,req.body,req.invocationTenant,options))));
  router.post('/',handle(req=>invoke(db,req.body,req.invocationTenant,{...options,operator:req.get('x-invocation-operator')??'internal-operator'}),202));
  router.get('/by-request/:request_key',handle(req=>invocationReadback(db,{requestKey:req.params.request_key,tenantId:req.invocationTenant})));
  router.get('/:task_id',handle(req=>invocationReadback(db,{taskId:req.params.task_id,tenantId:req.invocationTenant})));
  return router;
}
export default createInvocationsRouter();
