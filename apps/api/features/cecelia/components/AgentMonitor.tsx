/**
 * AgentMonitor — Running agents with progress + task queue
 *
 * Left column of the three-column layout.
 * Shows running agents as live cards, queued tasks below.
 */

import { Play, Clock, Loader2 } from 'lucide-react';

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

interface QueuedTask {
  id: string;
  title: string;
  task_type: string;
  priority: string;
}

interface AgentMonitorProps {
  runningTasks: RunningTask[];
  queuedTasks: QueuedTask[];
}

const PRIORITY_COLOR: Record<string, string> = {
  P0: '#ef4444', P1: '#f59e0b', P2: '#3b82f6', P3: '#6b7280',
};

// ── Main Component ───────────────────────────────────────

export function AgentMonitor({ runningTasks, queuedTasks }: AgentMonitorProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Play size={11} style={{ color: '#60a5fa', opacity: 0.7 }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em' }}>
          AGENTS
        </span>
        {runningTasks.length > 0 && (
          <span style={{
            fontSize: 9, color: '#60a5fa', background: 'rgba(96,165,250,0.1)',
            padding: '0 6px', borderRadius: 8,
          }}>{runningTasks.length}</span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {/* Running agents */}
        {runningTasks.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center' }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, margin: '0 auto 8px',
              background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Play size={14} style={{ color: 'rgba(255,255,255,0.1)' }} />
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.12)' }}>无运行中 Agent</span>
          </div>
        ) : (
          runningTasks.map(t => <RunningAgentCard key={t.id} task={t} />)
        )}

        {/* Queue */}
        {queuedTasks.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', marginTop: 4 }}>
            <div style={{
              padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <Clock size={10} style={{ color: 'rgba(255,255,255,0.2)' }} />
              <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.06em' }}>
                队列 ({queuedTasks.length})
              </span>
            </div>
            {queuedTasks.slice(0, 8).map(t => (
              <div key={t.id} style={{
                padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{
                  width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
                  background: PRIORITY_COLOR[t.priority] ?? '#6b7280', opacity: 0.5,
                }} />
                <span style={{
                  fontSize: 10.5, color: 'rgba(255,255,255,0.3)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{t.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────

function RunningAgentCard({ task }: { task: RunningTask }) {
  const elapsed = Math.floor((Date.now() - new Date(task.started_at).getTime()) / 60000);
  const agentName = task.agent_name || task.skill || task.task_type;

  return (
    <div style={{
      margin: '4px 10px', padding: '10px 12px',
      background: 'rgba(96,165,250,0.04)',
      border: '1px solid rgba(96,165,250,0.08)',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Loader2 size={10} style={{ color: '#60a5fa', animation: 'spin 2s linear infinite', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#93c5fd' }}>{agentName}</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' }}>{elapsed}m</span>
      </div>
      <p style={{
        margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {task.title}
      </p>
    </div>
  );
}
