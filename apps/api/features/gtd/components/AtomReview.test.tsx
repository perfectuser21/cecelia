import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AtomReview from './AtomReview';

const mockAtoms = [
  {
    id: 'atom-1',
    capture_id: 'cap-1',
    content: '学习 React Testing Library',
    target_type: 'knowledge',
    target_subtype: 'tech',
    suggested_area_id: null,
    status: 'pending_review',
    confidence: 0.85,
    ai_reason: 'AI 分类为知识类型',
    created_at: new Date().toISOString(),
  },
  {
    id: 'atom-2',
    capture_id: 'cap-2',
    content: '完成季度报告',
    target_type: 'task',
    target_subtype: null,
    suggested_area_id: null,
    status: 'pending_review',
    confidence: 0.72,
    ai_reason: null,
    created_at: new Date().toISOString(),
  },
];

function mockFetchSuccess(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

describe('AtomReview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when no atoms', async () => {
    global.fetch = mockFetchSuccess([]);
    render(<AtomReview />);
    await waitFor(() => {
      expect(screen.getByText('暂无待审阅的 Atom')).toBeInTheDocument();
    });
  });

  it('renders atom cards with content', async () => {
    global.fetch = mockFetchSuccess(mockAtoms);
    render(<AtomReview />);
    await waitFor(() => {
      expect(screen.getByText('学习 React Testing Library')).toBeInTheDocument();
      expect(screen.getByText('完成季度报告')).toBeInTheDocument();
    });
  });

  it('displays target type badges', async () => {
    global.fetch = mockFetchSuccess(mockAtoms);
    render(<AtomReview />);
    await waitFor(() => {
      expect(screen.getByText('知识')).toBeInTheDocument();
      expect(screen.getByText('任务')).toBeInTheDocument();
    });
  });

  it('displays confidence percentage', async () => {
    global.fetch = mockFetchSuccess(mockAtoms);
    render(<AtomReview />);
    await waitFor(() => {
      expect(screen.getByText('85%')).toBeInTheDocument();
      expect(screen.getByText('72%')).toBeInTheDocument();
    });
  });

  it('displays ai_reason when present', async () => {
    global.fetch = mockFetchSuccess(mockAtoms);
    render(<AtomReview />);
    await waitFor(() => {
      expect(screen.getByText('AI 分类为知识类型')).toBeInTheDocument();
    });
  });

  it('renders filter buttons for all target types', async () => {
    global.fetch = mockFetchSuccess([]);
    render(<AtomReview />);
    await waitFor(() => {
      expect(screen.getByText('全部')).toBeInTheDocument();
      expect(screen.getByText('笔记')).toBeInTheDocument();
      expect(screen.getByText('知识')).toBeInTheDocument();
      expect(screen.getByText('内容')).toBeInTheDocument();
      expect(screen.getByText('任务')).toBeInTheDocument();
      expect(screen.getByText('决策')).toBeInTheDocument();
      expect(screen.getByText('事件')).toBeInTheDocument();
    });
  });

  it('fetches with filter when type button clicked', async () => {
    const fetchMock = mockFetchSuccess([]);
    global.fetch = fetchMock;
    render(<AtomReview />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/capture-atoms?status=pending_review');
    });

    fireEvent.click(screen.getByText('任务'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/capture-atoms?status=pending_review&target_type=task'
      );
    });
  });

  it('calls onCountChange with atom count', async () => {
    global.fetch = mockFetchSuccess(mockAtoms);
    const onCountChange = vi.fn();
    render(<AtomReview onCountChange={onCountChange} />);
    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(2);
    });
  });

  it('sends PATCH on confirm action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockAtoms) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });
    global.fetch = fetchMock;

    render(<AtomReview />);
    await waitFor(() => {
      expect(screen.getByText('学习 React Testing Library')).toBeInTheDocument();
    });

    const confirmButtons = screen.getAllByTitle('确认');
    fireEvent.click(confirmButtons[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/capture-atoms/atom-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      });
    });
  });

  it('sends PATCH on dismiss action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockAtoms) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });
    global.fetch = fetchMock;

    render(<AtomReview />);
    await waitFor(() => {
      expect(screen.getByText('学习 React Testing Library')).toBeInTheDocument();
    });

    const dismissButtons = screen.getAllByTitle('驳回');
    fireEvent.click(dismissButtons[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/capture-atoms/atom-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });
    });
  });

  it('handles fetch error gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    render(<AtomReview />);
    await waitFor(() => {
      expect(screen.getByText('暂无待审阅的 Atom')).toBeInTheDocument();
    });
  });
});
