/**
 * EventCard — Lightweight real-time event card inserted into consciousness flow
 *
 * Smaller text, muted colors — shows system is alive without stealing focus.
 */

import { CheckCircle2, XCircle, Play, AlertTriangle, Zap } from 'lucide-react';

export type EventType = 'task_completed' | 'task_failed' | 'task_started' | 'alertness_changed' | 'tick_executed' | 'desire_created';

const EVENT_CONFIG: Record<EventType, { icon: React.ReactNode; color: string }> = {
  task_completed: { icon: <CheckCircle2 size={11} />, color: '#10b981' },
  task_failed: { icon: <XCircle size={11} />, color: '#ef4444' },
  task_started: { icon: <Play size={11} />, color: '#60a5fa' },
  alertness_changed: { icon: <AlertTriangle size={11} />, color: '#f59e0b' },
  tick_executed: { icon: <Zap size={11} />, color: '#a78bfa' },
  desire_created: { icon: <AlertTriangle size={11} />, color: '#f59e0b' },
};

interface EventCardProps {
  type: EventType;
  text: string;
  time: string;
}

export function EventCard({ type, text, time }: EventCardProps) {
  const config = EVENT_CONFIG[type] ?? EVENT_CONFIG.tick_executed;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      borderRadius: 8,
      background: 'rgba(255,255,255,0.015)',
      border: '1px solid rgba(255,255,255,0.03)',
      animation: 'event-enter 0.3s ease-out',
    }}>
      <style>{`
        @keyframes event-enter {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <span style={{ color: config.color, opacity: 0.6, flexShrink: 0 }}>{config.icon}</span>
      <span style={{
        fontSize: 11.5,
        color: 'rgba(255,255,255,0.35)',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {text}
      </span>
      <span style={{
        fontSize: 10,
        color: 'rgba(255,255,255,0.15)',
        flexShrink: 0,
        fontFamily: 'monospace',
      }}>
        {time}
      </span>
    </div>
  );
}
