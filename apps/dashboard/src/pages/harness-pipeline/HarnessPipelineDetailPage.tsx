/**
 * HarnessPipelineDetailPage — Harness Pipeline 全链路详情
 * 路由：/pipeline/:id
 *
 * 展示单个 Pipeline 的完整执行链路：
 * - 阶段时间线概览
 * - 串行步骤列表（按时间排序）
 * - 点击步骤展开三栏视图：Input | Prompt | Output
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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

// ─── LangGraph Types ────────────────────────────────────────────────────────

interface LangGraphStep {
  step_index: number;
  node: string;
  verdict: string | null;
  review_round: number | null;
  eval_round: number | null;
  review_verdict: string | null;
  evaluator_verdict: string | null;
  pr_url: string | null;
  error: string | null;
  timestamp: string;
  state_snapshot?: Record<string, unknown>;
}

interface LangGraphRound {
  round: number;
  proposer?: LangGraphStep | null;
  reviewer?: LangGraphStep | null;
  generator?: LangGraphStep | null;
  evaluator?: LangGraphStep | null;
}

interface LangGraphInfo {
  enabled: boolean;
  thread_id: string;
  steps: LangGraphStep[];
  gan_rounds: LangGraphRound[];
  fix_rounds: LangGraphRound[];
  // 多 Workstream 字段（Harness 从「一次产 1 PR」升级为「按 WS 循环产 N PR」）
  workstreams?: Array<{ index: number; name: string; dod_file?: string; description?: string }>;
  pr_urls?: Array<string | null>;
  ws_verdicts?: Array<string | null>;
  ws_feedbacks?: Array<string | null>;
  checkpoints: {
    count: number;
    latest_checkpoint_id: string | null;
    state_available: boolean;
  };
  mermaid?: string | null;
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
  langgraph?: LangGraphInfo;
}

// ─── Constants ──────────────────────────────────────────────────────────────

// 完整 10 步 pipeline 阶段定义
const PIPELINE_STAGE_LABELS: Record<string, string> = {
  harness_planner: 'Planner',
  harness_contract_propose: 'Propose',
  harness_contract_review: 'Review',
  harness_generate: 'Generate',
  harness_evaluate: 'Evaluate',
  harness_report: 'Report',
  harness_auto_merge: 'Auto-merge',
  harness_deploy: 'Deploy',
  harness_smoke_test: 'Smoke-test',
  harness_cleanup: 'Cleanup',
};

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

// 所有 10 步的完整顺序，用于补全 API 未返回的步骤（显示为 pending）
const ALL_PIPELINE_STAGES = [
  'harness_planner', 'harness_contract_propose', 'harness_contract_review',
  'harness_generate', 'harness_evaluate', 'harness_report',
  'harness_auto_merge', 'harness_deploy', 'harness_smoke_test', 'harness_cleanup',
];

function StageTimeline({ stages }: { stages: DetailStage[] }) {
  // 补全未在 API 返回中的步骤（显示为 pending/not_started）
  const stageMap = new Map(stages.map(s => [s.task_type, s]));
  const fullStages: DetailStage[] = ALL_PIPELINE_STAGES.map(type => (
    stageMap.get(type) ?? {
      task_type: type,
      label: PIPELINE_STAGE_LABELS[type] ?? type,
      status: 'not_started',
      task_id: null,
      title: null,
      created_at: null,
      started_at: null,
      completed_at: null,
      error_message: null,
      pr_url: null,
      result: null,
      count: 0,
    }
  ));

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
        阶段时间线（10 步）
      </h2>
      <div className="flex flex-wrap items-center gap-1">
        {fullStages.map((stage, i) => {
          const s = stage.status in STATUS_ICON ? stage.status : 'not_started';
          const label = PIPELINE_STAGE_LABELS[stage.task_type] ?? stage.label;
          return (
            <div key={stage.task_type} className="flex items-center">
              <div className="flex flex-col items-center min-w-[72px]">
                <span className="text-lg">{STATUS_ICON[s] ?? '\u2014'}</span>
                <span className={`text-xs font-medium mt-0.5 text-center ${STATUS_COLOR[s] ?? STATUS_COLOR.not_started}`}>
                  {label}
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
              {i < fullStages.length - 1 && (
                <div className="w-4 h-px bg-slate-300 dark:bg-slate-600 mx-0.5" />
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

// ─── Section: Step Cards ────────────────────────────────────────────────────

function StepCards({ steps, pipelineId }: { steps: PipelineStep[]; pipelineId: string }) {
  const navigate = useNavigate();

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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map(step => {
          const s = step.status in STATUS_ICON ? step.status : 'not_started';
          const duration = formatDuration(step.created_at, step.completed_at);

          return (
            <div
              key={step.step}
              className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
              onClick={() => navigate(`/pipeline/${pipelineId}/step/${step.step}`)}
            >
              {/* 步骤号 + 状态图标 */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-400 dark:text-slate-500">
                  #{step.step}
                </span>
                <span className="text-base">{STATUS_ICON[s] ?? '\u2014'}</span>
              </div>

              {/* label */}
              <div className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2 leading-snug">
                {step.label}
              </div>

              {/* status + verdict + duration */}
              <div className="flex items-center gap-2 flex-wrap">
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
                {duration && (
                  <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
                    耗时 {duration}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section: LangGraph Visualization ──────────────────────────────────────

function LangGraphBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 uppercase tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
      LangGraph
    </span>
  );
}

function CheckpointBadge({ checkpoints }: { checkpoints: LangGraphInfo['checkpoints'] }) {
  const color = checkpoints.count > 0
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${color}`}
      title={checkpoints.latest_checkpoint_id ? `latest: ${checkpoints.latest_checkpoint_id}` : '无持久化 state'}
    >
      {checkpoints.count} checkpoints {checkpoints.state_available ? '已保存' : '未保存'}
    </span>
  );
}

function verdictBadge(verdict: string | null) {
  if (!verdict) return null;
  const cls = (() => {
    switch (verdict) {
      case 'APPROVED':
      case 'PASS':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'REVISION':
      case 'FAIL':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
      default:
        return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    }
  })();
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${cls}`}>{verdict}</span>
  );
}

function LangGraphRoundCard({
  roundLabel,
  firstNode,
  secondNode,
  first,
  second,
}: {
  roundLabel: string;
  firstNode: string;
  secondNode: string;
  first: LangGraphStep | null | undefined;
  second: LangGraphStep | null | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const duration = first?.timestamp && second?.timestamp
    ? formatDuration(first.timestamp, second.timestamp)
    : '';

  const verdict = second?.verdict ?? second?.review_verdict ?? second?.evaluator_verdict ?? null;

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-900/50">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <span className="text-xs font-bold text-violet-600 dark:text-violet-300 min-w-[80px]">
          {roundLabel}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          {firstNode} &rarr; {secondNode}
        </span>
        {verdictBadge(verdict)}
        {second?.pr_url && (
          <a
            href={second.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-mono"
          >
            PR
          </a>
        )}
        {first?.pr_url && (
          <a
            href={first.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-mono"
          >
            PR
          </a>
        )}
        {duration && (
          <span className="text-xs text-slate-400 ml-auto">{duration}</span>
        )}
        <span className="text-xs text-slate-400">{expanded ? '\u2212' : '+'}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 space-y-2">
          <div>
            <span className="font-semibold">{firstNode} step #{first?.step_index ?? '?'}</span>
            <span className="ml-2 text-slate-400">{formatTime(first?.timestamp || null)}</span>
            {first?.error && <pre className="mt-1 text-red-500 whitespace-pre-wrap">{first.error}</pre>}
          </div>
          <div>
            <span className="font-semibold">{secondNode} step #{second?.step_index ?? '?'}</span>
            <span className="ml-2 text-slate-400">{formatTime(second?.timestamp || null)}</span>
            {second?.error && <pre className="mt-1 text-red-500 whitespace-pre-wrap">{second.error}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

function LangGraphRoundList({
  title,
  rounds,
  nodePair,
}: {
  title: string;
  rounds: LangGraphRound[];
  nodePair: [string, string];
}) {
  if (rounds.length === 0) return null;

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
        {title} ({rounds.length} 轮)
      </h3>
      <div className="flex flex-col gap-2">
        {rounds.map((r, i) => {
          const indexed = r as unknown as Record<string, LangGraphStep | null | undefined>;
          const first = indexed[nodePair[0]];
          const second = indexed[nodePair[1]];
          return (
            <LangGraphRoundCard
              key={`${title}-${r.round}-${i}`}
              roundLabel={`${title.split(' ')[0]} R${r.round}`}
              firstNode={nodePair[0]}
              secondNode={nodePair[1]}
              first={first}
              second={second}
            />
          );
        })}
      </div>
    </div>
  );
}

function MermaidDiagram({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'render failed');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
        Pipeline 架构图
      </h3>
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-900/50 overflow-auto">
        {renderError ? (
          <div className="text-xs text-red-500">Mermaid 渲染失败：{renderError}</div>
        ) : (
          <div ref={ref} className="flex justify-center" data-testid="mermaid-diagram" />
        )}
      </div>
    </div>
  );
}

/**
 * Workstream Runs 区块：多 WS 模式下展示每个 WS 的 PR 链接 + 验收状态。
 *
 * 每行 = 一个 Workstream：WS 编号 + 名称 + PR 链接 + PASS/FAIL 徽章 + 失败反馈折叠。
 * 单 WS 或无 workstreams 数据时整个区块不渲染。
 */
function WorkstreamRunsList({ info }: { info: LangGraphInfo }) {
  const workstreams = info.workstreams || [];
  const prUrls = info.pr_urls || [];
  const verdicts = info.ws_verdicts || [];
  const feedbacks = info.ws_feedbacks || [];

  if (workstreams.length === 0) return null;
  // 单 WS 且是 default 兜底时不画这个 section（跟老视图一样）
  if (workstreams.length === 1 && (workstreams[0].name === 'default' || !workstreams[0].name)) {
    return null;
  }

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
        Workstream Runs ({workstreams.length} WS)
      </h3>
      <div className="flex flex-col gap-2">
        {workstreams.map((ws, i) => {
          const prUrl = prUrls[i] || null;
          const verdict = verdicts[i] || null;
          const feedback = feedbacks[i] || null;
          const prMatch = prUrl?.match(/\/pull\/(\d+)/);
          const prNum = prMatch ? prMatch[1] : null;
          return (
            <WorkstreamRow
              key={`ws-${ws.index}`}
              index={ws.index}
              name={ws.name}
              dodFile={ws.dod_file || null}
              prUrl={prUrl}
              prNum={prNum}
              verdict={verdict}
              feedback={feedback}
            />
          );
        })}
      </div>
    </div>
  );
}

function WorkstreamRow({
  index,
  name,
  dodFile,
  prUrl,
  prNum,
  verdict,
  feedback,
}: {
  index: number;
  name: string;
  dodFile: string | null;
  prUrl: string | null;
  prNum: string | null;
  verdict: string | null;
  feedback: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasFeedback = !!feedback;
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900/50 overflow-hidden">
      <button
        type="button"
        onClick={() => hasFeedback && setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        disabled={!hasFeedback}
      >
        <span className="text-xs font-bold text-violet-600 dark:text-violet-300 min-w-[60px]">
          WS-{index}
        </span>
        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{name}</span>
        {dodFile && (
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
            {dodFile}
          </span>
        )}
        {verdictBadge(verdict)}
        {prNum && prUrl ? (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-mono ml-auto"
          >
            PR #{prNum}
          </a>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto italic">无 PR</span>
        )}
        {hasFeedback && (
          <span className="text-xs text-slate-400">{expanded ? '\u2212' : '+'}</span>
        )}
      </button>
      {expanded && hasFeedback && (
        <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-700 dark:text-slate-300">
            {feedback}
          </pre>
        </div>
      )}
    </div>
  );
}

function LangGraphSection({ info }: { info: LangGraphInfo }) {
  return (
    <div className="mb-6 border border-violet-200 dark:border-violet-900/50 rounded-lg p-4 bg-violet-50/40 dark:bg-violet-950/20">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
          LangGraph 路径
        </h2>
        <LangGraphBadge />
        <CheckpointBadge checkpoints={info.checkpoints} />
        <span className="text-[10px] text-slate-400 ml-auto font-mono">
          thread_id: {info.thread_id.slice(0, 8)}&hellip;
        </span>
      </div>

      <WorkstreamRunsList info={info} />

      <LangGraphRoundList
        title="GAN 对抗"
        rounds={info.gan_rounds}
        nodePair={['proposer', 'reviewer']}
      />
      <LangGraphRoundList
        title="Fix 循环"
        rounds={info.fix_rounds}
        nodePair={['generator', 'evaluator']}
      />

      {info.gan_rounds.length === 0 && info.fix_rounds.length === 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400 italic py-2">
          尚无 GAN / Fix 轮次数据（pipeline 还没跑到那里）
        </div>
      )}

      {info.mermaid && <MermaidDiagram source={info.mermaid} />}
    </div>
  );
}

// ─── Types: SSE Log ─────────────────────────────────────────────────────────

interface SseLogEntry {
  label: string;
  ts: string;
}

interface SseDoneData {
  status: string;
  verdict?: string | null;
}

// ─── Section: SSE Real-time Log ──────────────────────────────────────────────

function SseLogSection({
  logs,
  done,
}: {
  logs: SseLogEntry[];
  done: SseDoneData | null;
}) {
  return (
    <div className="mb-6 border border-blue-200 dark:border-blue-900/50 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-900/50">
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">
          实时执行日志
        </span>
      </div>
      <div
        data-testid="sse-log"
        className="p-3 max-h-[300px] overflow-y-auto bg-white dark:bg-slate-900/50 font-mono text-xs space-y-1"
      >
        {logs.length === 0 && !done && (
          <div className="text-slate-400 dark:text-slate-500 italic">等待节点推进...</div>
        )}
        {logs.map((entry, i) => (
          <div key={i} className="text-slate-700 dark:text-slate-300">
            <span className="text-slate-400 dark:text-slate-500 mr-2">
              {new Date(entry.ts).toLocaleTimeString()}
            </span>
            <span>{entry.label}</span>
          </div>
        ))}
        {done && (
          <div className={`mt-2 font-semibold ${done.status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {done.status === 'completed'
              ? `Pipeline 已完成 ✅${done.verdict ? ` ${done.verdict}` : ''}`
              : `Pipeline 失败 ❌${done.verdict ? ` ${done.verdict}` : ''}`}
          </div>
        )}
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
  const [sseLogs, setSseLogs] = useState<SseLogEntry[]>([]);
  const [sseDone, setSseDone] = useState<SseDoneData | null>(null);

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

  useEffect(() => {
    if (!id) return;
    const es = new EventSource(`/api/brain/harness/stream?planner_task_id=${encodeURIComponent(id)}`);

    es.addEventListener('node_update', (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data) as { label: string; ts: string };
        setSseLogs(prev => [...prev, { label: d.label, ts: d.ts }]);
      } catch {
        // ignore malformed event data
      }
    });

    es.addEventListener('done', (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data) as SseDoneData;
        setSseDone(d);
      } catch {
        // ignore malformed event data
      }
      es.close();
    });

    return () => {
      es.close();
    };
  }, [id]);

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
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {data.title || '未命名 Pipeline'}
          </h1>
          {data.langgraph?.enabled && <LangGraphBadge />}
        </div>
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

      {/* SSE 实时日志区 */}
      <SseLogSection logs={sseLogs} done={sseDone} />

      {/* LangGraph 时间轴（仅在走了 LangGraph 路径时渲染） */}
      {data.langgraph?.enabled && <LangGraphSection info={data.langgraph} />}

      {/* 阶段时间线概览 */}
      <StageTimeline stages={data.stages} />

      {/* 串行步骤列表 + 三栏钻取 */}
      <StepCards steps={data.steps || []} pipelineId={id!} />
    </div>
  );
}
