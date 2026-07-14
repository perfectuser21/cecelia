import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
  Star,
  Clock,
  X,
  ExternalLink,
} from 'lucide-react';

// ─── 11 Elements definition ───────────────────────────────────────────────────

const ELEMENTS = [
  { key: 'fr',         label: 'FR',        fullLabel: '功能定义',       tooltip: '是否有明确的功能描述' },
  { key: 'nfr',        label: 'NFR',       fullLabel: '非功能决策',     tooltip: '是否存在非功能性决策记录' },
  { key: 'invariant',  label: 'INV',       fullLabel: '不变量',         tooltip: '是否定义了系统不变量' },
  { key: 'gate',       label: '判定点',    fullLabel: '判定点',         tooltip: '是否有可验证的判定门禁' },
  { key: 'ttl',        label: '保质期',    fullLabel: '保质期',         tooltip: '是否有 TTL / 单元测试路径' },
  { key: 'death',      label: '死亡告警',  fullLabel: '死亡告警',       tooltip: '是否配置了监控死亡告警' },
  { key: 'failure',    label: '失败语义',  fullLabel: '失败语义',       tooltip: '是否定义了失败语义和处理逻辑' },
  { key: 'e2e',        label: '效果确认',  fullLabel: '效果确认',       tooltip: 'E2E 测试路径是否设置' },
  { key: 'adversarial',label: '对抗面',    fullLabel: '输入对抗面',     tooltip: '是否覆盖了输入对抗测试' },
  { key: 'freshness',  label: '账本保鲜',  fullLabel: '账本保鲜',       tooltip: '账本最近更新距今多少天' },
  { key: 'twoaxis',    label: '两轴衔接',  fullLabel: '两轴衔接',       tooltip: '能力轴是否与 GTD/OKR 轴对齐' },
] as const;

type ElementKey = typeof ELEMENTS[number]['key'];
type ElementStatus = 'present' | 'missing' | 'unknown' | 'stale';

// ─── Types ─────────────────────────────────────────────────────────────────

interface Journey {
  id: string;
  name: string;
  description: string | null;
  journey_type: string;
  maturity: string;
  status: string;
  e2e_test_path: string | null;
  area_id: string | null;
  updated_at: string;
}

interface JourneyFeature {
  id: string;
  journey_id: string | null;
  name: string;
  thickness: string | null;
  status: string;
  area_id: string | null;
  unit_test_path: string | null;
  kind: string;
  group: string | null;
  updated_at: string;
  created_at: string;
}

interface Decision {
  id: string;
  category: string | null;
  topic: string;
  decision: string;
  status: string;
  target_type?: string | null;
  target_id?: string | null;
  updated_at: string;
}

interface Goal {
  id: string;
  type: string;
  title: string;
  area_id: string | null;
  status: string;
}

interface ElementCoverage {
  status: ElementStatus;
  detail: string;
  ref?: string;
  daysOld?: number;
}

type Coverage = Record<ElementKey, ElementCoverage>;

interface LedgerRow {
  feature: JourneyFeature;
  journey: Journey | null;
  coverage: Coverage;
  isImportant: boolean;
  coverageScore: number;
}

// ─── Coverage computation ─────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function computeCoverage(
  feature: JourneyFeature,
  journey: Journey | null,
  decisions: Decision[],
  goals: Goal[],
): Coverage {
  const STALE_DAYS = 30;

  // FR
  const hasFR = !!feature.name && feature.name.length > 5;
  const fr: ElementCoverage = hasFR
    ? { status: 'present', detail: feature.name }
    : { status: 'missing', detail: '无功能描述' };

  // NFR – decisions with category='nfr' mentioning feature id or journey id
  const nfrDecs = decisions.filter(d =>
    d.category === 'nfr' &&
    (d.target_id === feature.id || d.target_id === feature.journey_id)
  );
  const nfr: ElementCoverage = nfrDecs.length > 0
    ? { status: 'present', detail: `${nfrDecs.length} 条 NFR 决策`, ref: nfrDecs[0].topic }
    : { status: 'unknown', detail: '无 NFR 决策记录' };

  // Invariant
  const invDecs = decisions.filter(d =>
    (d.category === 'invariant' || d.topic?.includes('不变量')) &&
    (d.target_id === feature.id || d.target_id === feature.journey_id)
  );
  const invariant: ElementCoverage = invDecs.length > 0
    ? { status: 'present', detail: `${invDecs.length} 条不变量决策` }
    : { status: 'unknown', detail: '无不变量记录' };

  // 判定点 – infer from decision keywords
  const gateDecs = decisions.filter(d =>
    (d.topic?.includes('判定') || d.topic?.includes('gate') || d.topic?.includes('验收') || d.category === 'gate') &&
    (d.target_id === feature.id || d.target_id === feature.journey_id)
  );
  const gate: ElementCoverage = gateDecs.length > 0
    ? { status: 'present', detail: `${gateDecs.length} 条判定点记录` }
    : { status: 'unknown', detail: '无判定点记录' };

  // 保质期 – unit_test_path
  const ttl: ElementCoverage = feature.unit_test_path
    ? { status: 'present', detail: feature.unit_test_path }
    : { status: 'missing', detail: 'unit_test_path 未设置' };

  // 死亡告警 – no explicit tracking
  const death: ElementCoverage = { status: 'unknown', detail: '未接入监控告警系统' };

  // 失败语义 – infer from unit test path or test-related decisions
  const testDecs = decisions.filter(d =>
    (d.topic?.includes('失败') || d.topic?.includes('error') || d.category === 'test') &&
    (d.target_id === feature.id || d.target_id === feature.journey_id)
  );
  const failure: ElementCoverage = feature.unit_test_path || testDecs.length > 0
    ? { status: 'present', detail: '有测试路径/失败语义决策' }
    : { status: 'missing', detail: '无失败语义定义' };

  // 效果确认 – journey e2e_test_path
  const e2e: ElementCoverage = journey?.e2e_test_path
    ? { status: 'present', detail: journey.e2e_test_path }
    : { status: 'missing', detail: 'Journey e2e_test_path 未设置' };

  // 输入对抗面 – no explicit tracking
  const adversarial: ElementCoverage = { status: 'unknown', detail: '未设置对抗测试' };

  // 账本保鲜 – days since updated_at
  const days = daysSince(feature.updated_at);
  const freshness: ElementCoverage = days > STALE_DAYS
    ? { status: 'stale', detail: `${days} 天未更新`, daysOld: days }
    : { status: 'present', detail: `${days} 天前更新`, daysOld: days };

  // 两轴衔接 – area_id or journey linked to goals
  const linkedGoals = goals.filter(g =>
    g.area_id === feature.area_id ||
    (journey && g.area_id === journey.area_id)
  );
  const twoaxis: ElementCoverage = feature.area_id || linkedGoals.length > 0
    ? { status: 'present', detail: feature.area_id ? `area_id: ${feature.area_id.slice(0, 8)}` : `${linkedGoals.length} 个目标关联` }
    : { status: 'unknown', detail: '未关联能力轴/GTD 轴' };

  return { fr, nfr, invariant, gate, ttl, death, failure, e2e, adversarial, freshness, twoaxis };
}

function coverageScore(cov: Coverage): number {
  return ELEMENTS.filter(e => cov[e.key].status === 'present').length;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusIcon({ status, small }: { status: ElementStatus; small?: boolean }) {
  const sz = small ? 'w-3.5 h-3.5' : 'w-4 h-4';
  if (status === 'present') return <CheckCircle2 className={`${sz} text-emerald-400`} />;
  if (status === 'missing') return <XCircle className={`${sz} text-red-400`} />;
  if (status === 'stale') return <AlertTriangle className={`${sz} text-amber-400`} />;
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

// ─── Drilldown Panel ─────────────────────────────────────────────────────────

function DrilldownPanel({
  row,
  onClose,
}: {
  row: LedgerRow;
  onClose: () => void;
}) {
  const { feature, journey, coverage } = row;
  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-slate-900 border-l border-slate-700 z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-slate-700">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {row.isImportant && <Star className="w-4 h-4 text-amber-400 fill-current" />}
            <span className="text-white font-semibold text-sm leading-tight">{feature.name}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className="text-xs text-slate-400">{journey?.name ?? '(无 Lane)'}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{feature.kind}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{feature.status}</span>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />{new Date(feature.updated_at).toLocaleDateString('zh-CN')}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Element list */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {ELEMENTS.map(el => {
          const cov = coverage[el.key];
          return (
            <div key={el.key} className={`rounded-xl p-3.5 border ${
              cov.status === 'present' ? 'border-emerald-500/30 bg-emerald-500/5' :
              cov.status === 'missing' ? 'border-red-500/30 bg-red-500/5' :
              cov.status === 'stale'   ? 'border-amber-500/30 bg-amber-500/5' :
              'border-slate-700/60 bg-slate-800/40'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <StatusIcon status={cov.status} />
                <span className="text-sm font-medium text-white">{el.fullLabel}</span>
                <span className="text-xs text-slate-500 ml-auto">{el.label}</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{cov.detail}</p>
              {cov.ref && (
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />{cov.ref}
                </p>
              )}
              {cov.daysOld !== undefined && (
                <p className="text-xs text-slate-500 mt-1">{cov.daysOld} 天前</p>
              )}
              <p className="text-xs text-slate-600 mt-1 italic">{el.tooltip}</p>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-slate-700">
        <CoverageBar score={row.coverageScore} />
        <p className="text-xs text-slate-500 mt-1">
          {ELEMENTS.length - row.coverageScore} 项未覆盖 · {ELEMENTS.filter(e => coverage[e.key].status === 'unknown').length} 项未追踪
        </p>
      </div>
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

function LedgerTableRow({
  row,
  onClick,
  selected,
}: {
  row: LedgerRow;
  onClick: () => void;
  selected: boolean;
}) {
  const { feature, journey, coverage } = row;
  const days = daysSince(feature.updated_at);

  return (
    <tr
      onClick={onClick}
      className={`border-b border-slate-800/60 cursor-pointer transition-colors ${
        selected ? 'bg-slate-700/40' : 'hover:bg-slate-800/50'
      }`}
    >
      {/* Lane */}
      <td className="px-3 py-2.5 text-xs text-slate-400 max-w-[120px]">
        <span className="truncate block">{journey?.name?.replace(/^gp-agg-smoke-journey-.*/, '[smoke]') ?? '—'}</span>
      </td>

      {/* Function name */}
      <td className="px-3 py-2.5 max-w-[200px]">
        <div className="flex items-center gap-1.5">
          {row.isImportant && <Star className="w-3 h-3 text-amber-400 fill-current flex-shrink-0" />}
          <span className="text-sm text-white truncate">{feature.name}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`text-xs px-1 py-0 rounded ${
            feature.status === 'done' ? 'bg-emerald-500/20 text-emerald-400' :
            feature.status === 'working' ? 'bg-blue-500/20 text-blue-400' :
            'bg-slate-700 text-slate-400'
          }`}>{feature.status}</span>
          <span className="text-xs text-slate-600">{feature.kind}</span>
        </div>
      </td>

      {/* 11 elements */}
      {ELEMENTS.map(el => (
        <td key={el.key} className="px-2 py-2.5 text-center">
          <div className="flex justify-center">
            <StatusIcon status={coverage[el.key].status} small />
          </div>
        </td>
      ))}

      {/* Score */}
      <td className="px-3 py-2.5">
        <CoverageBar score={row.coverageScore} />
      </td>

      {/* Last updated */}
      <td className="px-3 py-2.5 text-xs text-right whitespace-nowrap">
        <span className={days > 30 ? 'text-amber-400' : 'text-slate-500'}>
          {days === 0 ? '今天' : `${days}d`}
        </span>
      </td>
    </tr>
  );
}

// ─── Lane group ────────────────────────────────────────────────────────────

function LaneGroup({
  journeyId,
  journeyName,
  rows,
  defaultExpanded,
  selectedId,
  onSelect,
}: {
  journeyId: string | null;
  journeyName: string;
  rows: LedgerRow[];
  defaultExpanded: boolean;
  selectedId: string | null;
  onSelect: (row: LedgerRow) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const avgScore = rows.reduce((s, r) => s + r.coverageScore, 0) / rows.length;
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
            {expanded
              ? <ChevronDown className="w-4 h-4 text-slate-400" />
              : <ChevronRight className="w-4 h-4 text-slate-400" />
            }
            <span className="text-sm font-semibold text-slate-200">
              {journeyName || '(无 Lane)'}
            </span>
            <span className="text-xs text-slate-500">{rows.length} 条</span>
            <span className={`text-xs font-bold ml-auto ${color}`}>{pct}%</span>
          </div>
        </td>
      </tr>
      {expanded && rows.map(row => (
        <LedgerTableRow
          key={row.feature.id}
          row={row}
          onClick={() => onSelect(row)}
          selected={selectedId === row.feature.id}
        />
      ))}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LedgerPage() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedRow, setSelectedRow] = useState<LedgerRow | null>(null);
  const [filterKind, setFilterKind] = useState<'all' | 'ability' | 'feature'>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [importantOnly, setImportantOnly] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [jRes, jfRes, dRes, gRes] = await Promise.all([
        fetch('/api/brain/journeys?limit=200'),
        fetch('/api/brain/journey_features?limit=500'),
        fetch('/api/brain/decisions?limit=500'),
        fetch('/api/brain/goals?limit=200'),
      ]);

      const [jData, jfData, dData, gData] = await Promise.all([
        jRes.ok ? jRes.json() : [],
        jfRes.ok ? jfRes.json() : [],
        dRes.ok ? dRes.json() : [],
        gRes.ok ? gRes.json() : [],
      ]);

      const journeys: Journey[] = Array.isArray(jData) ? jData : [];
      const features: JourneyFeature[] = Array.isArray(jfData) ? jfData : [];
      const decisions: Decision[] = Array.isArray(dData) ? dData : (dData?.decisions ?? []);
      const goals: Goal[] = Array.isArray(gData) ? gData : [];

      const journeyMap = Object.fromEntries(journeys.map(j => [j.id, j]));

      const built: LedgerRow[] = features
        .filter(f => f.name && !f.name.startsWith('gp-agg-smoke') && !f.name.startsWith('[smoke]'))
        .map(f => {
          const journey = f.journey_id ? journeyMap[f.journey_id] ?? null : null;
          const cov = computeCoverage(f, journey, decisions, goals);
          return {
            feature: f,
            journey,
            coverage: cov,
            isImportant: f.thickness === 'mature' || f.status === 'done',
            coverageScore: coverageScore(cov),
          };
        })
        .sort((a, b) => b.coverageScore - a.coverageScore);

      setRows(built);
      setError(null);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 60_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  // Filter
  const filtered = rows.filter(r => {
    if (filterKind !== 'all' && r.feature.kind !== filterKind) return false;
    if (filterStatus !== 'all' && r.feature.status !== filterStatus) return false;
    if (importantOnly && !r.isImportant) return false;
    return true;
  });

  // Group by journey
  const laneMap = new Map<string | null, { name: string; rows: LedgerRow[] }>();
  for (const row of filtered) {
    const key = row.feature.journey_id ?? null;
    if (!laneMap.has(key)) {
      laneMap.set(key, { name: row.journey?.name ?? '(无 Lane)', rows: [] });
    }
    laneMap.get(key)!.rows.push(row);
  }
  const lanes = Array.from(laneMap.entries()).sort((a, b) => {
    const as_ = a[1].rows.reduce((s, r) => s + r.coverageScore, 0) / a[1].rows.length;
    const bs_ = b[1].rows.reduce((s, r) => s + r.coverageScore, 0) / b[1].rows.length;
    return bs_ - as_;
  });

  const statusOptions = ['all', ...Array.from(new Set(rows.map(r => r.feature.status))).sort()];
  const totalPresent = rows.reduce((s, r) => s + r.coverageScore, 0);
  const totalPossible = rows.length * ELEMENTS.length;
  const overallPct = totalPossible > 0 ? Math.round((totalPresent / totalPossible) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
        <p className="text-red-400 text-sm">加载失败: {error}</p>
        <button onClick={fetchAll} className="mt-3 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg text-sm">重试</button>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className={`flex-1 min-w-0 flex flex-col overflow-hidden ${selectedRow ? 'mr-[420px]' : ''}`}>
        {/* Header */}
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-slate-700/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-violet-500 to-purple-700 rounded-xl">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">11要素账本</h1>
                <p className="text-xs text-slate-400">
                  {rows.length} 条 Function · 整体覆盖 {overallPct}%
                  {lastUpdated && (
                    <span className="ml-2">· {lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新</span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={fetchAll}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mb-4 text-xs">
            {[
              { status: 'present' as ElementStatus, label: '已覆盖' },
              { status: 'missing' as ElementStatus, label: '缺失' },
              { status: 'stale' as ElementStatus, label: '过期' },
              { status: 'unknown' as ElementStatus, label: '未追踪' },
            ].map(({ status, label }) => (
              <div key={status} className="flex items-center gap-1.5">
                <StatusIcon status={status} small />
                <span className="text-slate-400">{label}</span>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={filterKind}
              onChange={e => setFilterKind(e.target.value as typeof filterKind)}
              className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5"
            >
              <option value="all">全部类型</option>
              <option value="ability">ability</option>
              <option value="feature">feature</option>
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5"
            >
              {statusOptions.map(s => (
                <option key={s} value={s}>{s === 'all' ? '全部状态' : s}</option>
              ))}
            </select>
            <button
              onClick={() => setImportantOnly(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                importantOnly
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Star className="w-3 h-3" />
              重要
            </button>
            <span className="text-xs text-slate-500 ml-auto">{filtered.length} 条</span>
          </div>
        </div>

        {/* Table */}
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
                    title={el.fullLabel + '：' + el.tooltip}
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
                lanes.map(([journeyId, { name, rows: laneRows }]) => (
                  <LaneGroup
                    key={journeyId ?? '__no_lane__'}
                    journeyId={journeyId}
                    journeyName={name}
                    rows={laneRows}
                    defaultExpanded={laneRows.length <= 5}
                    selectedId={selectedRow?.feature.id ?? null}
                    onSelect={row => setSelectedRow(prev => prev?.feature.id === row.feature.id ? null : row)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drilldown */}
      {selectedRow && (
        <DrilldownPanel
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </div>
  );
}
