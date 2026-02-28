import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Leaf, Send, Check, Loader2, Clock, GitBranch,
  ChevronDown, ChevronRight, Pencil,
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
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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

// 简洁 Markdown 渲染：粗体 / 行内代码 / 标题 / 列表，不渲染表格和分隔线
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

    // 跳过空行和分隔线（--- / ===）
    if (line.trim() === '' || /^[-=]{3,}$/.test(line.trim())) {
      i++;
      continue;
    }

    // 标题 → 加粗小字
    const headMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headMatch) {
      elements.push(
        <p key={i} className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-2 mb-0.5">
          {renderInline(headMatch[2])}
        </p>
      );
      i++;
      continue;
    }

    // 列表
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

    // 普通段落
    elements.push(
      <p key={i} className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

// Initiative 内联编辑组件
function EditableInitiative({
  name, index, actionId, allInitiatives, onSave,
}: {
  name: string;
  index: number;
  actionId: string;
  allInitiatives: string[];
  onSave: (newList: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) { setEditing(false); setValue(name); return; }
    setSaving(true);
    const next = [...allInitiatives];
    next[index] = trimmed;
    try {
      await fetch(`/api/brain/pending-actions/${actionId}/context`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initiatives: next }),
      });
      onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { setEditing(false); setValue(name); }
          }}
          onBlur={save}
          className="flex-1 text-xs bg-white dark:bg-slate-900 border border-violet-400 rounded px-1.5 py-0.5 outline-none text-slate-700 dark:text-slate-200"
        />
        {saving && <Loader2 className="w-3 h-3 animate-spin text-slate-400 shrink-0" />}
      </div>
    );
  }

  return (
    <button
      className="group flex items-center gap-1.5 w-full text-left py-0.5"
      onClick={() => setEditing(true)}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
      <span className="text-xs text-slate-600 dark:text-slate-300 flex-1 leading-snug">{name}</span>
      <Pencil className="w-2.5 h-2.5 text-transparent group-hover:text-violet-400 transition-colors shrink-0" />
    </button>
  );
}

export default function OkrReviewPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [action, setAction] = useState<PendingAction | null>(null);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initiatives, setInitiatives] = useState<string[]>([]);

  const [expandedVersionIdx, setExpandedVersionIdx] = useState<number | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [redecompNotice, setRedecompNotice] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAction = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/brain/pending-actions/${id}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setAction(data.action);
      const ctxInitiatives = Array.isArray(data.action.context?.initiatives)
        ? data.action.context.initiatives as string[]
        : [];
      setInitiatives(ctxInitiatives);
      setMessages(extractMessages(data.action.comments || []));
    } catch {
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
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadAction(), loadVersions()]);
      setLoading(false);
    };
    init();
  }, [loadAction, loadVersions]);

  // 版本加载后自动展开当前版本
  useEffect(() => {
    if (versions.length > 0) {
      const idx = versions.findIndex(v => v.id === id);
      setExpandedVersionIdx(idx >= 0 ? idx : versions.length - 1);
    }
  }, [versions, id]);

  // 重拆后轮询新版本
  useEffect(() => {
    if (redecompNotice) {
      pollRef.current = setInterval(loadVersions, 15000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [redecompNotice, loadVersions]);

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
        text: '网络超时，稍后重试。（重拆任务可能已发起）',
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

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
    </div>
  );

  if (error || !action) return (
    <div className="p-6">
      <button onClick={() => navigate('/inbox')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> 返回收件箱
      </button>
      <p className="text-slate-500">{error || '未找到该条目'}</p>
    </div>
  );

  const ctx = action.context;
  const currentVersionIdx = versions.findIndex(v => v.id === id);
  const versionLabel = currentVersionIdx >= 0 ? `V${currentVersionIdx + 1}` : 'V1';
  const hasVersions = versions.length > 1;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-slate-900">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <button
          onClick={() => navigate('/inbox')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          收件箱
        </button>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <GitBranch className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0">
          {ctx.kr_title as string || 'OKR 拆解讨论'}
        </span>
        {action.status === 'approved' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 shrink-0">
            已放行
          </span>
        )}
      </div>

      {/* 主体：左面板 + 右聊天 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ─── 左面板 ─── */}
        <div className="w-60 xl:w-64 flex flex-col border-r border-slate-200 dark:border-slate-700 overflow-hidden shrink-0">
          {/* KR 基本信息 */}
          <div className="px-3 py-3 border-b border-slate-100 dark:border-slate-700/50 shrink-0 space-y-2">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">KR</p>
              <p className="text-xs text-slate-700 dark:text-slate-200 leading-snug">{ctx.kr_title as string || '—'}</p>
            </div>
            {ctx.project_name && (
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Project</p>
                <p className="text-xs text-slate-600 dark:text-slate-300">{ctx.project_name as string}</p>
              </div>
            )}
          </div>

          {/* 版本列表（手风琴） */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-2 flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-slate-400" />
              <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                {hasVersions ? `版本历史（${versions.length}）` : 'Initiatives'}
              </span>
            </div>

            {hasVersions ? (
              /* 多版本手风琴 */
              <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {versions.map((v, idx) => {
                  const isCurrentVersion = v.id === id;
                  const isExpanded = expandedVersionIdx === idx;
                  const vInitiatives = Array.isArray(v.context.initiatives)
                    ? v.context.initiatives as string[]
                    : [];

                  return (
                    <div key={v.id}>
                      <button
                        onClick={() => setExpandedVersionIdx(isExpanded ? null : idx)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                          isCurrentVersion
                            ? 'bg-violet-50/60 dark:bg-violet-900/10 hover:bg-violet-50 dark:hover:bg-violet-900/20'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'
                        }`}
                      >
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                          isCurrentVersion
                            ? 'bg-violet-500 text-white'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                        }`}>
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                              V{idx + 1}
                            </span>
                            {isCurrentVersion && (
                              <span className="text-[9px] text-violet-500">当前</span>
                            )}
                          </div>
                          <span className="text-[9px] text-slate-400">{formatDate(v.created_at)}</span>
                        </div>
                        {isExpanded
                          ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                          : <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
                      </button>

                      {isExpanded && (
                        <div className="px-3 pb-2.5 pt-1 bg-slate-50/50 dark:bg-slate-800/20">
                          {vInitiatives.length > 0 ? (
                            <ul className="space-y-0.5">
                              {vInitiatives.map((name, nidx) => (
                                <li key={nidx}>
                                  {isCurrentVersion ? (
                                    <EditableInitiative
                                      name={name}
                                      index={nidx}
                                      actionId={id!}
                                      allInitiatives={initiatives}
                                      onSave={setInitiatives}
                                    />
                                  ) : (
                                    <div className="flex items-start gap-1.5 py-0.5">
                                      <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0 mt-1.5" />
                                      <span className="text-xs text-slate-500 dark:text-slate-400 leading-snug">{name}</span>
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-[10px] text-slate-400 italic">无 Initiative</p>
                          )}
                          {!isCurrentVersion && (
                            <button
                              onClick={() => navigate(`/okr/review/${v.id}`)}
                              className="mt-2 text-[10px] text-violet-500 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                            >
                              切换到此版本 →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* 单版本：直接显示 initiatives（可编辑） */
              <div className="px-3 pb-3">
                {initiatives.length > 0 ? (
                  <ul className="space-y-0.5">
                    {initiatives.map((name, idx) => (
                      <li key={idx}>
                        <EditableInitiative
                          name={name}
                          index={idx}
                          actionId={id!}
                          allInitiatives={initiatives}
                          onSave={setInitiatives}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400 italic">尚无 Initiative</p>
                )}
                {ctx.decomposed_at && (
                  <p className="text-[10px] text-slate-400 mt-2">
                    {new Date(ctx.decomposed_at as string).toLocaleString('zh-CN')}
                  </p>
                )}
              </div>
            )}

            {redecompNotice && (
              <div className="px-3 pb-3">
                <p className="text-[10px] text-violet-500 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  重拆进行中，新版本出现后自动更新...
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ─── 右侧聊天区 ─── */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          {/* 秋米头部 + 版本标识 */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-700/50 shrink-0 bg-white dark:bg-slate-900">
            <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
              <Leaf className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            </div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">秋米</span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{versionLabel} 版本对话</span>
          </div>

          {/* 消息列表（固定高度，内部滚动） */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50/50 dark:bg-slate-800/20 min-h-0"
          >
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full text-center text-xs text-slate-400 py-16">
                <div>
                  <Leaf className="w-8 h-8 text-violet-200 dark:text-violet-800 mx-auto mb-2" />
                  <p>有什么疑问或修改意见？直接告诉秋米...</p>
                  <p className="text-[10px] mt-1 opacity-60">说「重新拆」可触发重拆</p>
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'autumnrice' && (
                  <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0 mt-0.5">
                    <Leaf className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                  m.role === 'user'
                    ? 'bg-violet-600 text-white rounded-tr-sm'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-tl-sm shadow-sm'
                }`}>
                  {m.role === 'user' ? (
                    <p className="text-sm whitespace-pre-wrap">{m.text}</p>
                  ) : (
                    renderMarkdown(m.text)
                  )}
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
              <div className="flex gap-2 items-start">
                <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                  <Loader2 className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 animate-spin" />
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-sm px-3 py-2 shadow-sm">
                  <p className="text-xs text-slate-400">秋米思考中...</p>
                </div>
              </div>
            )}
          </div>

          {/* 确认放行（仅 pending_approval 状态） */}
          {action.status === 'pending_approval' && (
            <div className="px-4 py-1.5 border-t border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-800/80 shrink-0">
              <button
                onClick={handleApprove}
                disabled={approving || sending}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 transition-colors"
              >
                {approving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {approving ? '放行中...' : '确认放行'}
              </button>
            </div>
          )}

          {/* 输入区 */}
          <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 shrink-0">
            <div className="flex items-end gap-2 bg-slate-50 dark:bg-slate-700/50 rounded-2xl px-3 py-2 border border-slate-200 dark:border-slate-600 focus-within:border-violet-400 dark:focus-within:border-violet-600 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="告诉秋米你的想法... (Enter 发送，Shift+Enter 换行)"
                disabled={sending || approving}
                rows={1}
                className="flex-1 text-sm bg-transparent border-none outline-none resize-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400 leading-relaxed max-h-28 overflow-y-auto"
                style={{ fieldSizing: 'content' } as React.CSSProperties}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending || approving}
                className="p-1.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
