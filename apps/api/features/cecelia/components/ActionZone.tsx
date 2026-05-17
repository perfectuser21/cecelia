/**
 * ActionZone — Items requiring user decision/action
 *
 * Shows pending desires (decisions) and queued tasks needing confirmation.
 * Auto-hides when nothing needs attention (zero height).
 * Auto-expands with red/amber highlight when items appear.
 */

import { AlertTriangle, CheckCircle, Zap, MessageSquare, Loader2 } from 'lucide-react';

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

interface ActionZoneProps {
  desires: Desire[];
  queuedTasks: Task[];
  onAcknowledgeDesire: (ids: string[]) => void;
  onDispatchTask: (id: string) => void;
  loadingActions: Set<string>;
}

const PRIORITY_COLOR: Record<string, string> = {
  P0: '#ef4444', P1: '#f59e0b', P2: '#3b82f6', P3: '#6b7280',
};

// ── Main Component ───────────────────────────────────────

export function ActionZone({ desires, queuedTasks, onAcknowledgeDesire, onDispatchTask, loadingActions }: ActionZoneProps) {
  const urgentDesires = desires.filter(d => d.urgency >= 7 || ['warn', 'question', 'propose'].includes(d.type));
  const hasItems = urgentDesires.length > 0 || queuedTasks.length > 0;

  if (!hasItems) return null;

  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      background: 'rgba(255,255,255,0.01)',
      animation: 'actionZoneIn 0.3s ease-out',
    }}>
      <style>{`
        @keyframes actionZoneIn {
          from { opacity: 0; max-height: 0; padding: 0 16px; }
          to { opacity: 1; max-height: 400px; padding: 10px 16px; }
        }
      `}</style>

      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Urgent decisions */}
        {urgentDesires.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <AlertTriangle size={11} style={{ color: '#ef4444' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(239,68,68,0.7)', letterSpacing: '0.08em' }}>
                需要决策 ({urgentDesires.length})
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {urgentDesires.slice(0, 4).map(d => {
                const summary = d.content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim();
                const firstLine = summary.split('\n').find(l => l.trim().length > 10) || summary;
                const display = firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine;
                const isLoading = loadingActions.has(d.id);

                return (
                  <div key={d.id} style={{
                    flex: '1 1 280px', maxWidth: 400,
                    background: 'rgba(239,68,68,0.04)',
                    border: '1px solid rgba(239,68,68,0.12)',
                    borderLeft: '3px solid #ef4444',
                    borderRadius: 8, padding: '10px 14px',
                  }}>
                    <p style={{ margin: '0 0 8px', fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                      {display}
                    </p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => onAcknowledgeDesire([d.id])}
                        disabled={isLoading}
                        style={btnStyle('rgba(239,68,68,0.12)', '#f87171')}
                      >
                        {isLoading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={10} />}
                        了解
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Queued tasks needing dispatch */}
        {queuedTasks.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <MessageSquare size={11} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(245,158,11,0.7)', letterSpacing: '0.08em' }}>
                等待派发 ({queuedTasks.length})
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {queuedTasks.slice(0, 6).map(t => {
                const isLoading = loadingActions.has(t.id);
                return (
                  <div key={t.id} style={{
                    flex: '1 1 200px', maxWidth: 320,
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 8,
                  }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                      background: `${PRIORITY_COLOR[t.priority] ?? '#6b7280'}15`,
                      color: PRIORITY_COLOR[t.priority] ?? '#6b7280',
                    }}>{t.priority}</span>
                    <span style={{
                      flex: 1, fontSize: 11.5, color: '#cbd5e1', minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{t.title}</span>
                    <button
                      onClick={() => onDispatchTask(t.id)}
                      disabled={isLoading}
                      style={btnStyle('rgba(34,197,94,0.12)', '#4ade80')}
                    >
                      {isLoading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={10} />}
                      派发
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function btnStyle(bg: string, color: string): React.CSSProperties {
  return {
    padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: bg, color, fontSize: 10.5, fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 3, transition: 'all 0.15s',
    flexShrink: 0,
  };
}
