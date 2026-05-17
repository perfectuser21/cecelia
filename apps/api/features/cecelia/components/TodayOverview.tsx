/**
 * TodayOverview — Today's stats, cluster status, focus KR
 *
 * Center column of the three-column layout.
 * At-a-glance view of system health and progress.
 */

import { BarChart3, Cpu, HardDrive, Target } from 'lucide-react';
import type { BriefingData } from '../hooks/useBriefing';

// ── Types ────────────────────────────────────────────────

interface TodayStats {
  completed: number;
  failed: number;
  queued: number;
  successRate: number;
  tokenCostUsd: number;
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

interface TodayOverviewProps {
  todayStats: TodayStats;
  clusterNodes: ClusterNode[];
  briefing: BriefingData | null;
}

// ── Main Component ───────────────────────────────────────

export function TodayOverview({ todayStats, clusterNodes, briefing }: TodayOverviewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <BarChart3 size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em' }}>
          TODAY
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {/* Stats row */}
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '4px 14px 12px' }}>
          <StatBlock label="完成" value={todayStats.completed} color="#10b981" />
          <StatBlock label="失败" value={todayStats.failed} color={todayStats.failed > 0 ? '#ef4444' : '#475569'} />
          <StatBlock label="排队" value={todayStats.queued} color={todayStats.queued > 0 ? '#f59e0b' : '#475569'} />
        </div>

        {/* Success rate */}
        <div style={{ padding: '0 14px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>成功率</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: rateColor(todayStats.successRate) }}>
              {todayStats.successRate.toFixed(0)}%
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.05)' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${Math.min(100, todayStats.successRate)}%`,
              background: rateColor(todayStats.successRate),
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>

        {/* Token cost */}
        <div style={{
          padding: '0 14px 12px', display: 'flex', justifyContent: 'space-between',
          fontSize: 10, color: 'rgba(255,255,255,0.25)',
        }}>
          <span>Token 费用</span>
          <span style={{ fontWeight: 600 }}>${todayStats.tokenCostUsd.toFixed(2)}</span>
        </div>

        {/* Cluster */}
        {clusterNodes.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
              <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.06em' }}>集群</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {clusterNodes.map(n => <ClusterCard key={n.name} node={n} />)}
            </div>
          </div>
        )}

        {/* Today focus */}
        {briefing?.today_focus && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
              <Target size={10} style={{ color: '#a78bfa', opacity: 0.6 }} />
              <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.06em' }}>今日焦点</span>
            </div>
            <p style={{ margin: '0 0 4px', fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
              {briefing.today_focus.title}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.05)' }}>
                <div style={{
                  height: '100%', borderRadius: 2, width: `${briefing.today_focus.progress}%`,
                  background: '#a78bfa', transition: 'width 0.5s',
                }} />
              </div>
              <span style={{ fontSize: 9, color: 'rgba(167,139,250,0.6)' }}>{briefing.today_focus.progress}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────

function rateColor(rate: number): string {
  if (rate >= 80) return '#10b981';
  if (rate >= 50) return '#f59e0b';
  return '#ef4444';
}

function StatBlock({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function ClusterCard({ node }: { node: ClusterNode }) {
  const cpuColor = node.cpu_percent > 80 ? '#ef4444' : node.cpu_percent > 50 ? '#f59e0b' : '#10b981';
  const memPercent = node.memory_total_gb > 0 ? (node.memory_used_gb / node.memory_total_gb) * 100 : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <span style={{ fontSize: 10 }}>{node.location === 'us' ? '\ud83c\uddfa\ud83c\uddf8' : '\ud83c\udded\ud83c\uddf0'}</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>{node.name}</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)', marginLeft: 'auto' }}>
          {node.active_agents}/{node.active_agents + node.available_slots} agent
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <MiniBar icon={<Cpu size={8} />} label="CPU" value={node.cpu_percent} color={cpuColor} />
        <MiniBar icon={<HardDrive size={8} />} label="RAM" value={memPercent} suffix={`${node.memory_used_gb.toFixed(1)}G`} color="#60a5fa" />
      </div>
    </div>
  );
}

function MiniBar({ icon, label, value, suffix, color }: {
  icon: React.ReactNode; label: string; value: number; suffix?: string; color: string;
}) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2 }}>
        <span style={{ color: 'rgba(255,255,255,0.15)' }}>{icon}</span>
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)' }}>{label}</span>
        <span style={{ fontSize: 8, color, marginLeft: 'auto' }}>{suffix || `${value.toFixed(0)}%`}</span>
      </div>
      <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.05)' }}>
        <div style={{ height: '100%', borderRadius: 1, width: `${Math.min(100, value)}%`, background: color, transition: 'width 0.5s' }} />
      </div>
    </div>
  );
}
