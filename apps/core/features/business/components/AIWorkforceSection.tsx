/**
 * AIWorkforceSection - Cecelia + N8N execution stats
 */

import { useEffect, useState } from 'react';
import { Bot, Workflow, GitPullRequest, Code } from 'lucide-react';

interface AIStats {
  cecelia: {
    tasksToday: number;
    tasksWeek: number;
  };
  n8n: {
    runsToday: number;
    runsWeek: number;
    activeWorkflows: number;
  };
  github: {
    prsWeek: number;
    commitsWeek: number;
  };
}

interface Props {
  loading: boolean;
}

export default function AIWorkforceSection({ loading: initialLoading }: Props) {
  const [stats, setStats] = useState<AIStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        // Fetch Cecelia stats
        const ceceliaRes = await fetch('/api/cecelia/overview');
        const ceceliaData = await ceceliaRes.json();

        // Fetch N8N stats
        let n8nStats = { runsToday: 0, runsWeek: 0, activeWorkflows: 0 };
        try {
          const n8nRes = await fetch('/n8n/api/v1/workflows?active=true', {
            headers: { 'Accept': 'application/json' },
          });
          if (n8nRes.ok) {
            const n8nData = await n8nRes.json();
            n8nStats.activeWorkflows = n8nData.data?.length || 0;
          }
        } catch {
          // N8N not available
        }

        const runs = ceceliaData.data?.runs || [];
        const today = new Date().toDateString();
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        setStats({
          cecelia: {
            tasksToday: runs.filter((r: { started_at: string }) =>
              new Date(r.started_at).toDateString() === today
            ).length,
            tasksWeek: runs.filter((r: { started_at: string }) =>
              new Date(r.started_at) >= weekAgo
            ).length,
          },
          n8n: n8nStats,
          github: {
            prsWeek: 0, // TODO: Implement GitHub API call
            commitsWeek: 0,
          },
        });
      } catch {
        // Silent fail
      } finally {
        setLoading(false);
      }
    }

    if (!initialLoading) {
      fetchStats();
    }
  }, [initialLoading]);

  if (loading || initialLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-slate-100 dark:bg-slate-700/50 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const metrics = [
    {
      icon: Bot,
      label: 'Cecelia Tasks',
      value: stats?.cecelia.tasksWeek || 0,
      detail: `${stats?.cecelia.tasksToday || 0} today`,
      color: 'text-blue-500',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
    },
    {
      icon: Workflow,
      label: 'N8N Workflows',
      value: stats?.n8n.activeWorkflows || 0,
      detail: 'active',
      color: 'text-orange-500',
      bg: 'bg-orange-50 dark:bg-orange-900/20',
    },
    {
      icon: GitPullRequest,
      label: 'PRs Merged',
      value: stats?.github.prsWeek || '-',
      detail: 'this week',
      color: 'text-purple-500',
      bg: 'bg-purple-50 dark:bg-purple-900/20',
    },
    {
      icon: Code,
      label: 'Commits',
      value: stats?.github.commitsWeek || '-',
      detail: 'this week',
      color: 'text-emerald-500',
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    },
  ];

  return (
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
  );
}
