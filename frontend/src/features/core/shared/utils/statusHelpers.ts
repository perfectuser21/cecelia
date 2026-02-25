/**
 * Shared status helpers
 * Replaces 16+ duplicate status color/icon/label functions
 */

import React from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Activity,
} from 'lucide-react';

/**
 * Normalize various status strings to a standard set
 */
export type NormalizedStatus =
  | 'success'
  | 'error'
  | 'running'
  | 'pending'
  | 'warning'
  | 'unknown';

export function normalizeStatus(status: string): NormalizedStatus {
  const s = status.toLowerCase();

  // Success variants
  if (['success', 'completed', 'done', 'passed', 'merged', 'online'].includes(s)) {
    return 'success';
  }
  if (s.includes('up ')) return 'success'; // Docker "Up 2 hours"

  // Error variants
  if (['error', 'failed', 'crashed', 'offline', 'stopped'].includes(s)) {
    return 'error';
  }
  if (s.includes('exited')) return 'error'; // Docker "Exited (1)"

  // Running variants
  if (['running', 'in_progress', 'active', 'executing', 'waiting'].includes(s)) {
    return 'running';
  }

  // Pending variants
  if (['pending', 'queued', 'scheduled', 'idle'].includes(s)) {
    return 'pending';
  }

  // Warning variants
  if (['warning', 'skipped', 'partial'].includes(s)) {
    return 'warning';
  }

  return 'unknown';
}

/**
 * Status color classes (Tailwind)
 */
export const STATUS_COLORS: Record<NormalizedStatus, string> = {
  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  unknown: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

/**
 * Get status color classes
 */
export function getStatusColor(status: string): string {
  return STATUS_COLORS[normalizeStatus(status)];
}

/**
 * Status text colors only (for text without background)
 */
export const STATUS_TEXT_COLORS: Record<NormalizedStatus, string> = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
  running: 'text-blue-600 dark:text-blue-400',
  pending: 'text-gray-500 dark:text-gray-400',
  warning: 'text-yellow-600 dark:text-yellow-400',
  unknown: 'text-gray-400 dark:text-gray-500',
};

export function getStatusTextColor(status: string): string {
  return STATUS_TEXT_COLORS[normalizeStatus(status)];
}

/**
 * Status background colors for progress bars
 */
export const STATUS_BG_COLORS: Record<NormalizedStatus, string> = {
  success: 'bg-green-500',
  error: 'bg-red-500',
  running: 'bg-blue-500',
  pending: 'bg-gray-400',
  warning: 'bg-yellow-500',
  unknown: 'bg-gray-300',
};

export function getStatusBgColor(status: string): string {
  return STATUS_BG_COLORS[normalizeStatus(status)];
}

/**
 * Status icons (returns React element)
 */
export function getStatusIcon(
  status: string,
  className = 'w-4 h-4'
): React.ReactElement {
  const normalized = normalizeStatus(status);

  const iconProps = { className };

  switch (normalized) {
    case 'success':
      return React.createElement(CheckCircle2, iconProps);
    case 'error':
      return React.createElement(XCircle, iconProps);
    case 'running':
      return React.createElement(Activity, { ...iconProps, className: `${className} animate-pulse` });
    case 'pending':
      return React.createElement(Clock, iconProps);
    case 'warning':
      return React.createElement(AlertCircle, iconProps);
    default:
      return React.createElement(AlertCircle, iconProps);
  }
}

/**
 * Status labels (Chinese)
 */
export const STATUS_LABELS: Record<NormalizedStatus, string> = {
  success: '成功',
  error: '失败',
  running: '运行中',
  pending: '等待中',
  warning: '警告',
  unknown: '未知',
};

/**
 * Extended status labels mapping common status values
 */
export const EXTENDED_STATUS_LABELS: Record<string, string> = {
  // English
  success: '成功',
  completed: '已完成',
  done: '已完成',
  passed: '通过',
  merged: '已合并',
  online: '在线',
  error: '失败',
  failed: '失败',
  crashed: '崩溃',
  offline: '离线',
  stopped: '已停止',
  running: '运行中',
  in_progress: '进行中',
  active: '活跃',
  executing: '执行中',
  waiting: '等待中',
  pending: '等待中',
  queued: '排队中',
  scheduled: '已计划',
  idle: '空闲',
  warning: '警告',
  skipped: '已跳过',
  partial: '部分',
  open: '开放',
  closed: '关闭',
};

export function getStatusLabel(status: string): string {
  const lower = status.toLowerCase();
  return EXTENDED_STATUS_LABELS[lower] || STATUS_LABELS[normalizeStatus(status)];
}

/**
 * Get percentage color for progress bars
 */
export function getPercentageColor(percent: number): string {
  if (percent < 60) return 'bg-green-500';
  if (percent < 80) return 'bg-yellow-500';
  return 'bg-red-500';
}
