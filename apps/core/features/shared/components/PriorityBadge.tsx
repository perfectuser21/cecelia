interface PriorityBadgeProps {
  priority: string;
  size?: 'sm' | 'md';
}

export default function PriorityBadge({ priority, size = 'md' }: PriorityBadgeProps) {
  const colorClass = priority === 'P0'
    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    : priority === 'P1'
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-400';

  const sizeClass = size === 'sm'
    ? 'px-1.5 py-0.5 text-[10px]'
    : 'px-2 py-0.5 text-xs';

  return (
    <span className={`${sizeClass} rounded font-medium ${colorClass}`}>
      {priority}
    </span>
  );
}
