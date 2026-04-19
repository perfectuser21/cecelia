/**
 * HarnessPipelinePage — Harness Pipeline 可视化
 * 路由：/pipeline
 *
 * 列表源：GET /api/brain/harness-pipelines（LangGraph 模式聚合 planner task + cecelia_events）
 * - 新任务（LangGraph）：展示 current_node / last_verdict / GAN&Fix 轮次 / PR
 * - 老任务：沿用 stages[] 阶段徽章展示
 * - 顶部「新建 Pipeline」入口，调 POST /api/brain/tasks 建 harness_planner
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── 类型 ────────────────────────────────────────────────────────────────────

interface PipelineStage {
  task_type: string;
  label: string;
  status: string;
  pr_url?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

interface LangGraphSummary {
  current_node: string | null;
  current_node_label: string | null;
  last_verdict: string | null;
  review_round: number;
  eval_round: number;
  gan_rounds: number;
  fix_rounds: number;
  total_steps: number;
  pr_url: string | null;
  last_error: string | null;
  last_event_at: string | null;
}

interface Pipeline {
  pipeline_id: string;
  planner_task_id: string | null;
  sprint_dir: string | null;
  title: string;
  description?: string;
  sprint_goal?: string;
  priority?: string;
  status: string;
  verdict: string;
  current_step: string | null;
  elapsed_ms: number;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  pr_url: string | null;
  langgraph: LangGraphSummary | null;
  stages: PipelineStage[];
}

interface HarnessPipelinesResponse {
  pipelines: Pipeline[];
  total: number;
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  completed: '✅',
  in_progress: '🔄',
  failed: '❌',
  queued: '⏳',
  not_started: '—',
  canceled: '🚫',
  cancelled: '🚫',
  quarantined: '🔒',
  paused: '⏸',
};

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  failed: 'text-red-600 dark:text-red-400',
  queued: 'text-amber-600 dark:text-amber-400',
  not_started: 'text-slate-400 dark:text-slate-500',
  canceled: 'text-slate-500 dark:text-slate-400',
  cancelled: 'text-slate-500 dark:text-slate-400',
  quarantined: 'text-orange-600 dark:text-orange-400',
  paused: 'text-violet-600 dark:text-violet-400',
};

const STATUS_BG: Record<string, string> = {
  completed: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800',
  in_progress: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800',
  failed: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800',
  queued: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
  not_started: 'bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700',
  canceled: 'bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700',
  cancelled: 'bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700',
  quarantined: 'bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800',
  paused: 'bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800',
};

const VERDICT_COLOR: Record<string, string> = {
  passed: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  pending: 'text-slate-500 dark:text-slate-400',
  paused: 'text-violet-600 dark:text-violet-400',
  completed: 'text-emerald-600 dark:text-emerald-400',
};

const VERDICT_LABEL: Record<string, string> = {
  passed: '已通过',
  failed: '失败',
  in_progress: '进行中',
  pending: '待开始',
  paused: '已暂停',
  completed: '已完成',
};

const VERDICT_ICON: Record<string, string> = {
  passed: '✅',
  failed: '❌',
  in_progress: '🔄',
  pending: '⏳',
  paused: '⏸',
  completed: '✅',
};

// ─── 工具 ─────────────────────────────────────────────────────────────────────

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mrem = m % 60;
  return mrem > 0 ? `${h}h${mrem}m` : `${h}h`;
}

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffH < 24) return `${diffH} 小时前`;
  if (diffD < 7) return `${diffD} 天前`;
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function normalizeStatus(status: string): string {
  return status in STATUS_ICON ? status : 'not_started';
}

/**
 * LangGraph 摘要文案。
 * 例：「正在 Evaluator · R4: PASS · GAN 2 轮 · Fix 4 轮」
 */
export function formatLangGraphSummary(lg: LangGraphSummary, status: string): string {
  const parts: string[] = [];
  if (lg.current_node_label) {
    if (status === 'completed') {
      parts.push(`已完成 (${lg.current_node_label})`);
    } else if (['failed', 'cancelled', 'canceled', 'quarantined'].includes(status)) {
      parts.push(`已停在 ${lg.current_node_label}`);
    } else {
      parts.push(`正在 ${lg.current_node_label}`);
    }
  }
  if (lg.last_verdict) {
    const roundNo = lg.current_node === 'evaluator' ? lg.eval_round
                   : lg.current_node === 'reviewer' ? lg.review_round
                   : Math.max(lg.eval_round, lg.review_round);
    parts.push(roundNo > 0 ? `R${roundNo}: ${lg.last_verdict}` : lg.last_verdict);
  }
  if (lg.gan_rounds > 0) parts.push(`GAN ${lg.gan_rounds} 轮`);
  if (lg.fix_rounds > 0) parts.push(`Fix ${lg.fix_rounds} 轮`);
  return parts.join(' · ');
}

// ─── 组件：单阶段徽章 ─────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: PipelineStage }) {
  const s = normalizeStatus(stage.status);
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${STATUS_BG[s] ?? STATUS_BG.not_started}`}>
      <span>{STATUS_ICON[s] ?? '—'}</span>
      <span className={`font-medium ${STATUS_COLOR[s] ?? STATUS_COLOR.not_started}`}>
        {stage.label}
      </span>
      {stage.pr_url && (
        <a
          href={stage.pr_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-700 dark:text-blue-400 underline ml-1"
          onClick={e => e.stopPropagation()}
        >
          PR
        </a>
      )}
    </div>
  );
}

// ─── 组件：Pipeline 卡片 ──────────────────────────────────────────────────────

function PipelineCard({ pipeline }: { pipeline: Pipeline }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const { stages, verdict, elapsed_ms, created_at, sprint_goal, description,
          current_step, title, langgraph, status, priority, pr_url } = pipeline;

  const hasFailed = ['failed', 'cancelled', 'canceled', 'quarantined'].includes(status)
                     || stages.some(s => ['failed', 'quarantined'].includes(s.status));

  const borderColor = hasFailed
    ? 'border-red-200 dark:border-red-800'
    : verdict === 'passed'
      ? 'border-emerald-200 dark:border-emerald-800'
      : verdict === 'in_progress'
        ? 'border-blue-200 dark:border-blue-800'
        : 'border-slate-200 dark:border-slate-700';

  const overallIcon = VERDICT_ICON[verdict] ?? '⏳';
  const priorityColor = priority === 'P0' ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                         : priority === 'P2' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                         : 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300';

  const prMatch = pr_url?.match(/\/pull\/(\d+)/);
  const prNumber = prMatch ? prMatch[1] : null;

  return (
    <div className={`rounded-xl border bg-white dark:bg-slate-800 shadow-sm overflow-hidden transition-all duration-200 ${borderColor}`}>
      <div
        className="flex items-start justify-between p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-lg mt-0.5 shrink-0">{overallIcon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-900 dark:text-white text-sm leading-snug line-clamp-2">
                {title}
              </h3>
              {priority && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${priorityColor}`}>
                  {priority}
                </span>
              )}
              {langgraph && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  LangGraph
                </span>
              )}
            </div>
            {(sprint_goal || description) && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                {sprint_goal || description}
              </p>
            )}
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {formatRelativeTime(created_at)}
              </span>
              {elapsed_ms != null && elapsed_ms > 0 && (
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  耗时 {formatDuration(elapsed_ms)}
                </span>
              )}
              <span className={`text-xs font-medium ${VERDICT_COLOR[verdict] ?? VERDICT_COLOR.pending}`}>
                {VERDICT_LABEL[verdict] ?? verdict}
              </span>
              {langgraph ? (
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                  {formatLangGraphSummary(langgraph, status)}
                </span>
              ) : (
                current_step && (
                  <span className="text-xs text-blue-500 dark:text-blue-400">
                    当前: {current_step}
                  </span>
                )
              )}
              {prNumber && (
                <a
                  href={pr_url as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  onClick={e => e.stopPropagation()}
                >
                  PR #{prNumber}
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          {pipeline.planner_task_id && (
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/pipeline/${pipeline.planner_task_id}`); }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
            >
              详情 →
            </button>
          )}
          <span className="text-slate-400 dark:text-slate-500 text-xs">
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {/* 阶段徽章栏 */}
      <div className="px-4 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {stages.map(stage => (
            <StageBadge key={stage.task_type} stage={stage} />
          ))}
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 bg-slate-50/50 dark:bg-slate-900/30">
          {langgraph ? (
            <>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                LangGraph 状态
              </div>
              <div className="grid grid-cols-2 gap-y-1 text-xs mb-2">
                <div><span className="text-slate-500">当前节点：</span><span className="font-medium text-slate-700 dark:text-slate-200">{langgraph.current_node_label || '—'}</span></div>
                <div><span className="text-slate-500">最近判决：</span><span className="font-medium text-slate-700 dark:text-slate-200">{langgraph.last_verdict || '—'}</span></div>
                <div><span className="text-slate-500">GAN 轮数：</span><span className="font-medium text-slate-700 dark:text-slate-200">{langgraph.gan_rounds}</span></div>
                <div><span className="text-slate-500">Fix 轮数：</span><span className="font-medium text-slate-700 dark:text-slate-200">{langgraph.fix_rounds}</span></div>
                <div><span className="text-slate-500">总步数：</span><span className="font-medium text-slate-700 dark:text-slate-200">{langgraph.total_steps}</span></div>
                <div><span className="text-slate-500">Task ID：</span><span className="font-mono text-slate-600 dark:text-slate-300 text-[10px]">{pipeline.planner_task_id?.slice(0, 8)}</span></div>
              </div>
              {langgraph.last_error && (
                <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                  最近错误: {langgraph.last_error}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                各阶段详情（Legacy）
              </div>
              <div className="space-y-1.5">
                {stages.map(stage => {
                  const s = normalizeStatus(stage.status);
                  return (
                    <div key={stage.task_type} className="flex items-center gap-2 text-xs py-0.5">
                      <span>{STATUS_ICON[s] ?? '—'}</span>
                      <span className="text-slate-600 dark:text-slate-300 font-medium w-20 shrink-0">{stage.label}</span>
                      <span className={STATUS_COLOR[s] ?? STATUS_COLOR.not_started}>{stage.status}</span>
                      {stage.pr_url && (
                        <a href={stage.pr_url} target="_blank" rel="noopener noreferrer"
                           className="text-blue-500 hover:underline" onClick={e => e.stopPropagation()}>PR ↗</a>
                      )}
                      {stage.error_message && (
                        <span className="text-red-500 dark:text-red-400 truncate max-w-xs" title={stage.error_message}>
                          {stage.error_message.substring(0, 80)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {pipeline.sprint_dir && (
            <div className="mt-2 text-xs text-slate-400 dark:text-slate-500 font-mono">
              sprint: {pipeline.sprint_dir}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 组件：新建 Modal ─────────────────────────────────────────────────────────

function NewPipelineModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'P0' | 'P1' | 'P2'>('P1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_type: 'harness_planner',
          title: title.trim(),
          description: description.trim(),
          priority,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      const newId = data?.task?.id || data?.id || data?.task_id;
      if (!newId) throw new Error('API 没返回新任务 ID');
      onCreated(newId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md p-6 border border-slate-200 dark:border-slate-700"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">新建 Harness Pipeline</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          将创建一个 harness_planner 任务，LangGraph 自动跑 6 节点
        </p>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">标题 <span className="text-red-500">*</span></span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例如：给 Brain 新增 /version 端点"
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={200}
              disabled={submitting}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">描述（PRD） <span className="text-red-500">*</span></span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="描述目标、DoD、边界约束..."
              rows={5}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              disabled={submitting}
            />
          </label>

          <div>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">优先级</span>
            <div className="flex gap-3 mt-1">
              {(['P0', 'P1', 'P2'] as const).map(p => (
                <label key={p} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="priority"
                    value={p}
                    checked={priority === p}
                    onChange={() => setPriority(p)}
                    disabled={submitting}
                  />
                  <span className={priority === p ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-300'}>{p}</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? '创建中...' : '创建并启动'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 主页面组件 ───────────────────────────────────────────────────────────────

export default function HarnessPipelinePage() {
  const [data, setData] = useState<HarnessPipelinesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/harness-pipelines?limit=20');
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json: HarnessPipelinesResponse = await res.json();
      setData(json);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchPipelines, 15_000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchPipelines]);

  const pipelines = data?.pipelines ?? [];

  const stats = {
    total: pipelines.length,
    passed: pipelines.filter(p => p.verdict === 'passed').length,
    inProgress: pipelines.filter(p => p.verdict === 'in_progress').length,
    failed: pipelines.filter(p => p.verdict === 'failed').length,
  };

  function onCreated(id: string) {
    setShowModal(false);
    fetchPipelines();
    navigate(`/pipeline/${id}`);
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Harness Pipeline
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            GAN 对抗流水线运行状态 · 最近 20 次
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowModal(true)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-1"
          >
            <span>+</span>
            <span>新建 Pipeline</span>
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            自动刷新
          </label>
          <button
            onClick={fetchPipelines}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: '总计', value: stats.total, color: 'text-slate-700 dark:text-slate-200' },
          { label: '已通过', value: stats.passed, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: '进行中', value: stats.inProgress, color: 'text-blue-600 dark:text-blue-400' },
          { label: '失败', value: stats.failed, color: 'text-red-600 dark:text-red-400' },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 text-center"
          >
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 时间戳 */}
      <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
        最后更新：{lastRefresh.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}
        {data != null && <span className="ml-2">共 {data.total} 条</span>}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 mb-4">
          <p className="text-sm text-red-700 dark:text-red-400">加载失败：{error}</p>
          <p className="text-xs text-red-500 mt-1">
            请确认 Brain API (localhost:5221) 正在运行
          </p>
        </div>
      )}

      {/* 骨架屏 */}
      {loading && pipelines.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="flex-1">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 空状态 */}
      {!loading && pipelines.length === 0 && !error && (
        <div className="text-center py-16 text-slate-400 dark:text-slate-500">
          <div className="text-4xl mb-3">🔬</div>
          <p className="text-sm">暂无 Harness Pipeline 记录</p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-3 px-4 py-2 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            创建第一个 Pipeline
          </button>
        </div>
      )}

      {/* Pipeline 列表 */}
      <div className="space-y-3">
        {pipelines.map(pipeline => (
          <PipelineCard
            key={pipeline.pipeline_id}
            pipeline={pipeline}
          />
        ))}
      </div>

      {/* 新建 Modal */}
      {showModal && (
        <NewPipelineModal
          onClose={() => setShowModal(false)}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}
