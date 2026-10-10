import { Router } from 'express';
import defaultPool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { bindRunDefinition,getRunDefinitionBinding } from '../lib/run-definition-binding.js';
import { sendReleaseError } from './releases.js';
import { compactRunDefinition } from '../lib/run-definition-view.js';
export function createRunDefinitionsRouter({pool=defaultPool}={}){
  const router=Router();router.use(internalAuthOrLoopback);
  router.post('/:run_id/definition',async(req,res)=>{try{
    const result=await bindRunDefinition(pool,req.params.run_id,req.body);res.status(result.created?201:200).json(result);
  }catch(error){sendReleaseError(res,error);}});
  router.get('/:run_id/definition',async(req,res)=>{try{
    const result=await getRunDefinitionBinding(pool,req.params.run_id);
    if(!result)return res.status(404).json({error:{code:'RUN_DEFINITION_UNKNOWN',message:'运行缺少固定定义证据'}});
    // 默认紧凑：只回本次运行的定义骨架+校验hash（10-09 整份release约669KB致执行端超时）；?view=full 取旧完整形状
    res.status(200).json(req.query.view==='full'?result:compactRunDefinition(result));
  }catch(error){sendReleaseError(res,error);}});
  return router;
}
export default createRunDefinitionsRouter;
