import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Leaf, Send, Check, Loader2, Clock, GitBranch, ChevronDown, ChevronUp,
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

// 轻量 Markdown 渲染：支持粗体、行内代码、表格、列表、分隔线
function renderMarkdown(text: string): React.ReactElement {
  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];
  let i = 0;

  const renderInline = (line: string): React.ReactElement => {
    // 粗体 **text**
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
      <span>
        {parts.map((part, idx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={idx}>{part.slice(2, -2)}</strong>;
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

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 水平线
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-slate-200 dark:border-slate-600 my-2" />);
      i++;
      continue;
    }

    // 标题 ## ###
    const headMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headMatch) {
      const level = headMatch[1].length;
      const className = level === 1
        ? 'text-sm font-bold text-slate-800 dark:text-slate-100 mt-2 mb-1'
        : level === 2
        ? 'text-xs font-semibold text-slate-700 dark:text-slate-200 mt-1.5 mb-1'
        : 'text-xs font-medium text-slate-600 dark:text-slate-300 mt-1 mb-0.5';
      elements.push(<p key={i} className={className}>{renderInline(headMatch[2])}</p>);
      i++;
      continue;
    }

    // 表格（检测到 | 开头的连续行）
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      // 过滤分隔行 |---|---|
      const filtered = tableLines.filter(l => !/^\|[\s:|-]+\|/.test(l.trim()));
      if (filtered.length > 0) {
        const rows = filtered.map(l =>
          l.split('|').map(c => c.trim()).filter(c => c !== '')
        );
        const [header, ...body] = rows;
        elements.push(
          <div key={i} className="overflow-x-auto my-1.5">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>
                  {header.map((h, idx) => (
                    <th key={idx} className="px-2 py-1 text-left font-semibold border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50">
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ridx) => (
                  <tr key={ridx} className="even:bg-slate-50/50 dark:even:bg-slate-700/20">
                    {row.map((cell, cidx) => (
                      <td key={cidx} className="px-2 py-1 border border-slate-200 dark:border-slate-600">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // 列表 - item 或 * item
    if (/^[-*]\s/.test(line.trim())) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        listItems.push(lines[i].replace(/^[-*]\s/, '').trim());
        i++;
      }
      elements.push(
        <ul key={i} className="my-1 space-y-0.5 pl-3">
          {listItems.map((item, idx) => (
            <li key={idx} className="flex items-start gap-1.5 text-xs">
              <span className="w-1 h-1 rounded-full bg-current mt-1.5 shrink-0 opacity-50" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 普通段落
    elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

export default function OkrReviewPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [action, setAction] = useState<PendingAction | null>(null);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLeftPanel, setShowLeftPanel] = useState(false);

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

  useEffect(() => {
    if (redecompNotice) {
      pollRef.current = setInterval(loadVersions, 15000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [redecompNotice, loadVersions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending]);

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
        text: '网络超时，稍后重试。（如果你在请求重拆，重拆任务可能已发起）',
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
  const initiatives = Array.isArray(ctx.initiatives) ? ctx.initiatives as string[] : [];
  const currentVersionIdx = versions.findIndex(v => v.id === id);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部导航栏 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <button
          onClick={() => navigate('/inbox')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          收件箱
        </button>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <GitBranch className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
            {ctx.kr_title as string || 'OKR 拆解讨论'}
          </span>
          {versions.length > 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 shrink-0">
              v{currentVersionIdx + 1}/{versions.length}
            </span>
          )}
        </div>

        {/* 折叠/展开左面板按钮（移动端） */}
        <button
          onClick={() => setShowLeftPanel(!showLeftPanel)}
          className="lg:hidden flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1"
        >
          {showLeftPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          详情
        </button>

        {/* 状态 */}
        {action.status === 'approved' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 shrink-0">
            已放行
          </span>
        )}
      </div>

      {/* 主体：左面板 + 右聊天 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* 左面板：KR 信息 + 版本历史 */}
        <div className={`${showLeftPanel ? 'flex' : 'hidden'} lg:flex flex-col w-64 xl:w-72 border-r border-slate-200 dark:border-slate-700 overflow-y-auto shrink-0`}>

          {/* KR + 拆解结果 */}
          <div className="p-4 space-y-3">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">KR</p>
              <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">{ctx.kr_title as string || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Project</p>
              <p className="text-xs text-slate-700 dark:text-slate-200">{ctx.project_name as string || '—'}</p>
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
                <p className="text-xs text-slate-400 italic">尚无 Initiative</p>
              )}
              {ctx.decomposed_at && (
                <p className="text-[10px] text-slate-400 mt-1.5">
                  {new Date(ctx.decomposed_at as string).toLocaleString('zh-CN')}
                </p>
              )}
            </div>
          </div>

          {/* 版本历史 */}
          {versions.length > 0 && (
            <div className="border-t border-slate-100 dark:border-slate-700/50 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock className="w-3 h-3 text-slate-400" />
                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">版本历史</span>
              </div>
              <div className="space-y-1">
                {versions.map((v, idx) => (
                  <button
                    key={v.id}
                    onClick={() => v.id !== id && navigate(`/okr/review/${v.id}`)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-colors ${
                      v.id === id
                        ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                        : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[9px] font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <span className="flex-1 truncate">{v.id === id ? '当前' : `v${idx + 1}`}</span>
                    <span className="text-[9px] text-slate-400">{formatDate(v.created_at)}</span>
                  </button>
                ))}
              </div>
              {redecompNotice && (
                <p className="mt-2 text-[10px] text-violet-500 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  重拆进行中...
                </p>
              )}
            </div>
          )}
        </div>

        {/* 右侧：聊天区（主体） */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* 秋米头部 */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700/50 shrink-0">
            <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
              <Leaf className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            </div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">秋米</span>
            <span className="text-xs text-slate-400">OKR 拆解专家</span>
          </div>

          {/* 消息列表（可滚动） */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50/50 dark:bg-slate-800/30"
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
                <div className={`max-w-[75%] rounded-2xl px-3 py-2.5 ${
                  m.role === 'user'
                    ? 'bg-violet-600 text-white rounded-tr-sm'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-tl-sm shadow-sm'
                }`}>
                  {m.role === 'user' ? (
                    <p className="text-sm whitespace-pre-wrap">{m.text}</p>
                  ) : (
                    <div className={`text-sm ${m.role === 'autumnrice' ? '' : ''}`}>
                      {renderMarkdown(m.text)}
                    </div>
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
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-sm px-3 py-2.5 shadow-sm">
                  <p className="text-xs text-slate-400">秋米思考中...</p>
                </div>
              </div>
            )}
          </div>

          {/* 确认放行 banner（仅 pending_approval 状态） */}
          {action.status === 'pending_approval' && (
            <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-800/80 shrink-0">
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
          <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shrink-0">
            <div className="flex items-end gap-2 bg-slate-50 dark:bg-slate-700/50 rounded-2xl px-3 py-2 border border-slate-200 dark:border-slate-600 focus-within:border-violet-400 dark:focus-within:border-violet-600 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="告诉秋米你的想法... (Enter 发送，Shift+Enter 换行)"
                disabled={sending || approving}
                rows={1}
                className="flex-1 text-sm bg-transparent border-none outline-none resize-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400 leading-relaxed max-h-32 overflow-y-auto"
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
