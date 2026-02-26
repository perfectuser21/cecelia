/**
 * VoiceCard — Cecelia 的主动表达
 *
 * 永远展示有意义的内容，从不为空：
 * P0: desire:expressed（Cecelia 主动表达）
 * P1: 智能简报（任务进展、运行中、排队中）
 * P2: 反刍洞察
 * P3: 时间问候 + 状态概览
 */

import { useState } from 'react';
import { MessageCircle, Sparkles, Check, RefreshCw, AlertTriangle, PartyPopper, HelpCircle, Activity } from 'lucide-react';

// ── Types ────────────────────────────────────────────────

interface DesireExpressed {
  id: string;
  type: string; // inform | propose | warn | celebrate | question
  urgency: number;
  content: string;
  message?: string;
  timestamp: string;
}

interface BriefingSummary {
  completed: number;
  failed: number;
  queued: number;
  in_progress: number;
  running_tasks?: { title: string; priority: string }[];
}

interface VoiceCardProps {
  greeting: string | null;
  latestExpression: DesireExpressed | null;
  briefingSummary: BriefingSummary | null;
  onAcknowledge?: (id: string) => void;
  onChat?: () => void;
}

// ── Icon & Color mapping ─────────────────────────────────

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  propose: { icon: <Sparkles size={14} />, color: '#a78bfa', label: '建议' },
  warn: { icon: <AlertTriangle size={14} />, color: '#f59e0b', label: '注意' },
  inform: { icon: <MessageCircle size={14} />, color: '#60a5fa', label: '汇报' },
  celebrate: { icon: <PartyPopper size={14} />, color: '#10b981', label: '好消息' },
  question: { icon: <HelpCircle size={14} />, color: '#f472b6', label: '请决策' },
  briefing: { icon: <Activity size={14} />, color: '#818cf8', label: '简报' },
};

// ── Helper: 构建智能简报文字 ──────────────────────────────

function buildBriefingText(greeting: string | null, summary: BriefingSummary | null): string {
  const greet = greeting || getTimeGreeting();
  const parts: string[] = [greet];

  if (summary) {
    const { completed, failed, queued, in_progress, running_tasks } = summary;

    // 运行中的任务
    if (in_progress > 0 && running_tasks && running_tasks.length > 0) {
      const taskNames = running_tasks.slice(0, 2).map(t => t.title).join('、');
      parts.push(`正在执行 ${in_progress} 个任务：${taskNames}${in_progress > 2 ? ' 等' : ''}`);
    } else if (in_progress > 0) {
      parts.push(`正在执行 ${in_progress} 个任务`);
    }

    // 完成统计
    if (completed > 0 || failed > 0) {
      const statParts: string[] = [];
      if (completed > 0) statParts.push(`完成 ${completed}`);
      if (failed > 0) statParts.push(`失败 ${failed}`);
      parts.push(`今天已${statParts.join('，')}`);
    }

    // 排队中
    if (queued > 0) {
      parts.push(`${queued} 个任务排队等待派发`);
    }

    // 全部为零的情况
    if (completed === 0 && failed === 0 && in_progress === 0 && queued === 0) {
      parts.push('系统空闲中，等待指令');
    }
  } else {
    parts.push('系统运行中');
  }

  return parts.join('。') + '。';
}

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

// ── Main Component ───────────────────────────────────────

export function VoiceCard({ greeting, latestExpression, briefingSummary, onAcknowledge, onChat }: VoiceCardProps) {
  const [dismissed, setDismissed] = useState(false);

  // 决定展示什么内容
  const hasExpression = latestExpression && !dismissed;

  let content: string;
  let typeKey: string;

  if (hasExpression) {
    content = latestExpression.message || latestExpression.content;
    typeKey = latestExpression.type;
  } else {
    // 永远有内容：智能简报
    content = buildBriefingText(greeting, briefingSummary);
    typeKey = 'briefing';
  }

  const typeConf = TYPE_CONFIG[typeKey] || TYPE_CONFIG.briefing;

  const handleAck = () => {
    if (hasExpression && onAcknowledge) {
      onAcknowledge(latestExpression!.id);
      setDismissed(true);
    }
  };

  // 清理内容：去掉 markdown 标记
  const displayContent = content
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .trim();

  // 取第一段（最多 200 字符）
  const firstParagraph = displayContent.split('\n').filter(l => l.trim()).slice(0, 3).join('\n');
  const truncated = firstParagraph.length > 200 ? firstParagraph.slice(0, 200) + '...' : firstParagraph;

  return (
    <div style={{
      margin: '12px 16px 0',
      padding: '16px 20px',
      background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(99,102,241,0.04))',
      border: `1px solid ${typeConf.color}20`,
      borderLeft: `3px solid ${typeConf.color}`,
      borderRadius: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: typeConf.color, display: 'flex' }}>{typeConf.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: typeConf.color, letterSpacing: '0.05em' }}>
          Cecelia · {typeConf.label}
        </span>
        {hasExpression && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>
            {formatTimeAgo(latestExpression!.timestamp)}
          </span>
        )}
      </div>

      {/* Content */}
      <p style={{
        margin: '0 0 12px',
        fontSize: 13,
        lineHeight: 1.6,
        color: 'rgba(255,255,255,0.7)',
        whiteSpace: 'pre-line',
      }}>
        {truncated}
      </p>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {hasExpression && latestExpression!.type === 'propose' && (
          <>
            <VoiceButton color="#10b981" onClick={handleAck}>
              <Check size={11} /> 同意
            </VoiceButton>
            <VoiceButton color="#6b7280" onClick={handleAck}>
              <RefreshCw size={11} /> 换一个
            </VoiceButton>
          </>
        )}
        {hasExpression && latestExpression!.type === 'warn' && (
          <>
            <VoiceButton color="#f59e0b" onClick={handleAck}>
              <Check size={11} /> 处理
            </VoiceButton>
            <VoiceButton color="#6b7280" onClick={handleAck}>
              知道了
            </VoiceButton>
          </>
        )}
        {hasExpression && latestExpression!.type === 'question' && (
          <VoiceButton color="#f472b6" onClick={handleAck}>
            <Check size={11} /> 已决策
          </VoiceButton>
        )}
        {onChat && (
          <VoiceButton color="rgba(255,255,255,0.3)" onClick={onChat}>
            <MessageCircle size={11} /> 对话
          </VoiceButton>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────

function VoiceButton({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        background: `${color}18`,
        color,
        fontSize: 11,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function formatTimeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  return `${Math.floor(hrs / 24)} 天前`;
}
