/**
 * WarRoomLineCommandPage — Line 指挥页（只读）
 *
 * 路由：/warroom/line/:id（由 /pipeline 下钻进入）
 * 数据：GET /api/brain/warroom/line/:id/command
 *
 * 三块内容：
 *   1. 军师决策流水 — 该 line 的历史决策（notes 表前缀 `军师决策[<Line名>]`），时间倒序
 *   2. 连接全景图 — Ability/Feature + 推进项 + 进行中任务 + open issues + 近期 harness runs
 *   3. 节奏与健康度 — 近30天 run 成功率 + PR 频率 + 是否停线
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Brain, Layers, Activity,
  CheckCircle2, XCircle, Clock, GitPullRequest, AlertCircle,
  Zap, FileText, ChevronRight, TrendingUp, Plus, MessageSquare,
} from 'lucide-react';

// ── 类型 ────────────────────────────────────────────────────────────────────

interface LineInfo {
  id: string;
  name: string;
  description: string | null;
  status: string;
  maturity: string | null;
}

interface Decision {
  id: string;
  title: string;
  content: string | null;
  type: string | null;
  created_at: string;
}

interface JourneyFeature {
  id: string;
  name: string;
  kind: 'ability' | 'feature';
  status: string | null;
  group_name: string | null;
  created_at: string;
}

interface AdvancementItem {
  id: string;
  ability_id: string;
  ability_name: string;
  title: string;
  status: string;
  priority: string | null;
  pr_url: string | null;
  created_at: string;
}

interface ActiveTask {
  id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string | null;
  created_at: string;
  updated_at: string | null;
  pr_url: string | null;
}

interface OpenIssue {
  id: string;
  title: string;
  priority: string | null;
  status: string;
  created_at: string;
}

interface RecentRun {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface Health {
  run_total: number;
  run_success: number;
  success_rate: number | null;
  pr_count: number;
  is_stopped: boolean;
}

interface Conversation {
  id: string;
  journey_id: string;
  title: string | null;
  status: string;
  turn_count: number;
  last_message: string | null;
  last_message_at: string | null;
  updated_at: string;
}

interface ConvMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  turn_marker: string | null;
  created_at: string;
}

interface CommandData {
  line: LineInfo;
  decisions: Decision[];
  connections: {
    abilities: JourneyFeature[];
    features: JourneyFeature[];
    advancements: AdvancementItem[];
    active_tasks: ActiveTask[];
    open_issues: OpenIssue[];
    recent_runs: RecentRun[];
  };
  health: Health;
  generated_at: string;
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

function runStatusColor(status: string): string {
  if (status === 'completed') return 'text-emerald-400';
  if (status === 'failed') return 'text-red-400';
  if (status === 'in_progress') return 'text-blue-400';
  return 'text-slate-500';
}

function featureStatusBadge(status: string | null): string {
  if (!status) return 'bg-slate-700/50 text-slate-500';
  if (status === 'done' || status === 'completed') return 'bg-emerald-500/15 text-emerald-400';
  if (status === 'in_progress') return 'bg-blue-500/15 text-blue-400';
  return 'bg-slate-700/50 text-slate-400';
}

function advStatusIcon(status: string) {
  if (status === 'done' || status === 'completed') return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
  if (status === 'in_progress') return <Clock className="w-3 h-3 text-blue-400 animate-pulse" />;
  return <Clock className="w-3 h-3 text-slate-600" />;
}

// ── 子组件 ────────────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="text-slate-400">{icon}</div>
      <span className="text-[13px] font-semibold text-slate-300 tracking-wider uppercase">{title}</span>
      {count !== undefined && (
        <span className="ml-auto text-[11px] font-mono text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded">{count}</span>
      )}
    </div>
  );
}

function DecisionCard({ d }: { d: Decision }) {
  const [expanded, setExpanded] = useState(false);
  // 从 title 里去掉前缀，剩余为决策摘要
  const summary = d.title.replace(/^军师决策\[[^\]]+\]\s*/, '');
  return (
    <div className="border border-slate-700/50 rounded-lg bg-slate-800/40 p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] text-slate-200 font-medium leading-snug">{summary || d.title}</span>
        <span className="text-[11px] text-slate-600 flex-shrink-0 mt-0.5">{relativeTime(d.created_at)}</span>
      </div>
      {d.content && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] text-blue-400/70 hover:text-blue-300 flex items-center gap-1 transition-colors"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            {expanded ? '收起' : '展开详情'}
          </button>
          {expanded && (
            <pre className="text-[11px] text-slate-400 whitespace-pre-wrap font-sans leading-relaxed bg-slate-900/60 rounded p-2 mt-1">
              {d.content}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function ConnectionsPanel({ connections }: { connections: CommandData['connections'] }) {
  const { abilities, features, advancements, active_tasks, open_issues, recent_runs } = connections;

  const advByAbility = advancements.reduce<Record<string, AdvancementItem[]>>((acc, a) => {
    if (!acc[a.ability_id]) acc[a.ability_id] = [];
    acc[a.ability_id].push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {/* Abilities */}
      {abilities.length > 0 && (
        <div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">Abilities ({abilities.length})</div>
          <div className="space-y-1.5">
            {abilities.map((a) => {
              const advItems = advByAbility[a.id] || [];
              const done = advItems.filter((x) => x.status === 'done' || x.status === 'completed').length;
              return (
                <div key={a.id} className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className="text-[12px] text-slate-200 flex-1 truncate">{a.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${featureStatusBadge(a.status)}`}>
                      {a.status || 'planned'}
                    </span>
                  </div>
                  {advItems.length > 0 && (
                    <div className="mt-2 pl-5 space-y-1">
                      {advItems.slice(0, 3).map((adv) => (
                        <div key={adv.id} className="flex items-center gap-1.5">
                          {advStatusIcon(adv.status)}
                          <span className="text-[11px] text-slate-400 truncate flex-1">{adv.title}</span>
                          {adv.priority && (
                            <span className="text-[10px] text-slate-600 font-mono">{adv.priority}</span>
                          )}
                        </div>
                      ))}
                      {advItems.length > 3 && (
                        <span className="text-[11px] text-slate-600 pl-4">+{advItems.length - 3} 项</span>
                      )}
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="h-[3px] flex-1 rounded-full bg-slate-700 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500/70"
                            style={{ width: `${advItems.length > 0 ? Math.round((done / advItems.length) * 100) : 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-600 font-mono">{done}/{advItems.length}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Features */}
      {features.length > 0 && (
        <div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">Features ({features.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {features.map((f) => (
              <span key={f.id} className={`text-[11px] px-2 py-0.5 rounded border ${featureStatusBadge(f.status)} border-slate-700/40`}>
                {f.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Active Tasks */}
      {active_tasks.length > 0 && (
        <div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">进行中任务 ({active_tasks.length})</div>
          <div className="space-y-1.5">
            {active_tasks.map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-1.5 px-2.5 bg-slate-800/30 rounded border border-slate-700/30">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                <span className="text-[12px] text-slate-300 flex-1 truncate">{t.title}</span>
                <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">{t.task_type}</span>
                {t.pr_url && (
                  <a href={t.pr_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    <GitPullRequest className="w-3 h-3 text-purple-400" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Issues */}
      {open_issues.length > 0 && (
        <div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">Open Issues ({open_issues.length})</div>
          <div className="space-y-1">
            {open_issues.map((i) => (
              <div key={i.id} className="flex items-center gap-2 py-1 px-2.5 bg-red-900/10 border border-red-900/20 rounded">
                <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                <span className="text-[12px] text-slate-300 flex-1 truncate">{i.title}</span>
                {i.priority && <span className="text-[10px] text-red-400 font-mono">{i.priority}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Runs */}
      {recent_runs.length > 0 && (
        <div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">近期 Harness Runs</div>
          <div className="space-y-1">
            {recent_runs.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1 px-2.5 rounded border border-slate-700/30 bg-slate-800/20">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  r.status === 'completed' ? 'bg-emerald-400' :
                  r.status === 'failed' ? 'bg-red-400' :
                  r.status === 'in_progress' ? 'bg-blue-400 animate-pulse' : 'bg-slate-600'
                }`} />
                <span className={`text-[11px] font-mono ${runStatusColor(r.status)}`}>{r.status}</span>
                <span className="text-[11px] text-slate-600 ml-auto">{relativeTime(r.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {abilities.length === 0 && features.length === 0 && active_tasks.length === 0 &&
        open_issues.length === 0 && recent_runs.length === 0 && (
        <div className="text-[12px] text-slate-600 text-center py-4">该 Line 暂无连接数据</div>
      )}
    </div>
  );
}

function HealthPanel({ health }: { health: Health }) {
  const { run_total, run_success, success_rate, pr_count, is_stopped } = health;
  return (
    <div className="space-y-3">
      {is_stopped && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-700/30 rounded-lg">
          <XCircle className="w-4 h-4 text-red-400" />
          <span className="text-[12px] text-red-400 font-medium">该 Line 已停线</span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 text-center">
          <div className="text-[22px] font-bold font-mono text-slate-200">{run_total}</div>
          <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">近30天 Runs</div>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 text-center">
          <div className={`text-[22px] font-bold font-mono ${
            success_rate === null ? 'text-slate-500' :
            success_rate >= 70 ? 'text-emerald-400' :
            success_rate >= 40 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {success_rate !== null ? `${success_rate}%` : '—'}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">成功率</div>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 text-center">
          <div className="text-[22px] font-bold font-mono text-slate-200">{pr_count}</div>
          <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">近30天 PR</div>
        </div>
      </div>
      {run_total > 0 && (
        <div>
          <div className="flex justify-between text-[11px] text-slate-500 mb-1">
            <span>成功 {run_success} / 总计 {run_total}</span>
            <span>{success_rate ?? 0}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                (success_rate ?? 0) >= 70 ? 'bg-emerald-500' :
                (success_rate ?? 0) >= 40 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${success_rate ?? 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function turnMarkerLabel(marker: string | null): string | null {
  if (!marker) return null;
  if (marker === 'chat') return null;
  if (marker === 'pending_user') return '等待拍板';
  if (marker.startsWith('decision_saved=')) return '已落决策';
  return null;
}

export function convTitle(conv: { title: string | null; id: string }): string {
  return conv.title || `对话 #${conv.id.slice(0, 6)}`;
}

export function truncateMsg(text: string, maxLen = 60): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

function ConversationsPanel({ journeyId }: { journeyId: string }) {
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
      const res = await fetch(`/api/brain/conversations?journey_id=${encodeURIComponent(journeyId)}&limit=20`);
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {
      setConvError('加载对话列表失败');
    } finally {
      setLoadingConvs(false);
    }
  }, [journeyId]);

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
      const res = await fetch('/api/brain/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          journey_id: journeyId,
          title: `议题 ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        }),
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
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => openConv(conv)}
              className="w-full text-left bg-slate-800/40 hover:bg-slate-700/40 border border-slate-700/50 rounded-lg p-2.5 transition-colors"
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[12px] text-slate-200 truncate flex-1 font-medium">
                  {conv.title || `对话 #${conv.id.slice(0, 6)}`}
                </span>
                <span className="text-[10px] text-slate-600 flex-shrink-0">{relativeTime(conv.updated_at)}</span>
              </div>
              {conv.last_message && (
                <div className="text-[11px] text-slate-500 truncate">{conv.last_message}</div>
              )}
              <div className="text-[10px] text-slate-700 font-mono mt-0.5">{conv.turn_count} 轮</div>
            </button>
          ))}
        </div>
      )}

      {convError && <div className="text-[10px] text-red-400 mt-2">{convError}</div>}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function WarRoomLineCommandPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CommandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/brain/warroom/line/${encodeURIComponent(id)}/command`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">加载指挥数据…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <div className="text-sm text-red-400">{error || '数据加载失败'}</div>
          <button
            onClick={() => navigate('/pipeline')}
            className="text-sm text-blue-400 hover:text-blue-300 underline"
          >
            返回战情室
          </button>
        </div>
      </div>
    );
  }

  const { line, decisions, connections, health } = data;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-800/60 bg-slate-900/80 backdrop-blur px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate('/pipeline')}
          className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-slate-100 truncate">{line.name}</span>
          <span className="text-[11px] text-slate-600 px-1.5 py-0.5 bg-slate-800 rounded font-mono flex-shrink-0">
            {line.status}
          </span>
          {line.maturity && (
            <span className="text-[10px] text-slate-600 flex-shrink-0">{line.maturity}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-slate-600 hidden sm:block">
            {new Date(data.generated_at).toLocaleTimeString('zh-CN')}
          </span>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Body — 四栏 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-0 h-full">
          {/* 栏 1：军师决策流水 */}
          <div className="border-r border-slate-800/40 p-4 space-y-3 lg:overflow-y-auto lg:max-h-[calc(100vh-60px)]">
            <SectionHeader
              icon={<Brain className="w-4 h-4" />}
              title="军师决策流水"
              count={decisions.length}
            />
            {decisions.length === 0 ? (
              <div className="text-[12px] text-slate-600 text-center py-6">
                <FileText className="w-5 h-5 mx-auto mb-2 opacity-40" />
                暂无决策记录
              </div>
            ) : (
              <div className="space-y-2">
                {decisions.map((d) => <DecisionCard key={d.id} d={d} />)}
              </div>
            )}
          </div>

          {/* 栏 2：连接全景图 */}
          <div className="border-r border-slate-800/40 p-4 lg:overflow-y-auto lg:max-h-[calc(100vh-60px)]">
            <SectionHeader
              icon={<Layers className="w-4 h-4" />}
              title="连接全景图"
            />
            <ConnectionsPanel connections={connections} />
          </div>

          {/* 栏 3：节奏与健康度 */}
          <div className="border-r border-slate-800/40 p-4 lg:overflow-y-auto lg:max-h-[calc(100vh-60px)]">
            <SectionHeader
              icon={<Activity className="w-4 h-4" />}
              title="节奏与健康度"
            />
            <HealthPanel health={health} />

            {/* line description */}
            {line.description && (
              <div className="mt-5">
                <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">Line 简介</div>
                <p className="text-[12px] text-slate-400 leading-relaxed">{line.description}</p>
              </div>
            )}

            {/* 快速跳转 */}
            <div className="mt-5">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">快捷跳转</div>
              <button
                onClick={() => navigate('/pipeline')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded border border-slate-700/50 hover:bg-slate-800/50 text-[12px] text-slate-400 hover:text-slate-200 transition-colors"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                返回战情室总览
                <ChevronRight className="w-3.5 h-3.5 ml-auto" />
              </button>
            </div>
          </div>

          {/* 栏 4：议题对话 */}
          <div className="p-4 flex flex-col lg:max-h-[calc(100vh-60px)]">
            <ConversationsPanel journeyId={line.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
