import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, BookOpen, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, HelpCircle, AlertTriangle,
  Star, Clock, X, ExternalLink,
} from 'lucide-react';

// ── 11 要素定义 ──────────────────────────────────────────────────────────────

const ELEMENTS = [
  { key: 'fr',          label: 'FR',       fullLabel: '功能定义',   tooltip: '是否有明确的功能描述' },
  { key: 'nfr',         label: 'NFR',      fullLabel: '非功能决策', tooltip: '是否存在非功能性决策记录' },
  { key: 'invariant',   label: 'INV',      fullLabel: '不变量',     tooltip: '是否定义了系统不变量' },
  { key: 'gate',        label: '判定点',   fullLabel: '判定点',     tooltip: '是否有可验证的判定门禁' },
  { key: 'ttl',         label: '保质期',   fullLabel: '保质期',     tooltip: '是否有 unit_test_path' },
  { key: 'death',       label: '死亡告警', fullLabel: '死亡告警',   tooltip: '是否配置了 guard_ref' },
  { key: 'failure',     label: '失败语义', fullLabel: '失败语义',   tooltip: '是否定义了失败语义' },
  { key: 'e2e',         label: '效果确认', fullLabel: '效果确认',   tooltip: 'Journey E2E 路径是否设置' },
  { key: 'adversarial', label: '对抗面',   fullLabel: '输入对抗面', tooltip: '是否覆盖了输入对抗测试' },
  { key: 'freshness',   label: '账本保鲜', fullLabel: '账本保鲜',   tooltip: '账本最近更新距今天数' },
  { key: 'twoaxis',     label: '两轴衔接', fullLabel: '两轴衔接',   tooltip: '能力轴是否与 GTD/OKR 轴对齐' },
] as const;

type ElementKey = typeof ELEMENTS[number]['key'];
type ElementStatus = 'present' | 'missing' | 'unknown' | 'stale';

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface LedgerRow {
  id: string;
  name: string;
  journey_id: string | null;
  journey_name: string | null;
  status: string;
  kind: string;
  thickness: string;
  area_id: string | null;
  unit_test_path: string | null;
  guard_ref: string | null;
  workflow_ref: string | null;
  updated_at: string;
  created_at: string;
  coverage: Record<ElementKey, ElementStatus>;
  coverage_score: number;
}

interface LedgerResponse {
  rows: LedgerRow[];
  meta: { total: number; journey_id: string | null };
}

// ── 子组件 ───────────────────────────────────────────────────────────────────

function StatusIcon({ status, small }: { status: ElementStatus; small?: boolean }) {
  const sz = small ? 'w-3.5 h-3.5' : 'w-4 h-4';
  if (status === 'present') return <CheckCircle2 className={`${sz} text-emerald-400`} />;
  if (status === 'missing') return <XCircle className={`${sz} text-red-400`} />;
  if (status === 'stale')   return <AlertTriangle className={`${sz} text-amber-400`} />;
  return <HelpCircle className={`${sz} text-slate-500`} />;
}

function CoverageBar({ score }: { score: number }) {
  const pct = Math.round((score / ELEMENTS.length) * 100);
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400">{score}/{ELEMENTS.length}</span>
    </div>
  );
}

// ── 下钻面板 ─────────────────────────────────────────────────────────────────

function DrilldownPanel({ row, onClose }: { row: LedgerRow; onClose: () => void }) {
  const days = Math.floor((Date.now() - new Date(row.updated_at).getTime()) / 86400000);
  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-slate-900 border-l border-slate-700 z-50 flex flex-col shadow-2xl">
      <div className="flex items-start justify-between p-5 border-b border-slate-700">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-semibold text-sm leading-tight">{row.name}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className="text-xs text-slate-400">{row.journey_name ?? '(无 Lane)'}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{row.kind}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{row.status}</span>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />{new Date(row.updated_at).toLocaleDateString('zh-CN')}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {ELEMENTS.map(el => {
          const status = row.coverage[el.key];
          return (
            <div key={el.key} className={`rounded-xl p-3.5 border ${
              status === 'present' ? 'border-emerald-500/30 bg-emerald-500/5' :
              status === 'missing' ? 'border-red-500/30 bg-red-500/5' :
              status === 'stale'   ? 'border-amber-500/30 bg-amber-500/5' :
              'border-slate-700/60 bg-slate-800/40'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <StatusIcon status={status} />
                <span className="text-sm font-medium text-white">{el.fullLabel}</span>
                <span className="text-xs text-slate-500 ml-auto">{el.label}</span>
              </div>
              <p className="text-xs text-slate-500 italic">{el.tooltip}</p>
              {el.key === 'ttl' && row.unit_test_path && (
                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />{row.unit_test_path}
                </p>
              )}
              {el.key === 'death' && row.guard_ref && (
                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />{row.guard_ref}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-4 border-t border-slate-700">
        <CoverageBar score={row.coverage_score} />
        <p className="text-xs text-slate-500 mt-1">
          {ELEMENTS.length - row.coverage_score} 项未覆盖 · {days === 0 ? '今天' : `${days}d`} 前更新
        </p>
      </div>
    </div>
  );
}

// ── 表格行 ───────────────────────────────────────────────────────────────────

function LedgerTableRow({
  row, onClick, selected,
}: { row: LedgerRow; onClick: () => void; selected: boolean }) {
  const days = Math.floor((Date.now() - new Date(row.updated_at).getTime()) / 86400000);
  return (
    <tr
      onClick={onClick}
      className={`border-b border-slate-800/60 cursor-pointer transition-colors ${
        selected ? 'bg-slate-700/40' : 'hover:bg-slate-800/50'
      }`}
    >
      <td className="px-3 py-2.5 text-xs text-slate-400 max-w-[120px]">
        <span className="truncate block">
          {row.journey_name?.replace(/^gp-agg-smoke-journey-.*/, '[smoke]') ?? '—'}
        </span>
      </td>
      <td className="px-3 py-2.5 max-w-[200px]">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-white truncate">{row.name}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`text-xs px-1 py-0 rounded ${
            row.status === 'done'    ? 'bg-emerald-500/20 text-emerald-400' :
            row.status === 'working' ? 'bg-blue-500/20 text-blue-400' :
            'bg-slate-700 text-slate-400'
          }`}>{row.status}</span>
          <span className="text-xs text-slate-600">{row.kind}</span>
        </div>
      </td>
      {ELEMENTS.map(el => (
        <td key={el.key} className="px-2 py-2.5 text-center">
          <div className="flex justify-center">
            <StatusIcon status={row.coverage[el.key]} small />
          </div>
        </td>
      ))}
      <td className="px-3 py-2.5">
        <CoverageBar score={row.coverage_score} />
      </td>
      <td className="px-3 py-2.5 text-xs text-right whitespace-nowrap">
        <span className={days > 30 ? 'text-amber-400' : 'text-slate-500'}>
          {days === 0 ? '今天' : `${days}d`}
        </span>
      </td>
    </tr>
  );
}

// ── Lane 分组 ─────────────────────────────────────────────────────────────────

function LaneGroup({
  journeyId, journeyName, rows, defaultExpanded, selectedId, onSelect,
}: {
  journeyId: string | null; journeyName: string; rows: LedgerRow[];
  defaultExpanded: boolean; selectedId: string | null; onSelect: (row: LedgerRow) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const avgScore = rows.reduce((s, r) => s + r.coverage_score, 0) / rows.length;
  const pct = Math.round((avgScore / ELEMENTS.length) * 100);
  const color = pct >= 70 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400';

  return (
    <>
      <tr
        className="bg-slate-800/80 cursor-pointer hover:bg-slate-700/60 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <td colSpan={2 + ELEMENTS.length + 2} className="px-3 py-2">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            <span className="text-sm font-semibold text-slate-200">{journeyName || '(无 Lane)'}</span>
            <span className="text-xs text-slate-500">{rows.length} 条</span>
            <span className={`text-xs font-bold ml-auto ${color}`}>{pct}%</span>
          </div>
        </td>
      </tr>
      {expanded && rows.map(row => (
        <LedgerTableRow
          key={row.id}
          row={row}
          onClick={() => onSelect(row)}
          selected={selectedId === row.id}
        />
      ))}
    </>
  );
}

// ── 主组件 ───────────────────────────────────────────────────────────────────

interface LedgerPanelProps {
  journeyId?: string;
}

export function LedgerPanel({ journeyId }: LedgerPanelProps) {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedRow, setSelectedRow] = useState<LedgerRow | null>(null);
  const [filterKind, setFilterKind] = useState<'all' | 'ability' | 'feature'>('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const fetchAll = useCallback(async () => {
    try {
      const url = journeyId
        ? `/api/brain/ledger?journey_id=${encodeURIComponent(journeyId)}&limit=500`
        : '/api/brain/ledger?limit=500';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: LedgerResponse = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 60_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const rows = data?.rows ?? [];

  const filtered = rows.filter(r => {
    if (filterKind !== 'all' && r.kind !== filterKind) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    return true;
  });

  // 按 journey 分组
  const laneMap = new Map<string | null, { name: string; rows: LedgerRow[] }>();
  for (const row of filtered) {
    const key = row.journey_id ?? null;
    if (!laneMap.has(key)) {
      laneMap.set(key, { name: row.journey_name ?? '(无 Lane)', rows: [] });
    }
    laneMap.get(key)!.rows.push(row);
  }
  const lanes = Array.from(laneMap.entries()).sort((a, b) => {
    const as_ = a[1].rows.reduce((s, r) => s + r.coverage_score, 0) / a[1].rows.length;
    const bs_ = b[1].rows.reduce((s, r) => s + r.coverage_score, 0) / b[1].rows.length;
    return bs_ - as_;
  });

  const statusOptions = ['all', ...Array.from(new Set(rows.map(r => r.status))).sort()];
  const totalPresent = rows.reduce((s, r) => s + r.coverage_score, 0);
  const totalPossible = rows.length * ELEMENTS.length;
  const overallPct = totalPossible > 0 ? Math.round((totalPresent / totalPossible) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-center">
        <p className="text-red-400 text-sm">加载失败: {error}</p>
        <button onClick={fetchAll} className="mt-2 px-3 py-1 bg-red-900/30 text-red-400 rounded text-xs">重试</button>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className={`flex-1 min-w-0 flex flex-col overflow-hidden ${selectedRow ? 'mr-[420px]' : ''}`}>
        {/* 工具栏 */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-slate-700/50">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold text-white">11要素账本</span>
                <span className="text-xs text-slate-500">
                  {rows.length} 条 · 整体覆盖 {overallPct}%
                </span>
                {lastUpdated && (
                  <span className="text-xs text-slate-600">
                    · {lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新
                  </span>
                )}
              </div>
              {/* 图例 */}
              <div className="flex items-center gap-3 text-xs">
                {(['present', 'missing', 'stale', 'unknown'] as ElementStatus[]).map(s => (
                  <div key={s} className="flex items-center gap-1">
                    <StatusIcon status={s} small />
                    <span className="text-slate-500">
                      {s === 'present' ? '已覆盖' : s === 'missing' ? '缺失' : s === 'stale' ? '过期' : '未追踪'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={fetchAll} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {/* 过滤器 */}
          <div className="flex items-center gap-2">
            <select
              value={filterKind}
              onChange={e => setFilterKind(e.target.value as typeof filterKind)}
              className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded px-2 py-1"
            >
              <option value="all">全部类型</option>
              <option value="ability">ability</option>
              <option value="feature">feature</option>
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded px-2 py-1"
            >
              {statusOptions.map(s => (
                <option key={s} value={s}>{s === 'all' ? '全部状态' : s}</option>
              ))}
            </select>
            <span className="text-xs text-slate-500 ml-auto">{filtered.length} 条</span>
          </div>
        </div>

        {/* 表格 */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm border-collapse" style={{ minWidth: '1100px' }}>
            <thead className="sticky top-0 z-10 bg-slate-900">
              <tr className="border-b border-slate-700">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 w-[110px]">Lane</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 w-[180px]">Function</th>
                {ELEMENTS.map(el => (
                  <th
                    key={el.key}
                    className="px-2 py-2.5 text-center text-[10px] font-semibold text-slate-400 w-[52px]"
                    title={`${el.fullLabel}：${el.tooltip}`}
                  >
                    {el.label}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 w-[90px]">覆盖</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-400 w-[60px]">更新</th>
              </tr>
            </thead>
            <tbody>
              {lanes.length === 0 ? (
                <tr>
                  <td colSpan={2 + ELEMENTS.length + 2} className="text-center py-12 text-slate-500 text-sm">
                    暂无数据
                  </td>
                </tr>
              ) : (
                lanes.map(([jid, { name, rows: laneRows }]) => (
                  <LaneGroup
                    key={jid ?? '__no_lane__'}
                    journeyId={jid}
                    journeyName={name}
                    rows={laneRows}
                    defaultExpanded={laneRows.length <= 5}
                    selectedId={selectedRow?.id ?? null}
                    onSelect={row => setSelectedRow(prev => prev?.id === row.id ? null : row)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRow && (
        <DrilldownPanel row={selectedRow} onClose={() => setSelectedRow(null)} />
      )}
    </div>
  );
}

export default function LedgerPage() {
  return (
    <div className="flex h-full overflow-hidden">
      <LedgerPanel />
    </div>
  );
}
