/**
 * StatusBar — Cecelia 生命体征 + 活性信号
 *
 * 一行展示：呼吸脉动 · 认知阶段 · 反刍进度 · 反思累积 · Tick 倒计时 · 运行/排队 · 费用
 * 呼吸脉动速度和颜色随 cognitivePhase 实时变化。
 */

import { useState, useEffect, useRef } from 'react';
import { Timer, Play, ListTodo, DollarSign, BookOpen, Brain } from 'lucide-react';

// ── Cognitive Phase 配置 ─────────────────────────────────

export type CognitivePhase =
  | 'idle' | 'alertness' | 'thalamus' | 'decomposition'
  | 'planning' | 'dispatching' | 'decision' | 'rumination'
  | 'desire' | 'reflecting';

const PHASE_CONFIG: Record<CognitivePhase, { color: string; label: string; speed: number }> = {
  idle:          { color: '#22c55e', label: '空闲', speed: 4 },
  alertness:     { color: '#f59e0b', label: '评估警觉…', speed: 2 },
  thalamus:      { color: '#3b82f6', label: '丘脑路由…', speed: 2 },
  decomposition: { color: '#8b5cf6', label: '检查拆解…', speed: 2 },
  planning:      { color: '#6366f1', label: '规划中…', speed: 1.5 },
  dispatching:   { color: '#06b6d4', label: '派发任务…', speed: 1.5 },
  decision:      { color: '#14b8a6', label: '决策分析…', speed: 2 },
  rumination:    { color: '#f59e0b', label: '反刍消化…', speed: 2.5 },
  desire:        { color: '#ec4899', label: '感知表达…', speed: 2 },
  reflecting:    { color: '#a78bfa', label: '深度反思…', speed: 3 },
};

// ── Alertness 配置 ───────────────────────────────────────

const ALERTNESS_CONF: Record<number, { label: string; color: string }> = {
  0: { label: 'SLEEP', color: '#64748b' },
  1: { label: 'CALM', color: '#22c55e' },
  2: { label: 'AWARE', color: '#3b82f6' },
  3: { label: 'ALERT', color: '#f59e0b' },
  4: { label: 'PANIC', color: '#ef4444' },
};

// ── Types ────────────────────────────────────────────────

interface InnerLifeData {
  rumination?: { daily_budget: number; undigested_count: number };
  reflection?: { accumulator: number; threshold: number; progress_pct: number };
}

interface StatusBarProps {
  alertness: number;
  runningCount: number;
  queuedCount: number;
  tokenCostUsd: number;
  lastTickAt: string | null;
  tickIntervalMinutes: number;
  innerLife: InnerLifeData | null;
  cognitivePhase?: CognitivePhase;
  cognitiveDetail?: string;
}

// ── Main Component ───────────────────────────────────────

export function StatusBar({
  alertness, runningCount, queuedCount, tokenCostUsd,
  lastTickAt, tickIntervalMinutes, innerLife,
  cognitivePhase = 'idle', cognitiveDetail,
}: StatusBarProps) {
  const [countdown, setCountdown] = useState('--:--');
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const aC = ALERTNESS_CONF[alertness] ?? ALERTNESS_CONF[1];
  const phaseConf = PHASE_CONFIG[cognitivePhase] || PHASE_CONFIG.idle;

  // Tick countdown
  useEffect(() => {
    if (!lastTickAt) return;
    function updateCountdown() {
      const last = new Date(lastTickAt!).getTime();
      const next = last + tickIntervalMinutes * 60 * 1000;
      const remaining = Math.max(0, next - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${mins}:${String(secs).padStart(2, '0')}`);
    }
    updateCountdown();
    intervalRef.current = setInterval(updateCountdown, 1000);
    return () => clearInterval(intervalRef.current);
  }, [lastTickAt, tickIntervalMinutes]);

  const rum = innerLife?.rumination;
  const ref = innerLife?.reflection;

  // 动态状态文字
  const statusText = cognitiveDetail || phaseConf.label;

  // 呼吸灯动画名（唯一，避免冲突）
  const breatheId = `breathe-${cognitivePhase}`;

  return (
    <>
      <style>{`
        @keyframes ${breatheId} {
          0%, 100% {
            opacity: 0.4;
            transform: scale(1);
            box-shadow: 0 0 0 0 ${phaseConf.color}66;
          }
          50% {
            opacity: 1;
            transform: scale(1.3);
            box-shadow: 0 0 12px 4px ${phaseConf.color}33;
          }
        }
      `}</style>

      <div style={{
        flexShrink: 0,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: '0 16px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.01)',
        overflowX: 'auto',
      }}>
        {/* 呼吸脉动 + 状态文字 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 12px 0 4px',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: phaseConf.color,
            animation: `${breatheId} ${phaseConf.speed}s ease-in-out infinite`,
            transition: 'background 0.6s ease',
          }} />
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: phaseConf.color,
            letterSpacing: '0.02em',
            transition: 'color 0.6s ease',
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {statusText}
          </span>
        </div>

        {/* Alertness */}
        <StatusItem color={aC.color} label={aC.label} />

        {/* 反刍进度 */}
        {rum && (
          <StatusItem
            icon={<BookOpen size={12} />}
            color={rum.undigested_count > 0 ? '#f59e0b' : '#22c55e'}
            label={rum.undigested_count > 0 ? `${rum.undigested_count}待消化` : '反刍✓'}
          />
        )}

        {/* 反思累积 */}
        {ref && (
          <StatusItem
            icon={<Brain size={12} />}
            color={ref.progress_pct > 80 ? '#a78bfa' : 'rgba(255,255,255,0.4)'}
            label={`${Math.round(ref.accumulator)}/${ref.threshold}`}
          />
        )}

        {/* Tick 倒计时 */}
        <StatusItem icon={<Timer size={12} />} color="rgba(255,255,255,0.5)" label={countdown} />

        {/* 运行中 */}
        <StatusItem
          icon={<Play size={12} />}
          color={runningCount > 0 ? '#60a5fa' : 'rgba(255,255,255,0.3)'}
          label={`${runningCount} 运行`}
        />

        {/* 排队中 */}
        <StatusItem
          icon={<ListTodo size={12} />}
          color={queuedCount > 0 ? '#f59e0b' : 'rgba(255,255,255,0.3)'}
          label={`${queuedCount} 排队`}
        />

        {/* 费用 */}
        <StatusItem
          icon={<DollarSign size={12} />}
          color="rgba(255,255,255,0.4)"
          label={`$${tokenCostUsd.toFixed(2)}`}
          noBorder
        />
      </div>
    </>
  );
}

// ── Sub-component ───────────────────────────────────────

function StatusItem({ icon, color, label, noBorder }: {
  icon?: React.ReactNode; color: string; label: string; noBorder?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '0 10px',
      borderRight: noBorder ? undefined : '1px solid rgba(255,255,255,0.06)',
      whiteSpace: 'nowrap',
    }}>
      {icon && <span style={{ color, opacity: 0.7, display: 'flex' }}>{icon}</span>}
      <span style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: '0.02em' }}>
        {label}
      </span>
    </div>
  );
}
