import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { initializeAuthoring, getAuthoring, submitAuthoring } from '../workflow-authoring/store.js';
import { loadCatalog } from '../workflow-authoring/catalog.js';
import { validateDefinition, validateReferences, registerWorkflow } from '../workflow-authoring/registration.js';
import { registerWorkflowSource } from '../lib/workflow-source-registration.js';
import { resolveAuthoringAssembly } from '../workflow-authoring/assembly-resolver.js';
import {advanceAuthoringAssembly} from '../workflow-authoring/assembly-driver.js';

export function createWorkflowAuthoringRouter({ db = pool, sourceOptions, freezeOptions,invocationOptions } = {}) {
  const router = Router();
  router.use(internalAuthOrLoopback);
  const handle = action => async (req, res) => {
    try { res.json(await action(req)); }
    catch (error) {
      const status = error.statusCode || error.status || 500;
      res.status(status).json({ error: error.code || 'workflow_authoring_failed',
        message: status < 500 ? error.message : '工作流管理失败，状态未推进' });
    }
  };
  router.post('/runs/:id/init', handle(req => initializeAuthoring(db, req.params.id, req.body)));
  router.post('/sources/register', handle(req => registerWorkflowSource(db, req.body, sourceOptions)));
  router.get('/runs/:id', handle(req => getAuthoring(db, req.params.id)));
  router.get('/runs/:id/assembly-plan', handle(req => resolveAuthoringAssembly(db, req.params.id,
    String(req.get('x-tenant-id') ?? 'default').trim())));
  const advance=req=>advanceAuthoringAssembly(db,req.params.id,{tenantId:String(req.get('x-tenant-id')??'default'),freezeOptions,invocationOptions});
  router.post('/runs/:id/advance',handle(advance));
  router.post('/runs/:id/submit', handle(async req => {
    const submitted=await submitAuthoring(db,req.params.id,req.body,{loadCatalog,validateDefinition,validateReferences,registerWorkflow,freezeOptions});
    if(req.body.stage==='compose'&&submitted.state.request.execution_protocol==='workflow-authoring-execution-v1')return {...submitted,automatic:await advance(req)};
    return submitted;
  }));
  return router;
}

export default createWorkflowAuthoringRouter();
