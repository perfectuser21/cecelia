import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import WarRoomLineCommandPage from '../WarRoomLineCommandPage';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'journey-uuid-1234' }),
  useNavigate: () => vi.fn(),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('WarRoomLineCommandPage — 对话入口', () => {
  it('header 有"军师对话"按钮，点击后打开抽屉', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/warroom/line/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            line: { id: 'journey-uuid-1234', name: '测试Line', description: null, status: 'active', maturity: null },
            decisions: [],
            connections: { abilities: [], features: [], advancements: [], active_tasks: [], open_issues: [], recent_runs: [] },
            health: { run_total: 0, run_success: 0, success_rate: null, pr_count: 0, is_stopped: false },
            generated_at: '2026-07-24T00:00:00Z',
          }),
        });
      }
      if (url.includes('/api/brain/conversations')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ conversations: [], total: 0 }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }) as any;

    render(<WarRoomLineCommandPage />);
    await waitFor(() => expect(screen.getByText('测试Line')).toBeInTheDocument());

    expect(screen.queryByText('军师对话')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-chat-btn'));

    await waitFor(() => {
      expect(screen.getByText('军师对话')).toBeInTheDocument();
    });
  });
});
