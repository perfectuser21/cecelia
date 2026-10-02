import { Router } from 'express';
import defaultPool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { ReleaseEvidenceError,UUID,evidenceText,requireEvidence,createRelease,recordReleaseObservation,getRelease,getReleaseGate } from '../lib/release-index.js';
export function sendReleaseError(res,error){
  if(error instanceof ReleaseEvidenceError)return res.status(error.status).json({error:{code:error.code,message:error.message}});
  console.error('[release-evidence]',error);
  return res.status(500).json({error:{code:'RELEASE_INTERNAL_ERROR',message:'发布证据处理失败'}});
}
export function createReleasesRouter({pool=defaultPool,trustedCollectors}={}){
  const router=Router();router.use(internalAuthOrLoopback);
  const collectors=()=>trustedCollectors??(process.env.CECELIA_RELEASE_COLLECTORS||'').split(',').map(x=>x.trim()).filter(Boolean);
  router.post('/',async(req,res)=>{try{const result=await createRelease(pool,req.body);res.status(result.created?201:200).json(result);}catch(error){sendReleaseError(res,error);}});
  router.post('/:id/observations',async(req,res)=>{try{
    requireEvidence(collectors().length,'collector_unconfigured','COLLECTOR_UNCONFIGURED',503);
    requireEvidence(collectors().includes(req.body?.collector),'collector未登记','COLLECTOR_UNTRUSTED',403);
    const result=await recordReleaseObservation(pool,req.params.id,req.body,{trustedCollector:req.body.collector});res.status(result.created?201:200).json(result);
  }catch(error){sendReleaseError(res,error);}});
  router.get('/:id/observations/:observationId',async(req,res)=>{try{
    evidenceText(req.params.id,'release_id',UUID);evidenceText(req.params.observationId,'observation_id',UUID);
    const observation=(await pool.query('SELECT * FROM release_observations WHERE id=$1 AND release_id=$2',[req.params.observationId,req.params.id])).rows[0];
    requireEvidence(observation,'观测不存在或不属于release','NOT_FOUND',404);res.json({observation});
  }catch(error){sendReleaseError(res,error);}});
  router.get('/:id/gate',async(req,res)=>{try{res.json(await getReleaseGate(pool,req.params.id));}catch(error){sendReleaseError(res,error);}});
  router.get('/:id',async(req,res)=>{try{res.json({release:await getRelease(pool,req.params.id)});}catch(error){sendReleaseError(res,error);}});
  return router;
}
export default createReleasesRouter;
