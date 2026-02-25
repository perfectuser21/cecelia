import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Brain, Send, Phone, PhoneOff, Mic, Volume2, Maximize2, Minimize2, Zap, CheckCircle, MessageSquare, AlertTriangle, ChevronUp, Loader2 } from 'lucide-react';
import { useCecelia } from '@/contexts/CeceliaContext';
import { useRealtimeVoice } from '@features/core/shared/hooks/useRealtimeVoice';

// ── Types ─────────────────────────────────────────────────

interface Desire {
  id: string;
  type: string;
  content: string;
  urgency: number;
  created_at: string;
  proposed_action?: string;
  insight?: string;
}

interface DesireGroup {
  key: string;
  desires: Desire[];
  maxUrgency: number;
  representative: Desire;
}

interface Task {
  id: string;
  title: string;
  task_type: string;
  priority: string;
  status: string;
  description?: string;
}

interface StatusData {
  tasksQueued: number;
  tasksInProgress: number;
  tickActionsToday: number;
}

// ── Constants ─────────────────────────────────────────────

const ALERTNESS_CONF = {
  0: { label: 'SLEEP', color: '#64748b' },
  1: { label: 'CALM',  color: '#22c55e' },
  2: { label: 'AWARE', color: '#3b82f6' },
  3: { label: 'ALERT', color: '#f59e0b' },
  4: { label: 'PANIC', color: '#ef4444' },
} as const;

const PRIORITY_COLOR: Record<string, string> = {
  P0: '#ef4444', P1: '#f59e0b', P2: '#3b82f6', P3: '#6b7280',
};

const ROUTE_ALIASES: Record<string, string> = {
  'okr': '/okr', '目标': '/okr',
  'projects': '/projects', '项目': '/projects',
  'tasks': '/work/tasks', '任务': '/work/tasks',
  'work': '/work', '工作': '/work',
};

const CHAT_DEFAULT_VISIBLE = 3;

// ── Desire 去重分组 ─────────────────────────────────────

function extractKeywords(content: string): string[] {
  const clean = content.replace(/[#*`\n]/g, ' ').toLowerCase();
  const stopwords = new Set(['的', '了', '是', '在', '和', '有', '不', '这', '个', '中', '为', '与', 'the', 'a', 'is', 'to', 'and', 'of']);
  return clean.split(/\s+/).filter(w => w.length > 1 && !stopwords.has(w));
}

function groupDesires(desires: Desire[]): DesireGroup[] {
  if (desires.length === 0) return [];

  const groups: DesireGroup[] = [];
  const assigned = new Set<string>();
  const sorted = [...desires].sort((a, b) => b.urgency - a.urgency);

  for (const d of sorted) {
    if (assigned.has(d.id)) continue;

    const kw = extractKeywords(d.content);
    const group: Desire[] = [d];
    assigned.add(d.id);

    for (const other of sorted) {
      if (assigned.has(other.id)) continue;
      const otherKw = extractKeywords(other.content);
      const overlap = kw.filter(w => otherKw.includes(w)).length;
      const similarity = overlap / Math.max(kw.length, otherKw.length, 1);
      if (similarity > 0.3) {
        group.push(other);
        assigned.add(other.id);
      }
    }

    groups.push({
      key: d.id,
      desires: group,
      maxUrgency: Math.max(...group.map(g => g.urgency)),
      representative: d,
    });
  }

  return groups;
}

function partitionDesires(groups: DesireGroup[]): { decisions: DesireGroup[]; updates: DesireGroup[] } {
  const decisions: DesireGroup[] = [];
  const updates: DesireGroup[] = [];

  for (const g of groups) {
    const rep = g.representative;
    if (['warn', 'question', 'propose'].includes(rep.type) || g.maxUrgency >= 7) {
      decisions.push(g);
    } else {
      updates.push(g);
    }
  }

  return { decisions, updates };
}

// ── 红区卡片：需要决策 ──────────────────────────────────

function DecisionCard({ group, onAcknowledge, onAsk, loading }: {
  group: DesireGroup;
  onAcknowledge: (ids: string[]) => void;
  onAsk: (desire: Desire) => void;
  loading: boolean;
}) {
  const { representative: d, desires } = group;
  const summary = d.content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim();
  const firstLine = summary.split('\n').find(l => l.trim().length > 10) || summary;
  const display = firstLine.length > 140 ? firstLine.slice(0, 140) + '...' : firstLine;

  return (
    <div style={{
      background: 'rgba(239,68,68,0.04)',
      border: '1px solid rgba(239,68,68,0.12)',
      borderLeft: '3px solid #ef4444',
      borderRadius: 10, padding: '14px 18px',
    }}>
      <p style={{ margin: 0, fontSize: 13.5, color: 'rgba(255,255,255,0.7)', lineHeight: 1.65 }}>
        {display}
      </p>
      {desires.length > 1 && (
        <span style={{ fontSize: 11, color: 'rgba(239,68,68,0.5)', marginTop: 6, display: 'inline-block' }}>
          还有 {desires.length - 1} 条类似
        </span>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onAsk(d)}
          disabled={loading}
          style={btnStyle('rgba(239,68,68,0.12)', '#f87171')}
        >
          <AlertTriangle size={12} />处理
        </button>
        <button
          onClick={() => onAcknowledge(desires.map(x => x.id))}
          disabled={loading}
          style={btnStyle('rgba(255,255,255,0.06)', 'rgba(255,255,255,0.4)')}
        >
          {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={12} />}了解
        </button>
      </div>
    </div>
  );
}

// ── 黄区：任务确认卡片 ──────────────────────────────────

function TaskConfirmCard({ task, onDispatch, onAsk, loading }: {
  task: Task;
  onDispatch: (id: string) => void;
  onAsk: (task: Task) => void;
  loading: boolean;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 10, padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
            background: `${PRIORITY_COLOR[task.priority] ?? '#6b7280'}18`,
            color: PRIORITY_COLOR[task.priority] ?? '#6b7280',
          }}>{task.priority}</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', padding: '1px 6px', borderRadius: 4 }}>
            {task.task_type}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#e2e8f0', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => onDispatch(task.id)}
          disabled={loading}
          style={btnStyle('rgba(34,197,94,0.12)', '#4ade80')}
        >
          {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={12} />}派发
        </button>
        <button
          onClick={() => onAsk(task)}
          disabled={loading}
          style={btnStyle('rgba(255,255,255,0.04)', 'rgba(255,255,255,0.3)')}
        >
          <MessageSquare size={12} />?
        </button>
      </div>
    </div>
  );
}

// ── 对话气泡 ─────────────────────────────────────────────

function ChatBubble({ msg }: { msg: { id: string; role: string; content: string; toolCall?: { name: string } } }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8 }}>
      {!isUser && (
        <div style={{
          width: 24, height: 24, borderRadius: 7, flexShrink: 0,
          background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Brain size={11} style={{ color: 'rgba(167,139,250,0.6)' }} />
        </div>
      )}
      <div style={{
        maxWidth: '75%',
        borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        fontSize: 13.5, lineHeight: 1.65, padding: '10px 14px', wordBreak: 'break-word',
        ...(isUser
          ? { background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff' }
          : { background: 'rgba(255,255,255,0.03)', color: '#c4ccdc', border: '1px solid rgba(255,255,255,0.06)' }
        ),
      }}>
        {msg.toolCall && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>{'\u2192'} {msg.toolCall.name}</div>}
        <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
      </div>
    </div>
  );
}

// ── 按钮样式工具 ────────────────────────────────────────

function btnStyle(bg: string, color: string): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
    background: bg, color, fontSize: 12, fontWeight: 500,
    display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
  };
}

// ── 简报摘要生成（纯前端，不调 LLM）───────────────────

function buildBriefing(desires: Desire[], tasks: Task[], status: StatusData, alertnessLevel: number): string {
  const parts: string[] = [];
  const aC = ALERTNESS_CONF[alertnessLevel as keyof typeof ALERTNESS_CONF] ?? ALERTNESS_CONF[1];

  const urgentCount = desires.filter(d => d.urgency >= 7).length;
  const warnCount = desires.filter(d => d.type === 'warn').length;

  if (urgentCount > 0 || warnCount > 0) {
    parts.push(`有 ${urgentCount + warnCount} 件事需要你关注。`);
  }

  if (status.tasksInProgress > 0) {
    parts.push(`当前 ${status.tasksInProgress} 个任务正在执行中。`);
  }

  if (tasks.length > 0) {
    parts.push(`${tasks.length} 个任务等待你确认派发。`);
  }

  if (parts.length === 0) {
    parts.push(`一切运行正常，系统状态 ${aC.label}。今日已执行 ${status.tickActionsToday} 次操作。`);
  }

  return parts.join('');
}

// ── 主组件 ───────────────────────────────────────────────

export default function CeceliaPage() {
  const {
    messages, addMessage, input, setInput, sending, setSending, generateId,
    currentRoute, frontendTools, executeFrontendTool, getPageContext,
  } = useCecelia();

  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [desires, setDesires] = useState<Desire[]>([]);
  const [alertnessLevel, setAlertnessLevel] = useState(1);
  const [thinkingPhase, setThinkingPhase] = useState(0);
  const [queuedTasks, setQueuedTasks] = useState<Task[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [status, setStatus] = useState<StatusData>({ tasksQueued: 0, tasksInProgress: 0, tickActionsToday: 0 });
  const [showAllChat, setShowAllChat] = useState(false);
  const [loadingActions, setLoadingActions] = useState<Set<string>>(new Set());
  const [briefingShown, setBriefingShown] = useState(false);

  // ── Escape 退出全屏 ────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && fullscreen) setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // ── 思考动画 ────────────────────────────────────────────
  useEffect(() => {
    if (!sending) { setThinkingPhase(0); return; }
    const t = setInterval(() => setThinkingPhase(p => (p + 1) % 3), 1500);
    return () => clearInterval(t);
  }, [sending]);

  // ── 数据轮询 ────────────────────────────────────────────
  const fetchDesires = useCallback(async () => {
    try {
      const r = await fetch('/api/brain/desires?status=pending&limit=20');
      if (!r.ok) return;
      const d = await r.json();
      setDesires(Array.isArray(d) ? d : (d.desires || []));
    } catch { /* */ }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const r = await fetch('/api/brain/tasks?status=queued&limit=8');
      if (!r.ok) return;
      const d = await r.json();
      setQueuedTasks(Array.isArray(d) ? d : (d.tasks || []));
    } catch { /* */ }
  }, []);

  useEffect(() => {
    const load = async () => { try { const r = await fetch('/api/brain/alertness'); if (r.ok) { const d = await r.json(); setAlertnessLevel(d.level ?? 1); } } catch { /* */ } };
    load(); const t = setInterval(load, 30_000); return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetchDesires(); const t = setInterval(fetchDesires, 30_000); return () => clearInterval(t);
  }, [fetchDesires]);

  useEffect(() => {
    fetchTasks(); const t = setInterval(fetchTasks, 60_000); return () => clearInterval(t);
  }, [fetchTasks]);

  useEffect(() => {
    const load = async () => {
      try {
        const [fullRes, ipRes] = await Promise.all([fetch('/api/brain/status/full'), fetch('/api/brain/tasks?status=in_progress&limit=50')]);
        const ipData = ipRes.ok ? await ipRes.json() : [];
        const ipCount = Array.isArray(ipData) ? ipData.length : (ipData.tasks?.length ?? 0);
        if (fullRes.ok) { const d = await fullRes.json(); setStatus({ tasksQueued: d.task_queue?.queued ?? 0, tasksInProgress: ipCount, tickActionsToday: d.tick_stats?.actions_today ?? 0 }); }
      } catch { /* */ }
    };
    load(); const t = setInterval(load, 60_000); return () => clearInterval(t);
  }, []);

  // ── Opening：纯前端简报（不调 LLM）─────────────────────
  useEffect(() => {
    if (briefingShown || messages.length > 0) return;
    const timer = setTimeout(() => {
      const text = buildBriefing(desires, queuedTasks, status, alertnessLevel);
      if (text) {
        addMessage({ id: generateId(), role: 'assistant', content: text });
        setBriefingShown(true);
      }
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desires, queuedTasks, status, alertnessLevel, briefingShown, messages.length]);

  // ── Desire 分组和分区 ────────────────────────────────────
  const desireGroups = useMemo(() => groupDesires(desires), [desires]);
  const { decisions, updates } = useMemo(() => partitionDesires(desireGroups), [desireGroups]);

  // ── 聊天发送 ────────────────────────────────────────────
  const handleSend = useCallback(async (overrideText?: string) => {
    const text = overrideText ?? input.trim();
    if (!text || sending) return;
    if (!overrideText) setInput('');
    setSending(true);
    addMessage({ id: generateId(), role: 'user', content: text });
    try {
      const lower = text.toLowerCase();
      if (/打开|去|进入|切换|navigate|open|go/i.test(lower)) {
        for (const [alias, route] of Object.entries(ROUTE_ALIASES).sort((a, b) => b[0].length - a[0].length)) {
          if (lower.includes(alias)) {
            const result = await executeFrontendTool('navigate', { path: route });
            addMessage({ id: generateId(), role: 'assistant', content: result, toolCall: { name: 'navigate', result } });
            return;
          }
        }
      }
      const r = await fetch('/api/orchestrator/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })), context: { currentRoute, pageContext: getPageContext(), availableTools: frontendTools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) } }),
      });
      const data = await r.json();
      if (data.reply) addMessage({ id: generateId(), role: 'assistant', content: data.reply });
      else if (data.error) addMessage({ id: generateId(), role: 'assistant', content: `\u26a0\ufe0f ${data.error}` });
    } catch {
      addMessage({ id: generateId(), role: 'assistant', content: '\u53d1\u751f\u9519\u8bef\uff0c\u8bf7\u91cd\u8bd5' });
    } finally { setSending(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, sending, messages, currentRoute, frontendTools]);

  // ── Desire 操作：调真实 API ──────────────────────────────
  const acknowledgeDesires = useCallback(async (ids: string[]) => {
    const key = ids.join(',');
    setLoadingActions(prev => new Set(prev).add(key));
    try {
      await Promise.all(ids.map(id =>
        fetch(`/api/brain/desires/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'acknowledged' }),
        })
      ));
      await fetchDesires();
    } catch {
      addMessage({ id: generateId(), role: 'assistant', content: '\u6807\u8bb0\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5' });
    } finally {
      setLoadingActions(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }, [fetchDesires, addMessage, generateId]);

  const askAboutDesire = useCallback((desire: Desire) => {
    const summary = desire.content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim();
    const first = summary.split('\n').find(l => l.trim().length > 10) || summary;
    const short = first.length > 80 ? first.slice(0, 80) + '...' : first;
    handleSend(`\u8fd9\u4ef6\u4e8b\u9700\u8981\u5904\u7406\uff0c\u8bf7\u5e2e\u6211\u5206\u6790\u4e0b\u4e00\u6b65\uff1a\u300c${short}\u300d`);
  }, [handleSend]);

  // ── Task 操作：调真实 API ──────────────────────────────
  const dispatchTask = useCallback(async (taskId: string) => {
    setLoadingActions(prev => new Set(prev).add(taskId));
    try {
      const r = await fetch(`/api/brain/tasks/${taskId}/dispatch`, { method: 'POST' });
      const data = await r.json();
      if (data.success) {
        addMessage({ id: generateId(), role: 'assistant', content: `\u5df2\u6d3e\u53d1\u4efb\u52a1\uff0crun_id: ${data.run_id}` });
        await fetchTasks();
      } else {
        addMessage({ id: generateId(), role: 'assistant', content: `\u6d3e\u53d1\u5931\u8d25\uff1a${data.error}${data.detail ? ' \u2014 ' + data.detail : ''}` });
      }
    } catch {
      addMessage({ id: generateId(), role: 'assistant', content: '\u6d3e\u53d1\u8bf7\u6c42\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5' });
    } finally {
      setLoadingActions(prev => { const n = new Set(prev); n.delete(taskId); return n; });
    }
  }, [fetchTasks, addMessage, generateId]);

  const askAboutTask = useCallback((task: Task) => {
    handleSend(`\u5173\u4e8e\u4efb\u52a1\u300c${task.title}\u300d\uff08${task.priority} / ${task.task_type}\uff09\uff0c\u8bf7\u89e3\u91ca\u80cc\u666f\u548c\u76ee\u7684`);
  }, [handleSend]);

  // ── 语音 ────────────────────────────────────────────────
  const realtime = useRealtimeVoice({
    onUserSpeech: useCallback((text: string) => { if (text.trim()) handleSend(text.trim()); }, [handleSend]),
  });

  // ── 渲染 ────────────────────────────────────────────────
  const aC = ALERTNESS_CONF[alertnessLevel as keyof typeof ALERTNESS_CONF] ?? ALERTNESS_CONF[1];

  const visibleMessages = showAllChat ? messages : messages.slice(-CHAT_DEFAULT_VISIBLE);
  const hasHiddenMessages = messages.length > CHAT_DEFAULT_VISIBLE && !showAllChat;

  const containerStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#09090f' }
    : { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', background: '#09090f' };

  return (
    <div style={containerStyle}>
      {/* ── Header ────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, padding: '0 24px', height: 48,
        display: 'flex', alignItems: 'center', gap: 14,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.01)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Brain size={14} style={{ color: 'rgba(167,139,250,0.7)' }} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Cecelia</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: aC.color }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: aC.color }}>{aC.label}</span>
          </div>
          <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.08)' }} />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{status.tickActionsToday}{'\u26a1'}</span>
          <span style={{ fontSize: 10, color: status.tasksInProgress > 0 ? '#60a5fa' : 'rgba(255,255,255,0.35)' }}>
            {status.tasksInProgress}{'\u8fd0\u884c\u4e2d'}
          </span>
          {realtime.isConnected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', animation: 'pulse 1s infinite' }} />
              {realtime.isRecording && <Mic size={10} style={{ color: '#10b981' }} />}
              {realtime.isPlaying && <Volume2 size={10} style={{ color: '#10b981' }} />}
            </div>
          )}
          <button
            onClick={() => setFullscreen(!fullscreen)}
            style={{
              padding: 5, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: fullscreen ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)',
              color: fullscreen ? '#a78bfa' : 'rgba(255,255,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title={fullscreen ? '\u9000\u51fa\u5168\u5c4f (Esc)' : '\u5168\u5c4f'}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* ── Briefing Feed ─────────────────────────────────── */}
      <div ref={feedRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 640, padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* ── 红区：需要你决策 ─────────────────────────── */}
          {decisions.length > 0 && (
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 8px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(239,68,68,0.6)', letterSpacing: '0.1em' }}>
                  {'\ud83d\udd34'} {'\u9700\u8981\u4f60\u51b3\u7b56'}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', padding: '1px 7px', borderRadius: 10 }}>
                  {decisions.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {decisions.map(g => (
                  <DecisionCard
                    key={g.key}
                    group={g}
                    onAcknowledge={acknowledgeDesires}
                    onAsk={askAboutDesire}
                    loading={loadingActions.has(g.desires.map(x => x.id).join(','))}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── 黄区：等你确认 ───────────────────────────── */}
          {queuedTasks.length > 0 && (
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 8px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(245,158,11,0.6)', letterSpacing: '0.1em' }}>
                  {'\ud83d\udccb'} {'\u7b49\u4f60\u786e\u8ba4'}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)', padding: '1px 7px', borderRadius: 10 }}>
                  {queuedTasks.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {queuedTasks.map(t => (
                  <TaskConfirmCard
                    key={t.id}
                    task={t}
                    onDispatch={dispatchTask}
                    onAsk={askAboutTask}
                    loading={loadingActions.has(t.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── 信息通知（非紧急 desires）─────────────────── */}
          {updates.length > 0 && (
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 8px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.1em' }}>
                  {'\u901a\u77e5'}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.04)', padding: '1px 7px', borderRadius: 10 }}>
                  {updates.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {updates.map(g => {
                  const d = g.representative;
                  const line = d.content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').split('\n').find(l => l.trim().length > 10) || d.content;
                  return (
                    <div key={g.key} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 8,
                    }}>
                      <p style={{ margin: 0, flex: 1, fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {line.length > 100 ? line.slice(0, 100) + '...' : line}
                      </p>
                      {g.desires.length > 1 && (
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', flexShrink: 0 }}>+{g.desires.length - 1}</span>
                      )}
                      <button
                        onClick={() => acknowledgeDesires(g.desires.map(x => x.id))}
                        style={{ ...btnStyle('rgba(255,255,255,0.04)', 'rgba(255,255,255,0.25)'), padding: '4px 8px', fontSize: 11 }}
                      >
                        <CheckCircle size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 空状态 ────────────────────────────────────── */}
          {desires.length === 0 && queuedTasks.length === 0 && messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'rgba(255,255,255,0.1)' }}>
              <Brain size={36} style={{ opacity: 0.12, marginBottom: 10 }} />
              <p style={{ fontSize: 13, margin: 0 }}>{'\u4e00\u5207\u5b89\u597d\uff0c\u6682\u65e0\u9700\u8981\u6c47\u62a5\u7684\u4e8b\u9879'}</p>
            </div>
          )}

          {/* ── 对话区 ────────────────────────────────────── */}
          {messages.length > 0 && (
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 8px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.1em' }}>
                  {'\u5bf9\u8bdd'}
                </span>
              </div>

              {hasHiddenMessages && (
                <button
                  onClick={() => setShowAllChat(true)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 8px',
                    color: 'rgba(167,139,250,0.4)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <ChevronUp size={12} />{'\u663e\u793a\u66f4\u591a\u5386\u53f2'}{'\uff08'}{messages.length - CHAT_DEFAULT_VISIBLE} {'\u6761\uff09'}
                </button>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {visibleMessages.map(msg => <ChatBubble key={msg.id} msg={msg} />)}
              </div>
            </section>
          )}

          {/* ── 思考中动画 ────────────────────────────────── */}
          {sending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Brain size={11} style={{ color: 'rgba(167,139,250,0.5)' }} />
              </div>
              <div style={{ padding: '7px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px 12px 12px 4px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: i === thinkingPhase ? '#a78bfa' : 'rgba(167,139,250,0.15)', transition: 'background 0.4s' }} />)}
                </div>
                <span style={{ fontSize: 10, color: 'rgba(167,139,250,0.4)' }}>{['\u611f\u77e5\u4e2d', '\u601d\u8003\u4e2d', '\u6df1\u601d\u4e2d'][thinkingPhase]}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Input ──────────────────────────────────── */}
      <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 640, padding: '10px 20px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={realtime.isConnected ? realtime.disconnect : realtime.connect}
            style={{ padding: 7, borderRadius: 7, border: 'none', cursor: 'pointer', flexShrink: 0, background: realtime.isConnected ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.04)', color: realtime.isConnected ? '#fff' : 'rgba(255,255,255,0.3)' }}
          >
            {realtime.isConnected ? <PhoneOff size={13} /> : <Phone size={13} />}
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={'\u8ddf Cecelia \u8bf4...'}
            disabled={realtime.isConnected || sending}
            style={{ flex: 1, padding: '9px 14px', borderRadius: 9, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: '#e2e8f0', fontSize: 13, outline: 'none', opacity: (realtime.isConnected || sending) ? 0.4 : 1 }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sending || realtime.isConnected}
            style={{ padding: 7, borderRadius: 7, border: 'none', cursor: 'pointer', flexShrink: 0, background: input.trim() && !sending && !realtime.isConnected ? 'rgba(110,40,220,0.8)' : 'rgba(255,255,255,0.04)', color: input.trim() && !sending && !realtime.isConnected ? '#fff' : 'rgba(255,255,255,0.2)' }}
          >
            <Send size={13} />
          </button>
        </div>
        {realtime.error && <p style={{ fontSize: 10, color: '#f87171', textAlign: 'center', margin: '0 0 8px' }}>{realtime.error}</p>}
      </div>
    </div>
  );
}
