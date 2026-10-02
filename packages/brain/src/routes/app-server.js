import express from 'express';
import {timingSafeEqual} from 'node:crypto';
import {createAppServerController} from '../app-server/controller.js';
import {createAuthorizationStore} from '../app-server/authorization-store.js';
import {createAppServerClient} from '../app-server/client.js';
import {loadAppServerHomes} from '../app-server/config.js';
import {createAppServerCanaryService} from '../app-server/canary-service.js';
export function createAppServerRouter({pool,env=process.env,controller=createAppServerController({pool,env}),
 authorizationStore=createAuthorizationStore({pool,homes:loadAppServerHomes(env.CECELIA_APP_SERVER_HOMES_FILE),client:createAppServerClient({pool,env})}),
 canaryService=createAppServerCanaryService({pool,env,authorizationStore})}){
 const router=express.Router();
 router.use((req,res,next)=>{const token=env.CECELIA_INTERNAL_TOKEN;
  if(typeof token!=='string'||token.length<32)return res.status(503).json({error:'appserver_internal_auth_unconfigured'});
  const provided=req.headers['x-cecelia-token'];
  if(typeof provided!=='string'||Buffer.byteLength(provided)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))return res.status(401).json({error:'unauthorized'});
  next();
 });
 const run=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(error){res.status(409).json({error:/^(appserver|execution)_[a-z_0-9]+$/.test(error.message)?error.message:'appserver_operation_unconfirmed'});}};
 router.post('/authorizations/prepare',run(async req=>{const row=await canaryService.prepare(req.body);return {id:row.id,state:row.state,expires_at:row.authorization_expires_at};}));
 router.post('/authorizations/:id/advance',run(async req=>{
  if(Object.keys(req.body??{}).length)throw Error('appserver_authorization_request_invalid');
  const row=await canaryService.advance(req.params.id);return {id:row.id,state:row.state,...(row.successor_id?{successor_id:row.successor_id}:{})};
 }));
 router.post('/authorizations/:id/revoke',run(req=>{if(Object.keys(req.body??{}).length)throw Error('appserver_authorization_request_invalid');return authorizationStore.revoke(req.params.id);}));
 router.post('/generations',run(req=>controller.ensure(req.body)));
 router.post('/generations/:id/stream',async(req,res)=>{
  try{if(Object.keys(req.body??{}).length)throw Error('appserver_request_invalid');
   const {token,...metadata}=await controller.prepareStream(req.params.id);
   res.set('x-appserver-stream-token',token).set('cache-control','no-store').json(metadata);
  }catch(error){res.status(409).json({error:/^(appserver|execution)_[a-z_0-9]+$/.test(error.message)?error.message:'appserver_operation_unconfirmed'});}
 });
 router.post('/generations/:id/inspect',run(req=>{if(Object.keys(req.body??{}).length)throw Error('appserver_request_invalid');return controller.inspect(req.params.id);}));
 router.post('/generations/:id/cancel',run(req=>{if(Object.keys(req.body??{}).length)throw Error('appserver_request_invalid');return controller.cancel(req.params.id);}));
 return router;
}
