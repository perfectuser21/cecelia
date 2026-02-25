/**
 * Shared StatsCard component
 * Replaces 20+ stat card implementations across dashboards
 */

import React from 'react';
import { LucideIcon } from 'lucide-react';

export interface StatsCardProps {
  /** Card label/title */
  label: string;
  /** Primary value to display */
  value: string | number;
  /** Lucide icon component */
  icon: LucideIcon;
  /** Icon container gradient colors */
  iconGradient?: string;
  /** Icon shadow color */
  iconShadow?: string;
  /** Trend indicator (+5%, -3%, etc.) */
  trend?: {
    value: string;
    direction: 'up' | 'down' | 'neutral';
  };
  /** Additional CSS classes */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

/**
 * StatsCard - Consistent stats display card
 *
 * @example
 * <StatsCard
 *   label="运行中"
 *   value={5}
 *   icon={Activity}
 *   iconGradient="from-blue-500 to-indigo-600"
 * />
 */
export function StatsCard({
  label,
  value,
  icon: Icon,
  iconGradient = 'from-slate-500 to-slate-600',
  iconShadow = 'shadow-slate-500/25',
  trend,
  className = '',
  onClick,
}: StatsCardProps): React.ReactElement {
  return (
    <div
      className={`
        bg-white dark:bg-slate-800
        rounded-2xl
        border border-gray-200 dark:border-slate-700
        p-5
        transition-all duration-200
        ${onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5' : ''}
        ${className}
      `}
      onClick={onClick}
    >
      <div className="flex items-center gap-4">
        <div
          className={`
            w-10 h-10
            bg-gradient-to-br ${iconGradient}
            rounded-xl
            flex items-center justify-center
            shadow-lg ${iconShadow}
          `}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {value}
          </div>
        </div>
        {trend && (
          <div
            className={`
              text-xs font-medium
              ${
                trend.direction === 'up'
                  ? 'text-green-600 dark:text-green-400'
                  : trend.direction === 'down'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-500 dark:text-gray-400'
              }
            `}
          >
            {trend.direction === 'up' && '↑'}
            {trend.direction === 'down' && '↓'}
            {trend.value}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * GlassCard - Card with glassmorphism effect
 */
export interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
}

export function GlassCard({
  children,
  className = '',
  hoverable = false,
}: GlassCardProps): React.ReactElement {
  return (
    <div
      className={`
        rounded-2xl
        bg-white dark:bg-slate-800/80
        backdrop-blur-xl
        border border-slate-200 dark:border-slate-700
        shadow-lg shadow-slate-200/50 dark:shadow-black/30
        transition-all duration-300 ease-out
        ${hoverable ? 'hover:scale-[1.02] hover:-translate-y-0.5 hover:shadow-xl' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

/**
 * Gradient stat card with full-width gradient background
 */
export interface GradientStatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  gradient: string;
}

export function GradientStatCard({
  label,
  value,
  icon: Icon,
  gradient,
}: GradientStatCardProps): React.ReactElement {
  return (
    <div className={`bg-gradient-to-br ${gradient} rounded-xl p-5 text-white`}>
      <div className="flex items-center gap-3">
        <Icon className="w-8 h-8 opacity-80" />
        <div>
          <p className="text-sm opacity-80">{label}</p>
          <p className="text-3xl font-bold">{value}</p>
        </div>
      </div>
    </div>
  );
}
