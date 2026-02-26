/**
 * CeceliaPage V3 — 主动式管家界面
 *
 * Layout: AmbientGlow → StatusBar → VoiceCard → DecisionInbox → Two-column grid
 * 核心转变：Cecelia 先说话，用户一键决策。
 * Data: WebSocket events + REST fallback for initial load
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Maximize2, Minimize2, Sparkles } from 'lucide-react';
import { AmbientGlow } from '../components/AmbientGlow';
import { StatusBar } from '../components/StatusBar';
import { VoiceCard } from '../components/VoiceCard';
import { DecisionInbox } from '../components/DecisionInbox';
import { AgentMonitor } from '../components/AgentMonitor';
import { EventStream } from '../components/EventStream';
import { CommandPalette } from '../components/CommandPalette';
import { useCeceliaWS, WS_EVENTS } from '../hooks/useCeceliaWS';
import { useBriefing } from '../hooks/useBriefing';
import type { EventType } from '../components/cards/EventCard';

// ── Types ─────────────────────────────────────────────────

interface Desire {
  id: string;
  type: string;
  content: string;
  urgency: number;
  proposed_action?: string;
}

interface DesireExpressed {
  id: string;
  type: string;
  urgency: number;
  content: string;
  message?: string;
  timestamp: string;
}

interface Task {
  id: string;
  title: string;
  task_type: string;
  priority: string;
  status: string;
  started_at?: string;
  skill?: string;
  agent_name?: string;
}

interface InnerLifeData {
  rumination?: { daily_budget: number; undigested_count: number };
  reflection?: { accumulator: number; threshold: number; progress_pct: number };
  desires?: { pending: number; expressed: number; total: number };
}

interface FlowEvent {
  id: string;
  type: EventType;
  text: string;
  time: string;
  timestamp: number;
}

// ── Main Component ────────────────────────────────────────

export default function CeceliaPage() {
  const [fullscreen, setFullscreen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  // ── Data hooks ──────────────────────────────────────────
  const { connected, subscribe } = useCeceliaWS();
  const { data: briefing } = useBriefing();

  // ── State ───────────────────────────────────────────────
  const [alertness, setAlertness] = useState(1);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [tickIntervalMinutes, setTickIntervalMinutes] = useState(5);
  const [desires, setDesires] = useState<Desire[]>([]);
  const [queuedTasks, setQueuedTasks] = useState<Task[]>([]);
  const [runningTasks, setRunningTasks] = useState<Task[]>([]);
  const [todayStats, setTodayStats] = useState({ completed: 0, failed: 0, queued: 0, successRate: 100, tokenCostUsd: 0 });
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [loadingActions, setLoadingActions] = useState<Set<string>>(new Set());
  const [innerLife, setInnerLife] = useState<InnerLifeData | null>(null);
  const [latestExpression, setLatestExpression] = useState<DesireExpressed | null>(null);
  const [cognitivePhase, setCognitivePhase] = useState<string>('idle');
  const [cognitiveDetail, setCognitiveDetail] = useState<string>('');
  const eventIdRef = useRef(0);

  // ── Toast auto-dismiss ────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((text: string, type: 'error' | 'success' = 'error') => {
    setToast({ text, type });
  }, []);

  // ── Cmd+K global shortcut ─────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdkOpen(prev => !prev);
      }
      if (e.key === 'Escape' && fullscreen && !cmdkOpen) setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, cmdkOpen]);

  // ── Initial REST fetch ──────────────────────────────────
  const fetchActivity = useCallback(async () => {
    try {
      const [tasksRes, statusRes] = await Promise.all([
        fetch('/api/brain/tasks?status=in_progress&limit=10'),
        fetch('/api/brain/status/full'),
      ]);

      if (tasksRes.ok) {
        const d = await tasksRes.json();
        setRunningTasks(Array.isArray(d) ? d : (d.tasks || []));
      }

      if (statusRes.ok) {
        const d = await statusRes.json();
        const completed = d.task_stats?.completed_today ?? d.tick_stats?.actions_today ?? 0;
        const failed = d.task_stats?.failed_today ?? 0;
        const queued = d.task_queue?.queued ?? 0;
        const total = completed + failed;
        setTodayStats({
          completed, failed, queued,
          successRate: total > 0 ? (completed / total) * 100 : 100,
          tokenCostUsd: d.token_stats?.today_usd ?? 0,
        });
        setLastTickAt(d.tick_stats?.last_tick_at ?? null);
        setTickIntervalMinutes(d.tick_stats?.interval_minutes ?? 5);
      }
    } catch { /* */ }
  }, []);

  const fetchInnerLife = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/inner-life');
      if (res.ok) {
        const d = await res.json();
        setInnerLife(d);
      }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    async function loadInitial() {
      try {
        const [alertRes, desiresRes, tasksRes, eventsRes] = await Promise.all([
          fetch('/api/brain/alertness'),
          fetch('/api/brain/desires?status=pending&limit=20'),
          fetch('/api/brain/tasks?status=queued&limit=12'),
          fetch('/api/brain/events?limit=50'),
        ]);
        if (alertRes.ok) { const d = await alertRes.json(); setAlertness(d.level ?? 1); }
        if (desiresRes.ok) { const d = await desiresRes.json(); setDesires(Array.isArray(d) ? d : (d.desires || [])); }
        if (tasksRes.ok) { const d = await tasksRes.json(); setQueuedTasks(Array.isArray(d) ? d : (d.tasks || [])); }
        if (eventsRes?.ok) {
          const d = await eventsRes.json();
          const rawEvents = d.events || [];
          const mapped: FlowEvent[] = rawEvents.reverse().map((e: { id: number; event_type: string; payload?: { title?: string; content?: string }; created_at: string }, i: number) => {
            const dt = new Date(e.created_at);
            const time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
            const typeMap: Record<string, EventType> = {
              'task_completed': 'task_completed', 'task_failed': 'task_failed',
              'task_started': 'task_started', 'task_dispatched': 'task_started',
              'alertness_changed': 'alertness_changed', 'tick_executed': 'tick_executed',
              'desire_created': 'desire_created', 'routing_decision': 'tick_executed',
              'dispatch_attempt': 'task_started', 'dispatch_success': 'task_started',
            };
            const type = typeMap[e.event_type] || 'tick_executed';
            const text = e.payload?.title || e.payload?.content || e.event_type.replace(/_/g, ' ');
            return { id: `hist-${e.id || i}`, type, text, time, timestamp: dt.getTime() };
          });
          setEvents(mapped);
          eventIdRef.current = mapped.length;
        }
      } catch { /* */ }
    }
    loadInitial();
    fetchActivity();
    fetchInnerLife();

    // 通知后端用户到来，触发 Cecelia 主动问候
    fetch('/api/brain/greet', { method: 'POST' }).catch(() => {});

    const t = setInterval(fetchActivity, 30000);
    const t2 = setInterval(fetchInnerLife, 60000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, [fetchActivity, fetchInnerLife]);

  // ── WebSocket subscriptions ─────────────────────────────

  const pushEvent = useCallback((type: EventType, text: string) => {
    const id = `ev-${++eventIdRef.current}`;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setEvents(prev => {
      const next = [...prev, { id, type, text, time, timestamp: now.getTime() }];
      return next.length > 50 ? next.slice(-50) : next;
    });
  }, []);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(subscribe(WS_EVENTS.ALERTNESS_CHANGED, (data) => {
      setAlertness(data.level ?? data.alertness ?? 1);
      pushEvent('alertness_changed', `警觉等级 → ${data.level ?? data.alertness}`);
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_COMPLETED, (data) => {
      pushEvent('task_completed', data.title || '任务完成');
      fetchActivity();
      fetch('/api/brain/tasks?status=queued&limit=12')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setQueuedTasks(Array.isArray(d) ? d : (d.tasks || [])); })
        .catch(() => {});
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_FAILED, (data) => {
      pushEvent('task_failed', data.title || '任务失败');
      fetchActivity();
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_STARTED, (data) => {
      pushEvent('task_started', data.title || '任务开始');
      fetchActivity();
    }));

    unsubs.push(subscribe(WS_EVENTS.TICK_EXECUTED, (data) => {
      pushEvent('tick_executed', `Tick #${data.tick_number || '?'}`);
      setLastTickAt(new Date().toISOString());
      // 刷新 inner-life 数据（每个 tick 后反刍/反思数据可能变化）
      fetchInnerLife();
    }));

    unsubs.push(subscribe(WS_EVENTS.DESIRE_CREATED, (data) => {
      pushEvent('desire_created', data.summary?.slice(0, 60) || data.content?.slice(0, 60) || '新 Desire');
      fetch('/api/brain/desires?status=pending&limit=20')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setDesires(Array.isArray(d) ? d : (d.desires || [])); })
        .catch(() => {});
    }));

    // 订阅 DESIRE_EXPRESSED — 更新 VoiceCard
    unsubs.push(subscribe(WS_EVENTS.DESIRE_EXPRESSED, (data) => {
      setLatestExpression({
        id: data.id,
        type: data.type,
        urgency: data.urgency,
        content: data.content,
        message: data.message,
        timestamp: data.timestamp || new Date().toISOString(),
      });
      pushEvent('desire_created', `Cecelia: ${data.message?.slice(0, 50) || data.content?.slice(0, 50) || '主动表达'}`);
    }));

    // 订阅认知状态事件（活性信号）
    unsubs.push(subscribe(WS_EVENTS.COGNITIVE_STATE, (data) => {
      setCognitivePhase(data.phase || 'idle');
      setCognitiveDetail(data.detail || '');
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_CREATED, () => {
      fetch('/api/brain/tasks?status=queued&limit=12')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setQueuedTasks(Array.isArray(d) ? d : (d.tasks || [])); })
        .catch(() => {});
    }));

    return () => unsubs.forEach(u => u());
  }, [subscribe, pushEvent, fetchActivity, fetchInnerLife]);

  // ── Desire actions ──────────────────────────────────────

  const respondDesire = useCallback(async (id: string, message: string) => {
    setLoadingActions(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/brain/desires/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || `回复失败 (${res.status})`, 'error');
      } else {
        showToast('已回复', 'success');
      }
      const r = await fetch('/api/brain/desires?status=pending&limit=20');
      if (r.ok) { const d = await r.json(); setDesires(Array.isArray(d) ? d : (d.desires || [])); }
    } catch {
      showToast('回复请求失败，请重试', 'error');
    } finally {
      setLoadingActions(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, [showToast]);

  const acknowledgeDesire = useCallback(async (ids: string[]) => {
    const key = ids.join(',');
    setLoadingActions(prev => new Set(prev).add(key));
    try {
      const results = await Promise.all(ids.map(id =>
        fetch(`/api/brain/desires/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'acknowledged' }),
        })
      ));
      const failed = results.filter(r => !r.ok);
      if (failed.length > 0) {
        showToast(`确认失败 (${failed.length}/${results.length})`, 'error');
      } else {
        showToast('已确认', 'success');
      }
      const r = await fetch('/api/brain/desires?status=pending&limit=20');
      if (r.ok) { const d = await r.json(); setDesires(Array.isArray(d) ? d : (d.desires || [])); }
    } catch {
      showToast('确认请求失败，请重试', 'error');
    } finally {
      setLoadingActions(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }, [showToast]);

  const dispatchTask = useCallback(async (taskId: string) => {
    setLoadingActions(prev => new Set(prev).add(taskId));
    try {
      const res = await fetch(`/api/brain/tasks/${taskId}/dispatch`, { method: 'POST' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || `派发失败 (${res.status})`, 'error');
      } else {
        showToast('已派发', 'success');
      }
      const r = await fetch('/api/brain/tasks?status=queued&limit=12');
      if (r.ok) { const d = await r.json(); setQueuedTasks(Array.isArray(d) ? d : (d.tasks || [])); }
      fetchActivity();
    } catch {
      showToast('派发请求失败，请重试', 'error');
    } finally {
      setLoadingActions(prev => { const n = new Set(prev); n.delete(taskId); return n; });
    }
  }, [fetchActivity, showToast]);

  // ── Render ──────────────────────────────────────────────

  const containerStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#09090f' }
    : { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', background: '#09090f' };

  return (
    <div style={containerStyle}>
      <AmbientGlow alertness={alertness} cognitivePhase={cognitivePhase}>
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
          {/* Status Bar — 增强版，含反刍/反思指标 */}
          <StatusBar
            alertness={alertness}
            runningCount={runningTasks.length}
            queuedCount={queuedTasks.length}
            tokenCostUsd={todayStats.tokenCostUsd}
            lastTickAt={lastTickAt}
            tickIntervalMinutes={tickIntervalMinutes}
            innerLife={innerLife}
            cognitivePhase={cognitivePhase as any}
            cognitiveDetail={cognitiveDetail}
          />

          {/* Top-right controls */}
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%',
                background: connected ? '#10b981' : '#ef4444',
                boxShadow: connected ? '0 0 4px #10b981' : 'none',
              }} />
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
                {connected ? 'WS' : '离线'}
              </span>
            </div>
            <button
              onClick={() => setFullscreen(!fullscreen)}
              style={{
                padding: 5, borderRadius: 6, border: 'none', cursor: 'pointer',
                background: fullscreen ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)',
                color: fullscreen ? '#a78bfa' : 'rgba(255,255,255,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title={fullscreen ? '退出全屏 (Esc)' : '全屏'}
            >
              {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>

          {/* VoiceCard — Cecelia 的主动表达（永远有内容） */}
          <VoiceCard
            greeting={briefing?.greeting ?? null}
            latestExpression={latestExpression}
            briefingSummary={briefing ? {
              completed: briefing.since_last_visit?.completed ?? todayStats.completed,
              failed: briefing.since_last_visit?.failed ?? todayStats.failed,
              queued: briefing.since_last_visit?.queued ?? todayStats.queued,
              in_progress: (briefing as any).since_last_visit?.in_progress ?? runningTasks.length,
              running_tasks: (briefing as any).running_tasks ?? runningTasks.map(t => ({ title: t.title, priority: t.priority })),
            } : {
              completed: todayStats.completed,
              failed: todayStats.failed,
              queued: todayStats.queued,
              in_progress: runningTasks.length,
              running_tasks: runningTasks.map(t => ({ title: t.title, priority: t.priority })),
            }}
            onAcknowledge={(id) => acknowledgeDesire([id])}
            onChat={() => setCmdkOpen(true)}
            cognitivePhase={cognitivePhase}
          />

          {/* Decision Inbox — 等你决策 */}
          <div style={{ margin: '12px 0 0' }}>
            <DecisionInbox
              desires={desires}
              queuedTasks={queuedTasks}
              onRespondDesire={respondDesire}
              onAcknowledgeDesire={acknowledgeDesire}
              onDispatchTask={dispatchTask}
              loadingActions={loadingActions}
            />
          </div>

          {/* Two-column grid: Agent Monitor + Event Stream */}
          <div style={{
            flex: 1, display: 'flex', minHeight: 0,
            marginTop: 12,
            borderTop: '1px solid rgba(255,255,255,0.04)',
          }}>
            {/* Left: Agent Monitor */}
            <div style={{
              flex: 1, minWidth: 0,
              borderRight: '1px solid rgba(255,255,255,0.04)',
            }}>
              <AgentMonitor runningTasks={runningTasks} queuedTasks={queuedTasks} />
            </div>

            {/* Right: Event Stream */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <EventStream events={events} />
            </div>
          </div>

        </div>
      </AmbientGlow>

      {/* Cmd+K Command Palette */}
      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} />

      {/* Mini floating bubble — bottom-right */}
      {!cmdkOpen && (
        <button
          onClick={() => setCmdkOpen(true)}
          style={{
            position: 'fixed', right: 16, bottom: 16, zIndex: 100,
            width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
            boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(124,58,237,0.5)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(124,58,237,0.4)'; }}
          title="问 Cecelia (⌘K)"
        >
          <Sparkles size={18} color="#fff" />
        </button>
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 10002,
          padding: '8px 16px', borderRadius: 8, fontSize: 13,
          background: toast.type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(16,185,129,0.9)',
          color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          pointerEvents: 'none',
        }}>
          {toast.text}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
