import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import type { ProposalComment } from '../hooks/useProposals';

interface ProposalChatProps {
  comments: ProposalComment[];
  onSend: (message: string) => Promise<ProposalComment | null>;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function ProposalChat({ comments, onSend }: ProposalChatProps): React.ReactElement {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [comments.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput('');
    setSending(true);
    try {
      await onSend(msg);
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

  return (
    <div className="mt-3 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      {/* Chat history */}
      <div
        ref={scrollRef}
        className="max-h-64 overflow-y-auto p-3 space-y-3 bg-slate-50 dark:bg-slate-800/50"
      >
        {comments.length === 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
            向 Cecelia 提问...
          </p>
        )}
        {comments.map((c, i) => (
          <div key={i} className={`flex gap-2 ${c.role === 'user' ? 'justify-end' : ''}`}>
            {c.role !== 'user' && (
              <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              </div>
            )}
            <div className={`
              max-w-[80%] rounded-xl px-3 py-2 text-sm
              ${c.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600'
              }
            `}>
              <p className="whitespace-pre-wrap">{c.content}</p>
              <p className={`text-[10px] mt-1 ${c.role === 'user' ? 'text-blue-200' : 'text-slate-400 dark:text-slate-500'}`}>
                {formatTime(c.timestamp)}
              </p>
            </div>
            {c.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0">
              <Loader2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
            <div className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2">
              <p className="text-xs text-slate-400">思考中...</p>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 p-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入回复..."
          disabled={sending}
          className="flex-1 text-sm bg-transparent border-none outline-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
