import { useState, useEffect } from 'react';
import {
  Calendar,
  FileText,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  Target,
  Lightbulb,
  AlertTriangle
} from 'lucide-react';
import { brainApi, type BrainDailyReport } from '../api';

// Health badge colors
const HEALTH_COLORS: Record<string, { bg: string; text: string; icon: any }> = {
  healthy: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
  warning: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: AlertTriangle },
  critical: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
  idle: { bg: 'bg-gray-100', text: 'text-gray-700', icon: Clock }
};

export default function DailyReports() {
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [reports, setReports] = useState<BrainDailyReport[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Format date for display
  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
  };

  // Navigate dates
  const goToPrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const goToNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    const today = new Date().toISOString().split('T')[0];
    if (d.toISOString().split('T')[0] <= today) {
      setSelectedDate(d.toISOString().split('T')[0]);
    }
  };

  const goToToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  // Fetch reports
  const fetchReports = async () => {
    try {
      setLoading(true);
      setError(null);

      const [reportsRes, summaryRes] = await Promise.all([
        brainApi.getDailyReportByDate(selectedDate),
        brainApi.getDailySummary(selectedDate).catch(() => ({ data: { summary: null } }))
      ]);

      setReports(reportsRes.data.reports || []);
      setSummary(summaryRes.data.summary || null);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // Trigger nightly alignment
  const handleTriggerNightly = async () => {
    try {
      setRefreshing(true);
      await brainApi.triggerNightly();
      await fetchReports();
    } catch (err: any) {
      setError(err.message || '触发失败');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [selectedDate]);

  const isToday = selectedDate === new Date().toISOString().split('T')[0];
  const projectReports = reports.filter(r => r.type === 'repo');

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-blue-500" />
            <h1 className="text-2xl font-bold text-gray-900">日报</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleTriggerNightly}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              {refreshing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              生成日报
            </button>
          </div>
        </div>

        {/* Date Navigation */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex items-center justify-between">
            <button
              onClick={goToPrevDay}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>

            <div className="flex items-center gap-4">
              <Calendar className="w-5 h-5 text-gray-400" />
              <span className="text-lg font-medium text-gray-900">
                {formatDate(selectedDate)}
              </span>
              {!isToday && (
                <button
                  onClick={goToToday}
                  className="text-sm text-blue-500 hover:text-blue-600"
                >
                  今天
                </button>
              )}
            </div>

            <button
              onClick={goToNextDay}
              disabled={isToday}
              className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            >
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span className="text-red-700">{error}</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">暂无日报数据</p>
            {isToday && (
              <button
                onClick={handleTriggerNightly}
                className="mt-4 text-blue-500 hover:text-blue-600"
              >
                点击生成今日日报
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Card */}
            {summary && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-500" />
                  汇总
                </h2>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-green-700">
                      {summary.tasks_summary?.completed_today || 0}
                    </div>
                    <div className="text-sm text-green-600">今日完成</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-blue-700">
                      {summary.tasks_summary?.in_progress || 0}
                    </div>
                    <div className="text-sm text-blue-600">进行中</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-gray-700">
                      {summary.tasks_summary?.queued || 0}
                    </div>
                    <div className="text-sm text-gray-600">排队中</div>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-red-700">
                      {summary.tasks_summary?.failed_today || 0}
                    </div>
                    <div className="text-sm text-red-600">今日失败</div>
                  </div>
                </div>

                {/* Projects Health */}
                {summary.projects_summary && (
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-500">项目状态:</span>
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="w-4 h-4" />
                      {summary.projects_summary.healthy} 健康
                    </span>
                    <span className="flex items-center gap-1 text-yellow-600">
                      <AlertTriangle className="w-4 h-4" />
                      {summary.projects_summary.warning} 警告
                    </span>
                    <span className="flex items-center gap-1 text-red-600">
                      <XCircle className="w-4 h-4" />
                      {summary.projects_summary.critical} 严重
                    </span>
                  </div>
                )}

                {/* Goals Progress */}
                {summary.goals_progress && summary.goals_progress.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      目标进度
                    </h3>
                    <div className="space-y-2">
                      {summary.goals_progress.slice(0, 5).map((goal: any) => (
                        <div key={goal.id} className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="text-sm text-gray-900">{goal.title}</div>
                            <div className="h-1.5 bg-gray-100 rounded-full mt-1">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${goal.progress || 0}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-sm text-gray-500">{goal.progress || 0}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reflections Summary */}
                {summary.reflections_summary && (
                  <div className="mt-6 flex items-center gap-6 text-sm">
                    <span className="text-gray-500">反思记录:</span>
                    <span className="flex items-center gap-1 text-red-600">
                      <AlertCircle className="w-4 h-4" />
                      {summary.reflections_summary.issues} 问题
                    </span>
                    <span className="flex items-center gap-1 text-blue-600">
                      <Lightbulb className="w-4 h-4" />
                      {summary.reflections_summary.learnings} 学习
                    </span>
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="w-4 h-4" />
                      {summary.reflections_summary.improvements} 改进
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Project Reports */}
            {projectReports.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">项目详情</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {projectReports.map(report => {
                    const content = report.content || {};
                    const health = content.health || 'idle';
                    const healthInfo = HEALTH_COLORS[health] || HEALTH_COLORS.idle;
                    const HealthIcon = healthInfo.icon;

                    return (
                      <div
                        key={report.id}
                        className="border border-gray-200 rounded-lg p-4"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-medium text-gray-900">
                            {report.project_name || '未知项目'}
                          </h3>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${healthInfo.bg} ${healthInfo.text}`}>
                            <HealthIcon className="w-3 h-3" />
                            {health}
                          </span>
                        </div>

                        {content.summary && (
                          <div className="grid grid-cols-4 gap-2 text-center text-sm">
                            <div>
                              <div className="font-medium text-green-600">
                                {content.summary.completed_today || 0}
                              </div>
                              <div className="text-xs text-gray-500">完成</div>
                            </div>
                            <div>
                              <div className="font-medium text-blue-600">
                                {content.summary.in_progress || 0}
                              </div>
                              <div className="text-xs text-gray-500">进行中</div>
                            </div>
                            <div>
                              <div className="font-medium text-gray-600">
                                {content.summary.queued || 0}
                              </div>
                              <div className="text-xs text-gray-500">排队</div>
                            </div>
                            <div>
                              <div className="font-medium text-red-600">
                                {content.summary.failed_today || 0}
                              </div>
                              <div className="text-xs text-gray-500">失败</div>
                            </div>
                          </div>
                        )}

                        {content.lead_agent && (
                          <div className="mt-3 text-xs text-gray-500">
                            主管: {content.lead_agent}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
