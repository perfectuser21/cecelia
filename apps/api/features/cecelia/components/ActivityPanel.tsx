/**
 * ActivityPanel — Right-side panel showing running agents, cluster status, today stats
 */

import { useState, useEffect, useCallback } from 'react';
import { Play, Server, BarChart3, Cpu, HardDrive, ChevronRight, ChevronLeft, Loader2 } from 'lucide-react';

// ── Types ────────────────────────────────────────────────

interface RunningTask {
  id: string;
  title: string;
  task_type: string;
  status: string;
  started_at: string;
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

interface ActivityPanelProps {
  runningTasks: RunningTask[];
  clusterNodes: ClusterNode[];
  todayStats: TodayStats;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

// ── Main Component ───────────────────────────────────────

export function ActivityPanel({
  runningTasks,
  clusterNodes,
  todayStats,
  collapsed,
  onToggleCollapse,
}: ActivityPanelProps) {
  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        style={{
          position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
          padding: '12px 4px', borderRadius: '8px 0 0 8px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
          borderRight: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)',
          zIndex: 5,
        }}
      >
        <ChevronLeft size={14} />
      </button>
    );
  }

  return (
    <div style={{
      width: 280,
      flexShrink: 0,
      borderLeft: '1px solid rgba(255,255,255,0.05)',
      background: 'rgba(255,255,255,0.008)',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
    }}>
      {/* Collapse button */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
          ACTIVITY
        </span>
        <button onClick={onToggleCollapse} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', padding: 2 }}>
          <ChevronRight size={12} />
        </button>
      </div>

      {/* Running tasks */}
      <Section icon={<Play size={11} />} title="运行中" count={runningTasks.length} color="#60a5fa">
        {runningTasks.length === 0 ? (
          <Empty text="无运行中任务" />
        ) : (
          runningTasks.map(t => <RunningTaskCard key={t.id} task={t} />)
        )}
      </Section>

      {/* Cluster status */}
      <Section icon={<Server size={11} />} title="集群" color="rgba(255,255,255,0.3)">
        {clusterNodes.length === 0 ? (
          <Empty text="加载中..." />
        ) : (
          clusterNodes.map(n => <ClusterNodeCard key={n.name} node={n} />)
        )}
      </Section>

      {/* Today stats */}
      <Section icon={<BarChart3 size={11} />} title="今日" color="rgba(255,255,255,0.3)">
        <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <StatLabel label="完成" value={todayStats.completed} color="#10b981" />
            <StatLabel label="失败" value={todayStats.failed} color={todayStats.failed > 0 ? '#ef4444' : '#64748b'} />
            <StatLabel label="排队" value={todayStats.queued} color="#f59e0b" />
          </div>
          <div style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>成功率</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{todayStats.successRate.toFixed(0)}%</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.05)' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${Math.min(100, todayStats.successRate)}%`,
                background: todayStats.successRate >= 80 ? '#10b981' : todayStats.successRate >= 50 ? '#f59e0b' : '#ef4444',
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
            <span>Token 费用</span>
            <span>${todayStats.tokenCostUsd.toFixed(2)}</span>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────

function Section({ icon, title, count, color, children }: {
  icon: React.ReactNode; title: string; count?: number; color: string; children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px' }}>
        <span style={{ color, opacity: 0.6 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>{title}</span>
        {count !== undefined && count > 0 && (
          <span style={{ fontSize: 9, color, background: `${color}15`, padding: '0 5px', borderRadius: 8 }}>{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function RunningTaskCard({ task }: { task: RunningTask }) {
  const elapsed = Math.floor((Date.now() - new Date(task.started_at).getTime()) / 60000);

  return (
    <div style={{ padding: '6px 14px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Loader2 size={10} style={{ color: '#60a5fa', animation: 'spin 2s linear infinite' }} />
        <span style={{ fontSize: 11.5, fontWeight: 500, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.agent_name || task.task_type}
        </span>
      </div>
      <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 15 }}>
        {task.title}
      </span>
      <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.2)', paddingLeft: 15 }}>
        {elapsed} 分钟
      </span>
    </div>
  );
}

function ClusterNodeCard({ node }: { node: ClusterNode }) {
  const cpuColor = node.cpu_percent > 80 ? '#ef4444' : node.cpu_percent > 50 ? '#f59e0b' : '#10b981';
  const memPercent = (node.memory_used_gb / node.memory_total_gb) * 100;

  return (
    <div style={{ padding: '6px 14px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        <span style={{ fontSize: 11 }}>{node.location === 'us' ? '\ud83c\uddfa\ud83c\uddf8' : '\ud83c\udded\ud83c\uddf0'}</span>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>{node.name}</span>
      </div>
      <div style={{ display: 'flex', gap: 12, paddingLeft: 4 }}>
        <MiniBar icon={<Cpu size={9} />} label="CPU" value={node.cpu_percent} color={cpuColor} />
        <MiniBar icon={<HardDrive size={9} />} label="RAM" value={memPercent} suffix={`${node.memory_used_gb.toFixed(1)}G`} color="#60a5fa" />
      </div>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 3, paddingLeft: 4 }}>
        Agent: {node.active_agents} / {node.active_agents + node.available_slots}
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
        <span style={{ color: 'rgba(255,255,255,0.2)' }}>{icon}</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>{label}</span>
        <span style={{ fontSize: 9, color, marginLeft: 'auto' }}>{suffix || `${value.toFixed(0)}%`}</span>
      </div>
      <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.05)' }}>
        <div style={{ height: '100%', borderRadius: 1, width: `${Math.min(100, value)}%`, background: color, transition: 'width 0.5s' }} />
      </div>
    </div>
  );
}

function StatLabel({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>{label}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '8px 14px', fontSize: 10.5, color: 'rgba(255,255,255,0.15)' }}>{text}</div>;
}

// ── Data fetching hook ───────────────────────────────────

export function useActivityData() {
  const [runningTasks, setRunningTasks] = useState<RunningTask[]>([]);
  const [clusterNodes, setClusterNodes] = useState<ClusterNode[]>([]);
  const [todayStats, setTodayStats] = useState<TodayStats>({ completed: 0, failed: 0, queued: 0, successRate: 0, tokenCostUsd: 0 });

  const fetchAll = useCallback(async () => {
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
        if (d.us) nodes.push({ name: 'US', location: 'us', ...d.us });
        if (d.hk) nodes.push({ name: 'HK', location: 'hk', ...d.hk });
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
        setClusterNodes(nodes);
      }

      if (statusRes.ok) {
        const d = await statusRes.json();
        const completed = d.task_stats?.completed_today ?? d.tick_stats?.actions_today ?? 0;
        const failed = d.task_stats?.failed_today ?? 0;
        const queued = d.task_queue?.queued ?? 0;
        const total = completed + failed;
        setTodayStats({
          completed,
          failed,
          queued,
          successRate: total > 0 ? (completed / total) * 100 : 100,
          tokenCostUsd: d.token_stats?.today_usd ?? 0,
        });
      }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 30000);
    return () => clearInterval(t);
  }, [fetchAll]);

  return { runningTasks, clusterNodes, todayStats, refetch: fetchAll };
}
