import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Leaf, Send, Check, Loader2, Clock, GitBranch,
} from 'lucide-react';

interface PendingAction {
  id: string;
  action_type: string;
  context: Record<string, unknown>;
  params: Record<string, unknown>;
  status: string;
  comments: Array<{ role: string; text?: string; content?: string; ts?: string; timestamp?: string }>;
  created_at: string;
}

interface VersionRecord {
  id: string;
  context: Record<string, unknown>;
  status: string;
  created_at: string;
}

interface ChatMessage {
  role: 'user' | 'autumnrice';
  text: string;
  ts: string;
  redecomp?: boolean;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function extractMessages(comments: PendingAction['comments']): ChatMessage[] {
  if (!comments) return [];
  return comments
    .filter(c => c.role === 'user' || (c.role as string) === 'autumnrice')
    .map(c => ({
      role: (c.role === 'user' ? 'user' : 'autumnrice') as 'user' | 'autumnrice',
      text: (c as unknown as { text?: string }).text ?? c.content ?? '',
      ts: (c as unknown as { ts?: string }).ts ?? c.timestamp ?? new Date().toISOString(),
    }));
}

export default function OkrReviewPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [action, setAction] = useState<PendingAction | null>(null);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [redecompNotice, setRedecompNotice] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAction = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/brain/pending-actions/${id}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setAction(data.action);
      setMessages(extractMessages(data.action.comments || []));
    } catch (e) {
      setError('加载失败');
    }
  }, [id]);

  const loadVersions = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/brain/pending-actions/${id}/versions`);
      if (!res.ok) return;
      const data = await res.json();
      setVersions(data.versions || []);
    } catch {
      // ignore
    }
  }, [id]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadAction(), loadVersions()]);
      setLoading(false);
    };
    init();
  }, [loadAction, loadVersions]);

  // 重拆后轮询版本更新
  useEffect(() => {
    if (redecompNotice) {
      pollRef.current = setInterval(() => {
        loadVersions();
      }, 15000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [redecompNotice, loadVersions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sending || !id) return;
    setInput('');
    setSending(true);

    const userMsg: ChatMessage = { role: 'user', text: msg, ts: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch('/api/brain/autumnrice/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_action_id: id, message: msg }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();

      const replyMsg: ChatMessage = {
        role: 'autumnrice',
        text: data.reply || '（秋米无回复）',
        ts: data.comment?.ts || new Date().toISOString(),
        redecomp: !!data.redecomp_triggered,
      };
      setMessages(prev => [...prev, replyMsg]);

      if (data.redecomp_triggered) {
        setRedecompNotice(true);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'autumnrice',
        text: '抱歉，我暂时无法回复，请稍后再试。',
        ts: new Date().toISOString(),
      }]);
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
    if (!id) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/brain/pending-actions/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer: 'user' }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      navigate('/inbox');
    } catch {
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  }

  if (error || !action) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <button onClick={() => navigate('/inbox')} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft className="w-4 h-4" /> 返回收件箱
        </button>
        <p className="text-slate-500">{error || '未找到该条目'}</p>
      </div>
    );
  }

  const ctx = action.context;
  const initiatives = Array.isArray(ctx.initiatives) ? ctx.initiatives as string[] : [];
  const currentVersionIdx = versions.findIndex(v => v.id === id);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/inbox')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          收件箱
        </button>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">OKR 拆解讨论</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* 左栏：KR 信息 + 拆解结果 + 版本历史 */}
        <div className="lg:col-span-2 space-y-4">
          {/* KR 信息 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                <GitBranch className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              </div>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">拆解详情</span>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">KR</p>
                <p className="text-sm text-slate-700 dark:text-slate-200">{ctx.kr_title as string || '未知'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Project</p>
                <p className="text-sm text-slate-700 dark:text-slate-200">{ctx.project_name as string || '未知'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">
                  Initiatives（{initiatives.length} 个）
                </p>
                {initiatives.length > 0 ? (
                  <ul className="space-y-1">
                    {initiatives.map((name, idx) => (
                      <li key={idx} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 mt-1" />
                        {name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400">暂无 Initiative</p>
                )}
              </div>
              {ctx.decomposed_at && (
                <p className="text-[10px] text-slate-400 pt-1">
                  拆解时间：{new Date(ctx.decomposed_at as string).toLocaleString('zh-CN')}
                </p>
              )}
            </div>
          </div>

          {/* 版本历史 */}
          {versions.length > 1 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">版本历史</span>
              </div>
              <div className="space-y-1.5">
                {versions.map((v, idx) => (
                  <div
                    key={v.id}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                      v.id === id
                        ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 font-medium'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer'
                    }`}
                    onClick={() => v.id !== id && navigate(`/okr/review/${v.id}`)}
                  >
                    <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <span className="flex-1 truncate">
                      {v.id === id ? '当前版本' : `v${idx + 1}`}
                    </span>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">
                      {formatDate(v.created_at)}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                      v.status === 'approved' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                    }`}>
                      {v.status === 'approved' ? '已放行' : '待审'}
                    </span>
                  </div>
                ))}
              </div>
              {redecompNotice && (
                <p className="mt-2 text-[11px] text-violet-500 dark:text-violet-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  新版本生成中，每 15s 自动刷新...
                </p>
              )}
            </div>
          )}

          {/* 重拆通知（无历史版本时显示） */}
          {versions.length <= 1 && redecompNotice && (
            <div className="rounded-2xl border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-900/20 p-3">
              <p className="text-xs text-violet-600 dark:text-violet-400 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                重拆任务已发起，新版本生成后会自动出现在版本历史...
              </p>
            </div>
          )}
        </div>

        {/* 右栏：与秋米对话 */}
        <div className="lg:col-span-3 flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 overflow-hidden" style={{ minHeight: '480px' }}>
          {/* 对话头部 */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 bg-violet-50 dark:bg-violet-900/20">
            <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center">
              <Leaf className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">与秋米对话</p>
              <p className="text-[10px] text-slate-400">OKR 拆解专家</p>
            </div>
          </div>

          {/* 消息列表 */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-800/50">
            {messages.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-8">
                你有什么疑问或修改意见？直接告诉秋米...
                <br />
                <span className="text-[10px]">说「重新拆」可触发重拆</span>
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
                  {m.redecomp && (
                    <p className="mt-1.5 text-[10px] text-violet-300 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      重拆任务已发起
                    </p>
                  )}
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
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-violet-100 dark:border-violet-800/30 bg-white dark:bg-slate-800">
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

          {/* 确认放行 */}
          {action.status === 'pending_approval' && (
            <div className="px-3 py-2.5 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/50">
              <button
                onClick={handleApprove}
                disabled={approving || sending}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 transition-colors"
              >
                {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {approving ? '放行中...' : '确认放行'}
              </button>
            </div>
          )}
          {action.status === 'approved' && (
            <div className="px-3 py-2.5 bg-emerald-50 dark:bg-emerald-900/20 border-t border-emerald-100 dark:border-emerald-800/30">
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                已放行
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 版本计数提示（有版本且未显示历史面板时） */}
      {versions.length > 1 && currentVersionIdx >= 0 && (
        <p className="mt-3 text-xs text-center text-slate-400">
          版本 {currentVersionIdx + 1} / {versions.length}
        </p>
      )}
    </div>
  );
}
