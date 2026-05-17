import React from 'react';

interface ProgressBarProps {
  progress: number;
  size?: 'sm' | 'md';
}

export default function ProgressBar({ progress, size = 'md' }: ProgressBarProps) {
  const heightClass = size === 'sm' ? 'h-1.5' : 'h-2';
  const colorClass = progress >= 80
    ? 'bg-emerald-500'
    : progress >= 50
    ? 'bg-blue-500'
    : progress > 0
    ? 'bg-amber-500'
    : 'bg-slate-300 dark:bg-slate-600';

  return (
    <div className={`w-full ${heightClass} bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden`}>
      <div
        className={`${heightClass} ${colorClass} rounded-full transition-all duration-500`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
