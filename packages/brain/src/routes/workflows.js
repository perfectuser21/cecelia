/**
 * GET /api/brain/workflows — Workflow 只读清单（价值流建模③，决策 3e867cad / 752b7166，任务 ce41cd59）。
 * Workflow = 一个 Capability（有父的 journey）在某渠道/形态上的可执行链条；每行带能力名、所属价值流、挂在它上面的骨干活动数。
 * 过滤：?capability_id=<uuid> / ?value_stream_id=<uuid>（= 能力的父 journey）/ ?status=active|paused|retired。
 */
import { Router } from 'express';
import pool from '../db.js';
import { readDefinitionHistory } from '../lib/definition-history.js';
import { listWorkflows, readActivity, readActivityConsumers } from '../lib/workflow-read-service.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['active', 'paused', 'retired']);

router.get('/workflows', async (req, res) => {
  const { capability_id: capabilityId, value_stream_id: valueStreamId, status } = req.query;
  if (capabilityId !== undefined) {
    if (!UUID_RE.test(String(capabilityId))) return res.status(400).json({ error: 'capability_id 必须是 uuid' });
  }
  if (valueStreamId !== undefined) {
    if (!UUID_RE.test(String(valueStreamId))) return res.status(400).json({ error: 'value_stream_id 必须是 uuid' });
  }
  if (status !== undefined) {
    if (!STATUSES.has(String(status))) return res.status(400).json({ error: 'status 只支持 active|paused|retired' });
  }
  try {
    const rows = await listWorkflows(pool,{capabilityId,valueStreamId,status});
    return res.json({ workflows: rows, total: rows.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/workflows/:id', async (req,res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({error:'workflow id 必须是 uuid'});
  try {
    const workflow = (await listWorkflows(pool,{id:req.params.id}))[0];
    if (!workflow) return res.status(404).json({error:'工作流不存在'});
    return res.json({workflow});
  } catch(error) { return res.status(500).json({error:error.message}); }
});
router.get('/activities/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'activity id 必须是 uuid' });
  try {
    const activity = await readActivity(pool, req.params.id);
    if (!activity) return res.status(404).json({ error: '活动不存在' });
    return res.json({ activity });
  } catch (error) { return res.status(500).json({ error: error.message }); }
});
router.get('/activities/:id/consumers',async (req,res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({error:'activity id 必须是 uuid'});
  try {
    const consumers=await readActivityConsumers(pool,req.params.id);
    if (!consumers) return res.status(404).json({error:'活动不存在'});
    return res.json({consumers});
  }
  catch(error) { return res.status(500).json({error:error.message}); }
});
for(const [path,kind] of [['workflows','workflow'],['activities','activity']]) {
  router.get(`/${path}/:id/versions/:versionId?`,async(req,res)=>{
    if(!UUID_RE.test(req.params.id)||(req.params.versionId&&!UUID_RE.test(req.params.versionId))) return res.status(400).json({error:'定义和版本ID必须是uuid'});
    try {
      const value=await readDefinitionHistory(pool,{kind,id:req.params.id,versionId:req.params.versionId});
      if(value===undefined) return res.status(404).json({error:'定义或版本不存在'});
      return res.json(req.params.versionId?{version:value}:{versions:value});
    } catch(error) {return res.status(500).json({error:error.message});}
  });
}
export default router;
