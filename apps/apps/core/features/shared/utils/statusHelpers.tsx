import React from 'react';
import { CheckCircle2, XCircle, Clock, AlertCircle, Loader2, PlayCircle } from 'lucide-react';

/**
 * Get status color classes based on status string
 */
export function getStatusColor(status: string): string {
  const s = status.toLowerCase();

  if (s.includes('success') || s.includes('completed') || s.includes('done')) {
    return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  }

  if (s.includes('error') || s.includes('failed') || s.includes('failure')) {
    return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
  }

  if (s.includes('running') || s.includes('in_progress') || s.includes('active')) {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
  }

  if (s.includes('warning') || s.includes('pending') || s.includes('queued')) {
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  }

  if (s.includes('cancelled') || s.includes('stopped')) {
    return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  }

  return 'bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-400';
}

/**
 * Get text color for status (used in outline variant)
 */
export function getStatusTextColor(status: string): string {
  const s = status.toLowerCase();

  if (s.includes('success') || s.includes('completed') || s.includes('done')) {
    return 'text-green-600 dark:text-green-400';
  }

  if (s.includes('error') || s.includes('failed') || s.includes('failure')) {
    return 'text-red-600 dark:text-red-400';
  }

  if (s.includes('running') || s.includes('in_progress') || s.includes('active')) {
    return 'text-blue-600 dark:text-blue-400';
  }

  if (s.includes('warning') || s.includes('pending') || s.includes('queued')) {
    return 'text-yellow-600 dark:text-yellow-400';
  }

  return 'text-gray-600 dark:text-gray-400';
}

/**
 * Get status icon based on status string
 */
export function getStatusIcon(status: string, className: string = 'w-4 h-4'): React.ReactElement | null {
  const s = status.toLowerCase();

  if (s.includes('success') || s.includes('completed') || s.includes('done')) {
    return <CheckCircle2 className={className} />;
  }

  if (s.includes('error') || s.includes('failed') || s.includes('failure')) {
    return <XCircle className={className} />;
  }

  if (s.includes('running') || s.includes('in_progress') || s.includes('active')) {
    return <Loader2 className={`${className} animate-spin`} />;
  }

  if (s.includes('pending') || s.includes('queued')) {
    return <Clock className={className} />;
  }

  if (s.includes('warning')) {
    return <AlertCircle className={className} />;
  }

  if (s.includes('playing') || s.includes('started')) {
    return <PlayCircle className={className} />;
  }

  return null;
}

/**
 * Get human-readable label for status
 */
export function getStatusLabel(status: string): string {
  // Common status mappings
  const statusMap: Record<string, string> = {
    'in_progress': 'In Progress',
    'completed': 'Completed',
    'failed': 'Failed',
    'pending': 'Pending',
    'queued': 'Queued',
    'running': 'Running',
    'success': 'Success',
    'error': 'Error',
    'cancelled': 'Cancelled',
    'active': 'Active',
    'inactive': 'Inactive',
    'online': 'Online',
    'offline': 'Offline',
  };

  const key = status.toLowerCase();
  if (statusMap[key]) {
    return statusMap[key];
  }

  // Fallback: capitalize and replace underscores
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}