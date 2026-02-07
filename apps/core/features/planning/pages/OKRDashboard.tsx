/**
 * OKR Dashboard - 季度总览 + Areas 卡片
 */

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';
import { SkeletonCard } from '../../shared/components/LoadingState';

interface Goal {
  id: string;
  parent_id: string | null;
  title: string;
  status: string;
  priority: string;
  progress: number;
  business_id: string | null;
  project_id: string | null;
  department_id: string | null;
  expected_start_date: string | null;
  expected_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  business?: {
    id: string;
    name: string;
  };
}

interface Business {
  id: string;
  name: string;
}

// 从日期计算季度
function getQuarterFromDate(date: string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return `${year} Q${quarter}`;
}

// 计算延迟天数
function calculateDelay(expected: string | null, actual: string | null): number {
  if (!expected || !actual) return 0;
  const exp = new Date(expected).getTime();
  const act = new Date(actual).getTime();
  return Math.floor((act - exp) / (1000 * 60 * 60 * 24));
}

// 计算平均进度
function calculateAvgProgress(goals: Goal[]): number {
  if (goals.length === 0) return 0;
  const total = goals.reduce((sum, goal) => sum + goal.progress, 0);
  return Math.round(total / goals.length);
}

export default function OKRDashboard() {
  const navigate = useNavigate();

  // 获取所有 goals
  const { data: allGoals, loading: goalsLoading } = useApi<Goal[]>('/api/tasks/goals', {
    fetcher: async () => {
      const response = await fetch('/api/tasks/goals');
      if (!response.ok) throw new Error('Failed to fetch goals');
      return response.json();
    },
  });

  // 获取所有 businesses（作为 Areas）
  const { data: businesses, loading: businessesLoading } = useApi<Business[]>('/api/tasks/businesses', {
    fetcher: async () => {
      const response = await fetch('/api/tasks/businesses');
      if (!response.ok) throw new Error('Failed to fetch businesses');
      return response.json();
    },
  });

  // 当前季度（从第一个 goal 的日期计算，或使用当前日期）
  const [currentQuarter, setCurrentQuarter] = useState<string>(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const quarter = Math.ceil(month / 3);
    return `${year} Q${quarter}`;
  });

  // 过滤当前季度的 goals
  const quarterGoals = useMemo(() => {
    if (!allGoals) return [];
    return allGoals.filter(goal => {
      if (!goal.expected_start_date) return false;
      const goalQuarter = getQuarterFromDate(goal.expected_start_date);
      return goalQuarter === currentQuarter;
    });
  }, [allGoals, currentQuarter]);

  // 只获取 Area 层级的 goals（有 business_id，没有 project_id）
  const areaGoals = useMemo(() => {
    return quarterGoals.filter(goal => goal.business_id && !goal.project_id);
  }, [quarterGoals]);

  // 按 Area 分组
  const goalsByArea = useMemo(() => {
    const map = new Map<string, Goal[]>();
    areaGoals.forEach(goal => {
      const areaId = goal.business_id!;
      if (!map.has(areaId)) {
        map.set(areaId, []);
      }
      map.get(areaId)!.push(goal);
    });
    return map;
  }, [areaGoals]);

  // 整体统计
  const stats = useMemo(() => {
    const totalOkrs = quarterGoals.length;
    const avgProgress = calculateAvgProgress(quarterGoals);

    // 计算延迟（只统计已完成的 OKR）
    const completedGoals = quarterGoals.filter(g => g.actual_end_date);
    const delays = completedGoals.map(g =>
      calculateDelay(g.expected_end_date, g.actual_end_date)
    );
    const avgDelay = delays.length > 0
      ? Math.round(delays.reduce((sum, d) => sum + d, 0) / delays.length)
      : 0;

    return { totalOkrs, avgProgress, avgDelay };
  }, [quarterGoals]);

  // 季度切换
  const changeQuarter = (direction: 'prev' | 'next') => {
    const [yearStr, qStr] = currentQuarter.split(' Q');
    let year = parseInt(yearStr);
    let quarter = parseInt(qStr);

    if (direction === 'next') {
      quarter++;
      if (quarter > 4) {
        quarter = 1;
        year++;
      }
    } else {
      quarter--;
      if (quarter < 1) {
        quarter = 4;
        year--;
      }
    }

    setCurrentQuarter(`${year} Q${quarter}`);
  };

  if (goalsLoading || businessesLoading) {
    return (
      <div className="p-6">
        <SkeletonCard count={3} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* 标题 + 季度选择器 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">
          {currentQuarter} OKR Dashboard
        </h1>

        <div className="flex items-center gap-2">
          <button
            onClick={() => changeQuarter('prev')}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <span className="px-4 py-2 bg-gray-100 rounded-lg text-sm font-medium text-gray-700">
            {currentQuarter}
          </span>
          <button
            onClick={() => changeQuarter('next')}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* 整体统计 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="text-sm text-gray-500 mb-1">Total OKRs</div>
            <div className="text-3xl font-semibold text-gray-900">{stats.totalOkrs}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-1">Average Progress</div>
            <div className="text-3xl font-semibold text-gray-900">{stats.avgProgress}%</div>
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-1">Average Delay</div>
            <div className={`text-3xl font-semibold ${
              stats.avgDelay > 0 ? 'text-red-600' :
              stats.avgDelay < 0 ? 'text-green-600' :
              'text-gray-900'
            }`}>
              {stats.avgDelay > 0 ? `+${stats.avgDelay}` : stats.avgDelay} days
            </div>
          </div>
        </div>
      </div>

      {/* Areas 卡片 */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Areas</h2>

        {businesses && businesses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {businesses.map(business => {
              const areaOkrs = goalsByArea.get(business.id) || [];
              const avgProgress = calculateAvgProgress(areaOkrs);
              const completedOkrs = areaOkrs.filter(g => g.actual_end_date);
              const delays = completedOkrs.map(g =>
                calculateDelay(g.expected_end_date, g.actual_end_date)
              );
              const avgDelay = delays.length > 0
                ? Math.round(delays.reduce((sum, d) => sum + d, 0) / delays.length)
                : 0;

              return (
                <div
                  key={business.id}
                  onClick={() => navigate(`/work/okr/area/${business.id}`)}
                  className="bg-white rounded-lg border border-gray-200 p-6 hover:border-blue-500 hover:shadow-lg transition-all cursor-pointer"
                >
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    {business.name}
                  </h3>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">OKRs</span>
                      <span className="font-semibold text-gray-900">{areaOkrs.length}</span>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-gray-500">Progress</span>
                        <span className="font-semibold text-gray-900">{avgProgress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${avgProgress}%` }}
                        />
                      </div>
                    </div>

                    {avgDelay !== 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Delay</span>
                        <span className={`font-semibold ${
                          avgDelay > 0 ? 'text-red-600' : 'text-green-600'
                        }`}>
                          {avgDelay > 0 ? `+${avgDelay}` : avgDelay} days
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg border border-gray-200">
            No areas found. Create some to get started.
          </div>
        )}
      </div>
    </div>
  );
}
