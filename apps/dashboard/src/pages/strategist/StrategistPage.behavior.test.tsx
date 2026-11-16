import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StrategistPage from './StrategistPage';
import StrategistLinePage from './StrategistLinePage';

// 使用真实页面、React事件和路由；所有数据边界在本进程内。
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('军师台现役列表交互', () => {
  it('渲染业务线、过滤smoke线，点击进入线空间路由，刷新读取新结果', async () => {
    let refreshed = false;
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/brain/warroom/lines' ? { areas: [{
        areaKey: 'cecelia', areaName: '系统运行', lines: [
          { id: 'current-activity-line', name: refreshed ? '当前活动已刷新' : '当前活动工作流', status: 'active', step_total: 2, step_done: 1 },
          { id: 'smoke-line', name: '[smoke] fixture', status: 'active' },
        ],
      }] } : { total: 0 },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/strategist']}><Routes>
      <Route path="/strategist" element={<StrategistPage />} />
      <Route path="/strategist/:lineId" element={<div>线空间目标</div>} />
    </Routes></MemoryRouter>);
    await screen.findByText('当前活动工作流');
    expect(screen.queryByText('[smoke] fixture')).not.toBeInTheDocument();
    expect(screen.queryByText('议题对话')).not.toBeInTheDocument();
    refreshed = true;
    fireEvent.click(screen.getByTitle('刷新'));
    await screen.findByText('当前活动已刷新');
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/brain/warroom/lines')).toHaveLength(2));
    fireEvent.click(screen.getByText('当前活动已刷新'));
    await screen.findByText('线空间目标');
    expect(screen.queryByText('当前活动已刷新')).not.toBeInTheDocument();
  });
});

// API保留兼容路径名，页面消费的是现役Activity及其格子返回值。
it('线空间真实渲染活动矩阵，点击活动和格子可展开断言证据', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => {
    if (url.startsWith('/api/brain/warroom/line/')) return { line: { id: 'line-current', name: '现役线', status: 'active' }, tasks: [] };
    if (url.startsWith('/api/brain/journey_steps?')) return [{ id: 'activity-current', name: '核验活动', step_number: 1, status: 'done', promise: '结果真实可读回' }];
    if (url.startsWith('/api/brain/journey_step_links?')) return [{ id: 'cell-current', step_id: 'activity-current', cell_kind: 'element', cell_key: '效果确认', cell_status: 'green', assertion_ref: 'checks/current-result.test.js' }];
    throw new Error(`未允许的本地fixture请求 ${url}`);
  } })));
  render(<MemoryRouter initialEntries={['/strategist/line-current']}><Routes>
    <Route path="/strategist/:lineId" element={<StrategistLinePage />} />
  </Routes></MemoryRouter>);
  await screen.findByText('核验活动');
  expect(screen.queryByRole('button', { name: /议题对话/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('step-row'));
  const panel = await screen.findByTestId('step-ledger-panel');
  expect(panel).toHaveTextContent('承诺：结果真实可读回');
  fireEvent.click(screen.getByRole('button', { name: /效果确认.*已覆盖/ }));
  await screen.findByText('checks/current-result.test.js');
});
