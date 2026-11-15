import {failFoundationPreflight} from '../workflow-foundation/preflight.js';
import {Router,json} from 'express';
import defaultPool from '../db.js';
import {internalAuthOrLoopback} from '../middleware/internal-auth.js';
import {listFoundationCatalog,createFoundationTask} from '../workflow-foundation/registry.js';
import {claimFoundationTask,prepareFoundationTask} from '../workflow-foundation/claim.js';
import {reconcileFoundationTask} from '../workflow-foundation/reconcile.js';
export function createWorkflowFoundationRouter({pool=defaultPool,services={}}={}){
 const router=Router();router.use(internalAuthOrLoopback,json({limit:'2mb'}));
 const handle=fn=>async(req,res)=>{try{const result=await fn(req);res.status(result.created?201:200).json(result);}catch(error){res.status(error.status??500).json({error:error.code??'foundation_unavailable'});}};
 router.get('/catalog',handle(()=>listFoundationCatalog(pool)));
 router.post('/tasks',handle(req=>createFoundationTask(pool,req.body,services)));
 router.post('/claim',handle(req=>claimFoundationTask(pool,req.body,services)));
 router.post('/tasks/:id/ready',handle(req=>prepareFoundationTask(pool,req.params.id,req.body)));
 router.post('/tasks/:id/preflight-failed',handle(req=>failFoundationPreflight(pool,req.params.id,req.body)));
 router.post('/tasks/:id/reconcile',handle(req=>reconcileFoundationTask(pool,req.params.id,req.body,services)));
 return router;
}
