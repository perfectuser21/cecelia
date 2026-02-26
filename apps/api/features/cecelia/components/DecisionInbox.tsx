/**
 * DecisionInbox — 决策收件箱
 *
 * 替代 ActionZone，展示所有需要用户决策的事项。
 * Inbox Zero 为目标：清空后显示"一切就绪"。
 */

import { CheckCircle, Zap, Loader2, Inbox, AlertTriangle, MessageSquare, Sparkles } from 'lucide-react';

// ── Types ────────────────────────────────────────────────

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

interface DecisionInboxProps {
  desires: Desire[];
  queuedTasks: Task[];
  onAcknowledgeDesire: (ids: string[]) => void;
  onDispatchTask: (id: string) => void;
  loadingActions: Set<string>;
}

const PRIORITY_COLOR: Record<string, string> = {
  P0: '#ef4444', P1: '#f59e0b', P2: '#3b82f6', P3: '#6b7280',
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  propose: <Sparkles size={12} />,
  warn: <AlertTriangle size={12} />,
  question: <MessageSquare size={12} />,
};

// ── Main Component ───────────────────────────────────────

export function DecisionInbox({ desires, queuedTasks, onAcknowledgeDesire, onDispatchTask, loadingActions }: DecisionInboxProps) {
  const actionableDesires = desires.filter(d =>
    d.urgency >= 5 || ['warn', 'question', 'propose'].includes(d.type)
  );
  const totalItems = actionableDesires.length + queuedTasks.length;

  return (
    <div style={{
      margin: '0 16px',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        background: 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <Inbox size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.04em' }}>
          等你决策
        </span>
        {totalItems > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
            background: totalItems > 3 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
            color: totalItems > 3 ? '#f87171' : '#fbbf24',
          }}>
            {totalItems}
          </span>
        )}
        {actionableDesires.length > 1 && (
          <button
            onClick={() => onAcknowledgeDesire(actionableDesires.map(d => d.id))}
            style={{
              marginLeft: 'auto', padding: '3px 10px', borderRadius: 5, border: 'none',
              cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)',
              fontSize: 10, fontWeight: 600,
            }}
          >
            全部确认
          </button>
        )}
      </div>

      {/* Empty state */}
      {totalItems === 0 && (
        <div style={{
          padding: '20px 16px',
          textAlign: 'center',
          color: 'rgba(255,255,255,0.2)',
          fontSize: 12,
        }}>
          <CheckCircle size={20} style={{ marginBottom: 6, opacity: 0.3 }} />
          <div>一切就绪</div>
        </div>
      )}

      {/* Desire items */}
      {actionableDesires.slice(0, 5).map(d => {
        const summary = d.content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim();
        const firstLine = summary.split('\n').find(l => l.trim().length > 5) || summary;
        const display = firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
        const isLoading = loadingActions.has(d.id);
        const icon = TYPE_ICON[d.type] || <MessageSquare size={12} />;

        return (
          <div key={d.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
            transition: 'background 0.15s',
          }}>
            <span style={{ color: d.urgency >= 7 ? '#f87171' : '#fbbf24', flexShrink: 0, display: 'flex' }}>
              {icon}
            </span>
            <span style={{
              flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4,
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {display}
            </span>
            <button
              onClick={() => onAcknowledgeDesire([d.id])}
              disabled={isLoading}
              style={{
                padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                background: 'rgba(16,185,129,0.1)', color: '#34d399',
                fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
              }}
            >
              {isLoading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={10} />}
              确认
            </button>
          </div>
        );
      })}

      {/* Queued tasks */}
      {queuedTasks.slice(0, 4).map(t => {
        const isLoading = loadingActions.has(t.id);
        return (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
              background: `${PRIORITY_COLOR[t.priority] ?? '#6b7280'}15`,
              color: PRIORITY_COLOR[t.priority] ?? '#6b7280',
            }}>{t.priority}</span>
            <span style={{
              flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.55)',
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {t.title}
            </span>
            <button
              onClick={() => onDispatchTask(t.id)}
              disabled={isLoading}
              style={{
                padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                background: 'rgba(34,197,94,0.1)', color: '#4ade80',
                fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
              }}
            >
              {isLoading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={10} />}
              派发
            </button>
          </div>
        );
      })}
    </div>
  );
}
