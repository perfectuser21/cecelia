/**
 * MediaSection - Social media content stats (placeholder)
 */

import { FileText, Eye, Heart, Users } from 'lucide-react';

interface Props {
  loading: boolean;
}

export default function MediaSection({ loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-slate-100 dark:bg-slate-700/50 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  // Placeholder data - will be replaced with real API
  const metrics = [
    {
      icon: FileText,
      label: 'Posts',
      value: '-',
      detail: 'this week',
      color: 'text-purple-500',
      bg: 'bg-purple-50 dark:bg-purple-900/20',
    },
    {
      icon: Eye,
      label: 'Views',
      value: '-',
      detail: 'total',
      color: 'text-blue-500',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
    },
    {
      icon: Heart,
      label: 'Likes',
      value: '-',
      detail: 'total',
      color: 'text-pink-500',
      bg: 'bg-pink-50 dark:bg-pink-900/20',
    },
    {
      icon: Users,
      label: 'Followers',
      value: '-',
      detail: 'total',
      color: 'text-emerald-500',
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className={`p-4 rounded-xl ${metric.bg}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <metric.icon className={`w-4 h-4 ${metric.color}`} />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {metric.label}
              </span>
            </div>
            <p className={`text-2xl font-bold ${metric.color}`}>
              {metric.value}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {metric.detail}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
        Connect Notion to see real data
      </p>
    </div>
  );
}
