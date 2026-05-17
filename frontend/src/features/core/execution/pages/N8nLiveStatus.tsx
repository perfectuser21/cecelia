import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  RefreshCw,
  Clock,
  TrendingUp,
  Zap,
  ExternalLink,
  Server,
  Cloud,
} from 'lucide-react';
import {
  n8nLiveStatusApi,
  N8nInstance,
  LiveStatusOverview,
  InstancesStatus,
  RunningExecution,
  N8nExecutionDetail,
} from '../api/n8n-live-status.api';

export default function N8nLiveStatus() {
  const navigate = useNavigate();

  // Instance state
  const [activeInstance, setActiveInstance] = useState<N8nInstance>('local');
  const [instancesStatus, setInstancesStatus] = useState<InstancesStatus | null>(null);

  // Data state
  const [overview, setOverview] = useState<LiveStatusOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  // Fetch instances status
  useEffect(() => {
    n8nLiveStatusApi.getInstancesStatus()
      .then(setInstancesStatus)
      .catch(() => {
        setInstancesStatus({
          cloud: { available: false, name: 'Cloud' },
          local: { available: true, name: 'Local' },
        });
      });
  }, []);

  // Fetch overview data
  const fetchData = async () => {
    try {
      const data = await n8nLiveStatusApi.getLiveStatusOverview(activeInstance);
      setOverview(data);
      setLastUpdate(new Date().toLocaleTimeString('zh-CN'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    fetchData();
  };

  // Auto-refresh: stats every 30s, running every 10s
  useEffect(() => {
    setLoading(true);
    setOverview(null);
    fetchData();

    // Refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [activeInstance]);

  // Navigate to detail page
  const handleExecutionClick = (executionId: string) => {
    navigate(`/n8n/live-status/${activeInstance}/${executionId}`);
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    return `${Math.floor(seconds / 3600)}时${Math.floor((seconds % 3600) / 60)}分`;
  };

  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'success':
        return 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400';
      case 'error':
      case 'crashed':
        return 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400';
      case 'running':
      case 'waiting':
        return 'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400';
      default:
        return 'text-gray-600 bg-gray-100 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'error':
      case 'crashed':
        return <XCircle className="w-4 h-4" />;
      case 'running':
      case 'waiting':
        return <Activity className="w-4 h-4 animate-pulse" />;
      default:
        return <AlertCircle className="w-4 h-4" />;
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'success':
        return '成功';
      case 'error':
        return '失败';
      case 'crashed':
        return '崩溃';
      case 'running':
        return '运行中';
      case 'waiting':
        return '等待中';
      default:
        return status;
    }
  };

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <AlertCircle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
        <p className="text-red-600 dark:text-red-400 mb-3">{error}</p>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25"
        >
          重试
        </button>
      </div>
    );
  }

  const todayStats = overview?.todayStats;
  const runningExecutions = overview?.runningExecutions || [];
  const recentCompleted = overview?.recentCompleted || [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">n8n 实时状态</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              工作流执行监控 · 更新于 {lastUpdate}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={activeInstance === 'local' ? (import.meta.env.VITE_N8N_LOCAL_URL || 'http://localhost:5679') : (import.meta.env.VITE_N8N_CLOUD_URL || '#')}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition"
          >
            <ExternalLink className="w-4 h-4" />
            打开 n8n
          </a>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 shadow-lg shadow-blue-500/25"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Instance Tabs */}
      <div className="flex bg-gray-100 dark:bg-slate-700 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveInstance('local')}
          disabled={!instancesStatus?.local.available}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeInstance === 'local'
              ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          } ${!instancesStatus?.local.available ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Server className="w-4 h-4" />
          Local
          {!instancesStatus?.local.available && <span className="text-xs text-red-500">(未配置)</span>}
        </button>
        <button
          onClick={() => setActiveInstance('cloud')}
          disabled={!instancesStatus?.cloud.available}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeInstance === 'cloud'
              ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          } ${!instancesStatus?.cloud.available ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Cloud className="w-4 h-4" />
          Cloud
          {!instancesStatus?.cloud.available && <span className="text-xs text-red-500">(未配置)</span>}
        </button>
      </div>

      {/* Today Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          icon={<Activity className="w-4 h-4 text-white" />}
          label="运行中"
          value={todayStats?.running || 0}
          color="from-blue-500 to-cyan-600"
          animate={todayStats && todayStats.running > 0}
        />
        <StatCard
          icon={<CheckCircle2 className="w-4 h-4 text-white" />}
          label="成功"
          value={todayStats?.success || 0}
          color="from-green-500 to-emerald-600"
        />
        <StatCard
          icon={<XCircle className="w-4 h-4 text-white" />}
          label="失败"
          value={todayStats?.error || 0}
          color="from-red-500 to-rose-600"
        />
        <StatCard
          icon={<Zap className="w-4 h-4 text-white" />}
          label="总数"
          value={todayStats?.total || 0}
          color="from-purple-500 to-violet-600"
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4 text-white" />}
          label="成功率"
          value={`${todayStats?.successRate || 0}%`}
          color="from-emerald-500 to-teal-600"
        />
      </div>

      {/* Running Executions */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-pulse" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">正在运行</h2>
            <span className="text-sm text-gray-400 dark:text-gray-500">
              ({runningExecutions.length} 个)
            </span>
          </div>
        </div>
        <div className="p-6">
          {runningExecutions.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              暂无运行中的工作流
            </div>
          ) : (
            <div className="space-y-3">
              {runningExecutions.map((execution) => (
                <RunningExecutionCard
                  key={execution.id}
                  execution={execution}
                  formatDuration={formatDuration}
                  onClick={() => handleExecutionClick(execution.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Completed */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">最近完成</h2>
            <span className="text-sm text-gray-400 dark:text-gray-500">
              (最近 10 条)
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  工作流
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  耗时
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  完成时间
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {recentCompleted.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    暂无执行记录
                  </td>
                </tr>
              ) : (
                recentCompleted.map((execution) => (
                  <tr
                    key={execution.id}
                    onClick={() => handleExecutionClick(execution.id)}
                    className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-3 text-sm font-medium text-gray-900 dark:text-white">
                      {execution.workflowName || execution.workflowId}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 w-fit ${getStatusColor(execution.status)}`}
                      >
                        {getStatusIcon(execution.status)}
                        {getStatusLabel(execution.status)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono">
                      {execution.duration ? formatDuration(execution.duration) : '-'}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {execution.stoppedAt ? formatTime(execution.stoppedAt) : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Stat Card Component
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
  animate?: boolean;
}

function StatCard({ icon, label, value, color, animate }: StatCardProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 bg-gradient-to-br ${color} rounded-xl flex items-center justify-center shadow-lg ${animate ? 'animate-pulse' : ''}`}>
          {icon}
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">{value}</div>
        </div>
      </div>
    </div>
  );
}

// Running Execution Card Component
interface RunningExecutionCardProps {
  execution: RunningExecution;
  formatDuration: (seconds: number) => string;
  onClick: () => void;
}

function RunningExecutionCard({ execution, formatDuration, onClick }: RunningExecutionCardProps) {
  return (
    <div
      onClick={onClick}
      className="border border-blue-300 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-900/20 rounded-xl p-4 hover:shadow-md transition-all cursor-pointer"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="font-medium text-gray-900 dark:text-white text-sm">
            {execution.workflowName}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            开始于 {new Date(execution.startedAt).toLocaleTimeString('zh-CN')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center gap-2">
            <Activity className="w-4 h-4 animate-pulse" />
            已耗时 {formatDuration(execution.duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
