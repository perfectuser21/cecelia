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

  it('新议题创建失败显示中文错误提示', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (method === 'POST' && url === '/api/brain/conversations') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) as any;
      }
      if (url.includes('/api/brain/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ conversations: [], total: 0 }),
        }) as any;
      }
      throw new Error(`no mock for ${method} ${url}`);
    }) as any;

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/暂无议题/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('new-conversation-btn'));

    await waitFor(() => {
      expect(screen.getByText('创建议题失败')).toBeInTheDocument();
    });
  });
});

describe('ConversationDrawer — 对话区', () => {
  it('点击议题→拉取消息并按 role 渲染', async () => {
    mockFetchSequence({
      'GET /api/brain/conversations': () => ({
        conversations: [{ id: 'conv-1', title: '测试议题', status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:00:00Z', turn_count: 2 }],
        total: 1,
      }),
      'GET /api/brain/conversations/conv-1/messages': () => ({
        messages: [
          { id: 'm1', conversation_id: 'conv-1', role: 'user', content: '为什么昨晚部署失败了', turn_marker: null, created_at: '2026-07-24T00:00:00Z' },
          { id: 'm2', conversation_id: 'conv-1', role: 'assistant', content: '查了 dev-records，是 CI 超时', turn_marker: 'chat', created_at: '2026-07-24T00:00:05Z' },
        ],
        has_more: false,
      }),
    });

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('测试议题')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conversation-item-conv-1'));

    await waitFor(() => {
      expect(screen.getByText('为什么昨晚部署失败了')).toBeInTheDocument();
    });
    expect(screen.getByText('查了 dev-records，是 CI 超时')).toBeInTheDocument();
  });

  it('发送消息→POST后重拉消息列表→新消息出现', async () => {
    let sent = false;
    mockFetchSequence({
      'GET /api/brain/conversations': () => ({
        conversations: [{ id: 'conv-1', title: '测试议题', status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:00:00Z', turn_count: 0 }],
        total: 1,
      }),
      'GET /api/brain/conversations/conv-1/messages': () => ({
        messages: sent
          ? [
              { id: 'm1', conversation_id: 'conv-1', role: 'user', content: '现在几点了', turn_marker: null, created_at: '2026-07-24T00:01:00Z' },
              { id: 'm2', conversation_id: 'conv-1', role: 'assistant', content: '查了系统时间，现在下午3点', turn_marker: 'chat', created_at: '2026-07-24T00:01:03Z' },
            ]
          : [],
        has_more: false,
      }),
      'POST /api/brain/conversations/conv-1/messages': () => {
        sent = true;
        return { id: 'm1', conversation_id: 'conv-1', role: 'user', content: '现在几点了', turn_marker: null, created_at: '2026-07-24T00:01:00Z' };
      },
    });

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('测试议题')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conversation-item-conv-1'));
    await waitFor(() => expect(screen.getByText(/还没有消息/)).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('message-input'), { target: { value: '现在几点了' } });
    fireEvent.click(screen.getByTestId('message-send-btn'));

    await waitFor(() => {
      expect(screen.getByText('查了系统时间，现在下午3点')).toBeInTheDocument();
    });
    expect((screen.getByTestId('message-input') as HTMLInputElement).value).toBe('');
  });

  it('发送失败→显示错误且不清空输入框', async () => {
    mockFetchSequence({
      'GET /api/brain/conversations': () => ({
        conversations: [{ id: 'conv-1', title: '测试议题', status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:00:00Z', turn_count: 0 }],
        total: 1,
      }),
      'GET /api/brain/conversations/conv-1/messages': () => ({ messages: [], has_more: false }),
    });
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (method === 'POST') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: '服务异常' }) });
      }
      if (url.includes('/messages')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ messages: [], has_more: false }) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ conversations: [{ id: 'conv-1', title: '测试议题', status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:00:00Z', turn_count: 0 }], total: 1 }),
      });
    }) as any;

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('测试议题')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conversation-item-conv-1'));
    await waitFor(() => expect(screen.getByText(/还没有消息/)).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('message-input'), { target: { value: '测试内容' } });
    fireEvent.click(screen.getByTestId('message-send-btn'));

    await waitFor(() => expect(screen.getByText('发送失败')).toBeInTheDocument());
    expect((screen.getByTestId('message-input') as HTMLInputElement).value).toBe('测试内容');
  });

  it('点返回按钮回到议题列表', async () => {
    mockFetchSequence({
      'GET /api/brain/conversations': () => ({
        conversations: [{ id: 'conv-1', title: '测试议题', status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:00:00Z', turn_count: 0 }],
        total: 1,
      }),
      'GET /api/brain/conversations/conv-1/messages': () => ({ messages: [], has_more: false }),
    });

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('测试议题')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conversation-item-conv-1'));
    await waitFor(() => expect(screen.getByTestId('thread-back-btn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('thread-back-btn'));
    await waitFor(() => expect(screen.getByTestId('new-conversation-btn')).toBeInTheDocument());
  });

  it('消息加载失败→显示中文兜底文案"加载消息失败"', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url.includes('/api/brain/conversations/conv-1/messages')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) as any;
      }
      if (url.includes('/api/brain/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ conversations: [{ id: 'conv-1', title: '测试议题', status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:00:00Z', turn_count: 0 }], total: 1 }),
        }) as any;
      }
      throw new Error(`no mock for ${method} ${url}`);
    }) as any;

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('测试议题')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conversation-item-conv-1'));

    await waitFor(() => {
      expect(screen.getByText('加载消息失败')).toBeInTheDocument();
    });
  });

  it('消息拉取404→提示"议题已归档或不存在"并自动回到议题列表', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url.includes('/api/brain/conversations/conv-1/messages')) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) }) as any;
      }
      if (url.includes('/api/brain/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ conversations: [{ id: 'conv-1', title: '测试议题', status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:00:00Z', turn_count: 0 }], total: 1 }),
        }) as any;
      }
      throw new Error(`no mock for ${method} ${url}`);
    }) as any;

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('测试议题')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conversation-item-conv-1'));

    await waitFor(() => {
      expect(screen.getByTestId('new-conversation-btn')).toBeInTheDocument();
    });
    expect(screen.getByText('议题已归档或不存在')).toBeInTheDocument();
  });

  it('消息发送失败无error字段→显示中文兜底文案"发送失败"', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/messages')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) as any;
      }
      if (url.includes('/messages')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ messages: [], has_more: false }) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ conversations: [{ id: 'conv-1', title: '测试议题', status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:00:00Z', turn_count: 0 }], total: 1 }),
      });
    }) as any;

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('测试议题')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conversation-item-conv-1'));
    await waitFor(() => expect(screen.getByText(/还没有消息/)).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('message-input'), { target: { value: '测试消息' } });
    fireEvent.click(screen.getByTestId('message-send-btn'));

    await waitFor(() => {
      expect(screen.getByText('发送失败')).toBeInTheDocument();
    });
    expect((screen.getByTestId('message-input') as HTMLInputElement).value).toBe('测试消息');
  });
});

describe('ConversationDrawer — 轮询生命周期', () => {
  it('打开对话区后每5秒自动重拉消息', async () => {
    vi.useFakeTimers();
    let pollCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/messages')) {
        pollCount += 1;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ messages: [], has_more: false }) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ conversations: [{ id: 'conv-1', title: '测试议题', status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:00:00Z', turn_count: 0 }], total: 1 }),
      });
    }) as any;

    render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);
    await vi.waitFor(() => expect(screen.getByText('测试议题')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conversation-item-conv-1'));
    await vi.waitFor(() => expect(pollCount).toBeGreaterThanOrEqual(1));

    const before = pollCount;
    await vi.advanceTimersByTimeAsync(5100);
    expect(pollCount).toBeGreaterThan(before);

    vi.useRealTimers();
  });

  it('关闭抽屉后停止轮询', async () => {
    vi.useFakeTimers();
    let pollCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/messages')) {
        pollCount += 1;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ messages: [], has_more: false }) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ conversations: [{ id: 'conv-1', title: '测试议题', status: 'active', last_message: null, last_message_at: null, updated_at: '2026-07-24T00:00:00Z', turn_count: 0 }], total: 1 }),
      });
    }) as any;

    const { rerender } = render(<ConversationDrawer journeyId={JOURNEY_ID} open={true} onClose={() => {}} />);
    await vi.waitFor(() => expect(screen.getByText('测试议题')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conversation-item-conv-1'));
    await vi.waitFor(() => expect(pollCount).toBeGreaterThanOrEqual(1));

    rerender(<ConversationDrawer journeyId={JOURNEY_ID} open={false} onClose={() => {}} />);
    const afterClose = pollCount;
    await vi.advanceTimersByTimeAsync(11000);
    expect(pollCount).toBe(afterClose);

    vi.useRealTimers();
  });
});
