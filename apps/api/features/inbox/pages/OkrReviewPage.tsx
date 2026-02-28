import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Leaf, Send, Check, Loader2, GitBranch, Pencil, Clock,
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

// 简洁 Markdown：粗体 / 行内代码 / 标题 / 列表，过滤分隔线和表格
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

// Initiative 内联编辑
function EditableInitiative({
  name, index, actionId, allInitiatives, onSave,
}: {
  name: string; index: number; actionId: string;
  allInitiatives: string[]; onSave: (newList: string[]) => void;
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
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { setEditing(false); setValue(name); }
          }}
          onBlur={save}
          className="flex-1 text-sm bg-white dark:bg-slate-800 border border-violet-400 rounded-lg px-3 py-1.5 outline-none text-slate-700 dark:text-slate-200"
        />
        {saving && <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />}
      </div>
    );
  }

  return (
    <button
      className="group flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/10 transition-colors"
      onClick={() => setEditing(true)}
    >
      <span className="w-2 h-2 rounded-full bg-violet-400 shrink-0" />
      <span className="text-sm text-slate-700 dark:text-slate-200 flex-1 leading-snug">{name}</span>
      <Pencil className="w-3.5 h-3.5 text-transparent group-hover:text-violet-400 transition-colors shrink-0" />
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

  // 横向 Tab 当前选中的版本索引
  const [activeTabIdx, setActiveTabIdx] = useState<number>(0);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [redecompNotice, setRedecompNotice] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 新版本创建后，下次 versions 状态更新时自动切换到最新 Tab
  const switchToLatestRef = useRef(false);

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

  // 版本加载后默认选中当前版本的 Tab；新版本创建后自动切到最新 Tab
  useEffect(() => {
    if (versions.length > 0) {
      if (switchToLatestRef.current) {
        setActiveTabIdx(versions.length - 1);
        switchToLatestRef.current = false;
      } else {
        const idx = versions.findIndex(v => v.id === id);
        setActiveTabIdx(idx >= 0 ? idx : versions.length - 1);
      }
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
      // 新版本创建：设置切换标志 + 立即刷新版本列表
      if (data.version_created && data.new_version_id) {
        switchToLatestRef.current = true;
        loadVersions();
      }
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
    <div className="p-8">
      <button onClick={() => navigate('/inbox')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> 返回收件箱
      </button>
      <p className="text-slate-500">{error || '未找到该条目'}</p>
    </div>
  );

  const ctx = action.context;
  const hasVersions = versions.length > 1;

  // 当前 Tab 对应的版本数据
  const activeVersion = hasVersions ? versions[activeTabIdx] : null;
  const activeVersionId = activeVersion?.id ?? id;
  const isCurrentVersion = activeVersionId === id;
  const activeInitiatives: string[] = hasVersions
    ? (Array.isArray(activeVersion?.context.initiatives) ? activeVersion!.context.initiatives as string[] : [])
    : initiatives;

  const currentVersionIdx = hasVersions ? versions.findIndex(v => v.id === id) : 0;
  const versionLabel = currentVersionIdx >= 0 ? `V${currentVersionIdx + 1}` : 'V1';

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
        <GitBranch className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0">
          {ctx.kr_title as string || 'OKR 拆解讨论'}
        </span>
        {action.status === 'approved' && (
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 shrink-0 font-medium">
            已放行
          </span>
        )}
      </div>

      {/* ─── 主体：内容区 65% + 聊天侧栏 35% ─── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ════ 内容主区域（65%）════ */}
        <div className="flex flex-col min-h-0 overflow-hidden border-r border-slate-200 dark:border-slate-700" style={{ flex: '0 0 65%' }}>

          {/* 版本横向 Tab */}
          {hasVersions && (
            <div className="flex items-center gap-1 px-6 py-2.5 border-b border-slate-100 dark:border-slate-700/50 shrink-0 bg-slate-50/50 dark:bg-slate-800/20">
              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-1" />
              {versions.map((v, idx) => {
                const isCurrent = v.id === id;
                const isActive = idx === activeTabIdx;
                return (
                  <button
                    key={v.id}
                    onClick={() => setActiveTabIdx(idx)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-violet-500 text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                    title={formatDate(v.created_at)}
                  >
                    V{idx + 1}
                    {isCurrent && (
                      <span className={`text-[9px] ${isActive ? 'text-violet-200' : 'text-violet-500'}`}>当前</span>
                    )}
                  </button>
                );
              })}
              {redecompNotice && (
                <span className="ml-2 flex items-center gap-1 text-[11px] text-violet-500">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  重拆中，新版本稍后出现
                </span>
              )}
            </div>
          )}

          {/* KR + Project 信息 */}
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700/50 shrink-0 space-y-2">
            <div>
              <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-1 font-medium">KR</p>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">
                {ctx.kr_title as string || '—'}
              </p>
            </div>
            {ctx.project_name && (
              <div>
                <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-1 font-medium">Project</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">{ctx.project_name as string}</p>
              </div>
            )}
            {activeVersion && (
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDate(activeVersion.created_at)}
                {!isCurrentVersion && (
                  <button
                    onClick={() => navigate(`/okr/review/${activeVersionId}`)}
                    className="ml-2 text-violet-500 hover:text-violet-700 transition-colors"
                  >
                    切换到此版本 →
                  </button>
                )}
              </p>
            )}
          </div>

          {/* Initiative 列表（可滚动） */}
          <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
            <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-3 font-medium">
              拆解方案 · {activeInitiatives.length} 个 Initiative
            </p>

            {activeInitiatives.length > 0 ? (
              <div className="space-y-1">
                {activeInitiatives.map((name, idx) => (
                  <div key={idx}>
                    {isCurrentVersion ? (
                      <EditableInitiative
                        name={name}
                        index={idx}
                        actionId={id!}
                        allInitiatives={initiatives}
                        onSave={setInitiatives}
                      />
                    ) : (
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0" />
                        <span className="text-sm text-slate-500 dark:text-slate-400 leading-snug">{name}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-slate-400">
                <p className="text-sm">尚无 Initiative</p>
              </div>
            )}
          </div>

          {/* 底部：确认放行 */}
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700/50 shrink-0">
            {isCurrentVersion && action.status !== 'approved' ? (
              <button
                onClick={handleApprove}
                disabled={approving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {approving
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Check className="w-4 h-4" />}
                确认放行
              </button>
            ) : action.status === 'approved' ? (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <Check className="w-4 h-4" /> 已放行
              </p>
            ) : (
              <p className="text-xs text-slate-400">切换到当前版本后可确认放行</p>
            )}
          </div>
        </div>

        {/* ════ 聊天侧栏（35%）════ */}
        <div className="flex flex-col min-h-0 overflow-hidden" style={{ flex: '0 0 35%' }}>

          {/* 秋米头部 */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 shrink-0">
            <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
              <Leaf className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">秋米</span>
              <span className="text-[11px] text-slate-400">{versionLabel} 版本对话</span>
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
                <p className="text-xs">有想法直接告诉秋米</p>
                <p className="text-[11px] mt-1 opacity-60">说「重新拆」可触发重拆</p>
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
