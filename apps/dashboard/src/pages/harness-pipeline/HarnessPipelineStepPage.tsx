import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Terminal,
  BookOpen,
  ArrowDownToLine,
  Database,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbContext {
  task_id: string;
  title: string;
  description: string;
  journey_id: string | null;
  sprint_dir: string | null;
}

interface LangGraphStep {
  step_index: number;
  node: string;
  skill_name: string | null;
  system_prompt: string | null;
  skill_content: string | null;
  input_content: string | null;
  output_content: string | null;
  db_context: DbContext | null;
  verdict: string | null;
  review_round: number | null;
  review_verdict: string | null;
  timestamp: string;
}

interface LegacyStep {
  step: number;
  label: string;
  status: string;
  input_content: string | null;
  system_prompt_content: string | null;
  output_content: string | null;
}

interface PipelineDetail {
  planner_task_id: string;
  title: string;
  steps: LegacyStep[];
  langgraph?: {
    enabled: boolean;
    steps: LangGraphStep[];
  };
}

// ─── ContextBlock ─────────────────────────────────────────────────────────────

interface ContextBlockProps {
  title: string;
  icon: React.ElementType;
  content: string | null;
  collapsible?: boolean;
  skillName?: string | null;
}

function ContextBlock({ title, icon: Icon, content, collapsible = false, skillName }: ContextBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div
        className={`flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700${collapsible ? ' cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800' : ''}`}
        onClick={collapsible ? () => setExpanded(v => !v) : undefined}
      >
        <Icon size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
          {title}
        </span>
        {skillName && (
          <span className="ml-2 text-xs font-mono text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 px-1.5 py-0.5 rounded">
            {skillName}
          </span>
        )}
        {collapsible && (
          <span className="ml-auto text-slate-400">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}
      </div>

      {(!collapsible || expanded) && (
        <div className="p-4 bg-white dark:bg-slate-900/30 max-h-[60vh] overflow-auto">
          <pre className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── DbContextBlock ───────────────────────────────────────────────────────────

function DbContextBlock({ ctx }: { ctx: DbContext }) {
  const rows: [string, string | null][] = [
    ['task_id', ctx.task_id],
    ['title', ctx.title],
    ['description', ctx.description || null],
    ['journey_id', ctx.journey_id],
    ['sprint_dir', ctx.sprint_dir],
  ];

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
        <Database size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
          DB Context
        </span>
      </div>
      <div className="p-4 bg-white dark:bg-slate-900/30">
        <table className="w-full text-xs font-mono">
          <tbody>
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <tr key={k} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-1.5 pr-4 text-slate-500 dark:text-slate-400 whitespace-nowrap w-28 align-top">{k}</td>
                <td className="py-1.5 text-slate-700 dark:text-slate-300 break-all">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HarnessPipelineStepPage() {
  const { id, step } = useParams<{ id: string; step: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PipelineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/brain/harness/pipeline-detail?planner_task_id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const stepNum = step ? parseInt(step, 10) : null;

  const lgStep: LangGraphStep | null =
    data?.langgraph?.enabled && stepNum != null
      ? (data.langgraph.steps.find(s => s.step_index === stepNum) ?? null)
      : null;

  const legacyStep: LegacyStep | null =
    !lgStep && stepNum != null
      ? (data?.steps.find(s => s.step === stepNum) ?? null)
      : null;

  const systemPrompt = lgStep?.system_prompt ?? null;
  const skillName = lgStep?.skill_name ?? null;
  const skillContent = lgStep?.skill_content ?? null;
  const inputContent = lgStep?.input_content ?? legacyStep?.input_content ?? null;
  const outputContent = lgStep?.output_content ?? legacyStep?.output_content ?? null;
  const dbCtx = lgStep?.db_context ?? null;
  const nodeLabel = lgStep
    ? `${lgStep.node}${lgStep.review_round ? ` R${lgStep.review_round}` : ''}`
    : legacyStep?.label ?? '未知步骤';

  if (loading && !data) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500 dark:text-slate-400">加载中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button onClick={fetchDetail} className="mt-2 text-xs text-red-500 hover:underline">重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate(`/pipeline/${id}`)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          &larr; 返回 Pipeline 详情
        </button>
      </div>

      <div className="mb-5">
        <h1 className="text-base font-bold text-slate-900 dark:text-white">
          Step #{step} — {nodeLabel}
        </h1>
        {data?.title && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{data.title}</p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <ContextBlock
          title="System Prompt"
          icon={Terminal}
          content={systemPrompt}
        />
        <ContextBlock
          title="Skills"
          icon={BookOpen}
          content={skillContent}
          collapsible
          skillName={skillName}
        />
        <ContextBlock
          title="User Input"
          icon={ArrowDownToLine}
          content={inputContent}
        />
        {dbCtx && <DbContextBlock ctx={dbCtx} />}
        <ContextBlock
          title="Output"
          icon={ArrowUpFromLine}
          content={outputContent ?? (lgStep?.verdict ? `verdict: ${lgStep.verdict}` : null)}
        />
      </div>

      {!lgStep && !legacyStep && !loading && (
        <div className="text-sm text-slate-400 dark:text-slate-500 py-12 text-center">
          未找到 Step #{step} 的数据
        </div>
      )}
    </div>
  );
}
