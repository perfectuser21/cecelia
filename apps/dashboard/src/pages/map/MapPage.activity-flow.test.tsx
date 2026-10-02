import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ActivityDetail from '@features/core/planning/pages/capability-system/ActivityDetail';
import type { Registry, Selection } from '@features/core/planning/pages/capability-system/model';

const activity = { id: '7d312fd8-10b0-4f23-99ec-535a6e782326', name: '共享采集', consumers: [] };
const registry = { workflows: [], steps: [], gaps: [] } as unknown as Registry;
const metrics = [
  { activity_id: activity.id, workflow_id: 'kw', workflow_name: '关键词流程', p50_duration_ms: 0, first_pass_yield: 0, pass_rate: 0, span_count: 0 },
  { activity_id: activity.id, workflow_id: 'bm', workflow_name: '对标流程', p50_duration_ms: 2000, first_pass_yield: 1, pass_rate: null, span_count: 4 },
];
beforeEach(() => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [{ id: activity.id, flow_metrics: metrics }] } as Response);
});
it('规范活动详情按实际UUID读取并分别显示两个流程，不平均分位数或丢失零值', async () => {
  render(<ActivityDetail selection={{ activity }} registry={registry} />);
  expect(await screen.findByText('0秒')).toBeInTheDocument();
  expect(screen.getByText('2秒')).toBeInTheDocument();
  expect(screen.getAllByText('0%')).toHaveLength(2);
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(`/api/brain/journey_steps?activity_id=${activity.id}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
it('具体使用位置仅显示所属流程的活动指标，不继承其它流程', async () => {
  const selection = { activity, usage: { workflow_id: 'bm', reference_id: 'ref-bm', slot_key: 'collect', sequence_no: 1 } } as Selection;
  render(<ActivityDetail selection={selection} registry={registry} />);
  expect(await screen.findByText('2秒')).toBeInTheDocument();
  expect(screen.queryByText('0秒')).not.toBeInTheDocument();
});
it('指标读取失败保留活动详情并显示真实错误，不伪装暂无数据', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { message: '指标证据不可用' } }) } as Response);
  render(<ActivityDetail selection={{ activity }} registry={registry} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('指标证据不可用');
  expect(screen.getByRole('heading', { name: '共享采集' })).toBeInTheDocument();
  expect(screen.queryByText('暂无活动执行数据')).not.toBeInTheDocument();
});
it('未归属使用位置不继承未挂工作流指标，错活动响应也不冒本活动事实', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [
    { id: activity.id, flow_metrics: [{ ...metrics[0], workflow_id: null, p50_duration_ms: 5000 }] },
    { id: 'other-activity', flow_metrics: [metrics[1]] },
  ] } as Response);
  const selection = { activity, usage: { reference_id: 'unbound', slot_key: 'collect', sequence_no: 1 } } as Selection;
  render(<ActivityDetail selection={selection} registry={registry} />);
  expect(await screen.findByText('暂无活动执行数据')).toBeInTheDocument();
  expect(screen.queryByText('5秒')).not.toBeInTheDocument();
  expect(screen.queryByText('2秒')).not.toBeInTheDocument();
});
