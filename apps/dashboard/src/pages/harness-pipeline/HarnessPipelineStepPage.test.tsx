import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'task-123', step: '1' }),
  useNavigate: () => mockNavigate,
}));

function mockFetch(data: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
}

const MOCK_STEP = {
  step_index: 1,
  node: 'proposer',
  skill_name: 'harness-contract-proposer',
  system_prompt: '你是 harness-contract-proposer agent。按下面 SKILL 指令工作。',
  skill_content: '# SKILL: harness-contract-proposer\n测试内容',
  input_content: '# Sprint PRD\n测试 PRD 内容',
  output_content: '# Contract Draft\n测试合同内容',
  db_context: {
    task_id: 'task-123',
    title: '测试 Sprint',
    description: '测试描述',
    journey_id: null,
    sprint_dir: 'sprints/test',
  },
  verdict: null,
  review_round: 1,
  timestamp: '2026-06-10T10:00:00Z',
};

const MOCK_DETAIL = {
  planner_task_id: 'task-123',
  title: '测试 Sprint',
  steps: [],
  langgraph: {
    enabled: true,
    steps: [MOCK_STEP],
    gan_rounds: [],
    fix_rounds: [],
  },
};

import HarnessPipelineStepPage from './HarnessPipelineStepPage';

describe('HarnessPipelineStepPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders five context section titles for a full LangGraph step', async () => {
    mockFetch(MOCK_DETAIL);
    render(<HarnessPipelineStepPage />);
    expect(await screen.findByText('System Prompt')).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('User Input')).toBeInTheDocument();
    expect(screen.getByText('DB Context')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
  });

  it('renders system prompt content', async () => {
    mockFetch(MOCK_DETAIL);
    render(<HarnessPipelineStepPage />);
    expect(await screen.findByText(/你是 harness-contract-proposer agent/)).toBeInTheDocument();
  });

  it('does not render optional sections when content is null', async () => {
    const emptyStep = {
      ...MOCK_DETAIL,
      langgraph: {
        ...MOCK_DETAIL.langgraph,
        steps: [{
          ...MOCK_STEP,
          input_content: null,
          output_content: null,
          db_context: null,
        }],
      },
    };
    mockFetch(emptyStep);
    render(<HarnessPipelineStepPage />);
    await screen.findByText('System Prompt');
    expect(screen.queryByText('User Input')).not.toBeInTheDocument();
    expect(screen.queryByText('DB Context')).not.toBeInTheDocument();
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
  });
});
