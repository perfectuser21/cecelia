/**
 * FeatureLedgerPage — 11要素账本状态（运维自用）
 *
 * 每行 = 一个 function/feature，11列 = 11要素状态
 * 支持按 domain 分组，点击行下钻详情，标注重要性，显示最近更新
 */

import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Circle, X } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

type ElementStatus = 'ok' | 'partial' | 'missing' | 'stale' | 'alert' | 'unknown';

interface LedgerStatus {
  fr: ElementStatus;
  nfr: ElementStatus;
  invariant: ElementStatus;
  checkpoints: number;
  checkpoints_max: number;
  checkpoints_status: ElementStatus;
  freshness_days: number | null;
  freshness_status: ElementStatus;
  death_alert: ElementStatus;
  failure_semantics: ElementStatus;
  effect_confirmed: ElementStatus;
  adversarial: ElementStatus;
  ledger_age_days: number | null;
  ledger_status: ElementStatus;
  axis_aligned: ElementStatus;
}

interface Feature {
  id: string;
  name: string;
  domain: string;
  area: string | null;
  priority: string | null;
  status: string;
  description: string | null;
  smoke_cmd: string | null;
  smoke_status: string | null;
  smoke_last_run: string | null;
  has_unit_test: boolean;
  has_integration_test: boolean;
  has_e2e: boolean;
  last_verified: string | null;
  notes: string | null;
  updated_at: string;
  ledger: LedgerStatus;
}

interface DomainGroup {
  domain: string;
  items: Feature[];
}

interface LedgerResponse {
  domains: DomainGroup[];
  total: number;
  generated_at: string;
}

// ── 11要素配置 ──────────────────────────────────────────────

const ELEMENTS: Array<{
  key: keyof LedgerStatus;
  label: string;
  abbr: string;
  tip: string;
}> = [
  { key: 'fr',                label: '功能定义',  abbr: 'FR',   tip: '功能描述是否完整' },
  { key: 'nfr',               label: '非功能',    abbr: 'NFR',  tip: '非功能决策（性能/安全等）' },
  { key: 'invariant',         label: '不变量',    abbr: 'Inv',  tip: '系统铁律/不可违反的约束' },
  { key: 'checkpoints_status',label: '判定点',    abbr: '判',   tip: `测试覆盖：单元/集成/E2E` },
  { key: 'freshness_status',  label: '保质期',    abbr: '保',   tip: '上次验证距今天数（<30天=绿）' },
  { key: 'death_alert',       label: '死亡告警',  abbr: '死',   tip: 'Smoke 失败 = 死亡告警触发' },
  { key: 'failure_semantics', label: '失败语义',  abbr: '语',   tip: '明确描述了什么叫失败' },
  { key: 'effect_confirmed',  label: '效果确认',  abbr: '效',   tip: 'Smoke 通过 = 效果已确认' },
  { key: 'adversarial',       label: '对抗面',    abbr: '抗',   tip: '输入对抗面/边界条件已覆盖' },
  { key: 'ledger_status',     label: '账本保鲜',  abbr: '鲜',   tip: '账本记录最近更新天数（<7天=绿）' },
  { key: 'axis_aligned',      label: '两轴衔接',  abbr: '轴',   tip: '已纳入目标轴（priority + active）' },
];

// ── Helpers ──────────────────────────────────────────────────

const STATUS_STYLE: Record<ElementStatus, { cell: string; dot: string; label: string }> = {
  ok:      { cell: 'bg-emerald-900/30 text-emerald-300 border-emerald-800/40', dot: 'bg-emerald-400', label: '✓' },
  partial: { cell: 'bg-amber-900/30 text-amber-300 border-amber-800/40',       dot: 'bg-amber-400',   label: '~' },
  missing: { cell: 'bg-slate-800/60 text-slate-500 border-slate-700/40',       dot: 'bg-slate-600',   label: '—' },
  stale:   { cell: 'bg-orange-900/30 text-orange-300 border-orange-800/40',    dot: 'bg-orange-400',  label: '↻' },
  alert:   { cell: 'bg-red-900/40 text-red-300 border-red-800/40',             dot: 'bg-red-400',     label: '!' },
  unknown: { cell: 'bg-slate-800/60 text-slate-400 border-slate-700/40',       dot: 'bg-slate-500',   label: '?' },
};

const PRIORITY_STYLE: Record<string, string> = {
  P0: 'bg-red-900/50 text-red-300 border-red-800/50',
  P1: 'bg-orange-900/40 text-orange-300 border-orange-800/50',
  P2: 'bg-blue-900/30 text-blue-300 border-blue-800/40',
  P3: 'bg-slate-800/60 text-slate-400 border-slate-700/40',
};

function daysAgoLabel(days: number | null): string {
  if (days === null) return '从未';
  if (days === 0) return '今天';
  if (days === 1) return '1天前';
  return `${days}天前`;
}

function domainHealthScore(items: Feature[]): number {
  let ok = 0, total = 0;
  for (const f of items) {
    for (const el of ELEMENTS) {
      const s = f.ledger[el.key] as ElementStatus;
      total++;
      if (s === 'ok') ok++;
      else if (s === 'partial') ok += 0.5;
    }
  }
  return total === 0 ? 0 : Math.round((ok / total) * 100);
}

function StatusCell({ status, extra }: { status: ElementStatus; extra?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center justify-center w-8 h-7 rounded text-xs font-mono border ${s.cell}`}
          title={status}>
      {extra || s.label}
    </span>
  );
}

function formatUpdated(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Detail Panel ─────────────────────────────────────────────

function DetailPanel({ feature, onClose }: { feature: Feature; onClose: () => void }) {
  const l = feature.ledger;
  return (
    <div className="mt-1 mb-3 mx-4 rounded-lg border border-slate-700 bg-slate-800/80 p-4 text-sm">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="font-semibold text-white">{feature.name}</span>
          <span className="ml-2 text-slate-400 font-mono text-xs">{feature.id}</span>
          {feature.priority && (
            <span className={`ml-2 px-1.5 py-0.5 rounded border text-xs font-mono ${PRIORITY_STYLE[feature.priority] || PRIORITY_STYLE.P3}`}>
              {feature.priority}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="space-y-1.5">
          {feature.description && (
            <div><span className="text-slate-500">描述：</span><span className="text-slate-300">{feature.description}</span></div>
          )}
          {feature.notes && (
            <div><span className="text-slate-500">备注：</span><span className="text-slate-300">{feature.notes}</span></div>
          )}
          {feature.smoke_cmd && (
            <div>
              <span className="text-slate-500">Smoke：</span>
              <code className="text-slate-300 bg-slate-900/60 px-1 rounded text-xs">{feature.smoke_cmd}</code>
              {feature.smoke_status && (
                <span className={`ml-1 ${feature.smoke_status === 'passing' ? 'text-emerald-400' : 'text-red-400'}`}>
                  ({feature.smoke_status})
                </span>
              )}
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="grid grid-cols-3 gap-1">
            <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${feature.has_unit_test ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
              {feature.has_unit_test ? <CheckCircle2 size={10} /> : <Circle size={10} />} Unit
            </span>
            <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${feature.has_integration_test ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
              {feature.has_integration_test ? <CheckCircle2 size={10} /> : <Circle size={10} />} Intg
            </span>
            <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${feature.has_e2e ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
              {feature.has_e2e ? <CheckCircle2 size={10} /> : <Circle size={10} />} E2E
            </span>
          </div>
          <div className="text-slate-400">
            <span>上次验证：</span>
            <span className="text-slate-300">{daysAgoLabel(l.freshness_days)}</span>
            <span className="ml-3">账本更新：</span>
            <span className="text-slate-300">{daysAgoLabel(l.ledger_age_days)}</span>
          </div>
          <div className="text-slate-400">
            <span>状态：</span>
            <span className={`${feature.status === 'active' ? 'text-emerald-400' : 'text-slate-400'}`}>{feature.status}</span>
            <span className="ml-3">Area：</span>
            <span className="text-slate-300">{feature.area || '—'}</span>
          </div>
        </div>
      </div>

      {/* 11要素详细状态 */}
      <div className="mt-3 pt-3 border-t border-slate-700">
        <div className="grid grid-cols-3 gap-1.5">
          {ELEMENTS.map(el => {
            const status = feature.ledger[el.key] as ElementStatus;
            const s = STATUS_STYLE[status];
            return (
              <div key={el.key} className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${s.cell}`} title={el.tip}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                <span className="text-slate-400 mr-0.5">{el.abbr}</span>
                <span className="font-medium truncate">{el.label}</span>
                <span className="ml-auto font-mono">{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Domain Group Row ──────────────────────────────────────────

function DomainSection({
  group,
  showImportant,
  expandedFeature,
  onSelectFeature,
}: {
  group: DomainGroup;
  showImportant: boolean;
  expandedFeature: string | null;
  onSelectFeature: (id: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const health = domainHealthScore(group.items);

  const items = showImportant
    ? group.items.filter(f => f.priority === 'P0' || f.priority === 'P1')
    : group.items;

  if (items.length === 0) return null;

  const alerts = items.filter(f => f.ledger.death_alert === 'alert').length;
  const healthColor = health >= 70 ? 'text-emerald-400' : health >= 40 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="mb-1">
      {/* Domain header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-800/80 hover:bg-slate-800 rounded-lg text-sm font-medium text-slate-300 transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        {collapsed ? <ChevronRight size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
        <span className="text-slate-200">{group.domain}</span>
        <span className="text-slate-500 text-xs">({items.length})</span>
        {alerts > 0 && (
          <span className="flex items-center gap-1 text-red-400 text-xs">
            <AlertTriangle size={12} /> {alerts} 告警
          </span>
        )}
        <span className={`ml-auto text-xs font-mono ${healthColor}`}>{health}%</span>
      </button>

      {!collapsed && (
        <div className="mt-0.5">
          {items.map(feature => (
            <div key={feature.id}>
              <button
                className={`w-full flex items-center gap-1 px-3 py-1.5 text-left hover:bg-slate-800/40 rounded transition-colors ${expandedFeature === feature.id ? 'bg-slate-800/60' : ''}`}
                onClick={() => onSelectFeature(expandedFeature === feature.id ? null : feature.id)}
              >
                {/* Priority */}
                <span className={`w-7 text-center text-xs font-mono px-0.5 py-0.5 rounded border flex-shrink-0 ${PRIORITY_STYLE[feature.priority || ''] || 'text-slate-600 border-slate-700'}`}>
                  {feature.priority || '—'}
                </span>

                {/* Name */}
                <span className="w-44 text-sm text-slate-300 truncate flex-shrink-0 ml-1">
                  {feature.name}
                </span>

                {/* 11 element cells */}
                <div className="flex items-center gap-0.5 flex-1">
                  {ELEMENTS.map(el => {
                    const status = feature.ledger[el.key] as ElementStatus;
                    if (el.key === 'checkpoints_status') {
                      const extra = `${feature.ledger.checkpoints}/${feature.ledger.checkpoints_max}`;
                      return <StatusCell key={el.key} status={status} extra={extra} />;
                    }
                    if (el.key === 'freshness_status' && feature.ledger.freshness_days !== null) {
                      const d = feature.ledger.freshness_days;
                      const extra = d > 99 ? '99+' : `${d}d`;
                      return <StatusCell key={el.key} status={status} extra={extra} />;
                    }
                    if (el.key === 'ledger_status' && feature.ledger.ledger_age_days !== null) {
                      const d = feature.ledger.ledger_age_days;
                      const extra = d > 99 ? '99+' : `${d}d`;
                      return <StatusCell key={el.key} status={status} extra={extra} />;
                    }
                    return <StatusCell key={el.key} status={status} />;
                  })}
                </div>

                {/* Last updated */}
                <span className="text-xs text-slate-500 ml-2 flex-shrink-0 w-24 text-right">
                  {formatUpdated(feature.updated_at)}
                </span>
              </button>

              {expandedFeature === feature.id && (
                <DetailPanel feature={feature} onClose={() => onSelectFeature(null)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Summary Bar ───────────────────────────────────────────────

function SummaryBar({ data }: { data: LedgerResponse }) {
  const allFeatures = data.domains.flatMap(d => d.items);
  const alerts = allFeatures.filter(f => f.ledger.death_alert === 'alert').length;
  const p0p1 = allFeatures.filter(f => f.priority === 'P0' || f.priority === 'P1').length;

  const elementHealth = ELEMENTS.map(el => {
    const ok = allFeatures.filter(f => (f.ledger[el.key] as ElementStatus) === 'ok').length;
    return { ...el, ok, pct: Math.round((ok / allFeatures.length) * 100) };
  });

  const weakest = [...elementHealth].sort((a, b) => a.pct - b.pct).slice(0, 3);

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      <div className="bg-slate-800/60 rounded-lg border border-slate-700 p-3 text-center">
        <div className="text-2xl font-bold text-white">{allFeatures.length}</div>
        <div className="text-xs text-slate-400 mt-0.5">功能总数</div>
      </div>
      <div className={`rounded-lg border p-3 text-center ${alerts > 0 ? 'bg-red-900/30 border-red-800/50' : 'bg-slate-800/60 border-slate-700'}`}>
        <div className={`text-2xl font-bold ${alerts > 0 ? 'text-red-300' : 'text-emerald-400'}`}>{alerts}</div>
        <div className="text-xs text-slate-400 mt-0.5">死亡告警</div>
      </div>
      <div className="bg-slate-800/60 rounded-lg border border-slate-700 p-3 text-center">
        <div className="text-2xl font-bold text-orange-300">{p0p1}</div>
        <div className="text-xs text-slate-400 mt-0.5">P0/P1 重要功能</div>
      </div>
      <div className="bg-slate-800/60 rounded-lg border border-slate-700 p-3">
        <div className="text-xs text-slate-400 mb-1">薄弱要素 Top 3</div>
        {weakest.map(el => (
          <div key={el.key} className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 w-5">{el.abbr}</span>
            <div className="flex-1 bg-slate-700 rounded-full h-1.5">
              <div className="bg-amber-400 h-1.5 rounded-full" style={{ width: `${el.pct}%` }} />
            </div>
            <span className="text-amber-300 w-8 text-right">{el.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export default function FeatureLedgerPage() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showImportant, setShowImportant] = useState(false);
  const [domainFilter, setDomainFilter] = useState('');
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);

  const fetchData = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/brain/features/ledger');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filteredDomains = useMemo(() => {
    if (!data) return [];
    if (!domainFilter) return data.domains;
    return data.domains.filter(d => d.domain.toLowerCase().includes(domainFilter.toLowerCase()));
  }, [data, domainFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 text-red-400">
        <AlertTriangle size={32} />
        <p className="text-sm">{error}</p>
        <button onClick={() => fetchData()} className="text-blue-400 hover:text-blue-300 text-sm underline">
          重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-white">11要素账本</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {data.total} 个功能 · 生成于 {new Date(data.generated_at).toLocaleString('zh-CN')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showImportant}
              onChange={e => setShowImportant(e.target.checked)}
              className="rounded"
            />
            仅 P0/P1
          </label>
          <input
            type="text"
            placeholder="过滤 domain…"
            value={domainFilter}
            onChange={e => setDomainFilter(e.target.value)}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 placeholder-slate-500 w-32 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-300 transition-colors"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {/* Summary */}
      <SummaryBar data={data} />

      {/* Column headers */}
      <div className="flex items-center gap-1 px-3 py-1.5 mb-1 text-xs text-slate-500 font-medium">
        <span className="w-7 flex-shrink-0">优先</span>
        <span className="w-44 flex-shrink-0 ml-1">功能名称</span>
        <div className="flex items-center gap-0.5 flex-1">
          {ELEMENTS.map(el => (
            <span
              key={el.key}
              className="w-8 text-center flex-shrink-0 cursor-help"
              title={`${el.label}：${el.tip}`}
            >
              {el.abbr}
            </span>
          ))}
        </div>
        <span className="w-24 text-right flex-shrink-0">最近更新</span>
      </div>

      {/* Domain groups */}
      <div className="space-y-1">
        {filteredDomains.map(group => (
          <DomainSection
            key={group.domain}
            group={group}
            showImportant={showImportant}
            expandedFeature={expandedFeature}
            onSelectFeature={setExpandedFeature}
          />
        ))}
        {filteredDomains.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm">无匹配结果</div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-6 flex items-center gap-4 text-xs text-slate-500 border-t border-slate-800 pt-3">
        <span>图例：</span>
        {Object.entries(STATUS_STYLE).map(([status, s]) => (
          <span key={status} className={`flex items-center gap-1 px-2 py-0.5 rounded border ${s.cell}`}>
            <span className={`w-2 h-2 rounded-full ${s.dot}`} />
            {s.label} {status}
          </span>
        ))}
      </div>
    </div>
  );
}
