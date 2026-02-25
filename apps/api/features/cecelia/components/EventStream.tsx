/**
 * EventStream — Timeline-format event log
 *
 * Right column of the three-column layout.
 * Shows real-time system events in a compact timeline.
 * Newest events at top, color-coded by type.
 */

import { Radio } from 'lucide-react';
import type { EventType } from './cards/EventCard';

// ── Types ────────────────────────────────────────────────

interface FlowEvent {
  id: string;
  type: EventType;
  text: string;
  time: string;
  timestamp: number;
}

interface EventStreamProps {
  events: FlowEvent[];
}

const EVENT_CONFIG: Record<string, { symbol: string; color: string }> = {
  task_completed: { symbol: '\u2713', color: '#10b981' },
  task_failed: { symbol: '\u2717', color: '#ef4444' },
  task_started: { symbol: '\u25b6', color: '#60a5fa' },
  alertness_changed: { symbol: '\u25c6', color: '#f59e0b' },
  tick_executed: { symbol: '\u25cb', color: '#475569' },
  desire_created: { symbol: '\u2606', color: '#a78bfa' },
};

// ── Main Component ───────────────────────────────────────

export function EventStream({ events }: EventStreamProps) {
  // Show newest first
  const sorted = [...events].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Radio size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em' }}>
          EVENTS
        </span>
        {events.length > 0 && (
          <span style={{
            fontSize: 9, color: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)',
            padding: '0 6px', borderRadius: 8,
          }}>{events.length}</span>
        )}
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {sorted.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center' }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, margin: '0 auto 8px',
              background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Radio size={14} style={{ color: 'rgba(255,255,255,0.1)' }} />
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.12)' }}>等待事件...</span>
          </div>
        ) : (
          sorted.map((ev, i) => {
            const config = EVENT_CONFIG[ev.type] ?? { symbol: '\u2022', color: '#475569' };
            return (
              <div
                key={ev.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '5px 14px',
                  opacity: i < 3 ? 1 : Math.max(0.4, 1 - i * 0.05),
                }}
              >
                {/* Timeline dot + line */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: config.color, lineHeight: 1 }}>{config.symbol}</span>
                  {i < sorted.length - 1 && (
                    <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.04)', marginTop: 2 }} />
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontSize: 10.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.3,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    display: 'block',
                  }}>
                    {ev.text}
                  </span>
                </div>

                {/* Time */}
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)', flexShrink: 0, lineHeight: '14px' }}>
                  {ev.time}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
