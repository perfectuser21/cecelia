/**
 * InnerLifePanel — Cecelia 的内心世界面板
 *
 * 折叠式展示：反刍进度 · 反思累积 · 最近洞察 · Desire 统计
 * 让用户看到 Cecelia 在"消化"什么、"想"什么。
 */

import { useState } from 'react';
import { BookOpen, Brain, Lightbulb, Heart, ChevronDown, ChevronRight } from 'lucide-react';

// ── Types ────────────────────────────────────────────────

interface Insight {
  id: number;
  content: string;
  importance: number;
  type: 'rumination' | 'reflection';
  created_at: string;
}

interface InnerLifeData {
  rumination?: { daily_budget: number; undigested_count: number };
  reflection?: { accumulator: number; threshold: number; progress_pct: number };
  insights?: Insight[];
  desires?: { pending: number; expressed: number; total: number };
}

interface InnerLifePanelProps {
  data: InnerLifeData | null;
  cognitivePhase?: string;
}

// ── Phase 颜色映射 ──────────────────────────────────────

const PHASE_ACCENT: Record<string, string> = {
  idle: '#22c55e',
  rumination: '#f59e0b',
  reflecting: '#a78bfa',
  desire: '#ec4899',
  planning: '#6366f1',
  dispatching: '#06b6d4',
};

// ── Main Component ───────────────────────────────────────

export function InnerLifePanel({ data, cognitivePhase = 'idle' }: InnerLifePanelProps) {
  const [expanded, setExpanded] = useState(true);
  const accent = PHASE_ACCENT[cognitivePhase] || '#6366f1';

  if (!data) {
    return (
      <div style={{ padding: '10px 14px' }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)' }}>加载内心数据…</span>
      </div>
    );
  }

  const { rumination, reflection, insights, desires } = data;

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', padding: '8px 14px',
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        {expanded ? <ChevronDown size={10} style={{ color: accent }} /> : <ChevronRight size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />}
        <Brain size={11} style={{ color: accent, opacity: 0.7 }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: accent, letterSpacing: '0.08em', opacity: 0.8 }}>
          INNER LIFE
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 10px' }}>
          {/* 反刍进度 */}
          {rumination && (
            <MetricRow
              icon={<BookOpen size={11} />}
              color={rumination.undigested_count > 0 ? '#f59e0b' : '#22c55e'}
              label="反刍"
              value={rumination.undigested_count > 0
                ? `${rumination.undigested_count} 待消化`
                : '全部消化'}
              subtext={`预算 ${rumination.daily_budget}/天`}
            />
          )}

          {/* 反思累积 */}
          {reflection && (
            <div style={{ marginBottom: 8 }}>
              <MetricRow
                icon={<Brain size={11} />}
                color={reflection.progress_pct > 80 ? '#a78bfa' : 'rgba(255,255,255,0.4)'}
                label="反思"
                value={`${Math.round(reflection.accumulator)} / ${reflection.threshold}`}
                subtext={`${reflection.progress_pct}%`}
              />
              {/* Progress bar */}
              <div style={{
                marginLeft: 22, marginTop: 3,
                height: 3, borderRadius: 2,
                background: 'rgba(255,255,255,0.06)',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${Math.min(100, reflection.progress_pct)}%`,
                  height: '100%',
                  borderRadius: 2,
                  background: reflection.progress_pct > 80
                    ? 'linear-gradient(90deg, #a78bfa, #c4b5fd)'
                    : 'rgba(255,255,255,0.15)',
                  transition: 'width 1s ease',
                }} />
              </div>
            </div>
          )}

          {/* Desire 统计 */}
          {desires && (
            <MetricRow
              icon={<Heart size={11} />}
              color={desires.pending > 0 ? '#ec4899' : 'rgba(255,255,255,0.3)'}
              label="欲望"
              value={desires.pending > 0 ? `${desires.pending} 待处理` : '无待处理'}
              subtext={`已表达 ${desires.expressed} / 共 ${desires.total}`}
            />
          )}

          {/* 最近洞察 */}
          {insights && insights.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <Lightbulb size={10} style={{ color: '#fbbf24', opacity: 0.6 }} />
                <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.05em' }}>
                  最近洞察
                </span>
              </div>
              {insights.slice(0, 5).map((ins) => (
                <InsightItem key={ins.id} insight={ins} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────

function MetricRow({ icon, color, label, value, subtext }: {
  icon: React.ReactNode; color: string; label: string; value: string; subtext?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <span style={{ color, opacity: 0.6, display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', width: 28, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 10.5, fontWeight: 600, color, flex: 1 }}>{value}</span>
      {subtext && (
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>{subtext}</span>
      )}
    </div>
  );
}

function InsightItem({ insight }: { insight: Insight }) {
  // 去掉 [反刍洞察] 或 [反思洞察] 前缀
  const cleanContent = insight.content
    .replace(/^\[反刍洞察\]\s*/g, '')
    .replace(/^\[反思洞察\]\s*/g, '');
  const truncated = cleanContent.length > 80 ? cleanContent.slice(0, 80) + '…' : cleanContent;

  const isRumination = insight.type === 'rumination';
  const ago = formatAgo(insight.created_at);

  return (
    <div style={{
      padding: '4px 0 4px 16px',
      borderLeft: `2px solid ${isRumination ? 'rgba(245,158,11,0.2)' : 'rgba(167,139,250,0.2)'}`,
      marginBottom: 3,
    }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4,
        display: 'block',
      }}>
        {truncated}
      </span>
      <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)' }}>
        {isRumination ? '反刍' : '反思'} · {ago}
      </span>
    </div>
  );
}

function formatAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  return `${Math.floor(hrs / 24)}天前`;
}
