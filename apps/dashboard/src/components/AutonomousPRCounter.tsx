import React, { useState, useEffect } from 'react';

interface AutonomousPRStats {
  completed_count: number;
  target: number;
  month: string;
  percentage: number;
}

interface AutonomousPRCounterProps {
  refreshInterval?: number; // ms，默认 60000 (1分钟)
}

function getColorClass(percentage: number): { bar: string; text: string } {
  if (percentage >= 70) {
    return { bar: 'bg-green-500', text: 'text-green-600' };
  } else if (percentage >= 30) {
    return { bar: 'bg-yellow-500', text: 'text-yellow-600' };
  } else {
    return { bar: 'bg-red-500', text: 'text-red-600' };
  }
}

export const AutonomousPRCounter: React.FC<AutonomousPRCounterProps> = ({
  refreshInterval = 60000,
}) => {
  const [stats, setStats] = useState<AutonomousPRStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/brain/stats/autonomous-prs');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: AutonomousPRStats = await res.json();
      setStats(data);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError('数据加载失败');
      console.error('[AutonomousPRCounter] fetch error:', err);
    }
  };

  useEffect(() => {
    fetchStats();
    const timer = setInterval(fetchStats, refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval]);

  if (error && !stats) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  const colors = stats ? getColorClass(stats.percentage) : { bar: 'bg-gray-300', text: 'text-gray-500' };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          本月自主 PR
        </h3>
        {stats && (
          <span className={`text-lg font-bold ${colors.text}`}>
            {stats.completed_count} / {stats.target}
          </span>
        )}
      </div>

      {/* 进度条 */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-2">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${colors.bar}`}
          style={{ width: `${stats ? stats.percentage : 0}%` }}
          role="progressbar"
          aria-valuenow={stats?.percentage ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span className={`font-medium ${colors.text}`}>
          {stats ? `${stats.percentage}%` : '--'}
        </span>
        <span>
          {stats
            ? `还差 ${Math.max(0, stats.target - stats.completed_count)} 个`
            : '加载中...'}
        </span>
      </div>

      {lastUpdated && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {stats?.month} · 每分钟更新
        </p>
      )}
    </div>
  );
};

export default AutonomousPRCounter;
