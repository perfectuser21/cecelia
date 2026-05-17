import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import AutonomousSessionsPage from './AutonomousSessionsPage';

describe('AutonomousSessionsPage', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('空 sessions → 显示空态', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ sessions: [] }),
    });
    render(<AutonomousSessionsPage />);
    await waitFor(() => {
      expect(screen.getByText(/无活跃 session/)).toBeDefined();
    });
  });

  it('有 sessions → 显示卡片', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        sessions: [{
          branch: 'cp-test-abc',
          autonomous_mode: true,
          harness_mode: false,
          owner_session: 's1',
          started: '2026-04-14T10:00:00+08:00',
          steps: {
            step_0_worktree: 'done',
            step_1_spec: 'done',
            step_2_code: 'pending',
            step_3_integrate: 'pending',
            step_4_ship: 'pending',
          },
          task_card_path: '.task-cp-test-abc.md',
          worktree_path: '/tmp/wt',
          elapsed_seconds: 1234,
        }],
      }),
    });
    render(<AutonomousSessionsPage />);
    await waitFor(() => {
      expect(screen.getByText(/cp-test-abc/)).toBeDefined();
      expect(screen.getByText(/AUTO/)).toBeDefined();
    });
  });

  it('fetch 失败 → 显示 error', async () => {
    (global.fetch as any).mockRejectedValue(new Error('Network fail'));
    render(<AutonomousSessionsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Error/)).toBeDefined();
    });
  });
});
