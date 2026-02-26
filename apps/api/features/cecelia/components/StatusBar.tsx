/**
 * StatusBar — 增强版 PulseStrip
 *
 * 一行展示 Cecelia 的"生命体征"：
 * 在线状态 · 反刍进度 · 反思累积 · Tick 倒计时 · 运行中 · 排队 · 费用
 */

import { useState, useEffect, useRef } from 'react';
import { Activity, Timer, Play, ListTodo, DollarSign, BookOpen, Brain } from 'lucide-react';

// ── Types ────────────────────────────────────────────────

const ALERTNESS_CONF: Record<number, { label: string; color: string }> = {
  0: { label: 'SLEEP', color: '#64748b' },
  1: { label: 'CALM', color: '#22c55e' },
  2: { label: 'AWARE', color: '#3b82f6' },
  3: { label: 'ALERT', color: '#f59e0b' },
  4: { label: 'PANIC', color: '#ef4444' },
};

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
}

// ── Main Component ───────────────────────────────────────

export function StatusBar({
  alertness, runningCount, queuedCount, tokenCostUsd,
  lastTickAt, tickIntervalMinutes, innerLife,
}: StatusBarProps) {
  const [countdown, setCountdown] = useState('--:--');
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const aC = ALERTNESS_CONF[alertness] ?? ALERTNESS_CONF[1];

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

  const items = [
    {
      icon: <Activity size={12} />,
      label: aC.label,
      color: aC.color,
      dot: true,
    },
    // 反刍进度
    ...(rum ? [{
      icon: <BookOpen size={12} />,
      label: `反刍 ${rum.undigested_count > 0 ? rum.undigested_count + '待' : '✓'}`,
      color: rum.undigested_count > 0 ? '#f59e0b' : '#22c55e',
    }] : []),
    // 反思累积
    ...(ref ? [{
      icon: <Brain size={12} />,
      label: `${Math.round(ref.accumulator)}/${ref.threshold}`,
      color: ref.progress_pct > 80 ? '#a78bfa' : 'rgba(255,255,255,0.4)',
    }] : []),
    {
      icon: <Timer size={12} />,
      label: countdown,
      color: 'rgba(255,255,255,0.5)',
    },
    {
      icon: <Play size={12} />,
      label: `${runningCount} 运行`,
      color: runningCount > 0 ? '#60a5fa' : 'rgba(255,255,255,0.3)',
    },
    {
      icon: <ListTodo size={12} />,
      label: `${queuedCount} 排队`,
      color: queuedCount > 0 ? '#f59e0b' : 'rgba(255,255,255,0.3)',
    },
    {
      icon: <DollarSign size={12} />,
      label: `$${tokenCostUsd.toFixed(2)}`,
      color: 'rgba(255,255,255,0.4)',
    },
  ];

  return (
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
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '0 10px',
            borderRight: i < items.length - 1 ? '1px solid rgba(255,255,255,0.06)' : undefined,
            whiteSpace: 'nowrap',
          }}
        >
          {'dot' in item && item.dot && (
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: item.color,
              boxShadow: `0 0 6px ${item.color}`,
            }} />
          )}
          <span style={{ color: item.color, opacity: 0.7, display: 'flex' }}>{item.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: item.color, letterSpacing: '0.02em' }}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
