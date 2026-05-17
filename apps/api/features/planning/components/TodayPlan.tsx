/**
 * TodayPlan Component - Phase 5.4
 *
 * Displays the current daily plan with:
 * - Task list with why/expected_evidence
 * - Progress bar (completed/total)
 * - One-click commit button
 */

import { useState, useEffect } from 'react';

interface SourceRef {
  type: 'goal' | 'memory' | 'task';
  id: string;
  title?: string;
}

interface PlanTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  why: string;
  expected_evidence: string;
  source_refs: SourceRef[];
}

interface Plan {
  plan_id: string;
  scope: string;
  created_at: string;
  tasks: PlanTask[];
  summary: {
    total: number;
    by_priority: Record<string, number>;
  };
  reasoning: string;
}

interface PlanStatus {
  active_plan: string | null;
  plan: Plan | null;
  progress: {
    total: number;
    completed: number;
    in_progress: number;
    pending: number;
  };
  next_task: PlanTask | null;
}

const API_BASE = '/api/system';

export default function TodayPlan() {
  const [planStatus, setPlanStatus] = useState<PlanStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlanStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/plan/status`);
      const data = await res.json();
      if (data.success) {
        setPlanStatus(data);
      } else {
        setError(data.error || 'Failed to fetch plan status');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!planStatus?.active_plan) return;

    setCommitting(true);
    try {
      const res = await fetch(`${API_BASE}/plan/${planStatus.active_plan}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 3 }),
      });
      const data = await res.json();
      if (data.success) {
        // Refresh plan status
        await fetchPlanStatus();
      } else {
        setError(data.error || 'Failed to commit tasks');
      }
    } catch {
      setError('Failed to commit tasks');
    } finally {
      setCommitting(false);
    }
  };

  const handleGenerateNew = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/plan/nightly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        await fetchPlanStatus();
      } else {
        setError(data.error || 'Failed to generate plan');
      }
    } catch {
      setError('Failed to generate plan');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlanStatus();
  }, []);

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
        <div className="animate-pulse">
          <div className="h-6 bg-slate-700 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-slate-700 rounded w-full mb-2"></div>
          <div className="h-4 bg-slate-700 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-6 border border-red-500/50">
        <h3 className="text-lg font-semibold text-red-400 mb-2">Error</h3>
        <p className="text-slate-400">{error}</p>
        <button
          onClick={() => { setError(null); fetchPlanStatus(); }}
          className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!planStatus?.plan) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-semibold text-slate-300 mb-2">Today's Plan</h3>
        <p className="text-slate-500 mb-4">No plan generated yet.</p>
        <button
          onClick={handleGenerateNew}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium"
        >
          Generate Plan
        </button>
      </div>
    );
  }

  const { plan, progress } = planStatus;
  const progressPercent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-200">Today's Plan</h3>
          <p className="text-sm text-slate-500">
            {plan.plan_id} • {new Date(plan.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCommit}
            disabled={committing || progress.pending === 0}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium"
          >
            {committing ? 'Committing...' : 'Commit P0'}
          </button>
          <button
            onClick={handleGenerateNew}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-slate-400">Progress</span>
          <span className="text-slate-300">{progress.completed}/{progress.total} ({progressPercent}%)</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex gap-4 mt-2 text-xs text-slate-500">
          <span>✅ {progress.completed} completed</span>
          <span>🔄 {progress.in_progress} in progress</span>
          <span>⏳ {progress.pending} pending</span>
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {plan.tasks.slice(0, 5).map((task) => (
          <div
            key={task.id}
            className={`p-3 rounded-lg border ${
              task.status === 'completed'
                ? 'bg-green-900/20 border-green-700/50'
                : task.status === 'in_progress'
                ? 'bg-blue-900/20 border-blue-700/50'
                : 'bg-slate-900/50 border-slate-700/50'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                    task.priority === 'P0' ? 'bg-red-500/20 text-red-400' :
                    task.priority === 'P1' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-slate-500/20 text-slate-400'
                  }`}>
                    {task.priority}
                  </span>
                  <span className="text-sm font-medium text-slate-200">{task.title}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">{task.why}</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  📋 {task.expected_evidence}
                </p>
              </div>
              <span className={`text-xs ${
                task.status === 'completed' ? 'text-green-400' :
                task.status === 'in_progress' ? 'text-blue-400' :
                'text-slate-500'
              }`}>
                {task.status}
              </span>
            </div>
          </div>
        ))}
        {plan.tasks.length > 5 && (
          <p className="text-xs text-slate-500 text-center">
            +{plan.tasks.length - 5} more tasks
          </p>
        )}
      </div>

      {/* Reasoning */}
      <div className="mt-4 p-3 bg-slate-900/50 rounded-lg">
        <p className="text-xs text-slate-400">
          <span className="text-slate-500">Reasoning:</span> {plan.reasoning}
        </p>
      </div>
    </div>
  );
}
