import express from 'express';
import {timingSafeEqual} from 'node:crypto';
import {createManagedScriptProfileStore} from '../execution-directory/managed-script-profile.js';
export function createExecutionScriptProfilesRouter({pool,env=process.env,store=createManagedScriptProfileStore({pool,env})}={}){
 const router=express.Router();
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');const token=env.CECELIA_INTERNAL_TOKEN,provided=req.headers['x-cecelia-token'];
  if(typeof token!=='string'||token.length<32)return res.status(503).json({error:'execution_script_auth_unconfigured'});
  if(typeof provided!=='string'||Buffer.byteLength(token)!==Buffer.byteLength(provided)||!timingSafeEqual(Buffer.from(token),Buffer.from(provided)))return res.status(401).json({error:'unauthorized'});next();
 });
 router.post('/script-profiles/:profileId/activate',async(req,res)=>{try{const result=await store.activate(req.params.profileId,req.body);res.status(result.requires_reconciliation?503:200).json(result);}
  catch(error){const code=/^execution_script_[a-z_]+$/.test(error.message)?error.message:'execution_script_unconfirmed';res.status(code==='execution_script_request_invalid'?400:409).json({error:code});}});
 return router;
}
