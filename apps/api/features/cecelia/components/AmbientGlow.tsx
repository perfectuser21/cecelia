/**
 * AmbientGlow — Breathing glow border based on alertness + cognitive phase
 *
 * Wraps children with an inset box-shadow that pulses.
 * Alertness controls intensity; cognitivePhase adds color tint.
 */

import { useMemo } from 'react';

// 认知阶段对 glow 颜色的微调
const PHASE_TINT: Record<string, { r: number; g: number; b: number }> = {
  idle:          { r: 16, g: 185, b: 129 },   // emerald
  alertness:     { r: 245, g: 158, b: 11 },    // amber
  thalamus:      { r: 59, g: 130, b: 246 },    // blue
  decomposition: { r: 139, g: 92, b: 246 },    // purple
  planning:      { r: 99, g: 102, b: 241 },    // indigo
  dispatching:   { r: 6, g: 182, b: 212 },     // cyan
  decision:      { r: 20, g: 184, b: 166 },    // teal
  rumination:    { r: 245, g: 158, b: 11 },    // amber
  desire:        { r: 236, g: 72, b: 153 },    // pink
  reflecting:    { r: 167, g: 139, b: 250 },   // violet
};

const GLOW_CONFIG: Record<number, { duration: number; dimOpacity: number; brightOpacity: number }> = {
  0: { duration: 6, dimOpacity: 0.15, brightOpacity: 0.25 },
  1: { duration: 4, dimOpacity: 0.08, brightOpacity: 0.2 },
  2: { duration: 3, dimOpacity: 0.08, brightOpacity: 0.2 },
  3: { duration: 2, dimOpacity: 0.1, brightOpacity: 0.25 },
  4: { duration: 1, dimOpacity: 0.12, brightOpacity: 0.3 },
};

interface AmbientGlowProps {
  alertness: number;
  cognitivePhase?: string;
  children: React.ReactNode;
}

export function AmbientGlow({ alertness, cognitivePhase = 'idle', children }: AmbientGlowProps) {
  const config = GLOW_CONFIG[alertness] ?? GLOW_CONFIG[1];
  const tint = PHASE_TINT[cognitivePhase] || PHASE_TINT.idle;

  const colorDim = `rgba(${tint.r},${tint.g},${tint.b},${config.dimOpacity})`;
  const colorBright = `rgba(${tint.r},${tint.g},${tint.b},${config.brightOpacity})`;

  const animationName = useMemo(() => `glow-${alertness}-${cognitivePhase}`, [alertness, cognitivePhase]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Glow overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 1,
          boxShadow: `inset 0 0 40px 0 ${colorDim}`,
          animation: `${animationName} ${config.duration}s ease-in-out infinite`,
          transition: 'box-shadow 2s ease',
        }}
      />

      <style>{`
        @keyframes ${animationName} {
          0%, 100% { box-shadow: inset 0 0 30px 0 ${colorDim}; }
          50% { box-shadow: inset 0 0 60px 5px ${colorBright}; }
        }
      `}</style>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, width: '100%', height: '100%' }}>
        {children}
      </div>
    </div>
  );
}
