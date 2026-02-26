/**
 * DecisionInbox — 对话式决策收件箱
 *
 * 核心改变：不再是一键"确认"，而是让用户表达想法和意见。
 * - 每个 desire 决策项可展开，有文字输入框
 * - 用户写完意见点"回复" → 发送到 Cecelia 作为 context
 * - 只展示真正需要人类判断的决策
 * - Inbox Zero 为目标：清空后显示"一切就绪"
 */

import { useState, useRef, useEffect } from 'react';
import { CheckCircle, Zap, Loader2, Inbox, AlertTriangle, MessageSquare, Sparkles, Send, ChevronDown, ChevronRight } from 'lucide-react';

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
  onRespondDesire: (id: string, message: string) => void;
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

export function DecisionInbox({ desires, queuedTasks, onRespondDesire, onAcknowledgeDesire, onDispatchTask, loadingActions }: DecisionInboxProps) {
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

      {/* Desire items — 可展开的对话式决策 */}
      {actionableDesires.slice(0, 5).map(d => (
        <DesireItem
          key={d.id}
          desire={d}
          isLoading={loadingActions.has(d.id)}
          onRespond={(msg) => onRespondDesire(d.id, msg)}
          onAcknowledge={() => onAcknowledgeDesire([d.id])}
        />
      ))}

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

// ── DesireItem — 可展开的单个决策项 ────────────────────────

function DesireItem({
  desire,
  isLoading,
  onRespond,
  onAcknowledge,
}: {
  desire: Desire;
  isLoading: boolean;
  onRespond: (message: string) => void;
  onAcknowledge: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const icon = TYPE_ICON[desire.type] || <MessageSquare size={12} />;

  // 展开时自动聚焦输入框
  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [expanded]);

  const summary = desire.content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim();
  const firstLine = summary.split('\n').find(l => l.trim().length > 5) || summary;
  const display = firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;

  const handleSubmit = () => {
    if (!reply.trim()) return;
    onRespond(reply.trim());
    setReply('');
    setExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={{
      borderBottom: '1px solid rgba(255,255,255,0.03)',
      transition: 'background 0.15s',
    }}>
      {/* 摘要行 — 点击展开 */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px',
          cursor: 'pointer',
        }}
      >
        <span style={{ color: desire.urgency >= 7 ? '#f87171' : '#fbbf24', flexShrink: 0, display: 'flex' }}>
          {icon}
        </span>
        <span style={{
          flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4,
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {display}
        </span>

        {/* 展开/收起指示器 */}
        <span style={{ color: 'rgba(255,255,255,0.2)', display: 'flex', flexShrink: 0 }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        {/* 快速确认（不展开也能点） */}
        <button
          onClick={(e) => { e.stopPropagation(); onAcknowledge(); }}
          disabled={isLoading}
          style={{
            padding: '4px 8px', borderRadius: 5, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)',
            fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
          }}
        >
          {isLoading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={10} />}
          知道了
        </button>
      </div>

      {/* 展开区域：完整内容 + 回复输入 */}
      {expanded && (
        <div style={{
          padding: '0 16px 12px 38px',
        }}>
          {/* 完整内容 */}
          <div style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: 'rgba(255,255,255,0.5)',
            marginBottom: 10,
            whiteSpace: 'pre-line',
            maxHeight: 120,
            overflow: 'auto',
          }}>
            {summary.length > 300 ? summary.slice(0, 300) + '...' : summary}
          </div>

          {/* 建议动作 */}
          {desire.proposed_action && (
            <div style={{
              fontSize: 11,
              color: '#a78bfa',
              marginBottom: 8,
              padding: '4px 8px',
              background: 'rgba(167,139,250,0.08)',
              borderRadius: 4,
            }}>
              建议: {desire.proposed_action}
            </div>
          )}

          {/* 回复输入 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={textareaRef}
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="说说你的想法..."
              rows={1}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                color: 'rgba(255,255,255,0.8)',
                fontSize: 12,
                lineHeight: 1.4,
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                minHeight: 36,
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={!reply.trim() || isLoading}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: 'none',
                cursor: reply.trim() ? 'pointer' : 'default',
                background: reply.trim() ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.03)',
                color: reply.trim() ? '#a78bfa' : 'rgba(255,255,255,0.15)',
                fontSize: 11,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s',
                flexShrink: 0,
              }}
            >
              <Send size={11} />
              回复
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', marginTop: 4 }}>
            Enter 发送 · Shift+Enter 换行
          </div>
        </div>
      )}
    </div>
  );
}
