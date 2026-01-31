import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  GitBranch,
  Terminal,
  MonitorPlay,
  FileCode,
  ExternalLink,
} from 'lucide-react';

interface TaskRun {
  id: string;
  prd_path: string;
  project: string;
  feature_branch: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_checkpoints: number;
  completed_checkpoints: number;
  failed_checkpoints: number;
  current_checkpoint?: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
  error?: string;
  mode?: 'headless' | 'interactive';
}

interface Checkpoint {
  run_id: string;
  checkpoint_id: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  started_at?: string;
  completed_at?: string;
  duration?: number;
  output?: string;
  error?: string;
  pr_url?: string;
}

interface RunDetailResponse {
  success: boolean;
  run: TaskRun;
  checkpoints: Checkpoint[];
  error?: string;
}

const CHECKPOINT_NAMES: Record<string, { name: string; description: string }> = {
  L1: { name: 'L1 - 自动化检查', description: 'Lint、TypeScript、单元测试' },
  L2: { name: 'L2 - 功能验证', description: '集成测试、功能验收' },
  L3: { name: 'L3 - 交付确认', description: 'PR 合并、部署验证' },
};

export default function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    if (!runId) return;
    try {
      const res = await fetch(`/api/cecelia/runs/${runId}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
        setError(null);
      } else {
        setError(json.error || '加载失败');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [runId]);

  const getStatusIcon = (status: string, size = 'w-5 h-5') => {
    switch (status) {
      case 'completed':
      case 'done':
        return <CheckCircle2 className={`${size} text-emerald-500`} />;
      case 'running':
      case 'in_progress':
        return <RefreshCw className={`${size} text-blue-500 animate-spin`} />;
      case 'failed':
        return <XCircle className={`${size} text-red-500`} />;
      default:
        return <Clock className={`${size} text-gray-400`} />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      pending: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
      skipped: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    };
    const labels: Record<string, string> = {
      completed: '已完成',
      done: '通过',
      running: '运行中',
      in_progress: '进行中',
      failed: '失败',
      pending: '等待中',
      skipped: '已跳过',
    };
    return (
      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${styles[status] || styles.pending}`}>
        {labels[status] || status}
      </span>
    );
  };

  const formatTime = (iso?: string) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('zh-CN');
  };

  const getModeIcon = (mode?: string) => {
    if (mode === 'headless') {
      return <Terminal className="w-4 h-4 text-purple-400" />;
    }
    return <MonitorPlay className="w-4 h-4 text-cyan-400" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/cecelia/runs')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回任务列表
        </button>
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <p className="text-red-400">{error || '任务不存在'}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg hover:bg-red-900/50 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const { run, checkpoints } = data;

  return (
    <div className="space-y-6">
      {/* 返回按钮 */}
      <button
        onClick={() => navigate('/cecelia/runs')}
        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回任务列表
      </button>

      {/* 任务头部 */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              {getStatusIcon(run.status, 'w-6 h-6')}
              <h1 className="text-2xl font-bold text-white">{run.project}</h1>
              {getStatusBadge(run.status)}
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <div className="flex items-center gap-1">
                <GitBranch className="w-4 h-4" />
                <span>{run.feature_branch}</span>
              </div>
              <div className="flex items-center gap-1">
                {getModeIcon(run.mode)}
                <span>{run.mode === 'headless' ? '无头模式' : '交互模式'}</span>
              </div>
            </div>
          </div>
          <button
            onClick={fetchData}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* 进度条 */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">进度</span>
            <span className="text-sm text-white font-medium">
              {run.completed_checkpoints}/{run.total_checkpoints} Checkpoints
            </span>
          </div>
          <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                run.failed_checkpoints > 0
                  ? 'bg-gradient-to-r from-red-500 to-red-600'
                  : 'bg-gradient-to-r from-blue-500 to-emerald-500'
              }`}
              style={{ width: `${(run.completed_checkpoints / run.total_checkpoints) * 100}%` }}
            />
          </div>
        </div>

        {/* 时间信息 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500 mb-1">开始时间</p>
            <p className="text-white">{formatTime(run.started_at)}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-1">更新时间</p>
            <p className="text-white">{formatTime(run.updated_at)}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-1">完成时间</p>
            <p className="text-white">{formatTime(run.completed_at)}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-1">当前步骤</p>
            <p className="text-white">{run.current_checkpoint || '-'}</p>
          </div>
        </div>

        {/* 错误信息 */}
        {run.error && (
          <div className="mt-4 p-4 bg-red-900/20 border border-red-800 rounded-lg">
            <p className="text-red-400 text-sm">{run.error}</p>
          </div>
        )}
      </div>

      {/* Checkpoints 列表 */}
      <div className="bg-slate-800 rounded-xl border border-slate-700">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="font-semibold text-white">Checkpoints</h2>
        </div>
        <div className="divide-y divide-slate-700">
          {checkpoints.map((cp, index) => {
            const cpInfo = CHECKPOINT_NAMES[cp.checkpoint_id] || {
              name: cp.checkpoint_id,
              description: '',
            };
            return (
              <div key={cp.checkpoint_id} className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white font-medium">
                      {index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(cp.status)}
                        <span className="font-medium text-white">{cpInfo.name}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">{cpInfo.description}</p>
                    </div>
                  </div>
                  {getStatusBadge(cp.status)}
                </div>

                {/* Checkpoint 详情 */}
                <div className="ml-11 space-y-2">
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                    {cp.started_at && (
                      <span>开始: {formatTime(cp.started_at)}</span>
                    )}
                    {cp.completed_at && (
                      <span>完成: {formatTime(cp.completed_at)}</span>
                    )}
                    {cp.duration && (
                      <span>耗时: {cp.duration}s</span>
                    )}
                  </div>

                  {/* PR 链接 */}
                  {cp.pr_url && (
                    <a
                      href={cp.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
                    >
                      <ExternalLink className="w-4 h-4" />
                      查看 PR
                    </a>
                  )}

                  {/* 输出 */}
                  {cp.output && (
                    <div className="mt-2 p-3 bg-slate-900 rounded-lg">
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                        <FileCode className="w-4 h-4" />
                        输出
                      </div>
                      <pre className="text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto">
                        {cp.output}
                      </pre>
                    </div>
                  )}

                  {/* 错误 */}
                  {cp.error && (
                    <div className="mt-2 p-3 bg-red-900/20 border border-red-800 rounded-lg">
                      <p className="text-sm text-red-400">{cp.error}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
