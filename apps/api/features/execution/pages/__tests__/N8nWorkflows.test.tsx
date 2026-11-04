import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import N8nWorkflows from '../N8nWorkflows';
vi.mock('../../api/n8n-workflows.api', () => ({ n8nWorkflowsApi: {
  getInstancesStatus: async () => ({ local: { available: true }, cloud: { available: false } }),
  getOverviewByInstance: async () => ({ workflows: { totalWorkflows: 1, activeWorkflows: 1, inactiveWorkflows: 0,
    workflows: [{ id: 'wf1', name: 'actual workflow', active: true, runStats: null }] },
    recentExecutions: { executions: [], total: 0, success: 0, error: 0, running: 0, successRate: 0 } }),
} }));
afterEach(cleanup);
it('未采集的工作流统计显示未知，不显示暂无记录或运行中0', async () => {
  render(<MemoryRouter><N8nWorkflows /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '全部展开' }));
  expect(await screen.findByText('运行统计未采集')).toBeInTheDocument();
  expect(within(screen.getByTestId('workflow-wf1')).queryByText('暂无执行记录')).not.toBeInTheDocument();
  expect(screen.getByTestId('workflow-running-count')).toHaveTextContent('—');
});
