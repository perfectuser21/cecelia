import { Router } from 'express';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { configureDirectoryProjection } from '../projection/directory-config.js';
import { DIRECTORY_TARGET } from '../projection/directory-projector.js';
import { runDirectoryJob } from '../projection/directory-job.js';

export function createDirectoryProjectionRouter({ pool, services = {} }) {
  const router = Router(); router.use(internalAuthOrLoopback);
  const configure = services.configure || configureDirectoryProjection;
  const run = services.run || runDirectoryJob;
  router.get('/status', async (_req,res) => {
    try { res.json((await pool.query('SELECT enabled,config,last_success_at,last_error FROM projection_targets WHERE target=$1',[DIRECTORY_TARGET])).rows[0] || { enabled:false }); }
    catch { res.status(500).json({error:'目录状态读取失败'}); }
  });
  for (const path of ['/configure','/bootstrap']) router.post(path, async (req,res) => {
    try { res.json(await configure(pool,req.body)); }
    catch(error) { res.status(400).json({error:error.message}); }
  });
  const emptyBody = req => req.body && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length);
  router.post('/run',async(req,res)=>{
    if(emptyBody(req))return res.status(400).json({error:'目录运行不接受外部参数'});
    try { res.json(await run(pool,{force:true})); }
    catch(error) { res.status(503).json({error:error.message}); }
  });
  router.post('/areas/import',async(req,res)=>{
    if(emptyBody(req))return res.status(400).json({error:'组织导入仅使用正式已登记配置'});
    try {
      const target=(await pool.query('SELECT enabled,config FROM projection_targets WHERE target=$1',[DIRECTORY_TARGET])).rows[0];
      if(!target?.enabled)return res.status(409).json({error:'目录尚未配置'});
      const {syncDirectoryAreas}=await import('../projection/directory-areas.js');
      const {getToken,notionReq}=await import('../recurring-notion-sync.js');
      res.json(await syncDirectoryAreas(pool,{token:getToken(),dbId:target.config.dbs.areas,notionReq,
        bindings:target.config.area_bindings || [],actor:'directory-authorized-api'}));
    } catch(error) { res.status(503).json({error:error.message}); }
  });
  return router;
}
