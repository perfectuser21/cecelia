import { useEffect, useState } from 'react';
import {
  Activity,
  RefreshCw,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Heart,
  ListTodo,
  Shield,
  GitBranch,
  Folder,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface LiveData {
  health: {
    workspace: 'ok' | 'degraded' | 'unavailable';
    brain: 'ok' | 'degraded' | 'unavailable';
    quality: 'ok' | 'degraded' | 'unavailable';
    n8n: 'ok' | 'degraded' | 'unavailable';
  };
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    updated_at?: string;
  }>;
  dev_sessions: Array<{
    session_id: string;
    branch: string;
    project: string;
    status: 'running' | 'completed' | 'failed';
    started_at: string;
    completed_at?: string;
    summary?: {
      files_modified: string[];
      duration_ms: number;
    };
  }>;
  governance: {
    dlq_count: number;
    degrade_status: string;
    degrade_reason: string | null;
    assertions: {
      passed: number;
      failed: number;
    };
  };
  plan: {
    last_plan_id: string | null;
    scope: string | null;
    next_run_time: string | null;
    committed_count: number;
  };
  timestamp: string;
}

const POLLING_INTERVAL = 3000; // 3 seconds

async function fetchLiveData(): Promise<LiveData> {
  const response = await fetch('/api/system/live');
  const json = await response.json();
  if (!json.success) throw new Error(json.error || 'Failed to fetch live data');
  return json.data;
}

export default function LiveDashboard() {
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const loadData = async () => {
    try {
      const liveData = await fetchLiveData();
      setData(liveData);
      setError(null);
      setLastUpdate(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, POLLING_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  const toggleSession = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <p className="text-red-400">加载失败: {error}</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg hover:bg-red-900/50 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  const healthColor = (status: string) => {
    if (status === 'ok') return 'text-emerald-400';
    if (status === 'degraded') return 'text-amber-400';
    return 'text-red-400';
  };

  const healthBg = (status: string) => {
    if (status === 'ok') return 'bg-emerald-500/20';
    if (status === 'degraded') return 'bg-amber-500/20';
    return 'bg-red-500/20';
  };

  const runningTasks = data?.tasks.filter((t) => t.status === 'in_progress' || t.status === 'running') || [];
  const totalAssertions = (data?.governance.assertions.passed || 0) + (data?.governance.assertions.failed || 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-emerald-500 to-cyan-600 rounded-xl">
            <Activity className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Live Dashboard</h1>
            <p className="text-gray-400">
              系统实时状态监控 · {POLLING_INTERVAL / 1000}秒刷新
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-sm text-gray-500 flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {lastUpdate.toLocaleTimeString('zh-CN')}
            </span>
          )}
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* System Health Card */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-emerald-400" />
              <span className="font-medium text-white">System Health</span>
            </div>
            <div className={`px-2 py-1 rounded-full text-xs ${healthBg(data?.health.workspace || 'unavailable')} ${healthColor(data?.health.workspace || 'unavailable')}`}>
              {data?.health.workspace || 'unavailable'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${data?.health.brain === 'ok' ? 'bg-emerald-400' : data?.health.brain === 'degraded' ? 'bg-amber-400' : 'bg-red-400'}`} />
              <span className="text-gray-400">Brain</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${data?.health.quality === 'ok' ? 'bg-emerald-400' : data?.health.quality === 'degraded' ? 'bg-amber-400' : 'bg-red-400'}`} />
              <span className="text-gray-400">Quality</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${data?.health.n8n === 'ok' ? 'bg-emerald-400' : data?.health.n8n === 'degraded' ? 'bg-amber-400' : 'bg-red-400'}`} />
              <span className="text-gray-400">N8N</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${data?.governance.degrade_status === 'normal' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span className="text-gray-400">Degrade</span>
            </div>
          </div>
        </div>

        {/* Running Tasks Card */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ListTodo className="w-5 h-5 text-blue-400" />
              <span className="font-medium text-white">Running Tasks</span>
            </div>
            <span className="text-2xl font-bold text-blue-400">{runningTasks.length}</span>
          </div>
          <div className="text-sm text-gray-400">
            总任务: {data?.tasks.length || 0}
          </div>
          {runningTasks.length > 0 && (
            <div className="mt-2 text-xs text-gray-500 truncate">
              {runningTasks[0]?.title}
            </div>
          )}
        </div>

        {/* DLQ & Degrade Card */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <span className="font-medium text-white">DLQ & Degrade</span>
            </div>
            <span className={`text-2xl font-bold ${data?.governance.dlq_count === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {data?.governance.dlq_count || 0}
            </span>
          </div>
          <div className="text-sm text-gray-400">
            状态: {data?.governance.degrade_status || 'unknown'}
          </div>
          {data?.governance.degrade_reason && (
            <div className="mt-2 text-xs text-amber-400 truncate">
              {data.governance.degrade_reason}
            </div>
          )}
        </div>

        {/* Assertions Card */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-purple-400" />
              <span className="font-medium text-white">Assertions</span>
            </div>
            <span className={`text-2xl font-bold ${data?.governance.assertions.failed === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {data?.governance.assertions.failed || 0}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-gray-400">{data?.governance.assertions.passed || 0} passed</span>
            </div>
            <div className="flex items-center gap-1">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-gray-400">{data?.governance.assertions.failed || 0} failed</span>
            </div>
          </div>
          {totalAssertions > 0 && (
            <div className="mt-3 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${(data?.governance.assertions.passed || 0) / totalAssertions * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Two Column Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Tasks */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <ListTodo className="w-5 h-5 text-blue-400" />
            Recent Tasks
            <span className="ml-auto text-sm text-gray-400">
              {data?.tasks.length || 0} 个
            </span>
          </h2>

          {data?.tasks && data.tasks.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {data.tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{task.title}</div>
                    {task.updated_at && (
                      <div className="text-xs text-gray-500">
                        {new Date(task.updated_at).toLocaleString('zh-CN')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      task.priority === 'P0' ? 'bg-red-500/20 text-red-400' :
                      task.priority === 'P1' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-slate-700 text-gray-400'
                    }`}>
                      {task.priority}
                    </span>
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      task.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                      task.status === 'in_progress' || task.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-slate-700 text-gray-400'
                    }`}>
                      {task.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <ListTodo className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>暂无任务</p>
            </div>
          )}
        </div>

        {/* Dev Sessions */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-purple-400" />
            Dev Sessions
            <span className="ml-auto text-sm text-gray-400">
              {data?.dev_sessions.length || 0} 个
            </span>
          </h2>

          {data?.dev_sessions && data.dev_sessions.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {data.dev_sessions.map((session) => (
                <div
                  key={session.session_id}
                  className={`rounded-lg border ${
                    session.status === 'running'
                      ? 'border-blue-500/30 bg-blue-500/5'
                      : session.status === 'completed'
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-red-500/30 bg-red-500/5'
                  }`}
                >
                  <div
                    className="p-3 cursor-pointer flex items-center justify-between"
                    onClick={() => toggleSession(session.session_id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Folder className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-medium text-white truncate">
                          {session.project}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <GitBranch className="w-3 h-3 text-gray-500" />
                        <span className="text-xs text-gray-400 truncate">
                          {session.branch}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        session.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                        session.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {session.status}
                      </span>
                      {expandedSessions.has(session.session_id) ? (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      )}
                    </div>
                  </div>

                  {/* Expanded summary */}
                  {expandedSessions.has(session.session_id) && session.summary && (
                    <div className="px-3 pb-3 border-t border-slate-700/50 mt-1 pt-2">
                      <div className="text-xs text-gray-400 space-y-1">
                        <div>
                          时长: {Math.round(session.summary.duration_ms / 1000 / 60)} 分钟
                        </div>
                        <div>
                          修改文件: {session.summary.files_modified?.length || 0} 个
                        </div>
                        {session.summary.files_modified?.slice(0, 3).map((f, i) => (
                          <div key={i} className="text-xs text-gray-500 pl-2 truncate">
                            · {f}
                          </div>
                        ))}
                        {session.summary.files_modified?.length > 3 && (
                          <div className="text-xs text-gray-500 pl-2">
                            ... 还有 {session.summary.files_modified.length - 3} 个
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {!expandedSessions.has(session.session_id) && (
                    <div className="px-3 pb-2 text-xs text-gray-500">
                      {new Date(session.started_at).toLocaleString('zh-CN')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>暂无 Dev Session</p>
            </div>
          )}
        </div>
      </div>

      {/* Plan Status */}
      {data?.plan.last_plan_id && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <span className="text-gray-400">最新计划:</span>
              <span className="text-white font-mono">{data.plan.last_plan_id}</span>
              <span className="text-gray-500">({data.plan.scope})</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-gray-400">已提交任务: <span className="text-emerald-400">{data.plan.committed_count}</span></span>
              {data.plan.next_run_time && (
                <span className="text-gray-400">下次运行: <span className="text-cyan-400">{new Date(data.plan.next_run_time).toLocaleString('zh-CN')}</span></span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
