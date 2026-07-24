# WarRoomLineCommandPage 军师对话抽屉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `WarRoomLineCommandPage`（`/warroom/line/:id`）加一个右侧滑出的"军师对话"抽屉：议题列表 + 对话区，消费已合并的 conversations API（PR1 #4244 / PR2 #4253），不改后端。

**Architecture:** 新增单文件 `ConversationDrawer.tsx`（内部含 `ConversationList` / `ConversationThread` / `MessageBubble` 子组件，沿用本 repo `WarRoomLineCommandPage.tsx` 一个文件多个小组件的既有模式），`WarRoomLineCommandPage.tsx` 只加一个 header 按钮 + 挂载点。抽屉用 `fixed` 定位覆盖层，不改变现有三栏渲染逻辑。

**Tech Stack:** React 18 + TypeScript + Tailwind（暗色 slate 主题，沿用现有 `text-[Npx]` / `bg-slate-800/N0` 惯例）+ lucide-react 图标 + vitest + @testing-library/react（`happy-dom` 环境，`globals: true`）。

## Global Constraints

- 所有输出/注释/UI 文案简体中文
- 不改动 `packages/brain/src/routes/conversations.js` / `conversation-agent.js`（PR1/PR2 已合并，本次纯前端消费）
- 不引入 SSE / WebSocket，轮询间隔固定 5000ms
- 组件内部子组件（List/Thread）不导出，只通过默认导出的 `ConversationDrawer` 测试（黑盒），与本目录 `WarRoomPage.test.ts` 的测试粒度一致
- 交互元素统一加 `data-testid`（现有 `AbilityProgress.test.tsx` 已用此模式做断言锚点）
- TDD：每个 Task 先写失败测试、跑一次确认失败、再写最小实现、跑通、再提交
- fetch mock 用 `global.fetch = vi.fn().mockImplementation((url, opts) => ...)` 按 URL/method 分派，不用真实网络

---

### Task 1: ConversationDrawer 骨架 + 议题列表（List 模式）

**Files:**
- Create: `apps/dashboard/src/pages/warroom/ConversationDrawer.tsx`
- Test: `apps/dashboard/src/pages/warroom/__tests__/ConversationDrawer.test.tsx`

**Interfaces:**
- Produces（后续 Task 2/3 依赖）：
  - `export interface ConversationSummary { id: string; title: string | null; status: 'active' | 'resolved' | 'suspended' | 'archived'; last_message: string | null; last_message_at: string | null; updated_at: string; turn_count: number; }`
  - `export default function ConversationDrawer({ journeyId, open, onClose }: { journeyId: string; open: boolean; onClose: () => void }): JSX.Element | null`
  - 组件内部 fetch `GET /api/brain/conversations?journey_id=<journeyId>` → 期望响应体 `{ conversations: ConversationSummary[], total: number }`
  - 组件内部 fetch `POST /api/brain/conversations { journey_id }` → 期望响应体是新建的 conversation 行（至少含 `id: string`）

- [ ] **Step 1: 写失败测试**

```tsx
// apps/dashboard/src/pages/warroom/__tests__/ConversationDrawer.test.tsx
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
```

> 注意：上面「点新议题」测试用例断言 `thread-back-btn` 出现——这依赖 Task 2 才实现的 `ConversationThread`。Task 1 阶段先写这个测试并确认它按预期失败（模块里还没有 `ConversationThread` / `thread-back-btn`），Task 2 完成后这条用例才会真正转绿。其余用例（关闭态/列表渲染/空态/错误态/关闭按钮）在 Task 1 结束时必须全部转绿。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/ConversationDrawer.test.tsx`
Expected: FAIL — `Cannot find module '../ConversationDrawer'`（文件还不存在）

- [ ] **Step 3: 写最小实现（骨架 + List 模式，activeId/Thread 先留 null 分支占位）**

```tsx
// apps/dashboard/src/pages/warroom/ConversationDrawer.tsx
/**
 * ConversationDrawer — Line 指挥页军师对话抽屉
 *
 * 挂载在 WarRoomLineCommandPage，右侧滑出，覆盖三栏但不销毁它们。
 * 议题列表 + 对话区，消费 PR1(#4244)/PR2(#4253) 已合并的 conversations API。
 */

import { useEffect, useState, useCallback } from 'react';
import { X, Plus, MessageSquare, AlertCircle } from 'lucide-react';

export interface ConversationSummary {
  id: string;
  title: string | null;
  status: 'active' | 'resolved' | 'suspended' | 'archived';
  last_message: string | null;
  last_message_at: string | null;
  updated_at: string;
  turn_count: number;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

function statusBadge(status: string): string {
  if (status === 'active') return 'bg-blue-500/15 text-blue-400';
  if (status === 'resolved') return 'bg-emerald-500/15 text-emerald-400';
  if (status === 'suspended') return 'bg-amber-500/15 text-amber-400';
  return 'bg-slate-700/50 text-slate-500';
}

function ConversationList({
  conversations,
  loading,
  error,
  onSelect,
  onCreate,
  creating,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  creating: boolean;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-800/60">
        <button
          onClick={onCreate}
          disabled={creating}
          data-testid="new-conversation-btn"
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded bg-blue-600/80 hover:bg-blue-600 text-white text-[12px] font-medium disabled:opacity-50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {creating ? '创建中…' : '新议题'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-[12px] text-slate-600 text-center py-6">加载议题…</div>}
        {!loading && error && (
          <div className="flex items-center gap-2 text-[12px] text-red-400 px-3 py-4">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
        {!loading && !error && conversations.length === 0 && (
          <div className="text-[12px] text-slate-600 text-center py-8">
            <MessageSquare className="w-5 h-5 mx-auto mb-2 opacity-40" />
            暂无议题，点上方"新议题"开始
          </div>
        )}
        {!loading && !error && conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            data-testid={`conversation-item-${c.id}`}
            className="w-full text-left px-3 py-2.5 border-b border-slate-800/40 hover:bg-slate-800/40 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-slate-200 font-medium truncate">
                {c.title || `议题 ${c.id.slice(0, 8)}`}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${statusBadge(c.status)}`}>
                {c.status}
              </span>
            </div>
            {c.last_message && (
              <div className="text-[11px] text-slate-500 truncate mt-1">{c.last_message}</div>
            )}
            <div className="text-[10px] text-slate-600 mt-1">{relativeTime(c.updated_at)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ConversationDrawer({
  journeyId,
  open,
  onClose,
}: {
  journeyId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch(`/api/brain/conversations?journey_id=${encodeURIComponent(journeyId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setConversations(body.conversations || []);
      setListError(null);
    } catch (e: any) {
      setListError(e.message || '加载议题列表失败');
    } finally {
      setListLoading(false);
    }
  }, [journeyId]);

  useEffect(() => {
    if (!open) return;
    setListLoading(true);
    fetchList();
  }, [open, fetchList]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/brain/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ journey_id: journeyId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const conv = await res.json();
      await fetchList();
      setActiveId(conv.id);
    } catch (e: any) {
      setListError(e.message || '创建议题失败');
    } finally {
      setCreating(false);
    }
  }, [journeyId, fetchList]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} data-testid="drawer-backdrop" />
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-slate-900 border-l border-slate-800 z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800/60 flex-shrink-0">
          <span className="text-[13px] font-semibold text-slate-200">军师对话</span>
          <button
            onClick={onClose}
            data-testid="drawer-close-btn"
            className="p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          {activeId ? (
            <div className="flex items-center justify-center h-full text-[12px] text-slate-600">
              对话区（Task 2 实现）
              <button data-testid="thread-back-btn" onClick={() => setActiveId(null)} className="hidden" />
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              loading={listLoading}
              error={listError}
              onSelect={setActiveId}
              onCreate={handleCreate}
              creating={creating}
            />
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/ConversationDrawer.test.tsx`
Expected: 6 个用例全部 PASS（含"点新议题"用例——此时占位 `thread-back-btn` 已存在，Task 1 结束即转绿；Task 2 会把它替换成真正的 `ConversationThread`）

- [ ] **Step 5: 提交**

```bash
git add apps/dashboard/src/pages/warroom/ConversationDrawer.tsx apps/dashboard/src/pages/warroom/__tests__/ConversationDrawer.test.tsx
git commit -m "feat(dashboard): ConversationDrawer 议题列表骨架"
```

---

### Task 2: ConversationThread — 对话区（消息渲染 + 发送 + 轮询）

**Files:**
- Modify: `apps/dashboard/src/pages/warroom/ConversationDrawer.tsx`
- Modify: `apps/dashboard/src/pages/warroom/__tests__/ConversationDrawer.test.tsx`

**Interfaces:**
- Consumes（Task 1 已定义）：`ConversationSummary`、`ConversationDrawer` 组件外壳、`relativeTime`
- Produces（Task 3 依赖）：`ConversationDrawer` 的 `activeId` 分支渲染真正的对话区，`data-testid="thread-back-btn"` / `data-testid="message-input"` / `data-testid="message-send-btn"` / `data-testid="thread-messages"` 保持稳定可供后续测试引用

- [ ] **Step 1: 写失败测试（追加到同一测试文件）**

```tsx
// 追加到 apps/dashboard/src/pages/warroom/__tests__/ConversationDrawer.test.tsx 末尾

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

    await waitFor(() => expect(screen.getByText('服务异常')).toBeInTheDocument());
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
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/ConversationDrawer.test.tsx`
Expected: 新增 4 个用例 FAIL（占位对话区没有真实消息渲染/输入框/发送按钮）

- [ ] **Step 3: 实现 ConversationThread，替换 activeId 分支占位**

在 `ConversationDrawer.tsx` 中：

1. 顶部 import 增加：

```tsx
import { X, Plus, MessageSquare, AlertCircle, Send, ChevronLeft } from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';
```

2. 在 `ConversationList` 定义之后、`export default function ConversationDrawer` 之前插入：

```tsx
export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  turn_marker: string | null;
  created_at: string;
}

function MessageBubble({ msg }: { msg: ConversationMessage }) {
  if (msg.role === 'system') {
    return <div className="text-[11px] text-slate-600 text-center py-1">{msg.content}</div>;
  }
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap ${
          isUser ? 'bg-blue-600/80 text-white' : 'bg-slate-800/70 text-slate-200'
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
}

function ConversationThread({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/brain/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setMessages(body.messages || []);
      setError(null);
    } catch (e: any) {
      setError(e.message || '加载消息失败');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/brain/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setInput('');
      await fetchMessages();
    } catch (e: any) {
      setError(e.message || '发送失败');
    } finally {
      setSending(false);
    }
  }, [input, sending, conversationId, fetchMessages]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/60 flex-shrink-0">
        <button onClick={onBack} data-testid="thread-back-btn" className="p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-[12px] text-slate-400">议题 {conversationId.slice(0, 8)}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" data-testid="thread-messages">
        {loading && <div className="text-[12px] text-slate-600 text-center py-6">加载对话…</div>}
        {!loading && messages.length === 0 && !error && (
          <div className="text-[12px] text-slate-600 text-center py-6">还没有消息，开始聊吧</div>
        )}
        {!loading && messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
        <div ref={bottomRef} />
      </div>
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-red-400 flex items-center gap-1.5 flex-shrink-0">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 p-3 border-t border-slate-800/60 flex-shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          disabled={sending}
          placeholder="跟军师聊聊…"
          data-testid="message-input"
          className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded px-3 py-2 text-[12px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          data-testid="message-send-btn"
          className="p-2 rounded bg-blue-600/80 hover:bg-blue-600 text-white disabled:opacity-40 transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
```

3. 把 `ConversationDrawer` 里 `activeId` 分支的占位 `<div>对话区（Task 2 实现）...</div>` 整块替换为：

```tsx
          {activeId ? (
            <ConversationThread conversationId={activeId} onBack={() => setActiveId(null)} />
          ) : (
```

（保持后面 `<ConversationList ... /> )}` 不变）

- [ ] **Step 4: 跑测试确认全部通过**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/ConversationDrawer.test.tsx`
Expected: 全部 10 个用例 PASS

- [ ] **Step 5: 提交**

```bash
git add apps/dashboard/src/pages/warroom/ConversationDrawer.tsx apps/dashboard/src/pages/warroom/__tests__/ConversationDrawer.test.tsx
git commit -m "feat(dashboard): ConversationDrawer 对话区——消息渲染/发送/5s轮询"
```

---

### Task 3: 5 秒轮询生命周期 + WarRoomLineCommandPage 接入

**Files:**
- Modify: `apps/dashboard/src/pages/warroom/__tests__/ConversationDrawer.test.tsx`（补轮询生命周期测试）
- Modify: `apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx`
- Test: `apps/dashboard/src/pages/warroom/__tests__/WarRoomLineCommandPage.chat.test.tsx`（新建，只测 header 按钮接入，不重复 WarRoomPage.test.ts 已有的三栏渲染断言）

**Interfaces:**
- Consumes：Task 1/2 的 `ConversationDrawer` 默认导出
- Produces：`WarRoomLineCommandPage` header 新增按钮 `data-testid="open-chat-btn"`，点击后挂载 `<ConversationDrawer open={true} .../>`

- [ ] **Step 1: 补轮询生命周期失败测试（追加到 ConversationDrawer.test.tsx）**

```tsx
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
```

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/ConversationDrawer.test.tsx`
Expected: "打开对话区后每5秒自动重拉消息" 应already PASS（Task 2 的 `setInterval` 已实现，此用例是补充覆盖而非新行为）；"关闭抽屉后停止轮询" 预期 FAIL —— `ConversationThread` 组件在 `open=false` 后仍被 React 卸载（`ConversationDrawer` 顶层 `if (!open) return null` 已卸载整棵子树，interval 的 cleanup 应该已经触发）。若这条也直接 PASS 说明 Task 2 的 `useEffect` cleanup 已经正确处理了卸载场景——这是预期结果，不需要额外实现，直接进 Step 2 确认，不做无意义的"制造失败"。

- [ ] **Step 2: 跑测试，如有 FAIL 才动代码**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/ConversationDrawer.test.tsx`

若两条新用例已经 PASS（预期结果，因为 Task 2 的 `useEffect(() => { const interval = setInterval(...); return () => clearInterval(interval); }, [fetchMessages])` 在组件卸载时 React 会自动调用 cleanup），跳过下面的"修复"，直接进 Step 3 提交。若 FAIL，说明轮询逻辑有泄漏，检查 `ConversationThread` 的 `useEffect` 依赖数组和 cleanup 函数是否正确书写（对照 Task 2 Step 3 给出的实现，逐行比对，不应有偏差）。

- [ ] **Step 3: 提交轮询测试**

```bash
git add apps/dashboard/src/pages/warroom/__tests__/ConversationDrawer.test.tsx
git commit -m "test(dashboard): ConversationDrawer 轮询生命周期覆盖"
```

- [ ] **Step 4: 写 WarRoomLineCommandPage 接入失败测试**

```tsx
// apps/dashboard/src/pages/warroom/__tests__/WarRoomLineCommandPage.chat.test.tsx
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
```

- [ ] **Step 5: 跑测试确认失败**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/WarRoomLineCommandPage.chat.test.tsx`
Expected: FAIL — 找不到 `data-testid="open-chat-btn"`

- [ ] **Step 6: 接入 ConversationDrawer**

在 `apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx` 做三处改动：

1. 顶部 import 区（第 13-19 行现有内容后）新增：

```tsx
import ConversationDrawer from './ConversationDrawer';
```

并把第 16-19 行的图标 import 列表里加入 `MessageSquare`：

```tsx
import {
  ArrowLeft, RefreshCw, Brain, Layers, Activity,
  CheckCircle2, XCircle, Clock, GitPullRequest, AlertCircle,
  Zap, FileText, ChevronRight, TrendingUp, MessageSquare,
} from 'lucide-react';
```

2. 在 `export default function WarRoomLineCommandPage()` 函数体内，`const [refreshing, setRefreshing] = useState(false);` 之后新增一行：

```tsx
  const [chatOpen, setChatOpen] = useState(false);
```

3. 在 header 区块（第 457-468 行 `<div className="flex items-center gap-2 flex-shrink-0">` 内，`<button onClick={() => fetchData(true)} ...>` 之前）插入新按钮：

```tsx
          <button
            onClick={() => setChatOpen(true)}
            data-testid="open-chat-btn"
            className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
```

4. 在组件最外层 `return` 的最外层 `<div className="min-h-screen ...">` 闭合标签之前（紧跟"Body — 三栏"整块 `<div className="flex-1 min-h-0 overflow-y-auto">...</div>` 之后）挂载抽屉：

```tsx
      <ConversationDrawer journeyId={id!} open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
```

（即把原本文件末尾的

```tsx
      </div>
    </div>
  );
}
```

改为

```tsx
      </div>
      <ConversationDrawer journeyId={id!} open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
```

）

- [ ] **Step 7: 跑测试确认通过**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/WarRoomLineCommandPage.chat.test.tsx src/pages/warroom/__tests__/WarRoomPage.test.ts`
Expected: 新测试 PASS；`WarRoomPage.test.ts` 既有用例（三栏渲染）不受影响，全部 PASS（回归检查——新按钮/挂载点不改变原有 DOM 结构里被断言的元素）

- [ ] **Step 8: 全量跑 dashboard 测试确认无回归**

Run: `cd apps/dashboard && npx vitest run`
Expected: 全部 PASS，0 FAIL

- [ ] **Step 9: 提交**

```bash
git add apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx apps/dashboard/src/pages/warroom/__tests__/WarRoomLineCommandPage.chat.test.tsx
git commit -m "feat(dashboard): WarRoomLineCommandPage 接入军师对话抽屉入口"
```

---

## Self-Review（写完后自查，不再等外部触发）

- **Spec 覆盖**：设计文档「组件结构」「数据流」「错误处理」「测试策略」四节分别对应 Task 1（List）/ Task 2（Thread + 发送 + 轮询）/ Task 3（轮询生命周期 + 页面接入）/ 全文贯穿的错误态断言。「不包含」一节（GP 二级页对话框、PR4、SSE）未建任务，符合设计里显式排除的范围。
- **占位符扫描**：无 TBD/TODO；Task 3 Step 2 的"若 PASS 则跳过"不是占位符，是基于 React useEffect cleanup 语义的确定性预判，两条分支都给了明确动作。
- **类型一致性**：`ConversationSummary`/`ConversationMessage` 字段名在 Task 1/2/3 全程一致；`ConversationDrawer` props `{ journeyId, open, onClose }` 与 Task 3 Step 6 接入代码调用签名一致；`data-testid` 命名（`new-conversation-btn` / `conversation-item-<id>` / `thread-back-btn` / `message-input` / `message-send-btn` / `thread-messages` / `drawer-close-btn` / `drawer-backdrop` / `open-chat-btn`）三个 Task 间无冲突无改名。
