import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Workflow,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Loader2,
  Clock,
  Activity,
  ExternalLink,
  Zap,
  TrendingUp,
  Calendar,
  Timer,
  BarChart3,
  Layers,
  Webhook,
  CalendarClock,
  MousePointer,
  Cloud,
  Server,
} from 'lucide-react';
import {
  n8nWorkflowsApi,
  N8nWorkflowDetail as WorkflowDetailType,
  ExecutionStats,
  N8nInstance,
} from '../api/n8n-workflows.api';

export default function N8nWorkflowDetail() {
  const { instance, id } = useParams<{ instance: string; id: string }>();
  const navigate = useNavigate();

  const [workflow, setWorkflow] = useState<WorkflowDetailType | null>(null);
  const [executions, setExecutions] = useState<ExecutionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  const fetchData = async () => {
    if (!instance || !id) return;

    try {
      const [workflowData, executionsData] = await Promise.all([
        n8nWorkflowsApi.getWorkflowDetail(instance as N8nInstance, id),
        n8nWorkflowsApi.getWorkflowExecutions(instance as N8nInstance, id, 50),
      ]);
      setWorkflow(workflowData);
      setExecutions(executionsData);
      setLastUpdate(new Date().toLocaleTimeString('zh-CN'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [instance, id]);

  const handleRefresh = () => {
    setLoading(true);
    fetchData();
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
        return 'Success';
      case 'error':
        return 'Failed';
      case 'crashed':
        return 'Crashed';
      case 'running':
        return 'Running';
      case 'waiting':
        return 'Waiting';
      default:
        return status;
    }
  };

  const getTriggerIcon = (type?: string) => {
    switch (type) {
      case 'schedule':
        return <CalendarClock className="w-4 h-4" />;
      case 'webhook':
        return <Webhook className="w-4 h-4" />;
      case 'manual':
        return <MousePointer className="w-4 h-4" />;
      default:
        return <Zap className="w-4 h-4" />;
    }
  };

  const getTriggerLabel = (type?: string): string => {
    switch (type) {
      case 'schedule':
        return 'Scheduled';
      case 'webhook':
        return 'Webhook';
      case 'manual':
        return 'Manual';
      default:
        return 'Other';
    }
  };

  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFullTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (start: string, end?: string): string => {
    if (!end) return '-';
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const duration = Math.round((endTime - startTime) / 1000);

    if (duration < 60) return `${duration}s`;
    if (duration < 3600) return `${Math.floor(duration / 60)}m ${duration % 60}s`;
    return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;
  };

  if (loading && !workflow) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !workflow) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <AlertCircle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
        <p className="text-red-600 dark:text-red-400 mb-3">{error}</p>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25"
        >
          Retry
        </button>
      </div>
    );
  }

  const n8nBaseUrl = instance === 'local'
    ? (import.meta.env.VITE_N8N_LOCAL_URL || 'http://localhost:5679')
    : (import.meta.env.VITE_N8N_CLOUD_URL || '#');

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate('/n8n/workflows')}
            className="mt-1 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition text-gray-500 dark:text-gray-400"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {workflow?.name || 'Loading...'}
              </h1>
              <span className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 ${
                instance === 'local'
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
              }`}>
                {instance === 'local' ? <Server className="w-3 h-3" /> : <Cloud className="w-3 h-3" />}
                {instance === 'local' ? 'Local' : 'Cloud'}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Updated at {lastUpdate}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`${n8nBaseUrl}/workflow/${id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition"
          >
            <ExternalLink className="w-4 h-4" />
            Open in n8n
          </a>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 shadow-lg shadow-blue-500/25"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Status */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              workflow?.active
                ? 'bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg shadow-green-500/25'
                : 'bg-gradient-to-br from-gray-400 to-gray-500 shadow-lg shadow-gray-500/25'
            }`}>
              {workflow?.active ? <Play className="w-5 h-5 text-white" /> : <Pause className="w-5 h-5 text-white" />}
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Status</div>
              <div className={`text-lg font-bold ${
                workflow?.active ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'
              }`}>
                {workflow?.active ? 'Active' : 'Inactive'}
              </div>
            </div>
          </div>
        </div>

        {/* Trigger */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
              {getTriggerIcon(workflow?.triggerType)}
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Trigger</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {getTriggerLabel(workflow?.triggerType)}
              </div>
              {workflow?.triggerInfo && (
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]" title={workflow.triggerInfo}>
                  {workflow.triggerInfo}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Nodes */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Nodes</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {workflow?.nodeCount || 0}
              </div>
            </div>
          </div>
        </div>

        {/* Created */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Created</div>
              <div className="text-sm font-bold text-gray-900 dark:text-white">
                {workflow?.createdAt ? formatFullTime(workflow.createdAt) : '-'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Execution Stats */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-5">
          <BarChart3 className="w-5 h-5" />
          Execution Statistics
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
              <Zap className="w-4 h-4" />
              Total
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {executions?.total || 0}
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm mb-1">
              <CheckCircle2 className="w-4 h-4" />
              Success
            </div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {executions?.success || 0}
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm mb-1">
              <XCircle className="w-4 h-4" />
              Failed
            </div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {executions?.error || 0}
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm mb-1">
              <TrendingUp className="w-4 h-4" />
              Success Rate
            </div>
            <div className={`text-2xl font-bold ${
              (executions?.successRate || 0) >= 90 ? 'text-green-600 dark:text-green-400' :
              (executions?.successRate || 0) >= 70 ? 'text-yellow-600 dark:text-yellow-400' :
              'text-red-600 dark:text-red-400'
            }`}>
              {executions?.successRate || 0}%
            </div>
          </div>
        </div>
      </div>

      {/* Execution History */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Executions</h2>
            <span className="text-sm text-gray-400 dark:text-gray-500">
              (Last {executions?.executions?.length || 0})
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Mode
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Started
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {!executions?.executions?.length ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    No executions yet
                  </td>
                </tr>
              ) : (
                executions.executions.map((execution) => (
                  <tr key={execution.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-3">
                      <span className="text-sm font-mono text-gray-600 dark:text-gray-300">
                        #{execution.id}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 w-fit ${getStatusColor(execution.status)}`}>
                        {getStatusIcon(execution.status)}
                        {getStatusLabel(execution.status)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {execution.mode}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {formatTime(execution.startedAt)}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono">
                      {formatDuration(execution.startedAt, execution.stoppedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Description */}
      {workflow?.description && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Description</h2>
          <p className="text-gray-600 dark:text-gray-400">{workflow.description}</p>
        </div>
      )}
    </div>
  );
}
