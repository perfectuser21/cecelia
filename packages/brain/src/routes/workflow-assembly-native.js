import {Router} from 'express';
import {internalAuthOrLoopback} from '../middleware/internal-auth.js';
import {prepareNativeSource,nativeSpec,deployedNativeRevision} from '../lib/workflow-assembly-native-source.js';
import {registerNativeReconcile} from '../lib/workflow-assembly-native-registration.js';
import {runNativeReconcile,validateNativeReconcileRequest} from '../lib/workflow-assembly-native.js';
export function createNativeAssemblyRouter({pool,services={}}){
  const router=Router();router.use(internalAuthOrLoopback);
  router.use((req,res,next)=>{
    if(req.headers['x-tenant-id']||req.body?.tenant_id||req.body?.tenantId)return res.status(422).json({error:'native_global_admin_scope_required'});
    next();
  });
  const run=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status(e.status??500).json({error:e.status?e.message:'native_maintenance_failed'});}};
  router.post('/register',run(async req=>{
    if(!req.body||Object.keys(req.body).some(k=>k!=='revision'))throw Object.assign(Error('native_registration_input_invalid'),{status:422});
    const revision=services.revision??deployedNativeRevision();
    if(req.body.revision&&req.body.revision!==revision)throw Object.assign(Error('native_deployment_revision_conflict'),{status:409});
    return registerNativeReconcile(pool,await prepareNativeSource({revision,readFile:services.readSource}));
  }));
  router.post('/runs',run(req=>runNativeReconcile(pool,{...validateNativeReconcileRequest(req.body),trigger:'manual'},services)));
  router.get('/runs/:runId',run(async req=>{
    const row=(await pool.query("SELECT * FROM runs WHERE run_id=$1 AND workflow_id=$2 AND detail->>'protocol'=$3",[req.params.runId,nativeSpec.id,nativeSpec.protocol])).rows[0];
    if(!row)throw Object.assign(Error('native_run_not_found'),{status:404});
    const spans=(await pool.query('SELECT * FROM spans WHERE run_id=$1 ORDER BY started_at',[row.run_id])).rows;
    return {run:row,spans};
  }));
  return router;
}
