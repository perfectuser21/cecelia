import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ConversationDrawer from '../ConversationDrawer';

const JOURNEY_ID = 'journey-uuid-1234';

function mockFetchSequence(handlers: Record<string, (opts?: any) => any>) {
  global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
    const method = (opts?.method || 'GET').toUpperCase();
    const key = `${method} ${url.split('?')[0]}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`no mock for ${key}`);
    const body = handler(opts);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
    });
  }) as any;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ConversationDrawer — 关闭态', () => {
  it('open=false 时不渲染任何内容', () => {
    render(<ConversationDrawer journeyId={JOURNEY_ID} open={false} onClose={() => {}} />);
    expect(screen.queryByText('军师对话')).not.toBeInTheDocument();
  });
});

describe('ConversationDrawer — 议题列表', () => {
  it('打开后拉取并渲染议题列表', async () => {
    mockFetchSequence({
      'GET /api/brain/conversations': () => ({
        conversations: [
          {
            id: 'conv-1',
            title: '为什么昨晚部署失败',
            status: 'active',
            last_message: '正在查 dev-records…',
            last_message_at: '2026-07-24T00:00:00Z',
            updated_at: '2026-07-24T00:05:00Z',
            turn_count: 3,
          },
        ],
        total: 1,
      }),
    });

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('为什么昨晚部署失败')).toBeInTheDocument();
    });
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('正在查 dev-records…')).toBeInTheDocument();
  });

  it('空列表显示引导语', async () => {
    mockFetchSequence({
      'GET /api/brain/conversations': () => ({ conversations: [], total: 0 }),
    });

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/暂无议题/)).toBeInTheDocument();
    });
  });

  it('列表加载失败显示错误提示', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as any;

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('加载议题列表失败')).toBeInTheDocument();
    });
  });

  it('点"新议题"→POST创建→列表刷新', async () => {
    let created = false;
    mockFetchSequence({
      'GET /api/brain/conversations': () => ({
        conversations: created
          ? [{ id: 'conv-new', title: null, status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:10:00Z', turn_count: 0 }]
          : [],
        total: created ? 1 : 0,
      }),
      'POST /api/brain/conversations': () => {
        created = true;
        return { id: 'conv-new', journey_id: JOURNEY_ID, status: 'active' };
      },
    });

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/暂无议题/)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('new-conversation-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('thread-back-btn')).toBeInTheDocument();
    });
  });

  it('点击抽屉右上角关闭按钮触发 onClose', async () => {
    mockFetchSequence({
      'GET /api/brain/conversations': () => ({ conversations: [], total: 0 }),
    });
    const onClose = vi.fn();
    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText(/暂无议题/)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('drawer-close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
