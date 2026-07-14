import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Shield,
} from 'lucide-react';

interface Feature {
  id: string;
  name: string;
  domain: string;
  area: string;
  priority: string;
  status: 'active' | 'inactive' | 'deprecated';
  description: string | null;
  smoke_cmd: string | null;
  smoke_status: 'passing' | 'failing' | 'unknown' | null;
  smoke_last_run: string | null;
  has_unit_test: boolean;
  has_integration_test: boolean;
  has_e2e: boolean;
  last_verified: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type ElementStatus = 'ok' | 'partial' | 'missing' | 'alert' | 'stale';

type LedgerMap = Record<string, ElementStatus>;

const ELEMENT_KEYS = [
  { key: 'fr', short: 'FR', label: '功能描述' },
  { key: 'nfr', short: 'NF', label: '非功能决策' },
  { key: 'invariant', short: 'IN', label: '不变量' },
  { key: 'checkpoints', short: 'JP', label: '测试覆盖' },
  { key: 'freshness', short: 'SL', label: '保质期' },
  { key: 'death_alert', short: 'DA', label: '死亡告警' },
  { key: 'failure_semantics', short: 'FS', label: '失败语义' },
  { key: 'effect_confirmed', short: 'EC', label: '效果确认' },
  { key: 'adversarial', short: 'AT', label: '对抗面' },
  { key: 'ledger_age', short: 'LF', label: '账本保鲜' },
  { key: 'axis_aligned', short: 'AA', label: '两轴衔接' },
] as const;

type ElementKey = (typeof ELEMENT_KEYS)[number]['key'];

function daysSince(isoStr: string | null): number | null {
  if (!isoStr) return null;
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000);
}

function computeLedger(feature: Feature): LedgerMap {
  const daysVerified = daysSince(feature.last_verified);
  const daysUpdated = daysSince(feature.updated_at);
  const testScore =
    (feature.has_unit_test ? 1 : 0) +
    (feature.has_integration_test ? 1 : 0) +
    (feature.has_e2e ? 1 : 0);

  return {
    fr: feature.description ? 'ok' : 'missing',
    nfr: feature.smoke_cmd ? 'partial' : 'missing',
    invariant:
      feature.notes && /铁律|invariant/i.test(feature.notes) ? 'ok' : 'missing',
    checkpoints:
      testScore === 3 ? 'ok' : testScore > 0 ? 'partial' : 'missing',
    freshness:
      daysVerified === null
        ? 'missing'
        : daysVerified <= 30
        ? 'ok'
        : daysVerified <= 90
        ? 'partial'
        : 'stale',
    death_alert:
      feature.smoke_status === 'failing'
        ? 'alert'
        : feature.smoke_status === 'passing'
        ? 'ok'
        : feature.smoke_cmd
        ? 'partial'
        : 'missing',
    failure_semantics: feature.notes ? 'ok' : 'missing',
    effect_confirmed:
      feature.smoke_status === 'passing'
        ? 'ok'
        : feature.smoke_cmd
        ? 'partial'
        : 'missing',
    adversarial:
      feature.notes && /对抗|adversar|攻击/i.test(feature.notes)
        ? 'ok'
        : 'missing',
    ledger_age:
      daysUpdated === null
        ? 'missing'
        : daysUpdated <= 7
        ? 'ok'
        : daysUpdated <= 30
        ? 'partial'
        : 'stale',
    axis_aligned:
      feature.priority && feature.status === 'active'
        ? 'ok'
        : feature.priority
        ? 'partial'
        : 'missing',
  };
}

function StatusDot({ status }: { status: ElementStatus }) {
  if (status === 'ok') {
    return <span className="text-emerald-400 text-sm leading-none">●</span>;
  }
  if (status === 'partial') {
    return <span className="text-yellow-400 text-sm leading-none">●</span>;
  }
  if (status === 'missing') {
    return <span className="text-slate-500 text-sm leading-none">○</span>;
  }
  if (status === 'stale') {
    return <span className="text-orange-400 text-sm leading-none">●</span>;
  }
  return (
    <span className="text-red-400 text-sm leading-none animate-pulse">⚠</span>
  );
}

function relativeTime(isoStr: string | null): string {
  if (!isoStr) return '—';
  const days = daysSince(isoStr);
  if (days === null) return '—';
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  if (days < 365) return `${Math.floor(days / 30)}个月前`;
  return `${Math.floor(days / 365)}年前`;
}

function priorityBadge(priority: string) {
  if (priority === 'P0')
    return (
      <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-red-900/60 text-red-300">
        P0
      </span>
    );
  if (priority === 'P1')
    return (
      <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-orange-900/60 text-orange-300">
        P1
      </span>
    );
  return (
    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-400">
      {priority || '—'}
    </span>
  );
}

function domainHealthScore(features: Feature[]): number {
  if (features.length === 0) return 0;
  let missingCount = 0;
  let total = 0;
  for (const f of features) {
    const ledger = computeLedger(f);
    for (const val of Object.values(ledger)) {
      total++;
      if (val === 'missing' || val === 'alert' || val === 'stale') missingCount++;
    }
  }
  return total === 0 ? 100 : Math.round(((total - missingCount) / total) * 100);
}

function HealthBar({ score }: { score: number }) {
  const color =
    score >= 80
      ? 'bg-emerald-500'
      : score >= 50
      ? 'bg-yellow-500'
      : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-slate-400">{score}%</span>
    </div>
  );
}

function DetailPanel({
  feature,
  onClose,
}: {
  feature: Feature;
  onClose: () => void;
}) {
  const ledger = computeLedger(feature);

  const statusLabel: Record<ElementStatus, string> = {
    ok: '完整',
    partial: '部分',
    missing: '缺失',
    alert: '告警',
    stale: '过期',
  };

  const elementDescriptions: Record<ElementKey, string> = {
    fr: feature.description || '（无功能描述）',
    nfr: feature.smoke_cmd
      ? `smoke_cmd: ${feature.smoke_cmd}`
      : '（无非功能决策）',
    invariant:
      feature.notes && /铁律|invariant/i.test(feature.notes)
        ? '在 notes 中检测到铁律/invariant 关键词'
        : '（notes 中未找到铁律关键词）',
    checkpoints: `unit: ${feature.has_unit_test ? '✓' : '✗'}  integration: ${feature.has_integration_test ? '✓' : '✗'}  e2e: ${feature.has_e2e ? '✓' : '✗'}`,
    freshness: feature.last_verified
      ? `最后验证：${relativeTime(feature.last_verified)}`
      : '（从未验证）',
    death_alert: feature.smoke_status
      ? `smoke 状态：${feature.smoke_status}`
      : '（无 smoke 命令）',
    failure_semantics: feature.notes ? '有 notes' : '（无 notes）',
    effect_confirmed:
      feature.smoke_status === 'passing'
        ? 'smoke 通过，效果已确认'
        : feature.smoke_cmd
        ? `smoke 状态：${feature.smoke_status || '未知'}`
        : '（无 smoke 命令）',
    adversarial:
      feature.notes && /对抗|adversar|攻击/i.test(feature.notes)
        ? '在 notes 中检测到对抗关键词'
        : '（未记录对抗面）',
    ledger_age: `最后更新：${relativeTime(feature.updated_at)}`,
    axis_aligned:
      feature.priority && feature.status === 'active'
        ? `priority=${feature.priority}，status=active`
        : `priority=${feature.priority || '无'}，status=${feature.status}`,
  };

  return (
    <div className="flex flex-col h-full bg-slate-850 border-l border-slate-700 overflow-hidden">
      <div className="flex items-start justify-between p-4 border-b border-slate-700 flex-shrink-0">
        <div className="min-w-0 flex-1 pr-2">
          <h2 className="font-semibold text-white text-sm leading-tight break-all">
            {feature.name}
          </h2>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300">
              {feature.domain}
            </span>
            <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300">
              {feature.area}
            </span>
            {priorityBadge(feature.priority)}
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                feature.status === 'active'
                  ? 'bg-emerald-900/60 text-emerald-300'
                  : feature.status === 'deprecated'
                  ? 'bg-red-900/60 text-red-300'
                  : 'bg-slate-700 text-slate-400'
              }`}
            >
              {feature.status}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            11 要素
          </h3>
          <div className="space-y-2">
            {ELEMENT_KEYS.map(({ key, short, label }) => {
              const s = ledger[key];
              return (
                <div
                  key={key}
                  className="flex items-start gap-3 p-2 rounded bg-slate-800/60"
                >
                  <div className="flex items-center gap-1.5 w-24 flex-shrink-0 pt-0.5">
                    <StatusDot status={s} />
                    <span className="text-xs font-mono text-slate-400">{short}</span>
                    <span className="text-xs text-slate-500">{label}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span
                      className={`text-xs ${
                        s === 'ok'
                          ? 'text-emerald-300'
                          : s === 'alert'
                          ? 'text-red-300'
                          : s === 'stale'
                          ? 'text-orange-300'
                          : s === 'partial'
                          ? 'text-yellow-300'
                          : 'text-slate-500'
                      }`}
                    >
                      {statusLabel[s]}
                    </span>
                    <p className="text-xs text-slate-400 mt-0.5 break-words">
                      {elementDescriptions[key]}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {feature.smoke_cmd && (
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Smoke Test
            </h3>
            <div className="bg-slate-800 rounded p-3 space-y-1.5">
              <div className="font-mono text-xs text-slate-300 break-all">
                {feature.smoke_cmd}
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span
                  className={`flex items-center gap-1 ${
                    feature.smoke_status === 'passing'
                      ? 'text-emerald-400'
                      : feature.smoke_status === 'failing'
                      ? 'text-red-400'
                      : 'text-slate-400'
                  }`}
                >
                  {feature.smoke_status === 'passing' ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : feature.smoke_status === 'failing' ? (
                    <AlertTriangle className="w-3 h-3" />
                  ) : (
                    <Circle className="w-3 h-3" />
                  )}
                  {feature.smoke_status || 'unknown'}
                </span>
                {feature.smoke_last_run && (
                  <span className="text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {relativeTime(feature.smoke_last_run)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            测试覆盖
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Unit', val: feature.has_unit_test },
              { label: 'Integration', val: feature.has_integration_test },
              { label: 'E2E', val: feature.has_e2e },
            ].map(({ label, val }) => (
              <div
                key={label}
                className={`p-2 rounded text-center ${
                  val ? 'bg-emerald-900/40' : 'bg-slate-800'
                }`}
              >
                <div
                  className={`text-xs font-medium ${
                    val ? 'text-emerald-300' : 'text-slate-500'
                  }`}
                >
                  {val ? '✓' : '✗'}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {feature.notes && (
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Notes
            </h3>
            <div className="bg-slate-800 rounded p-3 text-xs text-slate-300 whitespace-pre-wrap break-words">
              {feature.notes}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            时间记录
          </h3>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">最后验证</span>
              <span className="text-slate-300">{relativeTime(feature.last_verified)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">最后更新</span>
              <span className="text-slate-300">{relativeTime(feature.updated_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">创建时间</span>
              <span className="text-slate-300">{relativeTime(feature.created_at)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LedgerPage() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState<'all' | 'zenithjoy' | 'cecelia'>('all');
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(new Set());
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/brain/features?limit=500');
      if (res.ok) {
        const data = await res.json();
        setFeatures(data.features || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (features.length === 0) return;
    const domains = [...new Set(features.map((f) => f.domain))].sort();
    const toCollapse = new Set(domains.slice(3));
    setCollapsedDomains(toCollapse);
  }, [features.length > 0]);

  const filtered = useMemo(() => {
    let list = features;
    if (areaFilter !== 'all') {
      list = list.filter((f) => f.area === areaFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.domain.toLowerCase().includes(q)
      );
    }
    return list;
  }, [features, search, areaFilter]);

  const grouped = useMemo(() => {
    const map: Record<string, Feature[]> = {};
    for (const f of filtered) {
      if (!map[f.domain]) map[f.domain] = [];
      map[f.domain].push(f);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const totalStats = useMemo(() => {
    let okCount = 0;
    let missingCount = 0;
    for (const f of filtered) {
      const l = computeLedger(f);
      for (const v of Object.values(l)) {
        if (v === 'ok') okCount++;
        if (v === 'missing' || v === 'alert') missingCount++;
      }
    }
    return { total: filtered.length, ok: okCount, missing: missingCount };
  }, [filtered]);

  const toggleDomain = (domain: string) => {
    setCollapsedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  return (
    <div className="h-full overflow-hidden flex flex-col bg-slate-900 text-slate-200">
      <div className="flex-shrink-0 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-blue-400 flex-shrink-0" />
            <h1 className="text-base font-semibold text-white">11 要素账本</h1>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>
                <span className="text-white font-medium">{totalStats.total}</span> features
              </span>
              <span className="text-emerald-400">
                <span className="font-medium">{totalStats.ok}</span> ok
              </span>
              <span className="text-slate-500">
                <span className="font-medium">{totalStats.missing}</span> missing
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索..."
                className="pl-8 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500 w-44"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded p-0.5">
              <Filter className="w-3 h-3 text-slate-500 ml-1.5" />
              {(['all', 'zenithjoy', 'cecelia'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAreaFilter(a)}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    areaFilter === a
                      ? 'bg-slate-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {a === 'all' ? '全部' : a}
                </button>
              ))}
            </div>

            <button
              onClick={fetchData}
              className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        <div
          className={`flex flex-col overflow-hidden transition-all duration-200 ${
            selectedFeature ? 'flex-1' : 'w-full'
          }`}
        >
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-800">
                <tr>
                  <th className="text-left px-3 py-2 text-slate-400 font-medium w-48 border-b border-slate-700">
                    Feature
                  </th>
                  <th className="text-center px-1.5 py-2 text-slate-400 font-mono font-medium border-b border-slate-700 w-6">
                    P
                  </th>
                  {ELEMENT_KEYS.map(({ key, short }) => (
                    <th
                      key={key}
                      className="text-center px-1 py-2 text-slate-400 font-mono font-medium border-b border-slate-700 w-8"
                      title={ELEMENT_KEYS.find((e) => e.key === key)?.label}
                    >
                      {short}
                    </th>
                  ))}
                  <th className="text-right px-3 py-2 text-slate-400 font-medium border-b border-slate-700 w-20">
                    更新
                  </th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([domain, domainFeatures]) => {
                  const isCollapsed = collapsedDomains.has(domain);
                  const score = domainHealthScore(domainFeatures);

                  return [
                    <tr
                      key={`domain-${domain}`}
                      onClick={() => toggleDomain(domain)}
                      className="cursor-pointer hover:bg-slate-800/70 bg-slate-800/40 select-none"
                    >
                      <td className="px-3 py-2 border-b border-slate-700/50" colSpan={2}>
                        <div className="flex items-center gap-2">
                          {isCollapsed ? (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                          )}
                          <span className="font-semibold text-slate-200 text-xs">
                            {domain}
                          </span>
                          <span className="text-slate-500">
                            ({domainFeatures.length})
                          </span>
                        </div>
                      </td>
                      <td
                        className="border-b border-slate-700/50"
                        colSpan={ELEMENT_KEYS.length}
                      >
                        <HealthBar score={score} />
                      </td>
                      <td className="border-b border-slate-700/50 px-3" />
                    </tr>,

                    ...(!isCollapsed
                      ? domainFeatures.map((feature) => {
                          const ledger = computeLedger(feature);
                          const isSelected = selectedFeature?.id === feature.id;

                          return (
                            <tr
                              key={feature.id}
                              onClick={() =>
                                setSelectedFeature(
                                  isSelected ? null : feature
                                )
                              }
                              className={`cursor-pointer border-b border-slate-800 transition-colors ${
                                isSelected
                                  ? 'bg-blue-900/30'
                                  : 'hover:bg-slate-800/50'
                              }`}
                            >
                              <td className="px-3 py-1.5">
                                <span
                                  className={`text-xs ${
                                    feature.status === 'deprecated'
                                      ? 'text-slate-500 line-through'
                                      : 'text-slate-200'
                                  }`}
                                >
                                  {feature.name}
                                </span>
                              </td>
                              <td className="px-1.5 py-1.5 text-center">
                                {priorityBadge(feature.priority)}
                              </td>
                              {ELEMENT_KEYS.map(({ key }) => (
                                <td
                                  key={key}
                                  className="py-1.5 text-center"
                                >
                                  <StatusDot status={ledger[key]} />
                                </td>
                              ))}
                              <td className="px-3 py-1.5 text-right text-slate-500">
                                {relativeTime(feature.updated_at)}
                              </td>
                            </tr>
                          );
                        })
                      : []),
                  ];
                })}

                {grouped.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={ELEMENT_KEYS.length + 3}
                      className="text-center py-12 text-slate-500"
                    >
                      无匹配数据
                    </td>
                  </tr>
                )}

                {loading && features.length === 0 && (
                  <tr>
                    <td
                      colSpan={ELEMENT_KEYS.length + 3}
                      className="text-center py-12 text-slate-500"
                    >
                      加载中...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedFeature && (
          <div className="w-80 flex-shrink-0 overflow-hidden flex flex-col">
            <DetailPanel
              feature={selectedFeature}
              onClose={() => setSelectedFeature(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
