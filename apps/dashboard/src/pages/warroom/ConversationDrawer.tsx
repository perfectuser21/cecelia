/**
 * ConversationDrawer — Line 指挥页军师对话抽屉
 *
 * 挂载在 WarRoomLineCommandPage，右侧滑出，覆盖三栏但不销毁它们。
 * 议题列表 + 对话区，消费 PR1(#4244)/PR2(#4253) 已合并的 conversations API。
 */

import { X, Plus, MessageSquare, AlertCircle, Send, ChevronLeft } from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';

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

function ConversationThread({
  conversationId,
  onBack,
  onNotFound,
}: {
  conversationId: string;
  onBack: () => void;
  onNotFound: (message: string) => void;
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/brain/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`);
      if (res.status === 404) {
        onNotFound('议题已归档或不存在');
        return;
      }
      if (!res.ok) throw new Error();
      const body = await res.json();
      setMessages(body.messages || []);
      setError(null);
    } catch {
      setError('加载消息失败');
    } finally {
      setLoading(false);
    }
  }, [conversationId, onNotFound]);

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
        throw new Error();
      }
      setInput('');
      await fetchMessages();
    } catch {
      setError('发送失败');
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
      if (!res.ok) throw new Error();
      const body = await res.json();
      setConversations(body.conversations || []);
      setListError(null);
    } catch {
      setListError('加载议题列表失败');
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
      if (!res.ok) throw new Error();
      const conv = await res.json();
      await fetchList();
      setActiveId(conv.id);
    } catch {
      setListError('创建议题失败');
    } finally {
      setCreating(false);
    }
  }, [journeyId, fetchList]);

  const handleThreadNotFound = useCallback((message: string) => {
    setActiveId(null);
    setListError(message);
  }, []);

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
            <ConversationThread conversationId={activeId} onBack={() => setActiveId(null)} onNotFound={handleThreadNotFound} />
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
