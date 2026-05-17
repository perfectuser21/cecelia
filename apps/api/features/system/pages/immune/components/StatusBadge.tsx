/**
 * Policy Status Badge
 *
 * 策略状态徽章 - Active / Probation / Draft / Disabled
 */

import React from 'react';
import type { PolicyStatus } from '../../../types/immune';

interface PolicyStatusBadgeProps {
  status: PolicyStatus;
  size?: 'sm' | 'md';
  showDot?: boolean;
}

export function PolicyStatusBadge({ status, size = 'sm', showDot = false }: PolicyStatusBadgeProps) {
  const config = {
    active: {
      label: 'Active',
      color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      dotColor: 'bg-green-500',
    },
    probation: {
      label: 'Probation',
      color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      dotColor: 'bg-amber-500',
    },
    draft: {
      label: 'Draft',
      color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400',
      dotColor: 'bg-gray-500',
    },
    disabled: {
      label: 'Disabled',
      color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      dotColor: 'bg-red-500',
    },
  };

  const { label, color, dotColor } = config[status] || config.draft;

  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg font-medium ${sizeClass} ${color}`}>
      {showDot && <span className={`w-2 h-2 rounded-full ${dotColor}`} />}
      {label}
    </span>
  );
}
