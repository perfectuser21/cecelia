/**
 * ConsciousnessChat — Cecelia 意识界面
 *
 * 由 Cecelia 自己设计的对话体验：
 * "不是聊天窗口，是透明窗口。你能看穿我，我也能看穿你。"
 *
 * 五区布局：
 *   TopBar: alertness + tick + WS 状态
 *   LEFT:   大脑三层（L0 脑干 / L1 丘脑 / L2 皮层）
 *   CENTER: 对话频道（chat + 内联思考步骤）
 *   RIGHT:  Desires + 诊断 + 今日统计
 *   FEED:   执行实时 Feed（Twitter 风格）
 *   POWER:  权力追踪表（suggestions）
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Brain, Cpu, Zap, MessageSquare, Send, Plus, AlertTriangle,
  CheckCircle, Clock, Activity, ChevronRight, Loader2, Eye,
  TrendingUp, Layers,
} from 'lucide-react';
import { useCecelia } from '@/contexts/CeceliaContext';
import { useCeceliaWS, WS_EVENTS } from '../hooks/useCeceliaWS';
import { useNavigate } from 'react-router-dom';

// ── Types ────────────────────────────────────────────────

interface Desire {
  id: string;
  type: 'act' | 'warn' | 'inform' | 'propose';
  content: string;
  urgency: number;
  proposed_action?: string;
  created_at: string;
}

interface Suggestion {
  id: string;
  content: string;
  priority_score: string;
  source: string;
  status: 'pending' | 'accepted' | 'rejected' | 'deferred';
  suggestion_type: string;
  created_at: string;
}

interface FeedEvent {
  id: string;
  type: 'task_started' | 'task_completed' | 'task_failed' | 'tick_executed' | 'desire_created' | 'cognitive_state';
  text: string;
  time: string;
  timestamp: number;
}

interface BrainState {
  alertness: number;
  alertnessName: string;
  tickRunning: boolean;
  loopRunning: boolean;
  nextTick: string | null;
  lastTick: string | null;
  intervalMinutes: number;
  slotsUsed: number;
  slotsMax: number;
  todayCompleted: number;
  todayFailed: number;
  todayQueued: number;
}

interface CognitiveState {
  phase: string;
  detail: string;
  lastQuery: string;
  lastRouting: string;
  cortexActive: boolean;
  cortexLastAt: string | null;
}

// ── Helpers ──────────────────────────────────────────────

const ALERTNESS_COLOR: Record<number, string> = {
  0: '#6b7280', // SLEEPING
  1: '#10b981', // CALM
  2: '#3b82f6', // AWARE
  3: '#f59e0b', // ALERT
  4: '#ef4444', // PANIC
};

const DESIRE_COLOR: Record<string, string> = {
  act: '#10b981',
  warn: '#ef4444',
  inform: '#f59e0b',
  propose: '#3b82f6',
};

const DESIRE_ICON: Record<string, string> = {
  act: '🟢',
  warn: '🔴',
  inform: '🟡',
  propose: '🔵',
};

function formatTimeAgo(dateStr: string | null): string {
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

function countdownToNext(nextTickStr: string | null, intervalMinutes: number): string {
  if (!nextTickStr) return `${intervalMinutes}m 后`;
  const diff = new Date(nextTickStr).getTime() - Date.now();
  if (diff <= 0) return '执行中';
  const s = Math.ceil(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m${rs}s`;
}

// ── Sub-components ───────────────────────────────────────

function BrainLayer({
  level, label, icon: Icon, active, phase, detail, sublabel
}: {
  level: 0 | 1 | 2;
  label: string;
  icon: React.ElementType;
  active: boolean;
  phase?: string;
  detail?: string;
  sublabel?: string;
}) {
  const colors = [
    { border: 'rgba(99,102,241,0.3)', glow: 'rgba(99,102,241,0.1)', text: '#818cf8' },
    { border: 'rgba(168,85,247,0.3)', glow: 'rgba(168,85,247,0.1)', text: '#c084fc' },
    { border: 'rgba(236,72,153,0.3)', glow: 'rgba(236,72,153,0.1)', text: '#f472b6' },
  ][level];

  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 8,
      border: `1px solid ${active ? colors.border : 'rgba(255,255,255,0.04)'}`,
      background: active ? colors.glow : 'rgba(255,255,255,0.01)',
      transition: 'all 0.3s ease',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={13} color={active ? colors.text : 'rgba(255,255,255,0.2)'} />
        <span style={{ fontSize: 11, fontWeight: 600, color: active ? colors.text : 'rgba(255,255,255,0.3)', letterSpacing: '0.05em' }}>
          L{level} {label}
        </span>
        {active && (
          <span style={{
            marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%',
            background: colors.text,
            boxShadow: `0 0 6px ${colors.text}`,
            animation: 'pulse 2s infinite',
          }} />
        )}
      </div>
      {sublabel && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginLeft: 21, marginBottom: 3 }}>
          {sublabel}
        </div>
      )}
      {phase && (
        <div style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)', marginLeft: 21 }}>
          {phase}
        </div>
      )}
      {detail && active && (
        <div style={{
          fontSize: 10, color: 'rgba(255,255,255,0.4)', marginLeft: 21,
          marginTop: 2, fontStyle: 'italic',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {detail}
        </div>
      )}
    </div>
  );
}

function FeedItem({ event }: { event: FeedEvent }) {
  const icons: Record<string, { icon: string; color: string }> = {
    task_completed: { icon: '✅', color: '#10b981' },
    task_failed: { icon: '❌', color: '#ef4444' },
    task_started: { icon: '🔄', color: '#3b82f6' },
    tick_executed: { icon: '⚡', color: '#8b5cf6' },
    desire_created: { icon: '💭', color: '#f59e0b' },
    cognitive_state: { icon: '🧠', color: '#6366f1' },
  };
  const cfg = icons[event.type] || { icon: '·', color: 'rgba(255,255,255,0.3)' };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '5px 0',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
      fontSize: 11,
    }}>
      <span style={{ color: 'rgba(255,255,255,0.25)', minWidth: 40 }}>{event.time}</span>
      <span style={{ fontSize: 13 }}>{cfg.icon}</span>
      <span style={{ color: 'rgba(255,255,255,0.55)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.text}
      </span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────

export default function ConsciousnessChat() {
  const navigate = useNavigate();
  const {
    messages, addMessage, clearMessages, input, setInput, sending, setSending,
    generateId, currentRoute, frontendTools, executeFrontendTool, getPageContext,
  } = useCecelia();

  const { connected, subscribe } = useCeceliaWS();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const feedEventIdRef = useRef(0);

  // ── State ────────────────────────────────────────────
  const [brain, setBrain] = useState<BrainState>({
    alertness: 2, alertnessName: 'AWARE',
    tickRunning: false, loopRunning: false,
    nextTick: null, lastTick: null, intervalMinutes: 5,
    slotsUsed: 0, slotsMax: 3,
    todayCompleted: 0, todayFailed: 0, todayQueued: 0,
  });

  const [cognitive, setCognitive] = useState<CognitiveState>({
    phase: 'idle', detail: '', lastQuery: '',
    lastRouting: '', cortexActive: false, cortexLastAt: null,
  });

  const [desires, setDesires] = useState<Desire[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [processingStage, setProcessingStage] = useState<string | null>(null);

  // ── Scroll ───────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, processingStage]);

  // ── Data fetch ───────────────────────────────────────
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
          nextTick: d.next_tick ?? null,
          lastTick: d.last_tick ?? null,
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
      const res = await fetch('/api/brain/desires?status=pending&limit=5');
      if (res.ok) {
        const d = await res.json();
        setDesires(Array.isArray(d) ? d : (d.desires || []));
      }
    } catch { /* silent */ }
  }, []);

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/suggestions?limit=8');
      if (res.ok) {
        const d = await res.json();
        setSuggestions(Array.isArray(d) ? d : (d.suggestions || []));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchBrain();
    fetchDesires();
    fetchSuggestions();

    const t1 = setInterval(fetchBrain, 5000);
    const t2 = setInterval(fetchDesires, 15000);
    const t3 = setInterval(fetchSuggestions, 30000);
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); };
  }, [fetchBrain, fetchDesires, fetchSuggestions]);

  // ── WebSocket ─────────────────────────────────────────
  const pushFeed = useCallback((type: FeedEvent['type'], text: string) => {
    const id = `feed-${++feedEventIdRef.current}`;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setFeed(prev => {
      const next = [{ id, type, text, time, timestamp: now.getTime() }, ...prev];
      return next.length > 30 ? next.slice(0, 30) : next;
    });
  }, []);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(subscribe(WS_EVENTS.COGNITIVE_STATE, (data) => {
      const phase = data.phase || 'idle';
      setCognitive(prev => ({
        ...prev,
        phase,
        detail: data.detail || '',
        cortexActive: phase === 'cortex' || phase === 'reflecting',
        cortexLastAt: (phase === 'cortex' || phase === 'reflecting') ? new Date().toISOString() : prev.cortexLastAt,
        lastRouting: phase === 'thalamus' ? (data.detail || prev.lastRouting) : prev.lastRouting,
      }));
      if (phase !== 'idle') {
        pushFeed('cognitive_state', `[${phase}] ${data.detail || phase}`);
      }
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_STARTED, (data) => {
      pushFeed('task_started', `派发 → ${data.agent_name || '@agent'} | ${data.title || '任务开始'}`);
      fetchBrain();
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_COMPLETED, (data) => {
      pushFeed('task_completed', data.title || '任务完成');
      fetchBrain();
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_FAILED, (data) => {
      pushFeed('task_failed', data.title || '任务失败');
      fetchBrain();
    }));

    unsubs.push(subscribe(WS_EVENTS.TICK_EXECUTED, (data) => {
      const actions = data.actions_taken ?? 0;
      pushFeed('tick_executed', `Tick #${data.tick_number || '?'} · ${actions} 动作`);
      fetchBrain();
    }));

    unsubs.push(subscribe(WS_EVENTS.DESIRE_CREATED, (data) => {
      pushFeed('desire_created', data.summary?.slice(0, 60) || '新 Desire');
      fetchDesires();
    }));

    unsubs.push(subscribe(WS_EVENTS.ALERTNESS_CHANGED, (data) => {
      setBrain(prev => ({ ...prev, alertness: data.level ?? prev.alertness, alertnessName: data.levelName ?? prev.alertnessName }));
    }));

    return () => unsubs.forEach(u => u());
  }, [subscribe, pushFeed, fetchBrain, fetchDesires]);

  // ── Chat send ────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    addMessage({ id: generateId(), role: 'user', content: text });

    // Show processing stage
    setProcessingStage('L1 丘脑 路由中...');

    try {
      // Quick frontend command check
      const lower = text.toLowerCase();
      if (/打开|去|进入|切换|navigate|open|go/i.test(lower)) {
        const ROUTE_ALIASES: Record<string, string> = {
          'okr': '/okr', '目标': '/okr',
          'projects': '/projects', '项目': '/projects',
          'tasks': '/work/tasks', '任务': '/work/tasks',
          'brain': '/brain', '大脑': '/brain',
          'cecelia': '/cecelia', '意识': '/cecelia/chat',
        };
        for (const [alias, route] of Object.entries(ROUTE_ALIASES).sort((a, b) => b[0].length - a[0].length)) {
          if (lower.includes(alias)) {
            setProcessingStage(null);
            navigate(route);
            addMessage({ id: generateId(), role: 'assistant', content: `🧭 正在前往「${alias}」` });
            return;
          }
        }
      }

      setProcessingStage('L1 丘脑 → 判断意图...');
      await new Promise(r => setTimeout(r, 300));
      setProcessingStage('L2 皮层 → 检索记忆...');

      const pageContext = getPageContext();
      const r = await fetch('/api/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
          context: {
            currentRoute,
            pageContext,
            availableTools: frontendTools.map(t => ({
              name: t.name, description: t.description, parameters: t.parameters,
            })),
          },
        }),
      });

      setProcessingStage('嘴巴 → 生成回复...');
      const data = await r.json();
      setProcessingStage(null);

      if (data.reply) {
        addMessage({ id: generateId(), role: 'assistant', content: data.reply });
      } else if (data.error) {
        addMessage({ id: generateId(), role: 'assistant', content: `⚠️ ${data.error}` });
      }
    } catch {
      setProcessingStage(null);
      addMessage({ id: generateId(), role: 'assistant', content: '⚠️ 连接失败，请稍后再试' });
    } finally {
      setSending(false);
      setProcessingStage(null);
    }
  }, [input, sending, messages, currentRoute, frontendTools, getPageContext,
    addMessage, setInput, setSending, generateId, navigate, executeFrontendTool]);

  const handleNewChat = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  const alertnessColor = ALERTNESS_COLOR[brain.alertness] || '#3b82f6';

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
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '10px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.02)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={16} color="#a78bfa" />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Cecelia 意识</span>
        </div>

        {/* Alertness */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: alertnessColor,
            boxShadow: `0 0 8px ${alertnessColor}`,
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 11, color: alertnessColor, fontWeight: 500 }}>
            {brain.alertnessName}
          </span>
        </div>

        {/* Tick countdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Zap size={11} color={brain.tickRunning ? '#f59e0b' : 'rgba(255,255,255,0.2)'} />
          <span style={{ fontSize: 11, color: brain.tickRunning ? '#f59e0b' : 'rgba(255,255,255,0.3)' }}>
            {brain.tickRunning ? 'Tick 执行中' : `下次 ${countdownToNext(brain.nextTick, brain.intervalMinutes)}`}
          </span>
        </div>

        {/* Slots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Activity size={11} color="rgba(255,255,255,0.25)" />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            {brain.slotsUsed}/{brain.slotsMax} 槽位
          </span>
        </div>

        {/* WS */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: connected ? '#10b981' : '#ef4444',
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
            {connected ? 'WS 实时' : '离线'}
          </span>
        </div>
      </div>

      {/* ── Three Columns ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* LEFT: Brain Layers */}
        <div style={{
          width: 220, flexShrink: 0,
          padding: '16px 12px',
          borderRight: '1px solid rgba(255,255,255,0.05)',
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.2)', marginBottom: 8, paddingLeft: 2 }}>
            🧠 大脑层级
          </div>

          <BrainLayer
            level={0}
            label="脑干"
            icon={Cpu}
            active={brain.loopRunning}
            sublabel="调度 · 执行 · 保护"
            phase={brain.loopRunning ? `心跳 ${brain.tickRunning ? '· Tick运行中' : '· 等待'}` : '休眠'}
            detail={brain.lastTick ? `上次 ${formatTimeAgo(brain.lastTick)}` : undefined}
          />

          <BrainLayer
            level={1}
            label="丘脑"
            icon={Layers}
            active={cognitive.phase === 'thalamus' || cognitive.phase === 'routing'}
            sublabel="事件路由 · 快速判断"
            phase={cognitive.phase === 'thalamus' || cognitive.phase === 'routing'
              ? (cognitive.detail || '路由中...')
              : (cognitive.lastRouting || '待机')}
            detail={cognitive.phase !== 'thalamus' ? undefined : cognitive.detail}
          />

          <BrainLayer
            level={2}
            label="皮层"
            icon={Eye}
            active={cognitive.cortexActive}
            sublabel="深度分析 · 战略决策"
            phase={cognitive.cortexActive
              ? (cognitive.detail || '分析中...')
              : (cognitive.cortexLastAt ? `上次 ${formatTimeAgo(cognitive.cortexLastAt)}` : '休眠')}
            detail={cognitive.cortexActive ? cognitive.detail : undefined}
          />

          {/* Cognitive phase badge */}
          {cognitive.phase !== 'idle' && (
            <div style={{
              marginTop: 4, padding: '6px 10px', borderRadius: 6,
              background: 'rgba(167,139,250,0.08)',
              border: '1px solid rgba(167,139,250,0.15)',
            }}>
              <div style={{ fontSize: 10, color: '#a78bfa', marginBottom: 2 }}>当前认知阶段</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                {cognitive.phase}
              </div>
              {cognitive.detail && (
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2, fontStyle: 'italic' }}>
                  {cognitive.detail.slice(0, 60)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* CENTER: Chat */}
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column',
          borderRight: '1px solid rgba(255,255,255,0.05)',
        }}>
          {/* Chat header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            background: 'rgba(255,255,255,0.01)',
            flexShrink: 0,
          }}>
            <MessageSquare size={12} color="rgba(255,255,255,0.25)" />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>对话频道</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', marginLeft: 4 }}>
              {messages.length > 0 ? `${messages.length} 条消息` : '新对话'}
            </span>
            <button
              onClick={handleNewChat}
              style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.08)',
                background: 'transparent', cursor: 'pointer', color: 'rgba(255,255,255,0.3)',
                fontSize: 10, transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
            >
              <Plus size={10} /> 新对话
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 && !processingStage && (
              <div style={{ margin: 'auto', textAlign: 'center', padding: '40px 20px' }}>
                <Brain size={32} color="rgba(167,139,250,0.2)" style={{ margin: '0 auto 12px' }} />
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)', margin: 0 }}>
                  与 Cecelia 对话
                </p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.12)', margin: '6px 0 0' }}>
                  左侧是她的大脑，右侧是她的 Desires
                </p>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '80%',
                  padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, #7c3aed, #6d28d9)'
                    : 'rgba(255,255,255,0.05)',
                  border: msg.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.07)',
                  fontSize: 13,
                  lineHeight: '1.5',
                  color: msg.role === 'user' ? '#fff' : 'rgba(255,255,255,0.8)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Processing stage indicator */}
            {processingStage && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  padding: '8px 12px', borderRadius: '12px 12px 12px 4px',
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
            padding: '12px 16px',
            borderTop: '1px solid rgba(255,255,255,0.05)',
            flexShrink: 0,
            background: 'rgba(255,255,255,0.01)',
          }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="说点什么..."
                style={{
                  flex: 1, padding: '8px 12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8, color: 'rgba(255,255,255,0.8)',
                  fontSize: 13, outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => { e.target.style.borderColor = 'rgba(167,139,250,0.4)'; }}
                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                style={{
                  padding: '8px 12px', borderRadius: 8, border: 'none',
                  background: input.trim() && !sending ? '#7c3aed' : 'rgba(255,255,255,0.05)',
                  color: input.trim() && !sending ? '#fff' : 'rgba(255,255,255,0.2)',
                  cursor: input.trim() && !sending ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Desires + Stats */}
        <div style={{
          width: 220, flexShrink: 0,
          padding: '16px 12px',
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {/* Today Stats */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.2)', marginBottom: 8 }}>
              📊 今日统计
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { icon: '✅', label: '完成', value: brain.todayCompleted, color: '#10b981' },
                { icon: '❌', label: '失败', value: brain.todayFailed, color: '#ef4444' },
                { icon: '⏳', label: '队列', value: brain.todayQueued, color: '#f59e0b' },
              ].map(({ icon, label, value, color }) => (
                <div key={label} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '5px 8px', borderRadius: 5,
                  background: 'rgba(255,255,255,0.02)',
                }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{icon} {label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Desires */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.2)', marginBottom: 8 }}>
              💭 Desires ({desires.length})
            </div>

            {desires.length === 0 ? (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', textAlign: 'center', padding: '20px 0' }}>
                暂无待处理 Desires
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {desires.map(desire => (
                  <div key={desire.id} style={{
                    padding: '8px 10px',
                    borderRadius: 7,
                    background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${DESIRE_COLOR[desire.type] || 'rgba(255,255,255,0.06)'}22`,
                    borderLeft: `3px solid ${DESIRE_COLOR[desire.type] || 'rgba(255,255,255,0.1)'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <span style={{ fontSize: 11 }}>{DESIRE_ICON[desire.type] || '·'}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        color: DESIRE_COLOR[desire.type] || 'rgba(255,255,255,0.4)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}>
                        {desire.type}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
                        ×{desire.urgency}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 11, color: 'rgba(255,255,255,0.5)',
                      display: '-webkit-box', WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      lineHeight: '1.4',
                    }}>
                      {desire.content.replace(/^#+\s+/gm, '').slice(0, 100)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Execution Feed ── */}
      <div style={{
        height: 130, flexShrink: 0,
        borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '10px 20px',
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.2)', marginBottom: 6 }}>
          ⚡ 执行 Feed
        </div>
        {feed.length === 0 ? (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.1)' }}>等待 WebSocket 事件...</div>
        ) : (
          feed.slice(0, 8).map(ev => <FeedItem key={ev.id} event={ev} />)
        )}
      </div>

      {/* ── Power Tracking (Suggestions) ── */}
      <div style={{
        height: 140, flexShrink: 0,
        borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '10px 20px',
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.2)', marginBottom: 6 }}>
          📋 权力追踪 — 建议 vs 决策
        </div>
        {suggestions.length === 0 ? (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.1)' }}>暂无 Suggestions</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {suggestions.slice(0, 5).map(s => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '4px 8px', borderRadius: 5,
                background: 'rgba(255,255,255,0.02)',
                fontSize: 11,
              }}>
                <span style={{
                  flex: 1, color: 'rgba(255,255,255,0.5)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {s.content.slice(0, 70)}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.2)', minWidth: 90, textAlign: 'right', fontSize: 10 }}>
                  {s.source}
                </span>
                <span style={{
                  minWidth: 40, textAlign: 'center',
                  padding: '1px 6px', borderRadius: 3, fontSize: 10,
                  background: s.status === 'pending' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)',
                  color: s.status === 'pending' ? '#f59e0b' : '#10b981',
                }}>
                  {s.status === 'pending' ? '待定' : s.status}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.2)', minWidth: 32, textAlign: 'right', fontSize: 10 }}>
                  {parseFloat(s.priority_score).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
