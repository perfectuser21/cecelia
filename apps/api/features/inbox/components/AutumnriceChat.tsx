import React, { useState, useRef, useEffect } from 'react';
import { Send, Check, X, Loader2, Leaf } from 'lucide-react';
import type { Proposal } from '../hooks/useProposals';

interface ChatMessage {
  role: 'user' | 'autumnrice';
  text: string;
  ts: string;
}

interface AutumnriceChatProps {
  proposal: Proposal;
  onApprove: () => Promise<void>;
  onClose: () => void;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// 从 proposal.comments 中提取秋米对话消息（role = user | autumnrice）
function extractChatMessages(comments: Proposal['comments']): ChatMessage[] {
  if (!comments) return [];
  return comments
    .filter(c => c.role === 'user' || (c.role as string) === 'autumnrice')
    .map(c => ({
      role: (c.role === 'user' ? 'user' : 'autumnrice') as 'user' | 'autumnrice',
      // DB 存 {text, ts}，前端类型是 {content, timestamp}，兼容两者
      text: (c as unknown as { text?: string; content?: string }).text ?? c.content ?? '',
      ts: (c as unknown as { ts?: string; timestamp?: string }).ts ?? c.timestamp ?? new Date().toISOString(),
    }));
}

export default function AutumnriceChat({ proposal, onApprove, onClose }: AutumnriceChatProps): React.ReactElement {
  const ctx = proposal.context as Record<string, unknown>;
  const initiatives = Array.isArray(ctx.initiatives) ? ctx.initiatives as string[] : [];

  const [messages, setMessages] = useState<ChatMessage[]>(() => extractChatMessages(proposal.comments));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput('');
    setSending(true);

    // 立即显示用户消息
    const userMsg: ChatMessage = { role: 'user', text: msg, ts: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch('/api/brain/autumnrice/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_action_id: proposal.id, message: msg }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const replyMsg: ChatMessage = {
        role: 'autumnrice',
        text: data.reply || '（秋米无回复）',
        ts: data.comment?.ts || new Date().toISOString(),
      };
      setMessages(prev => [...prev, replyMsg]);
    } catch (err) {
      const errMsg: ChatMessage = {
        role: 'autumnrice',
        text: '抱歉，我暂时无法回复，请稍后再试。',
        ts: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      await onApprove();
    } catch {
      setApproving(false);
    }
  };

  return (
    <div className="mt-3 border border-violet-200 dark:border-violet-800/50 rounded-xl overflow-hidden">
      {/* 头部：拆解上下文 */}
      <div className="p-3 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-100 dark:border-violet-800/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Leaf className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-xs font-medium text-violet-700 dark:text-violet-300">与秋米对话</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-0.5">
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            <span className="font-medium text-violet-600 dark:text-violet-400">KR：</span>
            {ctx.kr_title as string || '未知'}
          </p>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            <span className="font-medium text-violet-600 dark:text-violet-400">Project：</span>
            {ctx.project_name as string || '未知'}
          </p>
          {initiatives.length > 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-500">
              {initiatives.length} 个 Initiative：{initiatives.slice(0, 2).join('、')}{initiatives.length > 2 ? '...' : ''}
            </p>
          )}
        </div>
      </div>

      {/* 对话区 */}
      <div
        ref={scrollRef}
        className="max-h-64 overflow-y-auto p-3 space-y-3 bg-slate-50 dark:bg-slate-800/50"
      >
        {messages.length === 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
            你有什么疑问或修改意见？直接告诉秋米...
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}>
            {m.role === 'autumnrice' && (
              <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center shrink-0 mt-0.5">
                <Leaf className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              </div>
            )}
            <div className={`
              max-w-[80%] rounded-xl px-3 py-2 text-sm
              ${m.role === 'user'
                ? 'bg-violet-600 text-white'
                : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-violet-100 dark:border-violet-800/30'
              }
            `}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              <p className={`text-[10px] mt-1 ${m.role === 'user' ? 'text-violet-200' : 'text-slate-400 dark:text-slate-500'}`}>
                {m.role === 'autumnrice' ? '秋米 · ' : ''}{formatTime(m.ts)}
              </p>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center shrink-0">
              <Loader2 className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 animate-spin" />
            </div>
            <div className="bg-white dark:bg-slate-700 border border-violet-100 dark:border-violet-800/30 rounded-xl px-3 py-2">
              <p className="text-xs text-slate-400">秋米思考中...</p>
            </div>
          </div>
        )}
      </div>

      {/* 输入框 */}
      <div className="flex items-center gap-2 p-2 border-t border-violet-100 dark:border-violet-800/30 bg-white dark:bg-slate-800">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="告诉秋米你的想法..."
          disabled={sending || approving}
          className="flex-1 text-sm bg-transparent border-none outline-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending || approving}
          className="p-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 底部操作：确认放行 */}
      <div className="px-3 py-2 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/50">
        <button
          onClick={handleApprove}
          disabled={approving || sending}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 transition-colors"
        >
          {approving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {approving ? '放行中...' : '确认放行'}
        </button>
      </div>
    </div>
  );
}
