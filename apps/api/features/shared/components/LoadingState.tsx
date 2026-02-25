/**
 * Shared Loading and Error state components
 * Replaces 15+ duplicate loading/error UI patterns
 */

import React from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

export interface LoadingStateProps {
  /** Height of the loading container */
  height?: string;
  /** Custom loading message */
  message?: string;
  /** Spinner size */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * LoadingState - Centered spinner with optional message
 *
 * @example
 * if (loading) return <LoadingState />;
 */
export function LoadingState({
  height = 'h-64',
  message,
  size = 'md',
}: LoadingStateProps): React.ReactElement {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className={`flex flex-col items-center justify-center ${height}`}>
      <Loader2 className={`${sizeClasses[size]} animate-spin text-blue-500`} />
      {message && (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{message}</p>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  /** Error message to display */
  message: string;
  /** Retry handler */
  onRetry?: () => void;
  /** Retry button text */
  retryText?: string;
  /** Height of the container */
  height?: string;
}

/**
 * ErrorState - Error display with optional retry button
 *
 * @example
 * if (error) return <ErrorState message={error} onRetry={refresh} />;
 */
export function ErrorState({
  message,
  onRetry,
  retryText = '重试',
  height = 'h-64',
}: ErrorStateProps): React.ReactElement {
  return (
    <div className={`flex flex-col items-center justify-center ${height}`}>
      <AlertCircle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
      <p className="text-red-600 dark:text-red-400 mb-3 text-center max-w-md">
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 transition-all"
        >
          {retryText}
        </button>
      )}
    </div>
  );
}

export interface EmptyStateProps {
  /** Icon to display */
  icon?: React.ReactElement;
  /** Title text */
  title: string;
  /** Description text */
  description?: string;
  /** Action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Height of the container */
  height?: string;
}

/**
 * EmptyState - Empty data display with optional action
 *
 * @example
 * if (data.length === 0) return <EmptyState title="暂无数据" />;
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  height = 'h-64',
}: EmptyStateProps): React.ReactElement {
  return (
    <div className={`flex flex-col items-center justify-center ${height} text-center`}>
      {icon && (
        <div className="mb-4 text-gray-300 dark:text-gray-600">
          {icon}
        </div>
      )}
      <p className="text-gray-600 dark:text-gray-300 font-medium">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * DataStateWrapper - Handles loading/error/empty states automatically
 *
 * @example
 * <DataStateWrapper loading={loading} error={error} data={data} onRetry={refresh}>
 *   {(data) => <DataDisplay data={data} />}
 * </DataStateWrapper>
 */
export interface DataStateWrapperProps<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
  onRetry?: () => void;
  emptyMessage?: string;
  loadingHeight?: string;
  children: (data: T) => React.ReactElement;
}

export function DataStateWrapper<T>({
  loading,
  error,
  data,
  onRetry,
  emptyMessage = '暂无数据',
  loadingHeight = 'h-64',
  children,
}: DataStateWrapperProps<T>): React.ReactElement {
  if (loading && !data) {
    return <LoadingState height={loadingHeight} />;
  }

  if (error && !data) {
    return <ErrorState message={error} onRetry={onRetry} height={loadingHeight} />;
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return <EmptyState title={emptyMessage} height={loadingHeight} />;
  }

  return children(data);
}

/**
 * Skeleton loading components for various layouts
 */
export function SkeletonCard({ className = '' }: { className?: string }): React.ReactElement {
  return (
    <div className={`rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 ${className}`}>
      <div className="animate-pulse p-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-xl" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
            <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonRow(): React.ReactElement {
  return (
    <div className="animate-pulse p-4 border-b border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-4">
        <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
        </div>
      </div>
    </div>
  );
}
