/**
 * Risk Level Badge
 *
 * 风险等级徽章 - Low / Medium / High
 */

import React from 'react';
import type { RiskLevel } from '../../../types/immune';

interface RiskBadgeProps {
  level: RiskLevel;
  size?: 'sm' | 'md';
}

export function RiskBadge({ level, size = 'sm' }: RiskBadgeProps) {
  const config = {
    low: {
      label: 'Low Risk',
      color: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    },
    medium: {
      label: 'Medium Risk',
      color: 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400',
    },
    high: {
      label: 'High Risk',
      color: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
    },
  };

  const { label, color } = config[level] || config.low;

  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return <span className={`inline-flex items-center rounded-lg font-medium ${sizeClass} ${color}`}>{label}</span>;
}
