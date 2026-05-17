import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  MessageSquare,
  Activity,
  TrendingUp,
  Calendar,
  Cpu,
  RefreshCw,
  Loader2,
  AlertCircle,
  FolderOpen,
} from 'lucide-react';
import { claudeStatsApi, StatsResponse, DailyStats, SessionStats } from '../api/claude-stats.api';

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(2)}M`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPath(path: string): string {
  if (!path) return '-';
  const parts = path.split('/');
  return parts.slice(-2).join('/') || path;
}

function getModelShortName(model: string): string {
  return model
    .replace('claude-', '')
    .replace('-20251101', '')
    .replace('-20250929', '')
    .replace('-20250514', '')
    .replace('-20241022', '')
    .replace('-20240307', '');
}

function getModelColor(model: string): string {
  if (model.includes('opus')) return 'bg-purple-500';
  if (model.includes('sonnet')) return 'bg-blue-500';
  if (model.includes('haiku')) return 'bg-green-500';
  return 'bg-gray-500';
}

export default function ClaudeStats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await claudeStatsApi.getStats(days);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [days]);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <AlertCircle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
        <p className="text-red-600 dark:text-red-400 mb-3">{error}</p>
        <button
          onClick={fetchStats}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 magnetic-btn"
        >
          重试
        </button>
      </div>
    );
  }

  if (!stats) return null;

  const { overview, daily, recent_sessions } = stats;
  const maxDailyCost = Math.max(...daily.map((d) => d.total_cost), 0.01);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Claude 使用统计</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">基于本地 JSONL 日志</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={7}>最近 7 天</option>
            <option value={14}>最近 14 天</option>
            <option value={30}>最近 30 天</option>
            <option value={60}>最近 60 天</option>
            <option value={90}>最近 90 天</option>
          </select>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-xl transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 tilt-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/25">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">总费用</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatCost(overview.total_cost)}</div>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            平均 {formatCost(overview.average_cost_per_session)}/会话
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 tilt-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">会话数</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{overview.total_sessions}</div>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{overview.total_messages} 条消息</div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 tilt-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">输入 Token</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatTokens(overview.total_input_tokens)}</div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 tilt-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/25">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">输出 Token</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatTokens(overview.total_output_tokens)}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Daily Cost Chart */}
        <div className="col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 shimmer-card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">每日费用趋势</h2>
            <Calendar className="w-5 h-5 text-gray-400 dark:text-gray-500" />
          </div>
          {daily.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 dark:text-gray-500">暂无数据</div>
          ) : (
            <div className="h-48 flex items-end gap-1">
              {daily
                .slice(0, 30)
                .reverse()
                .map((d, i) => {
                  const height = (d.total_cost / maxDailyCost) * 100;
                  return (
                    <div
                      key={d.date}
                      className="flex-1 flex flex-col items-center group relative"
                    >
                      <div
                        className="w-full bg-gradient-to-t from-blue-600 to-blue-400 hover:from-blue-500 hover:to-blue-300 rounded-t transition-all cursor-pointer"
                        style={{ height: `${Math.max(height, 2)}%` }}
                      />
                      <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 dark:bg-slate-900 text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap z-10 shadow-lg">
                        {d.date}: {formatCost(d.total_cost)}
                        <br />
                        {d.sessions} 会话
                      </div>
                      {i % 5 === 0 && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 mt-2 -rotate-45 origin-left">
                          {formatDate(d.date)}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Model Breakdown */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 shimmer-card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">按模型</h2>
            <Cpu className="w-5 h-5 text-gray-400 dark:text-gray-500" />
          </div>
          <div className="space-y-4">
            {overview.by_model.length === 0 ? (
              <div className="text-center text-gray-400 dark:text-gray-500 py-8">暂无数据</div>
            ) : (
              overview.by_model
                .sort((a, b) => b.cost - a.cost)
                .map((m) => {
                  const percentage = overview.total_cost > 0 ? (m.cost / overview.total_cost) * 100 : 0;
                  return (
                    <div key={m.model}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {getModelShortName(m.model)}
                        </span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">{formatCost(m.cost)}</span>
                      </div>
                      <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${getModelColor(m.model)} rounded-full transition-all`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
                        <span>{formatTokens(m.input_tokens)} 输入</span>
                        <span>{formatTokens(m.output_tokens)} 输出</span>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>

      {/* Recent Sessions */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="p-6 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">最近会话</h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">{recent_sessions.length} 个会话</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  项目
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  时间
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  模型
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  消息数
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Token
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  费用
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {recent_sessions.map((session) => (
                <tr key={session.session_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                      <span className="text-sm text-gray-900 dark:text-white font-mono">
                        {formatPath(session.cwd)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {formatDateTime(session.started_at)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex px-2.5 py-1 text-xs rounded-lg text-white ${getModelColor(
                        session.model
                      )}`}
                    >
                      {getModelShortName(session.model)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-white text-right">{session.messages}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 text-right font-mono">
                    {formatTokens(session.input_tokens + session.output_tokens)}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-green-600 dark:text-green-400 text-right">
                    {formatCost(session.cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
