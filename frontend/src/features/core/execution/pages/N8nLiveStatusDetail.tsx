import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronLeft,
  Clock,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import {
  n8nLiveStatusApi,
  N8nInstance,
  N8nExecutionDetail,
} from '../api/n8n-live-status.api';

export default function N8nLiveStatusDetail() {
  const { instance, executionId } = useParams<{ instance: string; executionId: string }>();
  const navigate = useNavigate();

  const [execution, setExecution] = useState<N8nExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!instance || !executionId) {
      setError('无效的参数');
      setLoading(false);
      return;
    }

    const fetchDetail = async () => {
      try {
        const data = await n8nLiveStatusApi.getExecutionDetail(instance as N8nInstance, executionId);
        setExecution(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取数据失败');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [instance, executionId]);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    return `${Math.floor(seconds / 3600)}时${Math.floor((seconds % 3600) / 60)}分`;
  };

  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
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
        return <CheckCircle2 className="w-5 h-5" />;
      case 'error':
      case 'crashed':
        return <XCircle className="w-5 h-5" />;
      case 'running':
      case 'waiting':
        return <Activity className="w-5 h-5 animate-pulse" />;
      default:
        return <AlertCircle className="w-5 h-5" />;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <AlertCircle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
        <p className="text-red-600 dark:text-red-400 mb-3">{error || '未找到执行记录'}</p>
        <button
          onClick={() => navigate(`/n8n/live-status`)}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25"
        >
          返回列表
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Back Button */}
      <button
        onClick={() => navigate(`/n8n/live-status`)}
        className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
      >
        <ChevronLeft className="w-4 h-4" />
        返回列表
      </button>

      {/* Header */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {execution.workflowName || execution.workflowId}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              执行 ID: {execution.id}
            </p>
          </div>
          <span
            className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${getStatusColor(execution.status)}`}
          >
            {getStatusIcon(execution.status)}
            {getStatusLabel(execution.status)}
          </span>
        </div>

        {/* Basic Info Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <InfoCard
            icon={<Zap className="w-4 h-4" />}
            label="触发方式"
            value={execution.mode}
          />
          <InfoCard
            icon={<Clock className="w-4 h-4" />}
            label="耗时"
            value={execution.duration ? formatDuration(execution.duration) : '-'}
          />
          <InfoCard
            icon={<Clock className="w-4 h-4" />}
            label="开始时间"
            value={formatTime(execution.startedAt)}
          />
          <InfoCard
            icon={<Clock className="w-4 h-4" />}
            label="结束时间"
            value={execution.stoppedAt ? formatTime(execution.stoppedAt) : '-'}
          />
        </div>
      </div>

      {/* Error Message */}
      {execution.errorMessage && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900 dark:text-red-300 mb-2">错误信息</h3>
              <p className="text-sm text-red-700 dark:text-red-400 font-mono">
                {execution.errorMessage}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Node Execution Timeline */}
      {execution.nodes && execution.nodes.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Activity className="w-5 h-5" />
              节点执行时间线
            </h2>
          </div>
          <div className="p-6">
            <div className="space-y-3">
              {execution.nodes.map((node, index) => (
                <NodeCard key={index} node={node} formatDuration={formatDuration} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {(!execution.nodes || execution.nodes.length === 0) && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-12 text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">暂无节点执行信息</p>
        </div>
      )}
    </div>
  );
}

// Info Card Component
interface InfoCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function InfoCard({ icon, label, value }: InfoCardProps) {
  return (
    <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs mb-2">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium text-gray-900 dark:text-white truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

// Node Card Component
interface NodeCardProps {
  node: {
    name: string;
    type: string;
    duration?: number;
    status?: string;
  };
  formatDuration: (seconds: number) => string;
}

function NodeCard({ node, formatDuration }: NodeCardProps) {
  const getNodeStatusColor = (status?: string): string => {
    switch (status) {
      case 'success':
        return 'border-green-300 dark:border-green-600 bg-green-50/50 dark:bg-green-900/20';
      case 'error':
        return 'border-red-300 dark:border-red-600 bg-red-50/50 dark:bg-red-900/20';
      case 'running':
      case 'waiting':
        return 'border-blue-300 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-900/20';
      default:
        return 'border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700/50';
    }
  };

  return (
    <div className={`border rounded-xl p-4 ${getNodeStatusColor(node.status)}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="font-medium text-gray-900 dark:text-white text-sm">{node.name}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{node.type}</p>
        </div>
        <div className="flex items-center gap-2">
          {node.status && (
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                node.status === 'success'
                  ? 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
                  : node.status === 'error'
                  ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400'
                  : 'bg-gray-100 dark:bg-slate-600 text-gray-600 dark:text-gray-400'
              }`}
            >
              {node.status === 'success' ? '成功' : node.status === 'error' ? '失败' : node.status}
            </span>
          )}
          {node.duration !== undefined && (
            <span className="text-xs font-mono text-gray-600 dark:text-gray-400">
              {formatDuration(node.duration)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
