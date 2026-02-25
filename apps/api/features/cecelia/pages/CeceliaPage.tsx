/**
 * CeceliaPage V2 — 有意识的管家指挥室
 *
 * Phase 2: Frontend skeleton rewrite
 * Layout: AmbientGlow → PulseStrip → dual-column (ConsciousnessFlow + ActivityPanel)
 * Data: WebSocket events + REST fallback for initial load
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { AmbientGlow } from '../components/AmbientGlow';
import { PulseStrip } from '../components/PulseStrip';
import { ConsciousnessFlow } from '../components/ConsciousnessFlow';
import { ActivityPanel, useActivityData } from '../components/ActivityPanel';
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
  const [activityCollapsed, setActivityCollapsed] = useState(false);

  // ── Data hooks ──────────────────────────────────────────
  const { connected, subscribe } = useCeceliaWS();
  const { data: briefing, loading: briefingLoading } = useBriefing();
  const { runningTasks, clusterNodes, todayStats, refetch: refetchActivity } = useActivityData();

  // ── State: alertness, tick info ─────────────────────────
  const [alertness, setAlertness] = useState(1);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [tickIntervalMinutes, setTickIntervalMinutes] = useState(5);

  // ── State: desires, tasks, events ───────────────────────
  const [desires, setDesires] = useState<Desire[]>([]);
  const [queuedTasks, setQueuedTasks] = useState<Task[]>([]);
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
  useEffect(() => {
    async function loadInitial() {
      try {
        const [alertRes, statusRes, desiresRes, tasksRes] = await Promise.all([
          fetch('/api/brain/alertness'),
          fetch('/api/brain/status/full'),
          fetch('/api/brain/desires?status=pending&limit=20'),
          fetch('/api/brain/tasks?status=queued&limit=8'),
        ]);

        if (alertRes.ok) {
          const d = await alertRes.json();
          setAlertness(d.level ?? 1);
        }

        if (statusRes.ok) {
          const d = await statusRes.json();
          setLastTickAt(d.tick_stats?.last_tick_at ?? null);
          setTickIntervalMinutes(d.tick_stats?.interval_minutes ?? 5);
        }

        if (desiresRes.ok) {
          const d = await desiresRes.json();
          setDesires(Array.isArray(d) ? d : (d.desires || []));
        }

        if (tasksRes.ok) {
          const d = await tasksRes.json();
          setQueuedTasks(Array.isArray(d) ? d : (d.tasks || []));
        }
      } catch { /* initial load best-effort */ }
    }

    loadInitial();
  }, []);

  // ── WebSocket subscriptions ─────────────────────────────

  const pushEvent = useCallback((type: EventType, text: string) => {
    const id = `ev-${++eventIdRef.current}`;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setEvents(prev => {
      const next = [...prev, { id, type, text, time, timestamp: now.getTime() }];
      // Keep max 50 events
      return next.length > 50 ? next.slice(-50) : next;
    });
  }, []);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(subscribe(WS_EVENTS.ALERTNESS_CHANGED, (data) => {
      setAlertness(data.level ?? data.alertness ?? 1);
      pushEvent('alertness_changed', `警觉等级变为 ${data.level ?? data.alertness}`);
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_COMPLETED, (data) => {
      pushEvent('task_completed', data.title || '任务完成');
      refetchActivity();
      // Refresh queued tasks list
      fetch('/api/brain/tasks?status=queued&limit=8')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setQueuedTasks(Array.isArray(d) ? d : (d.tasks || [])); })
        .catch(() => {});
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_FAILED, (data) => {
      pushEvent('task_failed', data.title || '任务失败');
      refetchActivity();
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_STARTED, (data) => {
      pushEvent('task_started', data.title || '任务开始');
      refetchActivity();
    }));

    unsubs.push(subscribe(WS_EVENTS.TICK_EXECUTED, (data) => {
      pushEvent('tick_executed', `Tick #${data.tick_number || '?'}`);
      setLastTickAt(new Date().toISOString());
    }));

    unsubs.push(subscribe(WS_EVENTS.DESIRE_CREATED, (data) => {
      pushEvent('desire_created', data.content?.slice(0, 60) || '新 Desire');
      // Refresh desires
      fetch('/api/brain/desires?status=pending&limit=20')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setDesires(Array.isArray(d) ? d : (d.desires || [])); })
        .catch(() => {});
    }));

    unsubs.push(subscribe(WS_EVENTS.TASK_CREATED, (data) => {
      // Refresh queued tasks
      fetch('/api/brain/tasks?status=queued&limit=8')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setQueuedTasks(Array.isArray(d) ? d : (d.tasks || [])); })
        .catch(() => {});
    }));

    return () => unsubs.forEach(u => u());
  }, [subscribe, pushEvent, refetchActivity]);

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
      if (r.ok) {
        const d = await r.json();
        setDesires(Array.isArray(d) ? d : (d.desires || []));
      }
    } catch { /* */ }
    finally {
      setLoadingActions(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }, []);

  // ── Task actions ────────────────────────────────────────

  const dispatchTask = useCallback(async (taskId: string) => {
    setLoadingActions(prev => new Set(prev).add(taskId));
    try {
      await fetch(`/api/brain/tasks/${taskId}/dispatch`, { method: 'POST' });
      const r = await fetch('/api/brain/tasks?status=queued&limit=8');
      if (r.ok) {
        const d = await r.json();
        setQueuedTasks(Array.isArray(d) ? d : (d.tasks || []));
      }
    } catch { /* */ }
    finally {
      setLoadingActions(prev => { const n = new Set(prev); n.delete(taskId); return n; });
    }
  }, []);

  // ── Render ──────────────────────────────────────────────

  const containerStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#09090f' }
    : { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', background: '#09090f' };

  return (
    <div style={containerStyle}>
      <AmbientGlow alertness={alertness}>
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
          {/* PulseStrip — top status bar */}
          <PulseStrip
            alertness={alertness}
            runningCount={runningTasks.length}
            queuedCount={queuedTasks.length}
            tokenCostUsd={todayStats.tokenCostUsd}
            lastTickAt={lastTickAt}
            tickIntervalMinutes={tickIntervalMinutes}
          />

          {/* Fullscreen toggle (top-right overlay) */}
          <button
            onClick={() => setFullscreen(!fullscreen)}
            style={{
              position: 'absolute', top: 8, right: 8, zIndex: 10,
              padding: 5, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: fullscreen ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)',
              color: fullscreen ? '#a78bfa' : 'rgba(255,255,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title={fullscreen ? '退出全屏 (Esc)' : '全屏'}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          {/* WebSocket indicator */}
          <div style={{
            position: 'absolute', top: 12, right: 40, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: connected ? '#10b981' : '#ef4444',
              boxShadow: connected ? '0 0 4px #10b981' : 'none',
            }} />
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
              {connected ? 'WS' : '离线'}
            </span>
          </div>

          {/* Dual-column layout */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
            {/* Left: Consciousness Flow */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <ConsciousnessFlow
                briefing={briefing}
                briefingLoading={briefingLoading}
                events={events}
                desires={desires}
                queuedTasks={queuedTasks}
                onAcknowledgeDesire={acknowledgeDesire}
                onDispatchTask={dispatchTask}
                loadingActions={loadingActions}
              />
            </div>

            {/* Right: Activity Panel */}
            <ActivityPanel
              runningTasks={runningTasks}
              clusterNodes={clusterNodes}
              todayStats={todayStats}
              collapsed={activityCollapsed}
              onToggleCollapse={() => setActivityCollapsed(!activityCollapsed)}
            />
          </div>
        </div>
      </AmbientGlow>

      {/* Global CSS for spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
