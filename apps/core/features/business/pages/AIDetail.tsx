/**
 * AIDetail - AI Workforce 详情页
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bot, CheckCircle2, Play, Clock, GitPullRequest } from 'lucide-react';

interface TaskRun {
  id: string;
  prd_id: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  project: string;
  feature_branch?: string;
  started_at: string;
}

export default function AIDetail() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ completed: 0, running: 0 });

  useEffect(() => {
    fetch('/api/cecelia/overview')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setRuns(data.recent_runs || []);
          setStats({
            completed: data.completed || 0,
            running: data.running || 0,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Play className="w-4 h-4 text-blue-500" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="min-h-screen -m-8 -mt-8 p-8 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-4xl mx-auto">
        {/* Back button */}
        <button
          onClick={() => navigate('/command')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-8"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Back to Command Center</span>
        </button>

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Bot className="w-8 h-8 text-blue-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">AI Workforce</h1>
            <p className="text-slate-500 dark:text-slate-400">Cecelia + N8N</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">Completed</p>
            <p className="text-3xl font-bold text-emerald-500 mt-1">{stats.completed}</p>
          </div>
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">Running</p>
            <p className="text-3xl font-bold text-blue-500 mt-1">{stats.running}</p>
          </div>
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">N8N Workflows</p>
            <p className="text-3xl font-bold text-slate-400 mt-1">-</p>
          </div>
        </div>

        {/* Recent Tasks */}
        <div className="rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="font-semibold text-slate-800 dark:text-white">Recent Tasks</h2>
          </div>

          {loading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-slate-100 dark:bg-slate-700/50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No tasks yet
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {runs.map(run => (
                <div key={run.id} className="px-6 py-4 flex items-center gap-4">
                  {getStatusIcon(run.status)}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 dark:text-white truncate">
                      {run.prd_id || run.id}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {run.project}
                    </p>
                  </div>
                  {run.feature_branch && (
                    <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                      <GitPullRequest className="w-3 h-3" />
                      {run.feature_branch}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
