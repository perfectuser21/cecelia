/**
 * ConsciousnessChat v2 — 透明意识界面
 *
 * 根据用户反馈重设计：
 *   - 会话历史持久化（localStorage，新对话保留历史）
 *   - Markdown 渲染（无外部依赖）
 *   - 右侧标签页：大脑 / 记忆 / 事件 / 建议
 *   - 三栏布局：历史+脑层 / 对话 / 标签页
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Brain, Cpu, Zap, MessageSquare, Send, Plus, Activity,
  Loader2, Eye, Layers, ChevronRight, History, BookOpen,
  Radio, ListChecks, Clock,
} from 'lucide-react';
import { useCecelia } from '@/contexts/CeceliaContext';
import { useCeceliaWS, WS_EVENTS } from '../hooks/useCeceliaWS';
import { useNavigate } from 'react-router-dom';
import type { ChatMessage } from '@/contexts/CeceliaContext';

// ── Types ────────────────────────────────────────────────

type RightTab = 'brain' | 'memory' | 'events' | 'suggestions';

interface Session {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatMessage[];
}

interface Learning {
  id: string;
  title: string;
  content: string;
  category: string;
  digested: boolean;
  created_at: string;
}

interface BrainEvent {
  id: number;
  event_type: string;
  source: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

interface Desire {
  id: string;
  type: 'act' | 'warn' | 'inform' | 'propose';
  content: string;
  urgency: number;
  created_at: string;
}

interface Suggestion {
  id: string;
  content: string;
  priority_score: string;
  source: string;
  status: string;
  suggestion_type: string;
  created_at: string;
}

interface BrainState {
  alertness: number;
  alertnessName: string;
  tickRunning: boolean;
  loopRunning: boolean;
  lastTick: string | null;
  nextTick: string | null;
  intervalMinutes: number;
  slotsUsed: number;
  slotsMax: number;
  todayCompleted: number;
  todayFailed: number;
  todayQueued: number;
}

// ── localStorage helpers ──────────────────────────────────

const SESSIONS_KEY = 'cecelia-chat-sessions-v2';
const MAX_SESSIONS = 15;

function loadSessions(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch { /* quota exceeded - ignore */ }
}

// ── Brain history helpers ─────────────────────────────────

interface BrainMsg { role: string; content: string; created_at: string; }

const GAP_MS = 30 * 60 * 1000; // 30 minutes = new conversation

function groupHistoryIntoSessions(msgs: BrainMsg[]): Session[] {
  if (msgs.length === 0) return [];
  // Sort ASC (oldest first)
  const sorted = [...msgs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const groups: BrainMsg[][] = [];
  let current: BrainMsg[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].created_at).getTime();
    const curr = new Date(sorted[i].created_at).getTime();
    if (curr - prev >= GAP_MS) {
      groups.push(current);
      current = [];
    }
    current.push(sorted[i]);
  }
  if (current.length > 0) groups.push(current);
  return groups.map((group, idx) => {
    const firstUser = group.find(m => m.role === 'user');
    const title = (firstUser?.content ?? group[0]?.content ?? 'Cecelia 对话').slice(0, 35);
    const createdAt = group[0].created_at;
    const messages: ChatMessage[] = group.map((m, i) => ({
      id: `brain-msg-${idx}-${i}`,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    return {
      id: `brain-history-${new Date(createdAt).getTime()}`,
      title,
      createdAt,
      messages,
    };
  });
}

// ── Markdown renderer (no deps) ───────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i} style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.75)' }}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} style={{
          fontFamily: 'monospace', fontSize: '0.85em',
          background: 'rgba(167,139,250,0.15)', color: '#c084fc',
          padding: '1px 5px', borderRadius: 4,
        }}>{part.slice(1, -1)}</code>
      );
    }
    return part;
  });
}

function MarkdownMessage({ content, isUser }: { content: string; isUser: boolean }) {
  const baseColor = isUser ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.82)';
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={`code-${i}`} style={{
          background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6, padding: '8px 12px', overflowX: 'auto',
          fontSize: 12, fontFamily: 'monospace', color: '#86efac',
          margin: '6px 0',
        }}>
          {lang && <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>{lang}{'\n'}</span>}
          {codeLines.join('\n')}
        </pre>
      );
      i++;
      continue;
    }

    // H2
    if (line.startsWith('## ')) {
      elements.push(
        <div key={i} style={{
          fontSize: 15, fontWeight: 700, color: '#e2e8f0',
          margin: '8px 0 4px', lineHeight: 1.3,
          borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 4,
        }}>
          {renderInline(line.slice(3))}
        </div>
      );
      i++;
      continue;
    }

    // H3
    if (line.startsWith('### ')) {
      elements.push(
        <div key={i} style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1', margin: '6px 0 2px' }}>
          {renderInline(line.slice(4))}
        </div>
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(
        <div key={i} style={{
          borderLeft: '3px solid rgba(167,139,250,0.4)',
          paddingLeft: 10, color: 'rgba(255,255,255,0.5)',
          fontStyle: 'italic', margin: '4px 0', fontSize: 13,
        }}>
          {renderInline(line.slice(2))}
        </div>
      );
      i++;
      continue;
    }

    // List item
    if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} style={{ display: 'flex', gap: 6, margin: '2px 0', alignItems: 'flex-start' }}>
          <span style={{ color: 'rgba(167,139,250,0.6)', marginTop: 2, flexShrink: 0 }}>•</span>
          <span style={{ color: baseColor, fontSize: 13, lineHeight: '1.5' }}>
            {renderInline(line.slice(2))}
          </span>
        </div>
      );
      i++;
      continue;
    }

    // Numbered list
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      elements.push(
        <div key={i} style={{ display: 'flex', gap: 6, margin: '2px 0', alignItems: 'flex-start' }}>
          <span style={{ color: 'rgba(167,139,250,0.6)', fontSize: 12, minWidth: 16, flexShrink: 0 }}>{numberedMatch[1]}.</span>
          <span style={{ color: baseColor, fontSize: 13, lineHeight: '1.5' }}>
            {renderInline(numberedMatch[2])}
          </span>
        </div>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 6 }} />);
      i++;
      continue;
    }

    // Normal line
    elements.push(
      <div key={i} style={{ color: baseColor, fontSize: 13, lineHeight: '1.6', margin: '1px 0' }}>
        {renderInline(line)}
      </div>
    );
    i++;
  }

  return <div style={{ wordBreak: 'break-word' }}>{elements}</div>;
}

// ── Helpers ──────────────────────────────────────────────

const ALERTNESS_COLOR: Record<number, string> = {
  0: '#6b7280', 1: '#10b981', 2: '#3b82f6', 3: '#f59e0b', 4: '#ef4444',
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s 前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m 前`;
  const h = Math.floor(m / 60);
  return `${h}h 前`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `今天 ${formatTime(dateStr)}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${formatTime(dateStr)}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(dateStr)}`;
}

const INTERESTING_EVENTS = new Set([
  'orchestrator_chat', 'routing_decision', 'suggestion_created',
  'suggestions_triaged', 'alertness:level_changed', 'layer2_health',
  'escalation:level_changed', 'llm_api_error',
]);

function eventLabel(ev: BrainEvent): { icon: string; color: string; text: string } {
  const p = ev.payload as any;
  switch (ev.event_type) {
    case 'orchestrator_chat':
      return { icon: '💬', color: '#a78bfa', text: String(p.reply || '').slice(0, 80) };
    case 'routing_decision':
      return { icon: '🔀', color: '#60a5fa', text: `丘脑路由 → L${p.level ?? '?'} · ${p.route_type ?? ''} (${p.latency_ms ?? 0}ms)` };
    case 'suggestion_created':
      return { icon: '💡', color: '#f59e0b', text: `新建议 [${p.source}] 评分 ${Number(p.priority_score ?? 0).toFixed(2)}` };
    case 'suggestions_triaged':
      return { icon: '📋', color: '#34d399', text: `分诊 ${p.processed_count ?? 0} → ${p.deduplicated_count ?? 0} 有效` };
    case 'alertness:level_changed': {
      let src: any = {};
      try { src = JSON.parse(String(ev.source || '{}')); } catch { /* ignore */ }
      return { icon: '⚠️', color: '#f59e0b', text: `警觉 ${src.from ?? '?'} → ${src.to ?? '?'} · ${src.reason ?? ''}`.slice(0, 80) };
    }
    case 'layer2_health':
      return { icon: '🧠', color: p.level === 'ok' ? '#34d399' : '#f59e0b', text: `皮层健康 ${p.level ?? '?'}` };
    case 'escalation:level_changed': {
      let src2: any = {};
      try { src2 = JSON.parse(String(ev.source || '{}')); } catch { /* ignore */ }
      return { icon: '🚨', color: '#ef4444', text: `升级 ${src2.from ?? '?'} → ${src2.to ?? '?'}` };
    }
    case 'llm_api_error':
      return { icon: '❌', color: '#ef4444', text: `LLM 错误 ${String(p.error_type ?? '')}` };
    default:
      return { icon: '·', color: 'rgba(255,255,255,0.3)', text: ev.event_type };
  }
}

// ── Sub-components ───────────────────────────────────────

function TabButton({ label, icon: Icon, active, onClick }: {
  label: string; icon: React.ElementType; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '6px 4px',
        background: active ? 'rgba(167,139,250,0.12)' : 'transparent',
        border: 'none', borderBottom: active ? '2px solid #a78bfa' : '2px solid transparent',
        color: active ? '#a78bfa' : 'rgba(255,255,255,0.3)',
        cursor: 'pointer', fontSize: 11, fontWeight: active ? 600 : 400,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        transition: 'all 0.15s',
      }}
    >
      <Icon size={12} />
      <span>{label}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
      color: 'rgba(255,255,255,0.2)', marginBottom: 8, padding: '0 2px',
    }}>
      {children}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────

export default function ConsciousnessChat() {
  const navigate = useNavigate();
  const {
    messages, addMessage, updateMessage, clearMessages,
    input, setInput, sending, setSending,
    generateId, currentRoute, frontendTools, getPageContext,
  } = useCecelia();

  const { connected, subscribe } = useCeceliaWS();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Session management ────────────────────────────────
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions()); // localStorage only
  const [brainSessions, setBrainSessions] = useState<Session[]>([]); // Brain API history (memory only)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'live' | 'history'>('live');
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const currentSessionIdRef = useRef<string>(`session-${Date.now()}`);

  // All sessions (brain history + localStorage), sorted newest first
  const allSessions = useMemo(() => {
    const combined = [...brainSessions, ...sessions];
    return combined.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [brainSessions, sessions]);

  // Load historical conversations from Brain API on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/brain/orchestrator/chat/history?limit=500');
        if (!r.ok) return;
        const data = await r.json();
        const msgs: BrainMsg[] = Array.isArray(data) ? data : [];
        if (msgs.length === 0) return;
        setBrainSessions(groupHistoryIntoSessions(msgs));
      } catch { /* silent */ }
    })();
  }, []); // Run once on mount

  // Auto-save session whenever messages change
  useEffect(() => {
    if (messages.length === 0) return;
    const sessionId = currentSessionIdRef.current;
    const firstMsg = messages.find(m => m.role === 'user');
    const title = (firstMsg?.content ?? messages[0]?.content ?? '对话').slice(0, 35);

    setSessions(prev => {
      const existing = prev.findIndex(s => s.id === sessionId);
      const session: Session = { id: sessionId, title, createdAt: new Date().toISOString(), messages };
      const next = existing >= 0
        ? prev.map(s => s.id === sessionId ? session : s)
        : [session, ...prev];
      saveSessions(next);
      return next.slice(0, MAX_SESSIONS);
    });
  }, [messages]);

  const handleNewChat = useCallback(() => {
    currentSessionIdRef.current = `session-${Date.now()}`;
    clearMessages();
    setViewMode('live');
  }, [clearMessages]);

  const handleSelectSession = useCallback((s: Session) => {
    setHistoryMessages(s.messages);
    setSelectedSessionId(s.id);
    setViewMode('history');
  }, []);

  const displayMessages = viewMode === 'live' ? messages : historyMessages;

  // ── Right tabs state ──────────────────────────────────
  const [activeTab, setActiveTab] = useState<RightTab>('brain');

  // ── Brain state ───────────────────────────────────────
  const [brain, setBrain] = useState<BrainState>({
    alertness: 2, alertnessName: 'AWARE',
    tickRunning: false, loopRunning: false,
    lastTick: null, nextTick: null, intervalMinutes: 5,
    slotsUsed: 0, slotsMax: 3,
    todayCompleted: 0, todayFailed: 0, todayQueued: 0,
  });
  const [cogPhase, setCogPhase] = useState<string>('idle');
  const [cogDetail, setCogDetail] = useState<string>('');
  const [desires, setDesires] = useState<Desire[]>([]);

  // ── Tab data ──────────────────────────────────────────
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [events, setEvents] = useState<BrainEvent[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [tabLoading, setTabLoading] = useState<Record<RightTab, boolean>>({
    brain: false, memory: false, events: false, suggestions: false,
  });

  // ── Chat send ─────────────────────────────────────────
  const [processingStage, setProcessingStage] = useState<string | null>(null);

  // ── Scroll ────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages, processingStage]);

  // ── Brain fetch ───────────────────────────────────────
  const fetchBrain = useCallback(async () => {
    try {
      const [alertRes, tickRes, statusRes] = await Promise.all([
        fetch('/api/brain/alertness'),
        fetch('/api/brain/tick/status'),
        fetch('/api/brain/status/full'),
      ]);
      if (alertRes.ok) {
        const d = await alertRes.json();
        setBrain(prev => ({ ...prev, alertness: d.level ?? 2, alertnessName: d.levelName ?? 'AWARE' }));
      }
      if (tickRes.ok) {
        const d = await tickRes.json();
        setBrain(prev => ({
          ...prev,
          tickRunning: d.tick_running ?? false,
          loopRunning: d.loop_running ?? false,
          lastTick: d.last_tick ?? null,
          nextTick: d.next_tick ?? null,
          intervalMinutes: d.interval_minutes ?? 5,
          slotsUsed: d.slot_budget?.used ?? 0,
          slotsMax: d.slot_budget?.max ?? 3,
        }));
      }
      if (statusRes.ok) {
        const d = await statusRes.json();
        setBrain(prev => ({
          ...prev,
          todayCompleted: d.task_stats?.completed_today ?? 0,
          todayFailed: d.task_stats?.failed_today ?? 0,
          todayQueued: d.task_queue?.queued ?? 0,
        }));
      }
    } catch { /* silent */ }
  }, []);

  const fetchDesires = useCallback(async () => {
    try {
      const r = await fetch('/api/brain/desires?status=pending&limit=6');
      if (r.ok) {
        const d = await r.json();
        setDesires(Array.isArray(d) ? d : (d.desires ?? []));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchBrain();
    fetchDesires();
    const t1 = setInterval(fetchBrain, 5000);
    const t2 = setInterval(fetchDesires, 20000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchBrain, fetchDesires]);

  // ── Tab data fetching ─────────────────────────────────
  const fetchLearnings = useCallback(async () => {
    setTabLoading(prev => ({ ...prev, memory: true }));
    try {
      const r = await fetch('/api/brain/learnings?limit=20');
      if (r.ok) {
        const d = await r.json();
        setLearnings(d.learnings ?? []);
      }
    } catch { /* silent */ }
    finally { setTabLoading(prev => ({ ...prev, memory: false })); }
  }, []);

  const fetchEvents = useCallback(async () => {
    setTabLoading(prev => ({ ...prev, events: true }));
    try {
      const r = await fetch('/api/brain/events?limit=80');
      if (r.ok) {
        const d = await r.json();
        const filtered = (d.events ?? []).filter((e: BrainEvent) => INTERESTING_EVENTS.has(e.event_type));
        setEvents(filtered.slice(0, 40));
      }
    } catch { /* silent */ }
    finally { setTabLoading(prev => ({ ...prev, events: false })); }
  }, []);

  const fetchSuggestions = useCallback(async () => {
    setTabLoading(prev => ({ ...prev, suggestions: true }));
    try {
      const r = await fetch('/api/brain/suggestions?limit=12');
      if (r.ok) {
        const d = await r.json();
        setSuggestions(Array.isArray(d) ? d : (d.suggestions ?? []));
      }
    } catch { /* silent */ }
    finally { setTabLoading(prev => ({ ...prev, suggestions: false })); }
  }, []);

  useEffect(() => {
    if (activeTab === 'memory') fetchLearnings();
    if (activeTab === 'events') fetchEvents();
    if (activeTab === 'suggestions') fetchSuggestions();
  }, [activeTab, fetchLearnings, fetchEvents, fetchSuggestions]);

  // ── WebSocket ─────────────────────────────────────────
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    unsubs.push(subscribe(WS_EVENTS.COGNITIVE_STATE, (data) => {
      setCogPhase(data.phase || 'idle');
      setCogDetail(data.detail || '');
    }));
    unsubs.push(subscribe(WS_EVENTS.TASK_STARTED, () => fetchBrain()));
    unsubs.push(subscribe(WS_EVENTS.TASK_COMPLETED, () => fetchBrain()));
    unsubs.push(subscribe(WS_EVENTS.TASK_FAILED, () => fetchBrain()));
    unsubs.push(subscribe(WS_EVENTS.TICK_EXECUTED, () => fetchBrain()));
    unsubs.push(subscribe(WS_EVENTS.DESIRE_CREATED, () => fetchDesires()));
    unsubs.push(subscribe(WS_EVENTS.ALERTNESS_CHANGED, (data) => {
      setBrain(prev => ({ ...prev, alertness: data.level ?? prev.alertness, alertnessName: data.levelName ?? prev.alertnessName }));
    }));
    // ★ 接收 Cecelia 主动推送（叙事/情绪变化）
    unsubs.push(subscribe('cecelia:message', (data) => {
      if (data?.message) {
        addMessage({ id: `proactive_${Date.now()}`, role: 'assistant', content: data.message });
      }
    }));
    return () => unsubs.forEach(u => u());
  }, [subscribe, fetchBrain, fetchDesires, addMessage]);

  // ── Chat send ─────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (viewMode === 'history') {
      setViewMode('live');
      return;
    }
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    addMessage({ id: generateId(), role: 'user', content: text });
    setProcessingStage('L1 丘脑 路由中...');

    try {
      const lower = text.toLowerCase();
      if (/打开|去|进入|切换|navigate|open|go/i.test(lower)) {
        const ROUTE_ALIASES: Record<string, string> = {
          'okr': '/okr', '目标': '/okr', 'projects': '/projects', '项目': '/projects',
          'brain': '/brain', '大脑': '/brain', 'cecelia': '/cecelia', '意识': '/cecelia/chat',
        };
        for (const [alias, route] of Object.entries(ROUTE_ALIASES).sort((a, b) => b[0].length - a[0].length)) {
          if (lower.includes(alias)) {
            setProcessingStage(null);
            navigate(route);
            addMessage({ id: generateId(), role: 'assistant', content: `正在前往「${alias}」` });
            return;
          }
        }
      }

      setProcessingStage('检索意识...');
      await new Promise(r => setTimeout(r, 200));

      // 使用 SSE 流式端点，字一个个出来
      const streamingMsgId = generateId();
      addMessage({ id: streamingMsgId, role: 'assistant', content: '', isStreaming: true });
      setProcessingStage('传声中...');

      const r = await fetch('/api/brain/orchestrator/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
          context: {
            currentRoute,
            availableTools: frontendTools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })),
            pageContext: getPageContext(),
          },
        }),
      });

      if (!r.ok || !r.body) {
        updateMessage(streamingMsgId, { content: '连接失败，请稍后再试', isStreaming: false });
        setProcessingStage(null);
        setSending(false);
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buf = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              updateMessage(streamingMsgId, { content: accumulated || '我还没想过这个。', isStreaming: false });
              setProcessingStage(null);
              break;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.delta) {
                accumulated += parsed.delta;
                updateMessage(streamingMsgId, { content: accumulated, isStreaming: true });
              } else if (parsed.error) {
                updateMessage(streamingMsgId, { content: `连接异常：${parsed.error}`, isStreaming: false });
              }
            } catch { /* skip */ }
          }
        }
      } finally {
        reader.releaseLock();
        // 确保消息标记为非流式（兜底）
        updateMessage(streamingMsgId, { isStreaming: false });
        setProcessingStage(null);
      }
    } catch {
      setProcessingStage(null);
      addMessage({ id: generateId(), role: 'assistant', content: '连接失败，请稍后再试' });
    } finally {
      setSending(false);
      setProcessingStage(null);
    }
  }, [viewMode, input, sending, messages, currentRoute, frontendTools, getPageContext,
    addMessage, updateMessage, setInput, setSending, generateId, navigate]);

  // ── Derived ───────────────────────────────────────────
  const alertColor = ALERTNESS_COLOR[brain.alertness] ?? '#3b82f6';

  // ── Render ───────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - 64px)',
      background: '#09090f',
      color: 'rgba(255,255,255,0.85)',
      fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
      overflow: 'hidden',
    }}>
      {/* ── TopBar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '9px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.015)',
        flexShrink: 0,
      }}>
        <Brain size={15} color="#a78bfa" />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Cecelia 意识</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: alertColor, boxShadow: `0 0 6px ${alertColor}`, display: 'inline-block' }} />
          <span style={{ fontSize: 11, color: alertColor, fontWeight: 500 }}>{brain.alertnessName}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Zap size={10} color={brain.tickRunning ? '#f59e0b' : 'rgba(255,255,255,0.2)'} />
          <span style={{ fontSize: 11, color: brain.tickRunning ? '#f59e0b' : 'rgba(255,255,255,0.25)' }}>
            {brain.tickRunning ? 'Tick 中' : `${brain.slotsUsed}/${brain.slotsMax} 槽`}
          </span>
        </div>

        {cogPhase !== 'idle' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '2px 8px', borderRadius: 10,
            background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)',
          }}>
            <Loader2 size={10} color="#a78bfa" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 10, color: '#a78bfa' }}>{cogPhase}</span>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: connected ? '#10b981' : '#6b7280', display: 'inline-block' }} />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{connected ? 'WS 实时' : '离线'}</span>
        </div>
      </div>

      {/* ── Three Columns ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* ── LEFT: Sessions + Brain mini ── */}
        <div style={{
          width: 200, flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}>
          {/* Session list */}
          <div style={{ padding: '12px 12px 8px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <SectionLabel><History size={10} style={{ display: 'inline', marginRight: 4 }} />历史对话</SectionLabel>
              <button
                onClick={handleNewChat}
                title="新对话"
                style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  padding: '3px 7px', borderRadius: 5,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent', cursor: 'pointer',
                  color: 'rgba(255,255,255,0.4)', fontSize: 10,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = 'rgba(167,139,250,0.4)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
              >
                <Plus size={9} /> 新
              </button>
            </div>

            {viewMode === 'history' && (
              <button
                onClick={() => setViewMode('live')}
                style={{
                  width: '100%', marginBottom: 6, padding: '4px 8px',
                  borderRadius: 5, border: '1px solid rgba(167,139,250,0.3)',
                  background: 'rgba(167,139,250,0.08)', cursor: 'pointer',
                  color: '#a78bfa', fontSize: 10,
                }}
              >
                ← 返回当前对话
              </button>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {allSessions.length === 0 && (
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', textAlign: 'center', padding: '12px 0' }}>
                  暂无历史对话
                </div>
              )}
              {allSessions.map(s => {
                const isCurrent = s.id === currentSessionIdRef.current && viewMode === 'live';
                const isSelected = viewMode === 'history' && selectedSessionId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => { if (!isCurrent) handleSelectSession(s); else setViewMode('live'); }}
                    style={{
                      textAlign: 'left', padding: '5px 7px', borderRadius: 5,
                      border: `1px solid ${isCurrent || isSelected ? 'rgba(167,139,250,0.25)' : 'transparent'}`,
                      background: isCurrent || isSelected ? 'rgba(167,139,250,0.07)' : 'transparent',
                      cursor: 'pointer', width: '100%',
                    }}
                  >
                    <div style={{
                      fontSize: 11, color: isCurrent ? '#c084fc' : 'rgba(255,255,255,0.55)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontWeight: isCurrent ? 500 : 400,
                    }}>
                      {isCurrent ? '● ' : ''}{s.title}
                    </div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>
                      {formatDate(s.createdAt)} · {s.messages.length}条
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '4px 0' }} />

          {/* Brain mini status */}
          <div style={{ padding: '10px 12px', flex: 1 }}>
            <SectionLabel>🧠 大脑</SectionLabel>
            {[
              { label: 'L0 脑干', sublabel: '调度·执行', active: brain.loopRunning, color: '#818cf8', detail: brain.lastTick ? timeAgo(brain.lastTick) : '—' },
              { label: 'L1 丘脑', sublabel: '路由·判断', active: cogPhase === 'thalamus' || cogPhase === 'routing', color: '#c084fc', detail: cogPhase !== 'idle' ? cogDetail.slice(0, 25) : '待机' },
              { label: 'L2 皮层', sublabel: '分析·决策', active: cogPhase === 'cortex' || cogPhase === 'reflecting', color: '#f472b6', detail: '深度推理' },
            ].map(({ label, sublabel, active, color, detail }) => (
              <div key={label} style={{
                padding: '8px 10px', borderRadius: 7, marginBottom: 6,
                border: `1px solid ${active ? color + '40' : 'rgba(255,255,255,0.04)'}`,
                background: active ? color + '10' : 'rgba(255,255,255,0.01)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: active ? color : 'rgba(255,255,255,0.3)' }}>{label}</span>
                  {active && <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}`, display: 'inline-block', animation: 'pulse 2s infinite' }} />}
                </div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 1 }}>{sublabel}</div>
                {detail && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>}
              </div>
            ))}

            {/* Today stats mini */}
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              {[
                { v: brain.todayCompleted, c: '#10b981', l: '完成' },
                { v: brain.todayFailed, c: '#ef4444', l: '失败' },
                { v: brain.todayQueued, c: '#f59e0b', l: '队列' },
              ].map(({ v, c, l }) => (
                <div key={l} style={{ flex: 1, textAlign: 'center', padding: '4px 2px', borderRadius: 5, background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: c }}>{v}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── CENTER: Chat ── */}
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column',
          borderRight: '1px solid rgba(255,255,255,0.05)',
        }}>
          {/* Chat header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            background: 'rgba(255,255,255,0.01)',
            flexShrink: 0,
          }}>
            <MessageSquare size={11} color="rgba(255,255,255,0.2)" />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
              {viewMode === 'history' ? '历史对话（只读）' : '当前对话'}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)' }}>
              {displayMessages.length > 0 ? `${displayMessages.length} 条` : ''}
            </span>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {displayMessages.length === 0 && !processingStage && (
              <div style={{ margin: 'auto', textAlign: 'center', padding: '48px 20px', opacity: 0.7 }}>
                <Brain size={36} color="rgba(167,139,250,0.2)" style={{ margin: '0 auto 12px' }} />
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.2)', margin: 0 }}>与 Cecelia 对话</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.1)', margin: '8px 0 0' }}>
                  她的大脑状态在左侧 · 深度数据在右侧
                </p>
              </div>
            )}

            {displayMessages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                {msg.role === 'assistant' && (
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: 'linear-gradient(135deg, rgba(167,139,250,0.3), rgba(236,72,153,0.2))',
                    border: '1px solid rgba(167,139,250,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginRight: 8, flexShrink: 0, marginTop: 4,
                  }}>
                    <Eye size={10} color="#a78bfa" />
                  </div>
                )}
                <div style={{
                  maxWidth: '72%',
                  padding: msg.role === 'user' ? '8px 13px' : '10px 14px',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, #7c3aed, #6d28d9)'
                    : msg.id.startsWith('proactive_')
                      ? 'rgba(167,139,250,0.05)'
                      : 'rgba(255,255,255,0.04)',
                  border: msg.role === 'user' ? 'none'
                    : msg.id.startsWith('proactive_')
                      ? '1px solid rgba(167,139,250,0.2)'
                      : '1px solid rgba(255,255,255,0.07)',
                }}>
                  {msg.id.startsWith('proactive_') && (
                    <div style={{
                      fontSize: 10, color: 'rgba(167,139,250,0.6)',
                      marginBottom: 4, letterSpacing: '0.05em',
                    }}>
                      自述
                    </div>
                  )}
                  {msg.role === 'user' ? (
                    <div style={{ fontSize: 13, color: '#fff', lineHeight: '1.5' }}>{msg.content}</div>
                  ) : (
                    <MarkdownMessage content={msg.content} isUser={false} />
                  )}
                </div>
              </div>
            ))}

            {processingStage && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
                <div style={{ width: 22, height: 22, marginRight: 8, flexShrink: 0 }} />
                <div style={{
                  padding: '8px 13px', borderRadius: '4px 14px 14px 14px',
                  background: 'rgba(167,139,250,0.06)',
                  border: '1px solid rgba(167,139,250,0.15)',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, color: '#a78bfa',
                }}>
                  <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                  {processingStage}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.05)',
            flexShrink: 0, background: 'rgba(255,255,255,0.01)',
          }}>
            {viewMode === 'history' && (
              <div style={{
                marginBottom: 8, padding: '6px 10px', borderRadius: 6,
                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                fontSize: 11, color: '#f59e0b',
              }}>
                正在查看历史对话 · 点击"返回当前对话"继续聊天
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={viewMode === 'history' ? '按 Enter 返回当前对话' : '说点什么...'}
                disabled={sending}
                style={{
                  flex: 1, padding: '8px 13px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 9, color: 'rgba(255,255,255,0.8)',
                  fontSize: 13, outline: 'none', transition: 'border-color 0.2s',
                }}
                onFocus={e => { e.target.style.borderColor = 'rgba(167,139,250,0.4)'; }}
                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; }}
              />
              <button
                onClick={handleSend}
                disabled={(!input.trim() && viewMode !== 'history') || sending}
                style={{
                  padding: '8px 13px', borderRadius: 9, border: 'none',
                  background: (input.trim() || viewMode === 'history') && !sending ? '#7c3aed' : 'rgba(255,255,255,0.05)',
                  color: (input.trim() || viewMode === 'history') && !sending ? '#fff' : 'rgba(255,255,255,0.2)',
                  cursor: (input.trim() || viewMode === 'history') && !sending ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', transition: 'all 0.2s',
                }}
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Tabs ── */}
        <div style={{
          width: 290, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Tab header */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: 'rgba(255,255,255,0.01)',
            flexShrink: 0,
          }}>
            <TabButton label="大脑" icon={Brain} active={activeTab === 'brain'} onClick={() => setActiveTab('brain')} />
            <TabButton label="记忆" icon={BookOpen} active={activeTab === 'memory'} onClick={() => setActiveTab('memory')} />
            <TabButton label="事件" icon={Radio} active={activeTab === 'events'} onClick={() => setActiveTab('events')} />
            <TabButton label="建议" icon={ListChecks} active={activeTab === 'suggestions'} onClick={() => setActiveTab('suggestions')} />
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>

            {/* ── 大脑 Tab ── */}
            {activeTab === 'brain' && (
              <div>
                <SectionLabel>💭 Desires ({desires.length})</SectionLabel>
                {desires.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', textAlign: 'center', padding: '16px 0' }}>暂无待处理 Desires</div>
                ) : desires.map(d => {
                  const DCOLOR: Record<string, string> = { act: '#10b981', warn: '#ef4444', inform: '#f59e0b', propose: '#3b82f6' };
                  const DICON: Record<string, string> = { act: '🟢', warn: '🔴', inform: '🟡', propose: '🔵' };
                  return (
                    <div key={d.id} style={{
                      padding: '8px 10px', borderRadius: 7, marginBottom: 6,
                      background: 'rgba(255,255,255,0.02)',
                      borderLeft: `3px solid ${DCOLOR[d.type] ?? 'rgba(255,255,255,0.1)'}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <span style={{ fontSize: 10 }}>{DICON[d.type] ?? '·'}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: DCOLOR[d.type] ?? 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d.type}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>×{d.urgency}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: '1.4', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {d.content.replace(/^#+\s+/gm, '')}
                      </div>
                    </div>
                  );
                })}

                <div style={{ height: 12 }} />
                <SectionLabel>📊 今日统计</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {[
                    { label: '完成', value: brain.todayCompleted, color: '#10b981' },
                    { label: '失败', value: brain.todayFailed, color: '#ef4444' },
                    { label: '队列', value: brain.todayQueued, color: '#f59e0b' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ textAlign: 'center', padding: '10px 4px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ height: 12 }} />
                <SectionLabel>⚡ Tick</SectionLabel>
                <div style={{ padding: '8px 10px', borderRadius: 7, background: 'rgba(255,255,255,0.02)', fontSize: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>状态</span>
                    <span style={{ color: brain.tickRunning ? '#f59e0b' : '#10b981' }}>{brain.tickRunning ? '执行中' : '待机'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>上次</span>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}>{timeAgo(brain.lastTick)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>槽位</span>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}>{brain.slotsUsed}/{brain.slotsMax}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── 记忆 Tab ── */}
            {activeTab === 'memory' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <SectionLabel>📚 Learnings ({learnings.length})</SectionLabel>
                  <button onClick={fetchLearnings} style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}>刷新</button>
                </div>
                {tabLoading.memory ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <Loader2 size={14} color="rgba(255,255,255,0.2)" style={{ animation: 'spin 1s linear infinite', margin: 'auto' }} />
                  </div>
                ) : learnings.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', textAlign: 'center', padding: '16px 0' }}>暂无记忆数据</div>
                ) : learnings.map(l => (
                  <div key={l.id} style={{
                    padding: '9px 10px', borderRadius: 7, marginBottom: 6,
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 3,
                        background: l.digested ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                        color: l.digested ? '#34d399' : '#f59e0b',
                        flexShrink: 0,
                      }}>
                        {l.category || 'general'}
                      </span>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 500, flex: 1 }}>
                        {l.title.slice(0, 60)}
                      </span>
                    </div>
                    {l.content && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: '1.4', marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {l.content}
                      </div>
                    )}
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>{timeAgo(l.created_at)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── 事件 Tab ── */}
            {activeTab === 'events' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <SectionLabel>📡 Brain 事件</SectionLabel>
                  <button onClick={fetchEvents} style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}>刷新</button>
                </div>
                {tabLoading.events ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <Loader2 size={14} color="rgba(255,255,255,0.2)" style={{ animation: 'spin 1s linear infinite', margin: 'auto' }} />
                  </div>
                ) : events.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', textAlign: 'center', padding: '16px 0' }}>暂无事件</div>
                ) : events.map(ev => {
                  const { icon, color, text } = eventLabel(ev);
                  return (
                    <div key={ev.id} style={{
                      display: 'flex', gap: 8, alignItems: 'flex-start',
                      padding: '7px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                    }}>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginBottom: 1 }}>{ev.event_type}</div>
                        <div style={{ fontSize: 11, color, lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={text}>
                          {text}
                        </div>
                      </div>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>{formatTime(ev.created_at)}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── 建议 Tab ── */}
            {activeTab === 'suggestions' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <SectionLabel>📋 权力追踪 ({suggestions.length})</SectionLabel>
                  <button onClick={fetchSuggestions} style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}>刷新</button>
                </div>
                {tabLoading.suggestions ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <Loader2 size={14} color="rgba(255,255,255,0.2)" style={{ animation: 'spin 1s linear infinite', margin: 'auto' }} />
                  </div>
                ) : suggestions.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', textAlign: 'center', padding: '16px 0' }}>暂无建议</div>
                ) : suggestions.map(s => {
                  const score = parseFloat(s.priority_score);
                  const statusColor = s.status === 'pending' ? '#f59e0b' : s.status === 'accepted' ? '#10b981' : '#6b7280';
                  return (
                    <div key={s.id} style={{
                      padding: '9px 10px', borderRadius: 7, marginBottom: 6,
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.04)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 3,
                          background: statusColor + '22', color: statusColor,
                        }}>
                          {s.status}
                        </span>
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>{s.source}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: score >= 0.8 ? '#10b981' : score >= 0.7 ? '#f59e0b' : 'rgba(255,255,255,0.3)' }}>
                          {score.toFixed(2)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: '1.4', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {s.content}
                      </div>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>{s.suggestion_type} · {timeAgo(s.created_at)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
