/**
 * AmbientGlow — Breathing glow border based on alertness level
 *
 * Wraps children with an inset box-shadow that pulses
 * at a rate determined by the alertness level.
 */

import { useMemo } from 'react';

const GLOW_CONFIG: Record<number, { color: string; colorBright: string; duration: number }> = {
  0: { color: 'rgba(30,41,59,0.3)',   colorBright: 'rgba(30,41,59,0.5)',   duration: 6 },
  1: { color: 'rgba(16,185,129,0.08)', colorBright: 'rgba(16,185,129,0.2)', duration: 4 },
  2: { color: 'rgba(59,130,246,0.08)', colorBright: 'rgba(59,130,246,0.2)', duration: 3 },
  3: { color: 'rgba(245,158,11,0.1)',  colorBright: 'rgba(245,158,11,0.25)', duration: 2 },
  4: { color: 'rgba(239,68,68,0.12)',  colorBright: 'rgba(239,68,68,0.3)',  duration: 1 },
};

interface AmbientGlowProps {
  alertness: number;
  children: React.ReactNode;
}

export function AmbientGlow({ alertness, children }: AmbientGlowProps) {
  const config = GLOW_CONFIG[alertness] ?? GLOW_CONFIG[1];

  const animationName = useMemo(() => `glow-breathe-${alertness}`, [alertness]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Glow overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 1,
          boxShadow: `inset 0 0 40px 0 ${config.color}`,
          animation: `${animationName} ${config.duration}s ease-in-out infinite`,
          transition: 'box-shadow 2s ease',
        }}
      />

      {/* Keyframes */}
      <style>{`
        @keyframes ${animationName} {
          0%, 100% { box-shadow: inset 0 0 30px 0 ${config.color}; }
          50% { box-shadow: inset 0 0 60px 5px ${config.colorBright}; }
        }
      `}</style>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, width: '100%', height: '100%' }}>
        {children}
      </div>
    </div>
  );
}
