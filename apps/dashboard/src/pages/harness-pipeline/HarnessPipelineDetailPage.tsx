/**
 * HarnessPipelineDetailPage — Harness Pipeline 全链路详情
 * 路由：/pipeline/:id
 *
 * 展示单个 Pipeline 的完整执行链路：
 * - 阶段时间线概览
 * - 串行步骤列表（按时间排序）
 * - 点击步骤展开三栏视图：Input | Prompt | Output
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PipelineStep {
  step: number;
  task_id: string;
  task_type: string;
  label: string;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  verdict: string | null;
  pr_url: string | null;
  error_message: string | null;
  input_content: string | null;
  prompt_content: string | null;
  output_content: string | null;
}

interface DetailStage {
  task_type: string;
  label: string;
  status: string;
  task_id: string | null;
  title: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  pr_url: string | null;
  result: Record<string, unknown> | null;
  count: number;
}

interface PipelineDetail {
  planner_task_id: string;
  title: string;
  description: string;
  user_input: string;
  sprint_dir: string;
  status: string;
  created_at: string | null;
  stages: DetailStage[];
  steps: PipelineStep[];
  gan_rounds: unknown[];
  file_contents: Record<string, string | null>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  completed: '\u2705',
  in_progress: '\uD83D\uDD04',
  failed: '\u274C',
  queued: '\u23F3',
  not_started: '\u2014',
  canceled: '\uD83D\uDEAB',
  paused: '\u23F8',
};

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  failed: 'text-red-600 dark:text-red-400',
  queued: 'text-amber-600 dark:text-amber-400',
  not_started: 'text-slate-400 dark:text-slate-500',
  canceled: 'text-slate-500 dark:text-slate-400',
  paused: 'text-violet-600 dark:text-violet-400',
};

// ─── Utils ──────────────────────────────────────────────────────────────────

function formatDuration(startStr: string | null, endStr: string | null): string {
  if (!startStr) return '';
  const start = new Date(startStr).getTime();
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  const ms = end - start;
  if (ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Section: Stage Timeline ────────────────────────────────────────────────

function StageTimeline({ stages }: { stages: DetailStage[] }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
        阶段时间线
      </h2>
      <div className="flex items-center gap-1">
        {stages.map((stage, i) => {
          const s = stage.status in STATUS_ICON ? stage.status : 'not_started';
          return (
            <div key={stage.task_type} className="flex items-center">
              <div className="flex flex-col items-center min-w-[80px]">
                <span className="text-lg">{STATUS_ICON[s] ?? '\u2014'}</span>
                <span className={`text-xs font-medium mt-0.5 ${STATUS_COLOR[s] ?? STATUS_COLOR.not_started}`}>
                  {stage.label}
                </span>
                {stage.count > 1 && (
                  <span className="text-[10px] text-slate-400">\u00D7{stage.count}</span>
                )}
                {stage.created_at && stage.completed_at && (
                  <span className="text-[10px] text-slate-400 mt-0.5">
                    {formatDuration(stage.created_at, stage.completed_at)}
                  </span>
                )}
              </div>
              {i < stages.length - 1 && (
                <div className="w-6 h-px bg-slate-300 dark:bg-slate-600 mx-1" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section: Content Panel ─────────────────────────────────────────────────

function ContentPanel({ title, content }: { title: string; content: string | null }) {
  return (
    <div className="flex-1 min-w-0 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
          {title}
        </span>
      </div>
      <div className="p-3 max-h-[500px] overflow-y-auto bg-white dark:bg-slate-900/50">
        {content ? (
          <pre className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </pre>
        ) : (
          <div className="text-xs text-slate-400 dark:text-slate-500 italic py-4 text-center">
            暂无数据
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section: Step List ─────────────────────────────────────────────────────

function StepList({ steps }: { steps: PipelineStep[] }) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (steps.length === 0) {
    return (
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
          执行步骤
        </h2>
        <div className="text-sm text-slate-400 dark:text-slate-500 italic p-4 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg">
          此 Pipeline 尚未开始执行
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
        执行步骤 ({steps.length})
      </h2>
      <div className="space-y-2">
        {steps.map(step => {
          const isExpanded = expandedStep === step.step;
          const s = step.status in STATUS_ICON ? step.status : 'not_started';

          return (
            <div key={step.step} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedStep(isExpanded ? null : step.step)}
                className="w-full flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-400 dark:text-slate-500 w-8 text-center">
                    {step.step}
                  </span>
                  <span className="text-sm">
                    {STATUS_ICON[s] ?? '\u2014'}
                  </span>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {step.label}
                  </span>
                  <span className={`text-xs ${STATUS_COLOR[s] ?? STATUS_COLOR.not_started}`}>
                    {step.status}
                  </span>
                  {step.verdict && (
                    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                      step.verdict === 'APPROVED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                      step.verdict === 'REVISION' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                      'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}>
                      {step.verdict}
                    </span>
                  )}
                  {step.pr_url && (
                    <a
                      href={step.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-xs text-blue-500 hover:underline"
                    >
                      PR ↗
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {step.created_at && (
                    <span className="text-[10px] text-slate-400">{formatTime(step.created_at)}</span>
                  )}
                  {step.created_at && step.completed_at && (
                    <span className="text-[10px] text-slate-400">
                      {formatDuration(step.created_at, step.completed_at)}
                    </span>
                  )}
                  <span className="text-xs text-slate-400">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-200 dark:border-slate-700 p-4 bg-slate-50/50 dark:bg-slate-900/30">
                  <div className="grid grid-cols-3 gap-3">
                    <ContentPanel title="Input" content={step.input_content} />
                    <ContentPanel title="Prompt" content={step.prompt_content} />
                    <ContentPanel title="Output" content={step.output_content} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function HarnessPipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PipelineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/brain/harness/pipeline-detail?planner_task_id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json: PipelineDetail = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  if (loading && !data) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500 dark:text-slate-400">加载中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          <button
            onClick={fetchDetail}
            className="mt-2 text-xs text-red-500 hover:underline"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="max-w-5xl mx-auto">
      {/* 头部导航 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/pipeline')}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          &larr; Pipeline 列表
        </button>
      </div>

      {/* 标题区 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {data.title || '未命名 Pipeline'}
        </h1>
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
          <span className={STATUS_COLOR[data.status] || STATUS_COLOR.not_started}>
            {STATUS_ICON[data.status] || '\u2014'} {data.status}
          </span>
          {data.created_at && <span>{formatTime(data.created_at)}</span>}
          <span className="font-mono text-slate-400">{data.sprint_dir}</span>
          <button
            onClick={fetchDetail}
            disabled={loading}
            className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
          >
            {loading ? '...' : '刷新'}
          </button>
        </div>
      </div>

      {/* 阶段时间线概览 */}
      <StageTimeline stages={data.stages} />

      {/* 串行步骤列表 + 三栏钻取 */}
      <StepList steps={data.steps || []} />
    </div>
  );
}
