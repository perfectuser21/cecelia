/**
 * ProjectCompare - 项目并排对比页面
 * 路由: /projects/compare
 * API: GET /api/tasks/projects + POST /api/brain/projects/compare/report
 */

import { useState, useEffect, useCallback } from 'react';
import { GitCompare, TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
  progress?: number;
}

interface ProjectStrength {
  aspect: string;
  detail: string;
}

interface ProjectWeakness {
  aspect: string;
  detail: string;
}

interface ProjectCompareSummary {
  project_id: string;
  project_name: string;
  overall_score: number;
  health_score: number;
  velocity_score: number;
  task_stats: {
    total: number;
    completed: number;
    in_progress: number;
    blocked: number;
  };
  strengths: ProjectStrength[];
  weaknesses: ProjectWeakness[];
  recommendation: string;
}

interface CompareReport {
  projects: ProjectCompareSummary[];
  winner?: string;
  summary: string;
  generated_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  active:      'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  in_progress: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  pending:     'bg-slate-500/20 text-slate-400 border border-slate-500/30',
  completed:   'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  paused:      'bg-amber-500/20 text-amber-300 border border-amber-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  active: '活跃', in_progress: '进行中', pending: '待开始', completed: '已完成', paused: '暂停',
};

function ScoreBar({ value, max = 100, color = 'bg-purple-500' }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-300 w-8 text-right font-mono">{Math.round(value)}</span>
    </div>
  );
}

function ScoreLabel({ score }: { score: number }) {
  if (score >= 80) return <span className="text-emerald-400 font-semibold">{score}</span>;
  if (score >= 60) return <span className="text-amber-400 font-semibold">{score}</span>;
  return <span className="text-red-400 font-semibold">{score}</span>;
}

function CompareCard({ summary, isWinner }: { summary: ProjectCompareSummary; isWinner: boolean }) {
  const completionRate = summary.task_stats.total > 0
    ? Math.round((summary.task_stats.completed / summary.task_stats.total) * 100)
    : 0;

  return (
    <div className={`flex flex-col bg-slate-800/50 rounded-lg border ${isWinner ? 'border-purple-500/60' : 'border-slate-700/60'} overflow-hidden min-w-0`}>
      {/* 卡片头 */}
      <div className={`px-4 py-3 ${isWinner ? 'bg-purple-900/30' : 'bg-slate-800/30'} border-b border-slate-700/40`}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-100 leading-tight break-words">{summary.project_name}</h3>
          {isWinner && (
            <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-300 border border-purple-500/40">
              领先
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-3xl font-bold"><ScoreLabel score={Math.round(summary.overall_score)} /></span>
          <span className="text-xs text-slate-500">综合评分 / 100</span>
        </div>
      </div>

      {/* 评分详情 */}
      <div className="px-4 py-3 border-b border-slate-700/40 space-y-2">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">评分细项</p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-16 shrink-0">健康度</span>
            <ScoreBar value={summary.health_score} color="bg-emerald-500" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-16 shrink-0">速度</span>
            <ScoreBar value={summary.velocity_score} color="bg-blue-500" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-16 shrink-0">完成率</span>
            <ScoreBar value={completionRate} color="bg-purple-500" />
          </div>
        </div>
      </div>

      {/* 任务统计 */}
      <div className="px-4 py-3 border-b border-slate-700/40">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">任务统计</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-700/30 rounded px-2 py-1.5 text-center">
            <div className="text-lg font-bold text-gray-100">{summary.task_stats.total}</div>
            <div className="text-xs text-slate-500">总任务</div>
          </div>
          <div className="bg-emerald-900/20 rounded px-2 py-1.5 text-center">
            <div className="text-lg font-bold text-emerald-400">{summary.task_stats.completed}</div>
            <div className="text-xs text-slate-500">已完成</div>
          </div>
          <div className="bg-blue-900/20 rounded px-2 py-1.5 text-center">
            <div className="text-lg font-bold text-blue-400">{summary.task_stats.in_progress}</div>
            <div className="text-xs text-slate-500">进行中</div>
          </div>
          <div className="bg-red-900/20 rounded px-2 py-1.5 text-center">
            <div className="text-lg font-bold text-red-400">{summary.task_stats.blocked ?? 0}</div>
            <div className="text-xs text-slate-500">阻塞</div>
          </div>
        </div>
      </div>

      {/* 优势 */}
      {summary.strengths && summary.strengths.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-700/40">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-400" /> 优势
          </p>
          <ul className="space-y-1">
            {summary.strengths.slice(0, 3).map((s, i) => (
              <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                <span>{s.detail || s.aspect}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 劣势 */}
      {summary.weaknesses && summary.weaknesses.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-700/40">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <TrendingDown className="w-3 h-3 text-red-400" /> 劣势
          </p>
          <ul className="space-y-1">
            {summary.weaknesses.slice(0, 3).map((w, i) => (
              <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                <AlertCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                <span>{w.detail || w.aspect}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 建议 */}
      {summary.recommendation && (
        <div className="px-4 py-3 flex-1">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Minus className="w-3 h-3" /> 建议
          </p>
          <p className="text-xs text-slate-300 leading-relaxed">{summary.recommendation}</p>
        </div>
      )}
    </div>
  );
}

export default function ProjectCompare() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [report, setReport] = useState<CompareReport | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 加载项目列表
  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/tasks/projects?limit=2000');
      const data: Project[] = res.ok ? await res.json() : [];
      setProjects(data.filter(p => p.type === 'project'));
    } catch {
      setError('项目列表加载失败');
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  // 多选切换
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 4) return prev; // 最多 4 个
      return [...prev, id];
    });
    // 清空上次报告
    setReport(null);
    setError(null);
  };

  // 生成对比报告
  const handleCompare = async () => {
    if (selectedIds.length < 2) return;
    setLoadingReport(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/projects/compare/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_ids: selectedIds }),
      });
      if (!res.ok) throw new Error(`请求失败: ${res.status}`);
      const data: CompareReport = await res.json();
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '对比报告获取失败');
    } finally {
      setLoadingReport(false);
    }
  };

  const canCompare = selectedIds.length >= 2 && !loadingReport;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-900">
      {/* 页面头 */}
      <div className="shrink-0 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompare className="w-5 h-5 text-purple-400" />
          <h1 className="text-base font-semibold text-gray-100">项目对比</h1>
          <span className="text-xs text-slate-500 ml-1">选择 2-4 个项目并排对比</span>
        </div>
        <button
          onClick={handleCompare}
          disabled={!canCompare}
          className="flex items-center gap-2 px-4 py-1.5 text-sm rounded-md bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white transition-colors"
        >
          {loadingReport && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          生成对比报告
          {selectedIds.length > 0 && <span className="text-purple-300 text-xs">({selectedIds.length}/4)</span>}
        </button>
      </div>

      {/* 项目多选区 */}
      <div className="shrink-0 px-6 py-3 border-b border-slate-800">
        {loadingProjects ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载项目列表…
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {projects.map(p => {
              const isSelected = selectedIds.includes(p.id);
              const isDisabled = !isSelected && selectedIds.length >= 4;
              return (
                <button
                  key={p.id}
                  onClick={() => !isDisabled && toggleSelect(p.id)}
                  disabled={isDisabled}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-all ${
                    isSelected
                      ? 'bg-purple-600/30 border-purple-500/60 text-purple-200'
                      : isDisabled
                        ? 'bg-slate-800/30 border-slate-700/30 text-slate-600 cursor-not-allowed'
                        : 'bg-slate-800/50 border-slate-700/50 text-slate-300 hover:border-purple-500/40 hover:text-purple-300'
                  }`}
                >
                  {isSelected && <CheckCircle2 className="w-3 h-3 text-purple-400" />}
                  <span>{p.name}</span>
                  <span className={`text-xs px-1 py-0.5 rounded ${STATUS_COLORS[p.status] ?? STATUS_COLORS.pending}`}>
                    {STATUS_LABELS[p.status] ?? p.status}
                  </span>
                </button>
              );
            })}
            {projects.length === 0 && (
              <span className="text-sm text-slate-500">暂无 Project 数据</span>
            )}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="shrink-0 mx-6 mt-3 px-4 py-2.5 rounded-md bg-red-900/20 border border-red-700/40 text-sm text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-200 text-xs underline">关闭</button>
        </div>
      )}

      {/* 对比内容区 */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {/* 空态提示 */}
        {!report && !loadingReport && selectedIds.length < 2 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3">
            <GitCompare className="w-12 h-12 text-slate-600" />
            <p className="text-slate-500 text-sm">请在上方选择 2-4 个项目，然后点击「生成对比报告」</p>
          </div>
        )}

        {/* 加载中 */}
        {loadingReport && (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            <p className="text-slate-400 text-sm">正在生成对比报告…</p>
          </div>
        )}

        {/* 对比结果 */}
        {report && !loadingReport && (
          <div className="space-y-4">
            {/* 总结 */}
            {report.summary && (
              <div className="px-4 py-3 rounded-lg bg-slate-800/40 border border-slate-700/40 text-sm text-slate-300">
                <span className="text-slate-500 mr-2">总结：</span>{report.summary}
              </div>
            )}

            {/* 并排卡片 */}
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${report.projects.length}, minmax(0, 1fr))` }}
            >
              {report.projects.map(summary => (
                <CompareCard
                  key={summary.project_id}
                  summary={summary}
                  isWinner={report.winner === summary.project_id}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
