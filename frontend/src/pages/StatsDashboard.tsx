/**
 * 多维度数据仪表盘页面
 * 展示平台、时间、成功率三个维度的数据
 */

import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, PieChart, RefreshCw } from 'lucide-react';
import {
  statsApi,
  type PlatformStats,
  type TimeSeriesDataPoint,
  type SuccessRateData,
} from '../api/stats.api';

type TimeRange = '24h' | '7d' | '30d';

export default function StatsDashboard() {
  const [platformStats, setPlatformStats] = useState<PlatformStats[]>([]);
  const [timelineData, setTimelineData] = useState<TimeSeriesDataPoint[]>([]);
  const [successRateData, setSuccessRateData] = useState<SuccessRateData>({
    success: 0,
    failed: 0,
    in_progress: 0,
  });
  const [selectedRange, setSelectedRange] = useState<TimeRange>('7d');
  const [loading, setLoading] = useState(true);

  // 自动刷新（30秒间隔）
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAllData();
    }, 30000);

    return () => clearInterval(interval);
  }, [selectedRange]);

  // 获取所有数据
  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [platform, timeline, successRate] = await Promise.all([
        statsApi.fetchPlatformStats(),
        statsApi.fetchTimelineStats(selectedRange),
        statsApi.fetchSuccessRateStats(),
      ]);

      setPlatformStats(platform.sort((a, b) => b.successRate - a.successRate));
      setTimelineData(timeline);
      setSuccessRateData(successRate);
    } catch (error) {
      // Error silently handled, UI shows empty state
    } finally {
      setLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    fetchAllData();
  }, [selectedRange]);

  // 手动刷新
  const handleRefresh = () => {
    fetchAllData();
  };

  // 计算成功率百分比
  const total = successRateData.success + successRateData.failed + successRateData.in_progress;
  const successPercent = total > 0 ? ((successRateData.success / total) * 100).toFixed(1) : '0.0';
  const failedPercent = total > 0 ? ((successRateData.failed / total) * 100).toFixed(1) : '0.0';
  const inProgressPercent = total > 0 ? ((successRateData.in_progress / total) * 100).toFixed(1) : '0.0';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      {/* 页面标题和操作栏 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">数据仪表盘</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            多维度数据展示与分析
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新数据
        </button>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="mb-6 text-center text-gray-600 dark:text-gray-400">
          加载中...
        </div>
      )}

      {/* 主内容区 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 平台维度统计 */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                平台发布统计
              </h2>
            </div>

            {platformStats.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                暂无平台数据
              </div>
            ) : (
              <div className="space-y-4">
                {platformStats.map((platform) => (
                  <div key={platform.platform} className="border-b border-gray-200 dark:border-gray-700 pb-4 last:border-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900 dark:text-white">
                        {platform.platform}
                      </span>
                      <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                        {platform.successRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                      <span>发布: {platform.published}</span>
                      <span>成功: {platform.success}</span>
                      <span>失败: {platform.failed}</span>
                    </div>
                    {/* 进度条 */}
                    <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-green-600 dark:bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${platform.successRate}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 成功率维度 */}
        <div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-5 h-5 text-purple-600" />
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                任务状态
              </h2>
            </div>

            {total === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                暂无数据
              </div>
            ) : (
              <div className="space-y-4">
                {/* 成功 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      成功
                    </span>
                    <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                      {successPercent}%
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    {successRateData.success.toLocaleString()}
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-green-600 dark:bg-green-500 h-2 rounded-full"
                      style={{ width: `${successPercent}%` }}
                    />
                  </div>
                </div>

                {/* 失败 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      失败
                    </span>
                    <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                      {failedPercent}%
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    {successRateData.failed.toLocaleString()}
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-red-600 dark:bg-red-500 h-2 rounded-full"
                      style={{ width: `${failedPercent}%` }}
                    />
                  </div>
                </div>

                {/* 进行中 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      进行中
                    </span>
                    <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                      {inProgressPercent}%
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    {successRateData.in_progress.toLocaleString()}
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full"
                      style={{ width: `${inProgressPercent}%` }}
                    />
                  </div>
                </div>

                {/* 总计验证 */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                    <span>总计</span>
                    <span className="font-semibold">{total.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                    百分比总和: {(parseFloat(successPercent) + parseFloat(failedPercent) + parseFloat(inProgressPercent)).toFixed(1)}%
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 时间维度分析 */}
        <div className="lg:col-span-3">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-orange-600" />
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  趋势分析
                </h2>
              </div>

              {/* 时间范围切换 */}
              <div className="flex gap-2">
                {(['24h', '7d', '30d'] as TimeRange[]).map((range) => (
                  <button
                    key={range}
                    onClick={() => setSelectedRange(range)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      selectedRange === range
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {range === '24h' ? '24小时' : range === '7d' ? '7天' : '30天'}
                  </button>
                ))}
              </div>
            </div>

            {timelineData.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                暂无趋势数据
              </div>
            ) : (
              <div className="mt-4">
                {/* 简单的柱状图展示 */}
                <div className="flex items-end justify-between gap-2 h-64">
                  {timelineData.map((point, index) => {
                    const maxValue = Math.max(...timelineData.map(p => p.value));
                    const height = (point.value / maxValue) * 100;
                    const date = new Date(point.timestamp);
                    const label =
                      selectedRange === '24h'
                        ? `${date.getHours()}时`
                        : `${date.getMonth() + 1}/${date.getDate()}`;

                    return (
                      <div
                        key={index}
                        className="flex-1 flex flex-col items-center group"
                      >
                        <div
                          className="w-full bg-blue-600 dark:bg-blue-500 rounded-t hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors relative"
                          style={{ height: `${height}%` }}
                        >
                          {/* Tooltip */}
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded py-1 px-2 whitespace-nowrap z-10">
                            {point.value}
                            <div className="text-gray-400">{label}</div>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 transform -rotate-45 origin-top-left">
                          {label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
