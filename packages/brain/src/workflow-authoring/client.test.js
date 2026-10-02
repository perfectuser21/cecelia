import { describe, it, expect, vi } from 'vitest';
import { createAuthoringClient } from '../../../workflows/skills/workflow-authoring/scripts/client.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
describe('OpenClaw 工作流管理调用器', () => {
  it('已有任务重用身份，认领后才初始化', async () => {
    const calls = [];
    const fetch = async (url, options) => {
      const path = new URL(url).pathname, body = options.body && JSON.parse(options.body);
      calls.push([path, options.method, body]);
      let result = {};
      if (path.endsWith('/tasks') && options.method === 'POST') result = { id:ID, status:'queued', payload:{workflow_authoring:true} };
      if (path.endsWith(`/tasks/${ID}`) && options.method === 'GET') result = { id:ID,status:'queued',payload:{workflow_authoring:true} };
      if (path.endsWith('/init')) result = { stage:'intake',revision:0 };
      return { ok:true,json:async()=>result };
    };
    const c = createAuthoringClient({ fetch, base:'http://localhost:5221/api/brain' });
    const result = await c.start({ request_key:'session-one',operation:'create',goal:'创建分析流程',actor:'openclaw' });
    expect(result.task_id).toBe(ID);
    expect(calls.map(x=>x[0])).toEqual(['/api/brain/tasks',`/api/brain/tasks/${ID}`,`/api/brain/tasks/${ID}/claim`,`/api/brain/tasks/${ID}`,`/api/brain/workflow-authoring/runs/${ID}/init`]);
    expect(calls[0][2].source_id).toBe('workflow-authoring:session-one');
  });
  it('未注册完成不能收尾任务', async () => {
    const fetch = vi.fn(async () => ({ok:true,json:async()=>({stage:'verify'})}));
    const c = createAuthoringClient({fetch});
    await expect(c.finish(ID)).rejects.toThrow('登记');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('服务器拒绝时不推进或伪造回执', async () => {
    const fetch = vi.fn(async () => ({ok:false,status:409,json:async()=>({message:'版本冲突'})}));
    const c = createAuthoringClient({fetch});
    await expect(c.status(ID)).rejects.toThrow('版本冲突');
  });
});
