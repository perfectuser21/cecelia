import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock axios before import chain resolves
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(),
      post: vi.fn(),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    })),
  },
}));

vi.mock('../api/harness-pipeline.api', () => ({
  getHarnessPipelines: vi.fn(),
}));

import HarnessPipelinePage from './HarnessPipelinePage';
import * as api from '../api/harness-pipeline.api';

const mockPipeline = {
  sprint_dir: 'sprints/sprint-1',
  title: '测试 Pipeline',
  sprint_goal: '验证功能',
  verdict: 'passed' as const,
  current_step: null,
  elapsed_ms: 120000,
  created_at: '2026-04-11T00:00:00Z',
  stages: [
    { task_type: 'harness_planner', label: 'Planner', status: 'completed' },
    { task_type: 'harness_contract_propose', label: 'Propose', status: 'completed' },
    { task_type: 'harness_contract_review', label: 'Review', status: 'completed' },
    { task_type: 'harness_generate', label: 'Generate', status: 'completed' },
    { task_type: 'harness_ci_watch', label: 'CI Watch', status: 'completed' },
    { task_type: 'harness_report', label: 'Report', status: 'completed' },
  ],
};

describe('HarnessPipelinePage', () => {
  beforeEach(() => {
    vi.mocked(api.getHarnessPipelines).mockResolvedValue({
      pipelines: [mockPipeline],
      total: 1,
    });
  });

  it('renders page title', async () => {
    render(<HarnessPipelinePage />);
    expect(screen.getByText('Harness Pipeline')).toBeTruthy();
  });

  it('shows pipeline after loading', async () => {
    render(<HarnessPipelinePage />);
    const title = await screen.findByText('测试 Pipeline');
    expect(title).toBeTruthy();
  });

  it('shows empty state when no pipelines', async () => {
    vi.mocked(api.getHarnessPipelines).mockResolvedValue({ pipelines: [], total: 0 });
    render(<HarnessPipelinePage />);
    const msg = await screen.findByText('暂无 Harness Pipeline 记录');
    expect(msg).toBeTruthy();
  });
});
