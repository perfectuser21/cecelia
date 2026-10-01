import express from 'express';
import {timingSafeEqual} from 'node:crypto';
import {createAppServerController} from '../app-server/controller.js';
export function createAppServerRouter({pool,env=process.env,controller=createAppServerController({pool,env})}){
 const router=express.Router();
 router.use((req,res,next)=>{const token=env.CECELIA_INTERNAL_TOKEN;
  if(typeof token!=='string'||token.length<32)return res.status(503).json({error:'appserver_internal_auth_unconfigured'});
  const provided=req.headers['x-cecelia-token'];
  if(typeof provided!=='string'||Buffer.byteLength(provided)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))return res.status(401).json({error:'unauthorized'});
  next();
 });
 const run=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(error){res.status(409).json({error:/^(appserver|execution)_[a-z_0-9]+$/.test(error.message)?error.message:'appserver_operation_unconfirmed'});}};
 router.post('/generations',run(req=>controller.ensure(req.body)));
 router.post('/generations/:id/inspect',run(req=>{if(Object.keys(req.body??{}).length)throw Error('appserver_request_invalid');return controller.inspect(req.params.id);}));
 router.post('/generations/:id/cancel',run(req=>{if(Object.keys(req.body??{}).length)throw Error('appserver_request_invalid');return controller.cancel(req.params.id);}));
 return router;
}
