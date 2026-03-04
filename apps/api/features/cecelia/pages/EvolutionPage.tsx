/**
 * EvolutionPage — Cecelia 进化日志
 *
 * 展示 Cecelia 各组件的进化历程：
 * - 左侧：组件选择器
 * - 右侧：合成叙事（周期性） + 原始 PR 记录时间线
 */

import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, GitMerge, Sparkles, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────

interface EvolutionRecord {
  id: number;
  date: string;
  component: string;
  pr_number: number | null;
  title: string;
  significance: number;
  summary: string | null;
  version: string | null;
  created_at: string;
}

interface EvolutionSummary {
  id: number;
  component: string;
  period_start: string;
  period_end: string;
  narrative: string;
  pr_count: number;
  key_milestones: string[] | null;
  created_at: string;
}

// ── Constants ──────────────────────────────────────────────

const COMPONENTS = [
  { id: 'all', label: '全部', color: 'text-slate-300' },
  { id: 'brain', label: '大脑', color: 'text-violet-400' },
  { id: 'desire', label: '欲望系统', color: 'text-rose-400' },
  { id: 'mouth', label: '嘴巴', color: 'text-sky-400' },
  { id: 'memory', label: '记忆', color: 'text-amber-400' },
  { id: 'emotion', label: '情绪', color: 'text-pink-400' },
  { id: 'notion', label: 'Notion', color: 'text-emerald-400' },
  { id: 'dashboard', label: '前端', color: 'text-blue-400' },
  { id: 'engine', label: '引擎', color: 'text-orange-400' },
];

const SIGNIFICANCE_LABEL: Record<number, { label: string; color: string }> = {
  5: { label: '里程碑', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
  4: { label: '重要', color: 'text-violet-400 bg-violet-400/10 border-violet-400/30' },
  3: { label: '常规', color: 'text-slate-400 bg-slate-700/50 border-slate-600/30' },
  2: { label: '小改', color: 'text-slate-500 bg-slate-800/50 border-slate-700/30' },
  1: { label: '微调', color: 'text-slate-600 bg-slate-900/50 border-slate-800/30' },
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatPeriod(start: string, end: string) {
  return `${formatDate(start)} — ${formatDate(end)}`;
}

// ── Components ──────────────────────────────────────────────

function SummaryCard({ summary, expanded, onToggle }: {
  summary: EvolutionSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const comp = COMPONENTS.find(c => c.id === summary.component);
  return (
    <div className="rounded-xl border border-violet-800/40 bg-violet-900/10 p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-violet-400 flex-shrink-0 mt-0.5" />
          <span className={`text-sm font-medium ${comp?.color || 'text-slate-300'}`}>
            {comp?.label || summary.component}
          </span>
          <span className="text-xs text-slate-500">
            {formatPeriod(summary.period_start, summary.period_end)}
          </span>
          <span className="text-xs text-slate-600 border border-slate-700 rounded px-1.5 py-0.5">
            {summary.pr_count} 次改动
          </span>
        </div>
        <button
          onClick={onToggle}
          className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* 叙事（始终显示前 2 行，展开后显示全部） */}
      <p className={`text-sm text-slate-300 leading-relaxed whitespace-pre-line ${!expanded ? 'line-clamp-2' : ''}`}>
        {summary.narrative}
      </p>

      {summary.key_milestones && summary.key_milestones.length > 0 && expanded && (
        <div className="mt-3 pt-3 border-t border-violet-800/30">
          <p className="text-xs text-slate-500 mb-1.5">关键里程碑</p>
          <ul className="space-y-1">
            {summary.key_milestones.map((m, i) => (
              <li key={i} className="text-xs text-slate-400 flex items-center gap-1.5">
                <span className="text-yellow-500">✦</span> {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RecordItem({ record }: { record: EvolutionRecord }) {
  const sig = SIGNIFICANCE_LABEL[record.significance] || SIGNIFICANCE_LABEL[3];
  const comp = COMPONENTS.find(c => c.id === record.component);
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-800/60 last:border-0">
      <div className="flex-shrink-0 w-10 text-right">
        <span className="text-xs text-slate-500">{formatDate(record.date)}</span>
      </div>
      <div className="flex-shrink-0 w-1 self-stretch">
        <div className="w-px h-full bg-slate-700/50 mx-auto" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          {record.pr_number && (
            <span className="text-xs text-slate-500 flex items-center gap-0.5">
              <GitMerge size={10} /> #{record.pr_number}
            </span>
          )}
          <span className={`text-xs border rounded px-1.5 py-0.5 ${sig.color}`}>{sig.label}</span>
          {comp && (
            <span className={`text-xs ${comp.color}`}>{comp.label}</span>
          )}
          {record.version && (
            <span className="text-xs text-slate-600">v{record.version}</span>
          )}
        </div>
        <p className="text-sm text-slate-300">{record.title}</p>
        {record.summary && (
          <p className="text-xs text-slate-500 mt-0.5">{record.summary}</p>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────

export default function EvolutionPage() {
  const [selectedComponent, setSelectedComponent] = useState('all');
  const [records, setRecords] = useState<EvolutionRecord[]>([]);
  const [summaries, setSummaries] = useState<EvolutionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<number>>(new Set());
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthResult, setSynthResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const compParam = selectedComponent !== 'all' ? `component=${selectedComponent}&` : '';
      const [recRes, sumRes] = await Promise.all([
        fetch(`/api/brain/evolution/records?${compParam}limit=100`),
        fetch(`/api/brain/evolution/summaries?${compParam}limit=20`),
      ]);
      if (!recRes.ok || !sumRes.ok) throw new Error('API 请求失败');
      const [rec, sum] = await Promise.all([recRes.json(), sumRes.json()]);
      setRecords(rec);
      setSummaries(sum);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [selectedComponent]);

  useEffect(() => { load(); }, [load]);

  const toggleSummary = (id: number) => {
    setExpandedSummaries(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const triggerSynthesis = async () => {
    setSynthesizing(true);
    setSynthResult(null);
    try {
      const res = await fetch('/api/brain/evolution/synthesize', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '合成失败');
      setSynthResult(`完成：${data.components_processed ?? 0} 个组件`);
      await load();
    } catch (err) {
      setSynthResult(err instanceof Error ? err.message : '合成失败');
    } finally {
      setSynthesizing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-slate-950 text-slate-200">
      {/* 左侧：组件选择器 */}
      <aside className="w-44 flex-shrink-0 border-r border-slate-800/60 p-4">
        <div className="flex items-center gap-2 mb-5">
          <TrendingUp size={14} className="text-violet-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">组件</span>
        </div>
        <ul className="space-y-1">
          {COMPONENTS.map(c => (
            <li key={c.id}>
              <button
                onClick={() => setSelectedComponent(c.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedComponent === c.id
                    ? 'bg-violet-900/30 text-violet-300 border border-violet-700/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>

        {/* 触发合成 */}
        <div className="mt-6 pt-4 border-t border-slate-800/60">
          <button
            onClick={triggerSynthesis}
            disabled={synthesizing}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs text-violet-400 border border-violet-800/40 hover:bg-violet-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={11} className={synthesizing ? 'animate-spin' : ''} />
            {synthesizing ? '合成中…' : '触发合成'}
          </button>
          {synthResult && (
            <p className="text-xs text-slate-500 mt-2 text-center leading-relaxed">{synthResult}</p>
          )}
        </div>
      </aside>

      {/* 右侧：内容 */}
      <main className="flex-1 min-w-0 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-xl font-semibold text-slate-100 mb-1">进化日志</h1>
          <p className="text-sm text-slate-500 mb-6">Cecelia 的成长自传</p>

          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-800/40 bg-red-900/10 p-4 text-sm text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* 合成叙事 */}
              {summaries.length > 0 && (
                <section className="mb-6">
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    <Sparkles size={12} className="inline mr-1.5 text-violet-400" />
                    周期叙事
                  </h2>
                  {summaries.map(s => (
                    <SummaryCard
                      key={s.id}
                      summary={s}
                      expanded={expandedSummaries.has(s.id)}
                      onToggle={() => toggleSummary(s.id)}
                    />
                  ))}
                </section>
              )}

              {/* 原始记录时间线 */}
              <section>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  <GitMerge size={12} className="inline mr-1.5" />
                  PR 记录 ({records.length})
                </h2>
                {records.length === 0 ? (
                  <div className="text-center py-12">
                    <TrendingUp size={32} className="mx-auto mb-3 text-slate-700 opacity-50" />
                    <p className="text-sm text-slate-500">暂无进化记录</p>
                    <p className="text-xs mt-2 text-slate-600 leading-relaxed max-w-xs mx-auto">
                      进化记录在每次 PR 合并后自动写入。<br />
                      点击左侧「触发合成」可立即生成已有记录的叙事摘要。
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 px-4">
                    {records.map(r => (
                      <RecordItem key={r.id} record={r} />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
