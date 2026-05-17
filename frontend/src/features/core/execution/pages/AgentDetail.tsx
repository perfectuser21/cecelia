import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle, Clock, Zap, Diamond } from 'lucide-react';
import { fetchAgentDetail, AgentWithStats, AgentTask } from '../api/agents.api';

const iconMap: Record<string, React.ElementType> = {
  Zap,
  RefreshCw,
  Diamond,
};

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentWithStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!agentId) return;
    try {
      const data = await fetchAgentDetail(agentId);
      if (data) {
        setAgent(data);
        setError(null);
      } else {
        setError('Agent 不存在');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [agentId]);

  const getTaskStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'running':
        return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleString('zh-CN');
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <p className="text-red-400">{error || 'Agent 不存在'}</p>
        <button
          onClick={() => navigate('/cecelia')}
          className="mt-4 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
        >
          返回总览
        </button>
      </div>
    );
  }

  const Icon = iconMap[agent.icon] || Zap;

  return (
    <div className="space-y-6">
      {/* 返回按钮 */}
      <button
        onClick={() => navigate('/cecelia')}
        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>返回 Cecelia</span>
      </button>

      {/* Agent 信息卡片 */}
      <div className={`
        p-6 rounded-xl border
        bg-gradient-to-br ${agent.gradient.from} ${agent.gradient.to} bg-opacity-10
        dark:bg-slate-800 ${agent.gradient.border}
      `}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-4 rounded-xl bg-gradient-to-br ${agent.gradient.from} ${agent.gradient.to}`}>
              <Icon className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{agent.name}</h1>
              <p className="text-gray-400">{agent.role} · {agent.codename}</p>
            </div>
          </div>
          <button
            onClick={loadData}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
        <p className="mt-4 text-gray-300">{agent.description}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {agent.workflowKeywords.map((keyword) => (
            <span
              key={keyword}
              className="px-2 py-1 text-xs bg-slate-700 text-gray-300 rounded"
            >
              {keyword}
            </span>
          ))}
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
          <p className="text-3xl font-bold text-white">{agent.stats.todayTotal}</p>
          <p className="text-sm text-gray-400 mt-1">今日任务</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-5 border border-emerald-800">
          <p className="text-3xl font-bold text-emerald-400">{agent.stats.todaySuccess}</p>
          <p className="text-sm text-gray-400 mt-1">成功</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-5 border border-red-800">
          <p className="text-3xl font-bold text-red-400">{agent.stats.todayError}</p>
          <p className="text-sm text-gray-400 mt-1">失败</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-5 border border-blue-800">
          <p className="text-3xl font-bold text-blue-400">{agent.stats.successRate}%</p>
          <p className="text-sm text-gray-400 mt-1">成功率</p>
        </div>
      </div>

      {/* 执行历史 */}
      <div className="bg-slate-800 rounded-xl border border-slate-700">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="font-semibold text-white">执行历史</h2>
        </div>
        {agent.recentTasks && agent.recentTasks.length > 0 ? (
          <div className="divide-y divide-slate-700">
            {agent.recentTasks.map((task) => (
              <div key={task.id} className="px-6 py-4 hover:bg-slate-700/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getTaskStatusIcon(task.status)}
                    <span className="text-white">{task.workflowName}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span>{formatDuration(task.duration)}</span>
                    <span>{formatTime(task.startedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <Icon className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">暂无执行记录</p>
          </div>
        )}
      </div>
    </div>
  );
}
