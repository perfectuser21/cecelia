import { describe, expect, it, vi } from 'vitest';
import { dispatchNotionLeadgen } from '../notion-leadgen-dispatch.js';

const pageId = '3bf10100-1bcb-4572-b187-09b864390021';
const workflowId = 'b1000000-0000-4000-8000-000000000101';
const firstRelease = '61a9990e-d7ca-4c67-8a5e-f552879418fc';
const defaultBody = '公司：悦升\n关键词：AI办公\n候选上限：1';

function fixture() {
  const createTask = vi.fn(async () => ({ task: { id: '44444444-4444-4444-8444-444444444444' } }));
  const bindings = { 悦升: { tenant_id: 'tenant-yuesheng', workflow_id: workflowId, release_id: firstRelease, binding_key: 'yuesheng_cloud' } };
  return { createTask, bindings };
}

describe('Notion 101 fixed workflow dispatch', () => {
  it('uses protected release and tenant binding, and binds the same page for idempotency and writeback', async () => {
    const { createTask, bindings } = fixture();
    const response = await dispatchNotionLeadgen({}, {
      stage: '101', pageId, title: '悦升 101', body: defaultBody, tenantId: 'tenant-yuesheng', bindings,
    }, { createTask });
    expect(response.taskId).toBe('44444444-4444-4444-8444-444444444444');
    expect(createTask).toHaveBeenCalledWith({}, {
      title: '悦升 101', workflow_id: workflowId, release_id: firstRelease,
      input: { binding_key: 'yuesheng_cloud', business: { keyword: 'AI办公', max_candidates: 1 } },
      idempotency_key: 'notion-101:' + pageId,
    }, { notionPageId: pageId, notionTenantId: 'tenant-yuesheng' });
  });

  it.each([
    ['缺少公司审批', { tenantId: 'another-tenant' }, 'notion_leadgen_binding_unavailable'],
    ['缺少活动配置', { bindings: {} }, 'notion_leadgen_binding_unavailable'],
    ['禁止额外字段', { body: defaultBody + '\n设备：other' }, 'notion_leadgen_input_invalid'],
    ['禁止越界', { body: defaultBody.replace('1', '2') }, 'notion_leadgen_input_invalid'],
    ['禁止重复公司', { body: defaultBody + '\n公司：其他公司' }, 'notion_leadgen_input_invalid'],
  ])('%s 时不创建任务', async (_, options, error) => {
    const { createTask, bindings } = fixture();
    await expect(dispatchNotionLeadgen({}, {
      stage: '101', pageId, title: '悦升 101', body: defaultBody, tenantId: 'tenant-yuesheng', bindings, ...options,
    }, { createTask })).rejects.toThrow(error);
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe('Notion 102–104 independent dispatch', () => {
  it.each([
    ['102', '来源运行：comments-source-1', 'douyin_video_processing', { source_run: 'comments-source-1' }],
    ['103', '来源运行：comments-source-2', 'douyin_comment_scoring', { source_run: 'comments-source-2' }],
    ['104', '原订单：recTestOrder123', 'douyin_lead_outreach', { order_id: 'recTestOrder123' }],
  ])('binds %s to its own workflow and the original task page', async (stage, body, workflowKey, business) => {
    const { createTask, bindings } = fixture();
    const response = await dispatchNotionLeadgen({}, {
      stage, pageId, title: `悦升 ${stage}`, body: `公司：悦升\n${body}`, tenantId: 'tenant-yuesheng', bindings,
    }, { createTask });
    expect(response.taskId).toBe('44444444-4444-4444-8444-444444444444');
    expect(createTask).toHaveBeenCalledWith({}, {
      title: `悦升 ${stage}`, workflow_id: workflowId, release_id: firstRelease,
      input: { binding_key: 'yuesheng_cloud', business }, idempotency_key: `notion-${stage}:${pageId}`,
    }, { notionPageId: pageId, notionTenantId: 'tenant-yuesheng', notionWorkflowKey: workflowKey });
  });

  it('rejects multiple orders and never dispatches across tenants', async () => {
    const { createTask, bindings } = fixture();
    const options = { stage: '104', pageId, title: '悦升 104', tenantId: 'tenant-yuesheng', bindings };
    await expect(dispatchNotionLeadgen({}, { ...options, body: '公司：悦升\n原订单：recA, recB' }, { createTask }))
      .rejects.toThrow('notion_leadgen_input_invalid');
    await expect(dispatchNotionLeadgen({}, { ...options, body: '公司：悦升\n原订单：recA', tenantId: 'other' }, { createTask }))
      .rejects.toThrow('notion_leadgen_binding_unavailable');
    expect(createTask).not.toHaveBeenCalled();
  });
});
