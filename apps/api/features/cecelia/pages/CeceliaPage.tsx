/**
 * CeceliaPage V2 Phase 3 — 管家指挥室
 *
 * Layout: AmbientGlow → PulseStrip → ActionZone → Three-column grid → ChatDrawer
 * Design: Command center, not chat window.
 * Data: WebSocket events + REST fallback for initial load
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { AmbientGlow } from '../components/AmbientGlow';
import { PulseStrip } from '../components/PulseStrip';
import { ActionZone } from '../components/ActionZone';
import { AgentMonitor } from '../components/AgentMonitor';
import { TodayOverview } from '../components/TodayOverview';
import { EventStream } from '../components/EventStream';
import { ChatDrawer } from '../components/ChatDrawer';
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

  // ── Escape exits fullscreen ─────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && fullscreen) setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

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
        if (d.servers) {
          for (const s of d.servers) {
            nodes.push({
              name: s.name || s.location?.toUpperCase() || 'Node',
              location: s.location || 'us',
              cpu_percent: s.cpu_percent ?? s.cpu ?? 0,
              memory_used_gb: s.memory_used_gb ?? s.mem_used ?? 0,
              memory_total_gb: s.memory_total_gb ?? s.mem_total ?? 8,
              active_agents: s.active_agents ?? s.activeAgents ?? 0,
              available_slots: s.available_slots ?? s.availableSlots ?? 0,
            });
          }
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
        const [alertRes, desiresRes, tasksRes] = await Promise.all([
          fetch('/api/brain/alertness'),
          fetch('/api/brain/desires?status=pending&limit=20'),
          fetch('/api/brain/tasks?status=queued&limit=12'),
        ]);
        if (alertRes.ok) { const d = await alertRes.json(); setAlertness(d.level ?? 1); }
        if (desiresRes.ok) { const d = await desiresRes.json(); setDesires(Array.isArray(d) ? d : (d.desires || [])); }
        if (tasksRes.ok) { const d = await tasksRes.json(); setQueuedTasks(Array.isArray(d) ? d : (d.tasks || [])); }
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
      await Promise.all(ids.map(id =>
        fetch(`/api/brain/desires/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'acknowledged' }),
        })
      ));
      const r = await fetch('/api/brain/desires?status=pending&limit=20');
      if (r.ok) { const d = await r.json(); setDesires(Array.isArray(d) ? d : (d.desires || [])); }
    } catch { /* */ }
    finally { setLoadingActions(prev => { const n = new Set(prev); n.delete(key); return n; }); }
  }, []);

  const dispatchTask = useCallback(async (taskId: string) => {
    setLoadingActions(prev => new Set(prev).add(taskId));
    try {
      await fetch(`/api/brain/tasks/${taskId}/dispatch`, { method: 'POST' });
      const r = await fetch('/api/brain/tasks?status=queued&limit=12');
      if (r.ok) { const d = await r.json(); setQueuedTasks(Array.isArray(d) ? d : (d.tasks || [])); }
      fetchActivity();
    } catch { /* */ }
    finally { setLoadingActions(prev => { const n = new Set(prev); n.delete(taskId); return n; }); }
  }, [fetchActivity]);

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

          {/* Chat Drawer — bottom, collapsed by default */}
          <ChatDrawer />
        </div>
      </AmbientGlow>

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
