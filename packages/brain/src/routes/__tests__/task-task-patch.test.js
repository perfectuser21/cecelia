vi.mock('../../lib/task-completion-pr.js',()=>({verifyTaskCompletionPr:async task=>{if(task.pr_url&&!task.pr_merged_at)throw Object.assign(Error('PR_NOT_MERGED'),{code:'PR_NOT_MERGED',pr_url:task.pr_url});return null;}}));
import { describe, expect, it, vi } from 'vitest';
import { registerTaskPatchRoute } from '../task-task-patch.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function captureHandler(pool) {
  let handler;
  const router = {
    patch: vi.fn((path, ...handlers) => {
      expect(path).toBe('/:id');
      handler = handlers.at(-1);
    }),
  };
  registerTaskPatchRoute(router, {
    pool,
    terminalStatuses: ['completed', 'failed', 'cancelled'],
  });
  return handler;
}

describe('registerTaskPatchRoute', () => {
  it('未完成硬依赖时拒绝 blocked → queued', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          status: 'blocked',
          task_type: 'dev',
          orchestrator: null,
          has_pending_hard_dependencies: true,
        }],
      }),
    };
    const handler = captureHandler(pool);
    const response = createResponse();

    await handler({
      params: { id: 'source-task-1' },
      body: { status: 'queued' },
      headers: {},
    }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: 'harness_gap_dependencies_unresolved' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('空 PATCH 请求返回 400 且不写 tasks', async () => {
    const pool = { query: vi.fn() };
    const handler = captureHandler(pool);
    const response = createResponse();

    await handler({ params: { id: 'task-1' }, body: {}, headers: {} }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'No fields to update' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});


describe('dev字段更新入口的完成门', () => {
  it.each([
    [{review_required_raw:'true',review_status:'rejected'},'REVIEW_NOT_APPROVED'],
    [{review_required_raw:'true',review_status:'pending'},'REVIEW_NOT_APPROVED'],
    [{review_required_raw:'true',review_status:'approved',pr_url:'https://github.com/owned/repo/pull/1',pr_merged_at:null},'PR_NOT_MERGED'],
  ])('未满足%s时不写终态', async (fields, code) => {
    const pool={query:vi.fn().mockResolvedValue({rows:[{id:'owned-task',status:'in_progress',task_type:'dev',...fields}]})};
    const handler=captureHandler(pool),res=createResponse();
    await handler({params:{id:'owned-task'},body:{status:'completed'},headers:{}},res);
    expect(res.statusCode).toBe(422); expect(res.body.code).toBe(code); expect(pool.query).toHaveBeenCalledTimes(1);
  });
});


describe('通用Gap依赖仍阻止未验真任务接棒',()=>{
  it.each(['queued','in_progress','completed'])('未解决Gap拒绝blocked→%s',async status=>{
    const pool={query:vi.fn().mockResolvedValue({rows:[{status:'blocked',task_type:'dev',claimed_by:'owner',has_unresolved_harness_gaps:true,has_pending_hard_dependencies:false}]})};
    const res=createResponse();await captureHandler(pool)({params:{id:'owned-gap'},body:{status},headers:{}},res);
    expect(res.statusCode).toBe(409);expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
