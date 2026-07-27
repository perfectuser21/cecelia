/**
 * ConversationsPanel — 议题对话面板（独立模块）
 *
 * Props:
 *   journeyId: string — 所属 Journey ID（必填）
 *   gpId?: string     — GP 过滤 ID（可选，存在时只显示锚定该 GP 的对话）
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowLeft, MessageSquare, Plus } from 'lucide-react';

// ── 类型 ─────────────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  journey_id: string;
  gp_id?: string | null;
  title: string | null;
  status: string;
  turn_count: number;
  last_message: string | null;
  last_message_at: string | null;
  updated_at: string;
}

export interface ConvMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  turn_marker: string | null;
  created_at: string;
}

export interface StatusBadgeMeta {
  text: string;
  bg: string;
  label: string;
}

// ── 纯函数：status badge 元信息 ───────────────────────────────────────────────

export function statusBadgeMeta(status: string): StatusBadgeMeta {
  if (status === 'active') {
    return {
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/15',
      label: '活跃',
    };
  }
  if (status === 'resolved') {
    return {
      text: 'text-slate-400',
      bg: 'bg-slate-700/50',
      label: '已解决',
    };
  }
  if (status === 'suspended') {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-500/15',
      label: '挂起',
    };
  }
  // archived 或未知状态，返回默认灰色
  return {
    text: 'text-slate-500',
    bg: 'bg-slate-800/40',
    label: status || '未知',
  };
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

export function turnMarkerLabel(marker: string | null): string | null {
  if (!marker) return null;
  if (marker === 'chat') return null;
  if (marker === 'pending_user') return '等待拍板';
  if (marker.startsWith('decision_saved=')) return '已落决策';
  return null;
}

// ── 组件 ─────────────────────────────────────────────────────────────────────

interface ConversationsPanelProps {
  journeyId: string;
  gpId?: string;
}

export default function ConversationsPanel({ journeyId, gpId }: ConversationsPanelProps) {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async () => {
    setLoadingConvs(true);
    setConvError(null);
    try {
      let url = `/api/brain/conversations?journey_id=${encodeURIComponent(journeyId)}&limit=20`;
      if (gpId) {
        url += `&gp_id=${encodeURIComponent(gpId)}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {
      setConvError('加载对话列表失败');
    } finally {
      setLoadingConvs(false);
    }
  }, [journeyId, gpId]);

  const fetchMessages = useCallback(async (convId: string) => {
    setLoadingMsgs(true);
    try {
      const res = await fetch(`/api/brain/conversations/${encodeURIComponent(convId)}/messages?limit=100`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      setConvError('加载消息失败');
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  const createConversation = async () => {
    setConvError(null);
    try {
      const body: Record<string, string> = {
        journey_id: journeyId,
        title: `议题 ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      };
      if (gpId) {
        body.gp_id = gpId;
      }
      const res = await fetch('/api/brain/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const conv = await res.json();
      setConversations((prev) => [conv, ...prev]);
      setSelectedConv(conv);
      setMessages([]);
      setView('detail');
    } catch (e: any) {
      setConvError(e.message || '创建对话失败');
    }
  };

  const openConv = async (conv: Conversation) => {
    setSelectedConv(conv);
    setMessages([]);
    setView('detail');
    await fetchMessages(conv.id);
  };

  const sendMessage = async () => {
    if (!selectedConv || !input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    setConvError(null);
    const optimistic: ConvMessage = {
      id: `opt-${Date.now()}`,
      conversation_id: selectedConv.id,
      role: 'user',
      content: text,
      turn_marker: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await fetch(`/api/brain/conversations/${encodeURIComponent(selectedConv.id)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: text }),
      });
      await fetchMessages(selectedConv.id);
    } catch (e: any) {
      setConvError(e.message || '发送失败');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  if (view === 'detail' && selectedConv) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3 flex-shrink-0">
          <button
            onClick={() => { setView('list'); setMessages([]); fetchConversations(); }}
            className="flex items-center gap-1 text-[11px] text-blue-400/70 hover:text-blue-300 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            返回
          </button>
          <span className="text-[11px] text-slate-400 truncate flex-1">
            {selectedConv.title || `对话 #${selectedConv.id.slice(0, 8)}`}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 mb-3 min-h-0">
          {loadingMsgs && (
            <div className="text-[11px] text-slate-600 text-center py-4">加载中…</div>
          )}
          {messages.filter((m) => m.role !== 'system').map((m) => {
            const badge = turnMarkerLabel(m.turn_marker);
            const cleanContent = m.content.replace(/\[TURN:[^\]]*\]/g, '').trim();
            return (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[90%] space-y-1">
                  <div className={`px-2.5 py-1.5 rounded-lg text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === 'user'
                      ? 'bg-blue-600/30 text-blue-100'
                      : 'bg-slate-700/50 text-slate-300'
                  }`}>
                    {cleanContent}
                  </div>
                  {badge && (
                    <div className={`text-[10px] px-1 ${m.role === 'user' ? 'text-right' : 'text-left'} text-amber-400/70`}>
                      {badge}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-slate-700/50 px-2.5 py-1.5 rounded-lg text-[11px] text-slate-500 animate-pulse">
                军师思考中…
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="flex-shrink-0 space-y-1">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="向军师提问…"
              disabled={sending}
              className="flex-1 min-w-0 bg-slate-800/60 border border-slate-700/50 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              className="px-2.5 py-1.5 bg-blue-600/70 hover:bg-blue-600 rounded-lg text-[11px] text-white disabled:opacity-40 transition-colors flex-shrink-0"
            >
              发
            </button>
          </div>
          {convError && <div className="text-[10px] text-red-400">{convError}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="text-[11px] text-slate-500 uppercase tracking-wider">
          议题对话
          {conversations.length > 0 && (
            <span className="ml-1.5 font-mono text-slate-600">{conversations.length}</span>
          )}
        </div>
        <button
          onClick={createConversation}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-400/50 rounded-lg transition-colors"
        >
          <Plus className="w-3 h-3" />
          新对话
        </button>
      </div>

      {loadingConvs ? (
        <div className="text-[11px] text-slate-600 text-center py-6">加载中…</div>
      ) : conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 py-8">
          <MessageSquare className="w-7 h-7 text-slate-700" />
          <div className="text-[12px] text-slate-600 text-center">暂无议题对话</div>
          <button
            onClick={createConversation}
            className="text-[11px] text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-400/50 rounded-lg px-3 py-1.5 transition-colors"
          >
            + 开启对话
          </button>
        </div>
      ) : (
        <div className="space-y-1.5 overflow-y-auto flex-1">
          {conversations.map((conv) => {
            const badge = statusBadgeMeta(conv.status);
            return (
              <button
                key={conv.id}
                onClick={() => openConv(conv)}
                className="w-full text-left bg-slate-800/40 hover:bg-slate-700/40 border border-slate-700/50 rounded-lg p-2.5 transition-colors"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[12px] text-slate-200 truncate flex-1 font-medium">
                    {conv.title || `对话 #${conv.id.slice(0, 6)}`}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.bg} ${badge.text} flex-shrink-0`}>
                    {badge.label}
                  </span>
                  <span className="text-[10px] text-slate-600 flex-shrink-0">{relativeTime(conv.updated_at)}</span>
                </div>
                {conv.last_message && (
                  <div className="text-[11px] text-slate-500 truncate">{conv.last_message}</div>
                )}
                <div className="text-[10px] text-slate-700 font-mono mt-0.5">{conv.turn_count} 轮</div>
              </button>
            );
          })}
        </div>
      )}

      {convError && <div className="text-[10px] text-red-400 mt-2">{convError}</div>}
    </div>
  );
}
