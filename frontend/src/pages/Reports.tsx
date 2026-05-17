import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  RefreshCw,
  Loader2,
  AlertCircle,
  ChevronRight
} from 'lucide-react';
import { brainApi, type SystemReport } from '../api';

const REPORT_TYPE_LABELS: Record<string, string> = {
  '48h_summary': '48h 系统简报',
  '48h_briefing': '48h 系统简报',
  'weekly_summary': '周度简报',
};

function formatDateTime(isoString: string) {
  const d = new Date(isoString);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Reports() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<SystemReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchReports = async (showRefreshing = false) => {
    try {
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const res = await brainApi.getSystemReports({ limit: 50 });
      setReports(res.data.reports || []);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-semibold text-gray-900">系统简报</h1>
        </div>
        <button
          onClick={() => fetchReports(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 加载中 */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}

      {/* 错误 */}
      {!loading && error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => fetchReports()}
            className="ml-auto text-sm underline hover:no-underline"
          >
            重试
          </button>
        </div>
      )}

      {/* 空状态 */}
      {!loading && !error && reports.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <FileText className="w-12 h-12 mb-3" />
          <p className="text-lg font-medium">暂无简报</p>
          <p className="text-sm mt-1">系统简报将在 tick 触发后自动生成</p>
        </div>
      )}

      {/* 简报列表 */}
      {!loading && !error && reports.length > 0 && (
        <div className="space-y-3">
          {reports.map((report) => {
            const typeLabel = REPORT_TYPE_LABELS[report.type] || report.type;
            const trigger = report.metadata?.trigger || 'auto';

            return (
              <button
                key={report.id}
                onClick={() => navigate(`/reports/${report.id}`)}
                className="w-full flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all text-left"
              >
                {/* 类型图标 */}
                <div className="flex-shrink-0 w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>

                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 truncate">{typeLabel}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      {trigger === 'manual' ? '手动触发' : '自动触发'}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500">
                    生成于 {formatDateTime(report.created_at)}
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
