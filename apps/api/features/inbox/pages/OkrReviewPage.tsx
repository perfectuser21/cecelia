import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Leaf, Send, Check, Loader2, Target, TrendingUp, BookOpen,
} from 'lucide-react';

interface PendingAction {
  id: string;
  action_type: string;
  context: Record<string, unknown>;
  status: string;
  comments: Array<{ role: string; text?: string; content?: string; ts?: string; timestamp?: string }>;
}

interface GoalItem {
  id: string;
  title: string;
  type: string;
  status: string;
  priority?: number;
  progress?: number;
}

interface Learning {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
}

interface OkrContext {
  kr: GoalItem;
  objective: GoalItem | null;
  siblings: GoalItem[];
  similar_krs: GoalItem[];
  learnings: Learning[];
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

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    reviewing: '待确认', ready: '待拆解', in_progress: '进行中',
    completed: '已完成', pending: '待开始',
  };
  return map[status] || status;
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    reviewing: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',
    ready: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
    in_progress: 'text-violet-600 bg-violet-50 dark:bg-violet-900/20',
    completed: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20',
  };
  return map[status] || 'text-slate-500 bg-slate-100';
}

// 简洁 Markdown 渲染
function renderMarkdown(text: string): React.ReactElement {
  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];
  let i = 0;

  const renderInline = (line: string): React.ReactElement => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
      <span>
        {parts.map((part, idx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={idx} className="font-semibold">{part.slice(2, -2)}</strong>;
          }
          if (part.startsWith('`') && part.endsWith('`')) {
            return <code key={idx} className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-xs font-mono">{part.slice(1, -1)}</code>;
          }
          return <span key={idx}>{part}</span>;
        })}
      </span>
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || /^[-=]{3,}$/.test(line.trim()) || line.trim().startsWith('|')) {
      i++; continue;
    }
    const headMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headMatch) {
      elements.push(
        <p key={i} className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-2 mb-0.5">
          {renderInline(headMatch[2])}
        </p>
      );
      i++; continue;
    }
    if (/^[-*]\s/.test(line.trim())) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        listItems.push(lines[i].replace(/^[-*]\s/, '').trim());
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-0.5 space-y-0.5 pl-2">
          {listItems.map((item, idx) => (
            <li key={idx} className="flex items-start gap-1.5 text-xs text-slate-700 dark:text-slate-200">
              <span className="w-1 h-1 rounded-full bg-current mt-1.5 shrink-0 opacity-40" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }
    elements.push(
      <p key={i} className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
        {renderInline(line)}
      </p>
    );
    i++;
  }
  return <div className="space-y-0.5">{elements}</div>;
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
  const [okrContext, setOkrContext] = useState<OkrContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [redecompNotice, setRedecompNotice] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/brain/pending-actions/${id}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const act: PendingAction = data.action;
      setAction(act);
      setMessages(extractMessages(act.comments || []));

      // 加载 OKR 上下文
      const krId = act.context?.kr_id as string | undefined;
      if (krId) {
        const ctxRes = await fetch(`/api/brain/goals/${krId}/okr-context`);
        if (ctxRes.ok) {
          const ctxData = await ctxRes.json();
          setOkrContext(ctxData);
        }
      }
    } catch {
      setError('加载失败');
    }
  }, [id]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadData();
      setLoading(false);
    };
    init();
  }, [loadData]);

  // 自动滚动到最新消息
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sending || !id) return;
    setInput('');
    setSending(true);
    setMessages(prev => [...prev, { role: 'user', text: msg, ts: new Date().toISOString() }]);
    try {
      const res = await fetch('/api/brain/autumnrice/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_action_id: id, message: msg }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setMessages(prev => [...prev, {
        role: 'autumnrice',
        text: data.reply || '（秋米无回复）',
        ts: data.comment?.ts || new Date().toISOString(),
        redecomp: !!data.redecomp_triggered,
      }]);
      if (data.redecomp_triggered) setRedecompNotice(true);
    } catch {
      setMessages(prev => [...prev, {
        role: 'autumnrice',
        text: '网络超时，稍后重试。',
        ts: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleApprove = async () => {
    if (!id || !action) return;
    const krId = action.context?.kr_id as string | undefined;
    if (!krId) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/brain/goals/${krId}/approve`, {
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

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
    </div>
  );

  if (error || !action) return (
    <div className="p-8">
      <button onClick={() => navigate('/inbox')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> 返回收件箱
      </button>
      <p className="text-slate-500">{error || '未找到该条目'}</p>
    </div>
  );

  const ctx = action.context;
  const kr = okrContext?.kr;
  const krTitle = (ctx.kr_title as string) || kr?.title || 'OKR 定义讨论';
  const krId = ctx.kr_id as string | undefined;
  const isApproved = action.status === 'approved' || kr?.status === 'ready' || kr?.status === 'completed';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-slate-900">

      {/* ─── 顶部 Header ─── */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <button
          onClick={() => navigate('/inbox')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          收件箱
        </button>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <Target className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0">
          {krTitle}
        </span>
        {isApproved && (
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 shrink-0 font-medium">
            已放行
          </span>
        )}
      </div>

      {/* ─── 主体：OKR 上下文 65% + 聊天侧栏 35% ─── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ════ 左侧：OKR 上下文（65%）════ */}
        <div className="flex flex-col min-h-0 overflow-y-auto border-r border-slate-200 dark:border-slate-700" style={{ flex: '0 0 65%' }}>
          <div className="px-6 py-5 space-y-6">

            {/* Area Objective */}
            {okrContext?.objective && (
              <section>
                <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-2 font-medium">AREA OKR</p>
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">
                    {okrContext.objective.title}
                  </p>
                  {typeof okrContext.objective.progress === 'number' && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full transition-all"
                          style={{ width: `${okrContext.objective.progress}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-slate-400 shrink-0">{okrContext.objective.progress}%</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* KR 列表 */}
            {okrContext && (
              <section>
                <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-2 font-medium">
                  KEY RESULTS（{okrContext.siblings.length + 1} 个）
                </p>
                <div className="space-y-1.5">
                  {/* 当前 KR（高亮） */}
                  <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
                    <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0 mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-violet-800 dark:text-violet-200 leading-snug">{krTitle}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor(kr?.status || 'reviewing')}`}>
                          {statusLabel(kr?.status || 'reviewing')}
                        </span>
                        {typeof kr?.progress === 'number' && (
                          <span className="text-[10px] text-slate-400">{kr.progress}%</span>
                        )}
                        <span className="text-[10px] text-violet-500 font-medium">← 当前</span>
                      </div>
                    </div>
                  </div>

                  {/* 同级 KR */}
                  {okrContext.siblings.map(s => (
                    <div key={s.id} className="flex items-start gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                      <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0 mt-1.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug">{s.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor(s.status)}`}>
                            {statusLabel(s.status)}
                          </span>
                          {typeof s.progress === 'number' && (
                            <span className="text-[10px] text-slate-400">{s.progress}%</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 历史相似 KR */}
            {okrContext && okrContext.similar_krs.length > 0 && (
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
                  <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">历史相似 KR</p>
                </div>
                <div className="space-y-1.5">
                  {okrContext.similar_krs.map(s => (
                    <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/30">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.status === 'completed' ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                      <p className="text-xs text-slate-500 dark:text-slate-400 flex-1 leading-snug">{s.title}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {s.status === 'completed' && <Check className="w-3 h-3 text-emerald-500" />}
                        <span className="text-[10px] text-slate-400">{s.progress ?? 0}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 支撑依据 */}
            {okrContext && okrContext.learnings.length > 0 && (
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                  <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">支撑依据</p>
                </div>
                <div className="space-y-1.5">
                  {okrContext.learnings.map(l => (
                    <div key={l.id} className="px-3 py-2 rounded-lg border border-slate-100 dark:border-slate-700/50">
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-snug">{l.title}</p>
                      {l.content && (
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                          {l.content.slice(0, 120)}{l.content.length > 120 ? '…' : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 如果没有加载到 OKR 上下文，显示基本信息 */}
            {!okrContext && (
              <section>
                <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-2 font-medium">KR</p>
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{krTitle}</p>
                </div>
              </section>
            )}

            {/* 确认放行 */}
            <section className="pt-2 pb-4">
              {!isApproved && krId ? (
                <button
                  onClick={handleApprove}
                  disabled={approving}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  {approving
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Check className="w-4 h-4" />}
                  确认放行 KR
                </button>
              ) : isApproved ? (
                <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                  <Check className="w-4 h-4" /> 已放行，系统将自动开始拆解
                </p>
              ) : (
                <p className="text-xs text-slate-400">无法识别 KR ID，请刷新重试</p>
              )}
            </section>

          </div>
        </div>

        {/* ════ 右侧：与秋米讨论（35%）════ */}
        <div className="flex flex-col min-h-0 overflow-hidden" style={{ flex: '0 0 35%' }}>

          {/* 秋米头部 */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 shrink-0">
            <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
              <Leaf className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">秋米</span>
              <span className="text-[11px] text-slate-400">KR 定义质量分析</span>
            </div>
          </div>

          {/* 消息列表 */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3 bg-slate-50/30 dark:bg-slate-800/10"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 py-12">
                <Leaf className="w-8 h-8 text-violet-200 dark:text-violet-800 mb-3" />
                <p className="text-xs">告诉秋米你对这个 KR 的想法</p>
                <p className="text-[11px] mt-1 opacity-60">秋米会帮你评估 KR 定义质量</p>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'autumnrice' && (
                  <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0 mt-0.5">
                    <Leaf className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  m.role === 'user'
                    ? 'bg-violet-600 text-white rounded-tr-sm'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-tl-sm shadow-sm'
                }`}>
                  {m.role === 'user'
                    ? <p className="text-sm whitespace-pre-wrap">{m.text}</p>
                    : renderMarkdown(m.text)
                  }
                  {m.redecomp && (
                    <p className="mt-1.5 text-[10px] text-violet-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      重拆任务已发起
                    </p>
                  )}
                  <p className={`text-[10px] mt-1 ${m.role === 'user' ? 'text-violet-200 text-right' : 'text-slate-400'}`}>
                    {m.role === 'autumnrice' ? '秋米 · ' : ''}{formatTime(m.ts)}
                  </p>
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                  <Leaf className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-sm px-3 py-2 shadow-sm">
                  <div className="flex gap-1 items-center h-4">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {redecompNotice && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <p className="text-xs">系统正在重新拆解此 KR，请稍后刷新查看</p>
              </div>
            )}
          </div>

          {/* 输入区 */}
          <div className="shrink-0 border-t border-slate-100 dark:border-slate-700/50 px-4 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="告诉秋米你的想法..."
                rows={2}
                className="flex-1 resize-none text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 outline-none focus:border-violet-400 dark:focus:border-violet-500 transition-colors text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="shrink-0 w-9 h-9 rounded-xl bg-violet-500 hover:bg-violet-600 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
