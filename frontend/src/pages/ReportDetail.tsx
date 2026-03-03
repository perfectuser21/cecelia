import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FileText,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle,
  BarChart3,
  Target,
  AlertTriangle,
  Activity,
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
    second: '2-digit',
  });
}

function SectionCard({ icon: Icon, title, children, iconColor = 'text-blue-600', bgColor = 'bg-blue-50' }: {
  icon: any;
  title: string;
  children: React.ReactNode;
  iconColor?: string;
  bgColor?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <div className={`w-7 h-7 ${bgColor} rounded-md flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
        <h3 className="font-medium text-gray-900">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function KrProgressSection({ krProgress }: { krProgress: any[] }) {
  if (!krProgress || krProgress.length === 0) {
    return <p className="text-gray-500 text-sm">暂无 KR 进度数据</p>;
  }
  return (
    <div className="space-y-3">
      {krProgress.map((kr: any, idx: number) => (
        <div key={idx}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-700 truncate">{kr.title || kr.name || `KR ${idx + 1}`}</span>
            <span className="text-sm font-medium text-gray-900 ml-2">{kr.progress ?? kr.percentage ?? 0}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all"
              style={{ width: `${Math.min(100, kr.progress ?? kr.percentage ?? 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskStatsSection({ taskStats }: { taskStats: any }) {
  if (!taskStats) return <p className="text-gray-500 text-sm">暂无任务统计数据</p>;

  const stats = [
    { label: '已完成', value: taskStats.completed ?? 0, color: 'text-green-600' },
    { label: '进行中', value: taskStats.in_progress ?? 0, color: 'text-blue-600' },
    { label: '队列中', value: taskStats.queued ?? 0, color: 'text-yellow-600' },
    { label: '失败', value: taskStats.failed ?? 0, color: 'text-red-600' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((stat) => (
        <div key={stat.label} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
          <span className="text-sm text-gray-600">{stat.label}</span>
          <span className={`text-lg font-bold ${stat.color}`}>{stat.value}</span>
        </div>
      ))}
    </div>
  );
}

function SystemHealthSection({ systemHealth }: { systemHealth: any }) {
  if (!systemHealth) return <p className="text-gray-500 text-sm">暂无系统健康数据</p>;
  return (
    <div className="space-y-2">
      {Object.entries(systemHealth).map(([key, value]: [string, any]) => (
        <div key={key} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
          <span className="text-sm text-gray-600">{key}</span>
          <span className="text-sm font-medium text-gray-900">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function AnomaliesSection({ anomalies }: { anomalies: any[] }) {
  if (!anomalies || anomalies.length === 0) {
    return (
      <div className="flex items-center gap-2 text-green-600">
        <CheckCircle className="w-4 h-4" />
        <span className="text-sm">无异常</span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {anomalies.map((item: any, idx: number) => (
        <div key={idx} className="flex items-start gap-2 p-2 bg-red-50 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <span className="text-sm text-red-700">{typeof item === 'string' ? item : JSON.stringify(item)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<SystemReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetchReport = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await brainApi.getSystemReport(id);
        setReport(res.data.report);
      } catch (err: any) {
        if (err.response?.status === 404) {
          setError('简报不存在');
        } else {
          setError(err.message || '加载失败');
        }
      } finally {
        setLoading(false);
      }
    };
    fetchReport();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button onClick={() => navigate('/reports')} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" />
          返回列表
        </button>
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error || '简报不存在'}</span>
        </div>
      </div>
    );
  }

  const typeLabel = REPORT_TYPE_LABELS[report.type] || report.type;
  const content = report.content || {};
  const metadata = report.metadata || {};
  const trigger = metadata.trigger || 'auto';

  // 解析简报内容字段（兼容不同结构）
  const tasksSummary = content.tasks_summary || content.task_stats || content.tasks || null;
  const systemHealth = content.system_health || content.health || null;
  const anomalies: any[] = content.anomalies || content.risks || content.alerts || [];
  const summary: string = content.summary || content.text || '';
  const periodHours: number = content.period_hours || 48;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 返回按钮 */}
      <button
        onClick={() => navigate('/reports')}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6 text-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        返回列表
      </button>

      {/* 报告头部 */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{typeLabel}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              生成于 {formatDateTime(report.created_at)}
              {periodHours && ` · 覆盖最近 ${periodHours}h`}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
          {trigger === 'manual' ? '手动触发' : '自动触发'}
        </span>
      </div>

      {/* 摘要（如有） */}
      {summary && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-100 rounded-lg text-blue-900 text-sm leading-relaxed">
          {summary}
        </div>
      )}

      {/* 内容区域 */}
      <div className="space-y-4">
        {/* 任务统计 */}
        <SectionCard icon={BarChart3} title="任务统计" iconColor="text-blue-600" bgColor="bg-blue-50">
          <TaskStatsSection taskStats={tasksSummary} />
        </SectionCard>

        {/* 系统健康 */}
        <SectionCard icon={Activity} title="系统健康" iconColor="text-green-600" bgColor="bg-green-50">
          <SystemHealthSection systemHealth={systemHealth} />
        </SectionCard>

        {/* 异常和风险 */}
        <SectionCard icon={AlertTriangle} title="异常和风险" iconColor="text-orange-600" bgColor="bg-orange-50">
          <AnomaliesSection anomalies={anomalies} />
        </SectionCard>

        {/* KR 进度（如有） */}
        {content.kr_progress && (
          <SectionCard icon={Target} title="KR 进度" iconColor="text-purple-600" bgColor="bg-purple-50">
            <KrProgressSection krProgress={content.kr_progress} />
          </SectionCard>
        )}

        {/* 元数据 */}
        {Object.keys(metadata).length > 0 && (
          <SectionCard icon={FileText} title="生成元数据" iconColor="text-gray-600" bgColor="bg-gray-50">
            <div className="space-y-1">
              {Object.entries(metadata).map(([key, value]: [string, any]) => (
                <div key={key} className="flex items-center justify-between py-0.5">
                  <span className="text-sm text-gray-500">{key}</span>
                  <span className="text-sm text-gray-800">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* 原始数据（仅在内容结构未匹配时展示） */}
        {Object.keys(content).length > 0 && !tasksSummary && !systemHealth && !anomalies.length && !summary && (
          <SectionCard icon={FileText} title="简报原始数据" iconColor="text-gray-600" bgColor="bg-gray-50">
            <pre className="text-xs text-gray-600 overflow-auto max-h-64">
              {JSON.stringify(content, null, 2)}
            </pre>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
