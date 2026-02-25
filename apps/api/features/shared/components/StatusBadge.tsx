/**
 * Shared StatusBadge component
 * Replaces 15+ inline status badge implementations
 */

import React from 'react';
import {
  getStatusColor,
  getStatusIcon,
  getStatusLabel,
  getStatusTextColor,
} from '../utils/statusHelpers';

export interface StatusBadgeProps {
  /** Status string (will be normalized internally) */
  status: string;
  /** Show icon alongside text */
  showIcon?: boolean;
  /** Show text label */
  showLabel?: boolean;
  /** Custom label override */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Style variant */
  variant?: 'filled' | 'outline' | 'dot';
  /** Additional CSS classes */
  className?: string;
}

/**
 * StatusBadge - Consistent status display across the app
 *
 * @example
 * <StatusBadge status="success" />
 * <StatusBadge status="running" showIcon />
 * <StatusBadge status="error" variant="dot" />
 */
export function StatusBadge({
  status,
  showIcon = false,
  showLabel = true,
  label,
  size = 'sm',
  variant = 'filled',
  className = '',
}: StatusBadgeProps): React.ReactElement {
  const displayLabel = label || getStatusLabel(status);

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  if (variant === 'dot') {
    return (
      <span className={`inline-flex items-center gap-1.5 ${className}`}>
        <span
          className={`w-2 h-2 rounded-full ${
            status.toLowerCase().includes('online') ||
            status.toLowerCase().includes('success') ||
            status.toLowerCase().includes('running')
              ? 'bg-green-500'
              : status.toLowerCase().includes('error') ||
                status.toLowerCase().includes('offline')
              ? 'bg-red-500'
              : 'bg-gray-400'
          }`}
        />
        {showLabel && (
          <span className={`text-${size === 'sm' ? 'xs' : size === 'md' ? 'sm' : 'base'} ${getStatusTextColor(status)}`}>
            {displayLabel}
          </span>
        )}
      </span>
    );
  }

  if (variant === 'outline') {
    return (
      <span
        className={`
          inline-flex items-center gap-1 font-medium rounded-lg border
          ${sizeClasses[size]}
          ${getStatusTextColor(status)}
          border-current/30
          ${className}
        `}
      >
        {showIcon && getStatusIcon(status, iconSizes[size])}
        {showLabel && displayLabel}
      </span>
    );
  }

  // Default: filled
  return (
    <span
      className={`
        inline-flex items-center gap-1 font-medium rounded-lg
        ${sizeClasses[size]}
        ${getStatusColor(status)}
        ${className}
      `}
    >
      {showIcon && getStatusIcon(status, iconSizes[size])}
      {showLabel && displayLabel}
    </span>
  );
}

/**
 * Simple dot indicator for online/offline status
 */
export function StatusDot({
  online,
  className = '',
}: {
  online: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={`
        w-2 h-2 rounded-full
        ${online ? 'bg-green-500' : 'bg-red-500'}
        ${className}
      `}
    />
  );
}
