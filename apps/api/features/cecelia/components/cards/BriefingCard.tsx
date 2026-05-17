/**
 * BriefingCard — Morning briefing card shown on page open
 */

import { Sunrise, CheckCircle2, XCircle, Clock, Target, Zap } from 'lucide-react';
import type { BriefingData } from '../../hooks/useBriefing';

interface BriefingCardProps {
  data: BriefingData;
}

export function BriefingCard({ data }: BriefingCardProps) {
  const { since_last_visit, pending_decisions, today_focus, token_cost_usd, greeting } = data;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(167,139,250,0.06) 0%, rgba(59,130,246,0.04) 100%)',
      border: '1px solid rgba(167,139,250,0.12)',
      borderRadius: 14,
      padding: '18px 20px',
      animation: 'briefing-enter 0.4s ease-out',
    }}>
      <style>{`
        @keyframes briefing-enter {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Sunrise size={16} style={{ color: '#a78bfa' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
          {greeting || 'Cecelia 简报'}
        </span>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <StatBox icon={<CheckCircle2 size={13} />} label="完成" value={since_last_visit.completed} color="#10b981" />
        <StatBox icon={<XCircle size={13} />} label="失败" value={since_last_visit.failed} color={since_last_visit.failed > 0 ? '#ef4444' : '#64748b'} />
        <StatBox icon={<Clock size={13} />} label="排队" value={since_last_visit.queued} color="#f59e0b" />
        <StatBox icon={<Zap size={13} />} label="Token" value={`$${token_cost_usd.toFixed(2)}`} color="#60a5fa" />
      </div>

      {/* Pending decisions */}
      {pending_decisions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(239,68,68,0.7)', letterSpacing: '0.05em' }}>
            需要你决策:
          </span>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pending_decisions.slice(0, 3).map((d, i) => (
              <div key={i} style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.6)', paddingLeft: 8, borderLeft: '2px solid rgba(239,68,68,0.2)' }}>
                {d.summary}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today focus */}
      {today_focus && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={12} style={{ color: '#a78bfa', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            今日焦点: {today_focus.title} ({today_focus.progress}%)
          </span>
        </div>
      )}

      {/* Recent events */}
      {since_last_visit.events.length > 0 && (
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 10 }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.05em' }}>
            上次离开后:
          </span>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {since_last_visit.events.slice(0, 5).map((ev, i) => (
              <div key={i} style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>
                <span style={{ color: 'rgba(255,255,255,0.2)', marginRight: 6, fontFamily: 'monospace', fontSize: 10 }}>{ev.time}</span>
                {ev.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number; color: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 10px', borderRadius: 8,
      background: `${color}08`, border: `1px solid ${color}15`,
    }}>
      <span style={{ color, opacity: 0.7 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{label}</div>
      </div>
    </div>
  );
}
