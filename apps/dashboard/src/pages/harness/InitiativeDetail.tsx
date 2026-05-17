/**
 * InitiativeDetail — Harness v2 Initiative 级详情页（M6）
 *
 * 路由：/initiatives/:id
 * 数据源：GET /api/brain/initiatives/:id/dag
 *
 * 布局：
 *   - 顶部三阶段进度条（A_contract / B_task_loop / C_final_e2e）
 *   - Mermaid DAG（Task 节点 + 依赖边，按 status 着色）
 *   - Task 列表卡片（PR 链接 / fix_rounds / 状态）
 *   - 成本面板（total + by_task）
 *   - 阶段 C E2E verdict（若有）
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';

// ─── Types ─────────────────────────────────────────────────────────────────

type Phase = 'A_contract' | 'B_task_loop' | 'C_final_e2e' | 'done' | 'failed';

interface DagTask {
  task_id: string;
  title: string;
  status: string;
  pr_url: string | null;
  depends_on: string[];
  fix_rounds: number;
  cost_usd: number;
  started_at?: string | null;
  completed_at?: string | null;
}

interface DagDependency {
  from: string;
  to: string;
  edge_type: 'hard' | 'soft';
}

interface DagResponse {
  initiative_id: string;
  phase: Phase;
  prd_content: string | null;
  contract_content: string | null;
  e2e_acceptance: unknown;
  contract: {
    id: string;
    version: number;
    status: string;
    review_rounds: number;
    budget_cap_usd: number | string;
    timeout_sec: number;
    approved_at: string | null;
  } | null;
  tasks: DagTask[];
  dependencies: DagDependency[];
  cost: {
    total_usd: number;
    by_task: { task_id: string; usd: number }[];
  };
  timing: {
    started_at: string | null;
    current_phase_started_at: string | null;
    deadline_at: string | null;
    completed_at: string | null;
  };
  run: {
    id: string;
    current_task_id: string | null;
    merged_task_ids: string[];
    failure_reason: string | null;
  } | null;
}

// ─── 辅助 ───────────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<Phase, string> = {
  A_contract: '阶段 A · 合同',
  B_task_loop: '阶段 B · Task 顺序',
  C_final_e2e: '阶段 C · E2E 收尾',
  done: '完成',
  failed: '失败',
};

const STATUS_COLOR: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  queued: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function buildMermaid(tasks: DagTask[], deps: DagDependency[]): string {
  if (!tasks.length) return '';
  const lines: string[] = ['graph TD'];
  for (const t of tasks) {
    const label = `${shortId(t.task_id)}<br/>${(t.title || '').replace(/["\n]/g, ' ').slice(0, 30)}`;
    lines.push(`  ${shortId(t.task_id)}["${label}"]:::${t.status}`);
  }
  for (const d of deps) {
    // task_dependencies.from = 依赖方 → 要等 to 先完成
    lines.push(`  ${shortId(d.to)} --> ${shortId(d.from)}`);
  }
  lines.push('  classDef completed fill:#d1fae5,stroke:#059669');
  lines.push('  classDef in_progress fill:#dbeafe,stroke:#2563eb');
  lines.push('  classDef failed fill:#fee2e2,stroke:#dc2626');
  lines.push('  classDef queued fill:#f1f5f9,stroke:#64748b');
  return lines.join('\n');
}

// ─── 子组件 ─────────────────────────────────────────────────────────────────

function PhaseProgress({ phase }: { phase: Phase }) {
  const active = (p: Phase) =>
    phase === p ||
    (phase === 'B_task_loop' && p === 'A_contract') ||
    (phase === 'C_final_e2e' && (p === 'A_contract' || p === 'B_task_loop')) ||
    (phase === 'done' && (p === 'A_contract' || p === 'B_task_loop' || p === 'C_final_e2e'));

  const phases: Phase[] = ['A_contract', 'B_task_loop', 'C_final_e2e'];
  return (
    <div className="flex items-center gap-0 mb-6" data-testid="phase-progress">
      {phases.map((p, idx) => {
        const isActive = active(p);
        const isCurrent = phase === p;
        return (
          <div key={p} className="flex-1 flex items-center">
            <div
              className={`flex-1 flex items-center justify-center py-2 text-xs font-medium border ${
                isCurrent
                  ? 'bg-blue-600 text-white border-blue-600'
                  : isActive
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                    : 'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              } ${idx === 0 ? 'rounded-l-lg' : ''} ${idx === phases.length - 1 ? 'rounded-r-lg' : ''}`}
              data-testid={`phase-${p}`}
            >
              {PHASE_LABELS[p]}
            </div>
          </div>
        );
      })}
      {(phase === 'done' || phase === 'failed') && (
        <span
          className={`ml-3 px-2 py-1 text-xs font-semibold rounded ${
            phase === 'done'
              ? 'bg-emerald-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {PHASE_LABELS[phase]}
        </span>
      )}
    </div>
  );
}

function MermaidDAG({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) return;
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

  if (!source) {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-400 py-4">
        暂无 DAG（Planner 未产出或 Initiative 尚未开始）
      </div>
    );
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-900/50 overflow-auto mb-6">
      {renderError ? (
        <div className="text-xs text-red-500">Mermaid 渲染失败：{renderError}</div>
      ) : (
        <div ref={ref} className="flex justify-center" data-testid="dag-diagram" />
      )}
    </div>
  );
}

function TaskCard({ task }: { task: DagTask }) {
  const statusCls = STATUS_COLOR[task.status] || STATUS_COLOR.queued;
  return (
    <div
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3"
      data-testid={`task-card-${task.task_id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-slate-900 dark:text-white truncate">
            {task.title}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {shortId(task.task_id)}
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCls}`}>
          {task.status}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 dark:text-slate-400">
        {task.pr_url && (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            查看 PR
          </a>
        )}
        {task.fix_rounds > 0 && <span>Fix {task.fix_rounds} 轮</span>}
        {task.cost_usd > 0 && <span>${task.cost_usd.toFixed(2)}</span>}
      </div>
    </div>
  );
}

function CostPanel({ cost }: { cost: DagResponse['cost'] }) {
  const max = Math.max(1, ...cost.by_task.map((b) => b.usd));
  return (
    <div
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 mb-6"
      data-testid="cost-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">成本</h3>
        <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
          ${Number(cost.total_usd || 0).toFixed(2)}
        </span>
      </div>
      {cost.by_task.length === 0 ? (
        <div className="text-xs text-slate-500 dark:text-slate-400">暂无分布数据</div>
      ) : (
        <div className="space-y-1.5">
          {cost.by_task.map((b) => (
            <div key={b.task_id} className="flex items-center gap-2 text-xs">
              <span className="w-16 text-slate-500 dark:text-slate-400 truncate">
                {shortId(b.task_id)}
              </span>
              <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded h-2 overflow-hidden">
                <div
                  className="h-full bg-emerald-400"
                  style={{ width: `${(b.usd / max) * 100}%` }}
                />
              </div>
              <span className="w-14 text-right text-slate-700 dark:text-slate-300">
                ${b.usd.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function E2EResult({ e2e }: { e2e: unknown }) {
  if (!e2e || typeof e2e !== 'object') return null;
  const obj = e2e as Record<string, unknown>;
  const verdict = typeof obj.verdict === 'string' ? obj.verdict : null;
  const scenarios = Array.isArray(obj.failed_scenarios) ? obj.failed_scenarios : [];
  if (!verdict) return null;
  const isPass = verdict === 'PASS';
  return (
    <div
      className={`rounded-xl border p-4 mb-6 ${
        isPass
          ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
          : 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
      }`}
      data-testid="e2e-result"
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`text-sm font-bold ${
            isPass ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
          }`}
        >
          阶段 C E2E · {verdict}
        </span>
      </div>
      {!isPass && scenarios.length > 0 && (
        <ul className="mt-1 text-xs text-red-700 dark:text-red-300 list-disc list-inside">
          {scenarios.slice(0, 5).map((s, i) => (
            <li key={i}>{String(s)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── 主页面组件 ─────────────────────────────────────────────────────────────

export default function InitiativeDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DagResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDag = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/brain/initiatives/${encodeURIComponent(id)}/dag`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const json: DagResponse = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDag();
  }, [fetchDag]);

  if (!id) {
    return <div className="p-6 text-red-500">missing initiative id</div>;
  }

  if (loading && !data) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="text-sm text-slate-500 dark:text-slate-400">加载中…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
          <p className="text-sm text-red-700 dark:text-red-400">加载失败：{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const mermaidSrc = buildMermaid(data.tasks, data.dependencies);

  return (
    <div className="max-w-5xl mx-auto p-6" data-testid="initiative-detail">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Initiative {shortId(data.initiative_id)}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {data.tasks.length} 个 Task ·{' '}
          {data.contract ? `合同 v${data.contract.version}（${data.contract.status}）` : '未生成合同'}
        </p>
      </div>

      <PhaseProgress phase={data.phase} />

      <E2EResult e2e={data.e2e_acceptance} />

      <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
        DAG
      </h2>
      <MermaidDAG source={mermaidSrc} />

      <CostPanel cost={data.cost} />

      <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
        Tasks
      </h2>
      <div className="space-y-2">
        {data.tasks.length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400 py-4">
            暂无子 Task（Planner 还没输出 task-plan.json 或 Initiative 尚未开始）
          </div>
        ) : (
          data.tasks.map((t) => <TaskCard key={t.task_id} task={t} />)
        )}
      </div>

      {data.run?.failure_reason && (
        <div className="mt-6 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400">失败原因</p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-1">{data.run.failure_reason}</p>
        </div>
      )}
    </div>
  );
}

// 内部函数 export 供单元测试验证
export { buildMermaid, shortId };
