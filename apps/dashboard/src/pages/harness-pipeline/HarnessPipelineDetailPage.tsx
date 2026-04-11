/**
 * HarnessPipelineDetailPage — Harness Pipeline 全链路详情
 * 路由：/pipeline/:id
 *
 * 展示单个 Pipeline 的完整执行链路：
 * - 阶段时间线
 * - 用户输入 + PRD
 * - GAN 对抗轮次（DOD 草稿 + 评审 verdict/反馈）
 * - 最终合同 + 报告
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GanRoundPropose {
  task_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  verdict: string | null;
  propose_round: number;
}

interface GanRoundReview {
  task_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  verdict: string | null;
  feedback: string | null;
  contract_branch: string | null;
}

interface GanRound {
  round: number;
  propose: GanRoundPropose | null;
  review: GanRoundReview | null;
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
  gan_rounds: GanRound[];
  file_contents: Record<string, string | null>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  completed: '✅',
  in_progress: '🔄',
  failed: '❌',
  queued: '⏳',
  not_started: '—',
  canceled: '🚫',
};

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  failed: 'text-red-600 dark:text-red-400',
  queued: 'text-amber-600 dark:text-amber-400',
  not_started: 'text-slate-400 dark:text-slate-500',
  canceled: 'text-slate-500 dark:text-slate-400',
};

const VERDICT_STYLE: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  REVISION: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  PROPOSED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
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

// ─── Section: Markdown Content ──────────────────────────────────────────────

function MarkdownSection({ title, content, defaultOpen = false }: {
  title: string;
  content: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!content) {
    return (
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 mb-3">
        <div className="text-sm font-medium text-slate-400 dark:text-slate-500">{title}</div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">暂无内容</div>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg mb-3 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
      >
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</span>
        <span className="text-xs text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-4 bg-slate-50/50 dark:bg-slate-900/30">
          <pre className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
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
                <span className="text-lg">{STATUS_ICON[s] ?? '—'}</span>
                <span className={`text-xs font-medium mt-0.5 ${STATUS_COLOR[s] ?? STATUS_COLOR.not_started}`}>
                  {stage.label}
                </span>
                {stage.count > 1 && (
                  <span className="text-[10px] text-slate-400">×{stage.count}</span>
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

// ─── Section: GAN Rounds ────────────────────────────────────────────────────

function GanRoundsSection({ rounds }: { rounds: GanRound[] }) {
  if (rounds.length === 0) {
    return (
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
          GAN 对抗轮次
        </h2>
        <div className="text-sm text-slate-400 dark:text-slate-500 italic p-4 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg">
          暂无对抗记录
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
        GAN 对抗轮次 ({rounds.length} 轮)
      </h2>
      <div className="space-y-3">
        {rounds.map(round => (
          <GanRoundCard key={round.round} round={round} />
        ))}
      </div>
    </div>
  );
}

function GanRoundCard({ round }: { round: GanRound }) {
  const [expanded, setExpanded] = useState(false);
  const verdict = round.review?.verdict || round.propose?.verdict || '—';
  const verdictStyle = VERDICT_STYLE[verdict] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 w-6">
            R{round.round}
          </span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${verdictStyle}`}>
            {verdict}
          </span>
          {round.propose && (
            <span className="text-xs text-slate-400">
              Propose: {round.propose.status}
            </span>
          )}
          {round.review && (
            <span className="text-xs text-slate-400">
              Review: {round.review.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {round.propose?.created_at && (
            <span className="text-[10px] text-slate-400">{formatTime(round.propose.created_at)}</span>
          )}
          <span className="text-xs text-slate-400">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-3 bg-slate-50/50 dark:bg-slate-900/30 space-y-2">
          {round.propose && (
            <div className="text-xs">
              <span className="font-medium text-slate-600 dark:text-slate-300">Proposer</span>
              <span className="text-slate-400 ml-2">
                {round.propose.status} · {formatTime(round.propose.created_at)}
                {round.propose.completed_at && ` → ${formatTime(round.propose.completed_at)}`}
              </span>
            </div>
          )}
          {round.review && (
            <div className="text-xs">
              <span className="font-medium text-slate-600 dark:text-slate-300">Reviewer</span>
              <span className="text-slate-400 ml-2">
                {round.review.status} · verdict: {round.review.verdict || '—'}
              </span>
              {round.review.contract_branch && (
                <span className="text-blue-500 dark:text-blue-400 ml-2 font-mono text-[10px]">
                  {round.review.contract_branch}
                </span>
              )}
            </div>
          )}
          {round.review?.feedback && (
            <div className="mt-2 p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
              <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1 uppercase">反馈</div>
              <pre className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
                {round.review.feedback}
              </pre>
            </div>
          )}
        </div>
      )}
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
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500 dark:text-slate-400">加载中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
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

  const hasGanRounds = data.gan_rounds.length > 0;
  const fileKeys = Object.keys(data.file_contents || {}).filter(k => data.file_contents[k] !== null);

  return (
    <div className="max-w-4xl mx-auto">
      {/* 头部导航 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/pipeline')}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          ← Pipeline 列表
        </button>
      </div>

      {/* 标题区 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {data.title || '未命名 Pipeline'}
        </h1>
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
          <span className={STATUS_COLOR[data.status] || STATUS_COLOR.not_started}>
            {STATUS_ICON[data.status] || '—'} {data.status}
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

      {/* 阶段时间线 */}
      <StageTimeline stages={data.stages} />

      {/* 用户输入 */}
      {data.user_input && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            用户输入
          </h2>
          <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <pre className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
              {data.user_input}
            </pre>
          </div>
        </div>
      )}

      {/* PRD */}
      <MarkdownSection
        title="Sprint PRD"
        content={data.file_contents?.['sprint-prd.md'] || null}
        defaultOpen={!hasGanRounds}
      />

      {/* GAN 对抗轮次 */}
      <GanRoundsSection rounds={data.gan_rounds} />

      {/* 合同草稿 */}
      <MarkdownSection
        title="合同草稿 (Contract Draft)"
        content={data.file_contents?.['contract-draft.md'] || null}
      />

      {/* 评审反馈文件 */}
      <MarkdownSection
        title="评审反馈 (Review Feedback)"
        content={data.file_contents?.['contract-review-feedback.md'] || null}
      />

      {/* 最终合同 */}
      <MarkdownSection
        title="最终合同 (Sprint Contract)"
        content={data.file_contents?.['sprint-contract.md'] || null}
        defaultOpen
      />

      {/* Workstream 合同 */}
      {[1, 2, 3, 4, 5].map(i => {
        const wsKey = `contract-dod-ws${i}.md`;
        const wsContent = data.file_contents?.[wsKey];
        return wsContent ? (
          <MarkdownSection
            key={wsKey}
            title={`Workstream ${i} DoD`}
            content={wsContent}
          />
        ) : null;
      })}

      {/* 报告 */}
      <MarkdownSection
        title="Harness Report"
        content={data.file_contents?.['harness-report.md'] || null}
      />

      {/* 阶段详情表格 */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
          阶段详情
        </h2>
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
                <th className="text-left p-2 font-medium">阶段</th>
                <th className="text-left p-2 font-medium">状态</th>
                <th className="text-left p-2 font-medium">开始</th>
                <th className="text-left p-2 font-medium">耗时</th>
                <th className="text-left p-2 font-medium">PR</th>
              </tr>
            </thead>
            <tbody>
              {data.stages.map(stage => (
                <tr key={stage.task_type} className="border-t border-slate-100 dark:border-slate-700/50">
                  <td className="p-2 font-medium text-slate-700 dark:text-slate-300">
                    {STATUS_ICON[stage.status] || '—'} {stage.label}
                  </td>
                  <td className={`p-2 ${STATUS_COLOR[stage.status] || STATUS_COLOR.not_started}`}>
                    {stage.status}
                  </td>
                  <td className="p-2 text-slate-400">{formatTime(stage.created_at)}</td>
                  <td className="p-2 text-slate-400">
                    {formatDuration(stage.started_at || stage.created_at, stage.completed_at)}
                  </td>
                  <td className="p-2">
                    {stage.pr_url && (
                      <a
                        href={stage.pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        PR ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 无内容提示 */}
      {!hasGanRounds && fileKeys.length === 0 && data.stages.every(s => s.status === 'not_started') && (
        <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
          此 Pipeline 尚未开始执行
        </div>
      )}
    </div>
  );
}
