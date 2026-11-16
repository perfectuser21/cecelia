import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EvolutionPage from '@features/core/cecelia/pages/EvolutionPage';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/summaries') ? [{ id: 1, component: 'brain', period_start: '2026-11-01', period_end: '2026-11-07', narrative: '已保存的历史叙事', pr_count: 1, key_milestones: ['已有里程碑'] }] : [{ id: 1, date: '2026-11-06', component: 'brain', pr_number: 42, title: '已合并的真实改动', significance: 3, summary: '原始演进事实', version: '1.0' }] })));
});
afterEach(() => vi.unstubAllGlobals());
it('保留演进事实与历史叙事读取，撤销无Task的即时合成入口', async () => {
  render(<EvolutionPage />);
  expect(await screen.findByText('已合并的真实改动')).toBeInTheDocument();
  expect(screen.getByText('已保存的历史叙事')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /触发合成|合成本周/ })).not.toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.every(([url, options]) => !String(url).includes('/synthesize') && !options?.method)).toBe(true);
});
it('按组件查询仍只刷新原始记录与历史叙事', async () => {
  render(<EvolutionPage />);
  await screen.findByText('原始演进事实');
  fireEvent.click(screen.getByRole('button', { name: '大脑' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/brain/evolution/records?component=brain&limit=100'));
  expect(fetch).toHaveBeenCalledWith('/api/brain/evolution/summaries?component=brain&limit=20');
});
