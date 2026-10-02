import { Router } from 'express';
import defaultPool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { bindRunDefinition,getRunDefinitionBinding } from '../lib/run-definition-binding.js';
import { sendReleaseError } from './releases.js';
export function createRunDefinitionsRouter({pool=defaultPool}={}){
  const router=Router();router.use(internalAuthOrLoopback);
  router.post('/:run_id/definition',async(req,res)=>{try{
    const result=await bindRunDefinition(pool,req.params.run_id,req.body);res.status(result.created?201:200).json(result);
  }catch(error){sendReleaseError(res,error);}});
  router.get('/:run_id/definition',async(req,res)=>{try{
    const result=await getRunDefinitionBinding(pool,req.params.run_id);res.status(result?200:404).json(result||{error:{code:'RUN_DEFINITION_UNKNOWN',message:'运行缺少固定定义证据'}});
  }catch(error){sendReleaseError(res,error);}});
  return router;
}
export default createRunDefinitionsRouter;
