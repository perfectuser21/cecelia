/**
 * ProjectCompare - 并排对比 2-4 个项目
 * API: GET /api/tasks/projects + POST /api/brain/projects/compare/report
 */

import { useState, useEffect, useCallback } from 'react';
import { BarChart2, CheckCircle2, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
  progress?: number;
}

interface TaskStats {
  total: number;
  completed: number;
  in_progress: number;
  queued: number;
  completion_rate: number;
}

interface ProjectReport {
  id: string;
  name: string;
  type: string;
  status: string;
  score: number;
  task_stats: TaskStats;
  strengths: string[];
  weaknesses: string[];
}

interface CompareResult {
  generated_at: string;
  projects: ProjectReport[];
  summary: string;
}

const STATUS_COLORS: Record<string, string> = {
  active:      'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  in_progress: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  pending:     'bg-slate-500/20 text-slate-400 border border-slate-500/30',
  completed:   'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  paused:      'bg-amber-500/20 text-amber-300 border border-amber-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  active: '活跃', in_progress: '进行中', pending: '待开始',
  completed: '已完成', paused: '暂停',
};

function ScoreMeter({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-3xl font-bold tabular-nums ${textColor}`}>{score}</span>
      <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-slate-500">综合评分</span>
    </div>
  );
}

function StatRow({ label, value, total }: { label: string; value: number; total?: number }) {
  const pct = total && total > 0 ? Math.round((value / total) * 100) : null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 tabular-nums">
        {value}
        {pct !== null && <span className="text-slate-500 ml-1 text-xs">({pct}%)</span>}
      </span>
    </div>
  );
}

function ProjectCard({ report, rank }: { report: ProjectReport; rank: number }) {
  const pct = Math.round(report.task_stats.completion_rate * 100);
  return (
    <div className="flex flex-col bg-slate-800/50 border border-slate-700/60 rounded-xl p-5 gap-4 min-w-0">
      {/* 排名 + 名称 */}
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-7 h-7 rounded-full bg-purple-600/30 text-purple-300 text-xs font-bold flex items-center justify-center">
          #{rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-100 leading-snug truncate" title={report.name}>{report.name}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[report.status] ?? STATUS_COLORS.pending}`}>
              {STATUS_LABELS[report.status] ?? report.status}
            </span>
            <span className="text-xs text-slate-500 capitalize">{report.type}</span>
          </div>
        </div>
      </div>

      {/* 评分 */}
      <ScoreMeter score={report.score} />

      {/* 进度条 */}
      <div>
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>完成率</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-purple-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* 任务统计 */}
      <div className="flex flex-col gap-1.5 border-t border-slate-700/50 pt-3">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-0.5">任务统计</span>
        <StatRow label="总计" value={report.task_stats.total} />
        <StatRow label="已完成" value={report.task_stats.completed} total={report.task_stats.total} />
        <StatRow label="进行中" value={report.task_stats.in_progress} />
        <StatRow label="队列中" value={report.task_stats.queued} />
      </div>

      {/* 优势 */}
      <div className="border-t border-slate-700/50 pt-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 mb-2">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>优势</span>
        </div>
        <ul className="flex flex-col gap-1">
          {report.strengths.map((s, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 劣势 */}
      <div className="border-t border-slate-700/50 pt-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-red-400 mb-2">
          <TrendingDown className="w-3.5 h-3.5" />
          <span>劣势</span>
        </div>
        <ul className="flex flex-col gap-1">
          {report.weaknesses.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
              <AlertCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function ProjectCompare() {
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);

  // 加载项目列表
  useEffect(() => {
    fetch('/api/tasks/projects?limit=500')
      .then(r => r.ok ? r.json() : [])
      .then((data: Project[]) => setAllProjects(data.filter(p => p.type === 'project' || p.type === 'initiative')))
      .catch(() => setAllProjects([]));
  }, []);

  const toggleProject = useCallback((id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 4) return prev; // 最多 4 个
      return [...prev, id];
    });
    setResult(null);
  }, []);

  const handleCompare = useCallback(async () => {
    if (selectedIds.length < 2) return;
    setComparing(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/brain/projects/compare/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_ids: selectedIds, format: 'json' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error ?? '请求失败');
      }
      setResult(await res.json());
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : '未知错误');
    } finally {
      setComparing(false);
    }
  }, [selectedIds]);

  const canCompare = selectedIds.length >= 2 && !comparing;

  if (loading) {
    return <div className="h-full flex items-center justify-center text-slate-500 text-sm">加载中…</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <div className="shrink-0 px-5 py-3.5 border-b border-slate-800 bg-slate-900/50 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-slate-200">
          <BarChart2 className="w-4 h-4 text-purple-400" />
          <span className="font-medium text-sm">项目并排对比</span>
        </div>
        <span className="text-xs text-slate-500">选择 2-4 个项目后点击「开始对比」</span>
        <div className="ml-auto flex items-center gap-3">
          {selectedIds.length > 0 && (
            <button
              onClick={() => { setSelectedIds([]); setResult(null); }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              清空选择
            </button>
          )}
          <button
            onClick={handleCompare}
            disabled={!canCompare}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors"
          >
            {comparing ? '对比中…' : `开始对比（${selectedIds.length}/4）`}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧项目列表 */}
        <div className="w-64 shrink-0 border-r border-slate-800 flex flex-col overflow-hidden">
          <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800">
            选择项目
          </div>
          <div className="flex-1 overflow-auto">
            {allProjects.length === 0 && (
              <div className="flex items-center justify-center h-20 text-slate-600 text-xs">暂无项目</div>
            )}
            {allProjects.map(proj => {
              const selected = selectedIds.includes(proj.id);
              const disabled = !selected && selectedIds.length >= 4;
              return (
                <button
                  key={proj.id}
                  onClick={() => !disabled && toggleProject(proj.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-slate-800/50 transition-colors text-sm
                    ${selected ? 'bg-purple-600/20 text-purple-200' : disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-800/40 text-slate-300'}`}
                >
                  <span className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center text-xs
                    ${selected ? 'border-purple-500 bg-purple-500/30 text-purple-300' : 'border-slate-600'}`}>
                    {selected && '✓'}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{proj.name}</span>
                  <span className="shrink-0 text-xs text-slate-600 capitalize">{proj.type === 'initiative' ? 'Ini' : 'Proj'}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 右侧对比区域 */}
        <div className="flex-1 overflow-auto p-5">
          {fetchError && (
            <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {fetchError}
            </div>
          )}

          {!result && !fetchError && (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2">
              <BarChart2 className="w-10 h-10 opacity-30" />
              <span className="text-sm">选择 2-4 个项目后点击「开始对比」</span>
            </div>
          )}

          {result && (
            <>
              {/* 总结 */}
              <div className="mb-5 px-4 py-3 bg-slate-800/60 border border-slate-700/50 rounded-xl text-sm text-slate-300">
                <span className="text-slate-500 text-xs mr-2">总结</span>
                {result.summary}
              </div>

              {/* 并排卡片 */}
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: `repeat(${result.projects.length}, minmax(220px, 1fr))` }}
              >
                {result.projects.map((p, i) => (
                  <ProjectCard key={p.id} report={p} rank={i + 1} />
                ))}
              </div>

              <div className="mt-3 text-xs text-slate-700 text-right">
                生成时间：{new Date(result.generated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
