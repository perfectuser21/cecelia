import { useState, useEffect, useCallback } from 'react';
import { Brain, Activity, Target, ListTodo, RefreshCw, CheckCircle2, XCircle, Clock, Zap, Database } from 'lucide-react';

interface OrchestratorStatus {
  status: 'healthy' | 'unhealthy';
  indexed_chunks: number;
  layer2_state?: {
    current_focus?: string;
    active_tasks?: number;
    last_decision?: string;
  };
}

interface BrainStatus {
  policy_version: number;
  policy_rules: {
    priority_order: string[];
    confidence_threshold: number;
    allowed_actions: string[];
  };
  memory: {
    current_focus: { project?: string; goal?: string } | null;
    today_intent: { description?: string; set_at?: string } | null;
    blocked_by: { items: string[] };
  };
  recent_decisions: Array<{
    ts: string;
    action: string;
    status: string;
  }>;
  system_health: {
    n8n_ok: boolean;
    n8n_failures_1h: number;
    task_system_ok: boolean;
  } | null;
  snapshot_ts: string | null;
  tasks: {
    p0: Array<{ id: string; title: string; status: string }>;
    p1: Array<{ id: string; title: string; status: string }>;
    stats: {
      open_p0: number;
      open_p1: number;
      in_progress: number;
      queued: number;
    };
  };
}

export default function BrainDashboard() {
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [brainRes, orchestratorRes] = await Promise.all([
        fetch('/api/brain/status'),
        fetch('/api/orchestrator/health'),
      ]);

      if (!brainRes.ok) throw new Error('Failed to fetch brain status');
      const brainData = await brainRes.json();
      setStatus(brainData);

      if (orchestratorRes.ok) {
        const orchestratorData = await orchestratorRes.json();
        setOrchestratorStatus(orchestratorData);
      }

      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const formatTime = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
        <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
          <XCircle className="w-6 h-6" />
          <span>Error: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Brain Dashboard</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">AI Decision Transparency</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {lastRefresh && (
            <span className="text-xs text-slate-400">
              Last: {lastRefresh.toLocaleTimeString('zh-CN')}
            </span>
          )}
          <button
            onClick={fetchStatus}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw className="w-5 h-5 text-slate-500" />
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Orchestrator Status */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3 mb-4">
            <Database className="w-5 h-5 text-cyan-500" />
            <h3 className="font-semibold text-slate-900 dark:text-white">Orchestrator</h3>
          </div>
          {orchestratorStatus ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Status</span>
                <span className={`flex items-center gap-1.5 text-sm ${orchestratorStatus.status === 'healthy' ? 'text-emerald-500' : 'text-red-500'}`}>
                  {orchestratorStatus.status === 'healthy' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {orchestratorStatus.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Indexed Chunks</span>
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  {orchestratorStatus.indexed_chunks}
                </span>
              </div>
              {orchestratorStatus.layer2_state?.current_focus && (
                <div className="mt-3 p-2 bg-cyan-50 dark:bg-cyan-900/20 rounded-lg">
                  <p className="text-xs text-cyan-600 dark:text-cyan-400">
                    Focus: {orchestratorStatus.layer2_state.current_focus}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Not connected</p>
          )}
        </div>
        {/* System Health */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3 mb-4">
            <Activity className="w-5 h-5 text-emerald-500" />
            <h3 className="font-semibold text-slate-900 dark:text-white">System Health</h3>
          </div>
          {status?.system_health ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">N8N</span>
                <span className={`flex items-center gap-1.5 text-sm ${status.system_health.n8n_ok ? 'text-emerald-500' : 'text-red-500'}`}>
                  {status.system_health.n8n_ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {status.system_health.n8n_ok ? 'OK' : 'Error'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Task System</span>
                <span className={`flex items-center gap-1.5 text-sm ${status.system_health.task_system_ok ? 'text-emerald-500' : 'text-red-500'}`}>
                  {status.system_health.task_system_ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {status.system_health.task_system_ok ? 'OK' : 'Error'}
                </span>
              </div>
              {status.system_health.n8n_failures_1h > 0 && (
                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded">
                  {status.system_health.n8n_failures_1h} failures in last hour
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No health data</p>
          )}
        </div>

        {/* Current Focus */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3 mb-4">
            <Target className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-slate-900 dark:text-white">Current Focus</h3>
          </div>
          {status?.memory?.current_focus ? (
            <div className="space-y-2">
              <div className="text-sm">
                <span className="text-slate-500 dark:text-slate-400">Project: </span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {status.memory.current_focus.project || '-'}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-slate-500 dark:text-slate-400">Goal: </span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {status.memory.current_focus.goal || '-'}
                </span>
              </div>
              {status.memory.today_intent?.description && (
                <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    Today: {status.memory.today_intent.description}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No focus set</p>
          )}
        </div>

        {/* Task Stats */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3 mb-4">
            <ListTodo className="w-5 h-5 text-violet-500" />
            <h3 className="font-semibold text-slate-900 dark:text-white">Task Stats</h3>
          </div>
          {status?.tasks?.stats ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {status.tasks.stats.open_p0}
                </div>
                <div className="text-xs text-slate-500">P0 Open</div>
              </div>
              <div className="text-center p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {status.tasks.stats.open_p1}
                </div>
                <div className="text-xs text-slate-500">P1 Open</div>
              </div>
              <div className="text-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {status.tasks.stats.in_progress}
                </div>
                <div className="text-xs text-slate-500">In Progress</div>
              </div>
              <div className="text-center p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                <div className="text-2xl font-bold text-slate-600 dark:text-slate-300">
                  {status.tasks.stats.queued}
                </div>
                <div className="text-xs text-slate-500">Queued</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No task data</p>
          )}
        </div>
      </div>

      {/* Recent Decisions */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 p-5 border-b border-slate-200 dark:border-slate-700">
          <Zap className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-slate-900 dark:text-white">Recent Decisions</h3>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {status?.recent_decisions && status.recent_decisions.length > 0 ? (
            status.recent_decisions.map((decision, idx) => (
              <div key={idx} className="flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 w-20">
                  <Clock className="w-4 h-4" />
                  {formatTime(decision.ts)}
                </div>
                <div className="flex-1">
                  <code className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-sm text-slate-700 dark:text-slate-300">
                    {decision.action}
                  </code>
                </div>
                <div className={`flex items-center gap-1.5 text-sm ${
                  decision.status === 'success' ? 'text-emerald-500' : 'text-red-500'
                }`}>
                  {decision.status === 'success' ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  {decision.status}
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-slate-400">
              No recent decisions
            </div>
          )}
        </div>
      </div>

      {/* Working Memory */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 p-5 border-b border-slate-200 dark:border-slate-700">
          <Brain className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold text-slate-900 dark:text-white">Working Memory</h3>
        </div>
        <div className="p-5">
          {status?.memory ? (
            <pre className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4 overflow-x-auto text-sm text-slate-700 dark:text-slate-300">
              {JSON.stringify(status.memory, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-slate-400">No memory data</p>
          )}
        </div>
      </div>

      {/* Allowed Actions */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 p-5 border-b border-slate-200 dark:border-slate-700">
          <Zap className="w-5 h-5 text-emerald-500" />
          <h3 className="font-semibold text-slate-900 dark:text-white">Allowed Actions</h3>
          <span className="text-xs text-slate-400 ml-auto">
            Policy v{status?.policy_version || 0}
          </span>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap gap-2">
            {status?.policy_rules?.allowed_actions?.map((action) => (
              <span
                key={action}
                className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-full text-sm font-medium"
              >
                {action}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
