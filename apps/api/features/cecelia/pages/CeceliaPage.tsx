/**
 * CeceliaPage V2 Phase 3.1 — 管家指挥室
 *
 * Layout: AmbientGlow → PulseStrip → ActionZone → Three-column grid
 * Chat: Cmd+K 命令面板 + 右下角迷你气泡（替代底部 ChatDrawer）
 * Design: Command center, not chat window.
 * Data: WebSocket events + REST fallback for initial load
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Maximize2, Minimize2, Sparkles } from 'lucide-react';
import { AmbientGlow } from '../components/AmbientGlow';
import { PulseStrip } from '../components/PulseStrip';
import { ActionZone } from '../components/ActionZone';
import { AgentMonitor } from '../components/AgentMonitor';
import { TodayOverview } from '../components/TodayOverview';
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

interface ClusterNode {
  name: string;
  location: string;
  cpu_percent: number;
  memory_used_gb: number;
  memory_total_gb: number;
  active_agents: number;
  available_slots: number;
}

interface TodayStats {
  completed: number;
  failed: number;
  queued: number;
  successRate: number;
  tokenCostUsd: number;
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
  const [clusterNodes, setClusterNodes] = useState<ClusterNode[]>([]);
  const [todayStats, setTodayStats] = useState<TodayStats>({ completed: 0, failed: 0, queued: 0, successRate: 100, tokenCostUsd: 0 });
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [loadingActions, setLoadingActions] = useState<Set<string>>(new Set());
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
      const [tasksRes, clusterRes, statusRes] = await Promise.all([
        fetch('/api/brain/tasks?status=in_progress&limit=10'),
        fetch('/api/brain/cluster/status').catch(() => null),
        fetch('/api/brain/status/full'),
      ]);

      if (tasksRes.ok) {
        const d = await tasksRes.json();
        setRunningTasks(Array.isArray(d) ? d : (d.tasks || []));
      }

      if (clusterRes?.ok) {
        const d = await clusterRes.json();
        const nodes: ClusterNode[] = [];
        const servers = d.cluster?.servers || d.servers || [];
        for (const s of servers) {
          const memTotal = s.resources?.mem_total_gb ?? s.memory_total_gb ?? s.mem_total ?? 8;
          const memFree = s.resources?.mem_free_gb ?? 0;
          nodes.push({
            name: s.name || s.location?.toUpperCase() || 'Node',
            location: s.location || 'us',
            cpu_percent: s.resources?.cpu_pct ?? s.cpu_percent ?? s.cpu ?? 0,
            memory_used_gb: s.memory_used_gb ?? (memTotal - memFree),
            memory_total_gb: memTotal,
            active_agents: s.slots?.used ?? s.active_agents ?? s.activeAgents ?? 0,
            available_slots: s.slots?.available ?? s.available_slots ?? s.availableSlots ?? 0,
          });
        }
        if (d.us) nodes.push({ name: 'US', location: 'us', ...d.us });
        if (d.hk) nodes.push({ name: 'HK', location: 'hk', ...d.hk });
        setClusterNodes(nodes);
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
    const t = setInterval(fetchActivity, 30000);
    return () => clearInterval(t);
  }, [fetchActivity]);

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
    }));

    unsubs.push(subscribe(WS_EVENTS.DESIRE_CREATED, (data) => {
      pushEvent('desire_created', data.content?.slice(0, 60) || '新 Desire');
      fetch('/api/brain/desires?status=pending&limit=20')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setDesires(Array.isArray(d) ? d : (d.desires || [])); })
        .catch(() => {});
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_CREATED, () => {
      fetch('/api/brain/tasks?status=queued&limit=12')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setQueuedTasks(Array.isArray(d) ? d : (d.tasks || [])); })
        .catch(() => {});
    }));

    return () => unsubs.forEach(u => u());
  }, [subscribe, pushEvent, fetchActivity]);

  // ── Desire actions ──────────────────────────────────────

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
      <AmbientGlow alertness={alertness}>
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
          {/* Status Bar */}
          <PulseStrip
            alertness={alertness}
            runningCount={runningTasks.length}
            queuedCount={queuedTasks.length}
            tokenCostUsd={todayStats.tokenCostUsd}
            lastTickAt={lastTickAt}
            tickIntervalMinutes={tickIntervalMinutes}
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

          {/* Action Required Zone — only shows when there are items */}
          <ActionZone
            desires={desires}
            queuedTasks={queuedTasks}
            onAcknowledgeDesire={acknowledgeDesire}
            onDispatchTask={dispatchTask}
            loadingActions={loadingActions}
          />

          {/* Three-column grid */}
          <div style={{
            flex: 1, display: 'flex', minHeight: 0,
            borderTop: '1px solid rgba(255,255,255,0.04)',
          }}>
            {/* Left: Agent Monitor */}
            <div style={{
              flex: 1, minWidth: 0,
              borderRight: '1px solid rgba(255,255,255,0.04)',
            }}>
              <AgentMonitor runningTasks={runningTasks} queuedTasks={queuedTasks} />
            </div>

            {/* Center: Today Overview */}
            <div style={{
              flex: 1, minWidth: 0,
              borderRight: '1px solid rgba(255,255,255,0.04)',
            }}>
              <TodayOverview todayStats={todayStats} clusterNodes={clusterNodes} briefing={briefing} />
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
