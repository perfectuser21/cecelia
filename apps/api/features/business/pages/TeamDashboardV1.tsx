/**
 * TeamDashboardV1 — 团队数据一览
 * 面向非工程师，每日打开一眼知全局
 *
 * KR 进度与机器集群资源状态。
 */

import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  Target,
  Cpu,
  Clock,
  AlertCircle,
} from 'lucide-react';
import {
  fetchOkrCurrent,
  fetchClusterStatus,
  type OkrData,
  type ClusterStatus,
} from '../api/team-dashboard.api';

// ── 工具 ──────────────────────────────────────────────

function fmtSH(): string {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── 子组件 ────────────────────────────────────────────

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div
    className={`rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 shadow-md ${className}`}
  >
    {children}
  </div>
);

const CardHeader = ({
  icon: Icon,
  title,
  subtitle,
  color = 'blue',
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  color?: 'blue' | 'emerald' | 'violet' | 'amber' | 'rose';
}) => {
  const cls = {
    blue:   'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    emerald:'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    violet: 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
    amber:  'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    rose:   'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400',
  }[color];

  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
      <div className={`p-2 rounded-xl ${cls}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
          {title}
        </h3>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
};

const EmptyState = ({ msg }: { msg: string }) => (
  <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-500 gap-2">
    <Clock className="w-8 h-8 opacity-40" />
    <p className="text-sm">{msg}</p>
  </div>
);

const ProgressBar = ({
  value,
  max,
  color = 'blue',
  label,
}: {
  value: number;
  max: number;
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'violet';
  label?: string;
}) => {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const colorCls = {
    blue:   'bg-blue-500',
    emerald:'bg-emerald-500',
    amber:  'bg-amber-400',
    rose:   'bg-rose-500',
    violet: 'bg-violet-500',
  }[color];

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>{label}</span>
          <span>{pct}%</span>
        </div>
      )}
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorCls}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// ── KR 进度 ──────────────────────────────────

const KrProgressPanel = ({ data }: { data: OkrData | null }) => {
  const allKrs = data?.objectives.flatMap((o) => o.key_results) ?? [];
  const activeKrs = allKrs.filter((k) => k.status === 'active');

  return (
    <Card>
      <CardHeader icon={Target} title="KR 进度" subtitle={`${activeKrs.length} 个活跃 KR`} color="amber" />
      <div className="p-5 space-y-4">
        {activeKrs.length > 0 ? (
          activeKrs.map((kr) => (
            <div key={kr.id} className="space-y-1.5">
              <div className="flex justify-between items-start gap-2">
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug line-clamp-2 flex-1">
                  {kr.title}
                </p>
                <span className={`text-xs font-semibold shrink-0 ${
                  kr.progress_pct >= 80 ? 'text-emerald-600' :
                  kr.progress_pct >= 40 ? 'text-amber-500' : 'text-slate-400'
                }`}>
                  {kr.progress_pct}%
                </span>
              </div>
              <ProgressBar
                value={kr.progress_pct}
                max={100}
                color={
                  kr.progress_pct >= 80 ? 'emerald' :
                  kr.progress_pct >= 40 ? 'amber' : 'blue'
                }
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>当前 {kr.current_value} {kr.unit}</span>
                <span>目标 {kr.target_value} {kr.unit}</span>
              </div>
            </div>
          ))
        ) : (
          <EmptyState msg="暂无活跃 KR" />
        )}
      </div>
    </Card>
  );
};

// ── 算力利用率 ───────────────────────────────

const clusterUtil = 'clusterUtil';

const ClusterUtilPanel = ({ data }: { data: ClusterStatus | null }) => {
  const cluster = data?.cluster;
  const usedPct = cluster
    ? Math.round((cluster.total_used / Math.max(cluster.total_slots, 1)) * 100)
    : 0;

  return (
    <Card>
      <CardHeader icon={Cpu} title="算力利用率" subtitle="实时" color="rose" />
      <div className="p-5 space-y-4">
        {cluster ? (
          <>
            {/* 总览 */}
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Slot 占用 {cluster.total_used}/{cluster.total_slots}
                </span>
                <span className={`font-semibold ${
                  usedPct >= 80 ? 'text-rose-500' :
                  usedPct >= 50 ? 'text-amber-500' : 'text-emerald-600'
                }`}>{usedPct}%</span>
              </div>
              <ProgressBar
                value={cluster.total_used}
                max={cluster.total_slots}
                color={usedPct >= 80 ? 'rose' : usedPct >= 50 ? 'amber' : 'emerald'}
              />
            </div>

            {/* 各节点 */}
            <div className="space-y-3 pt-1">
              {cluster.servers.map((srv) => {
                const slotPct = Math.round((srv.slots.used / Math.max(srv.slots.dynamic_max, 1)) * 100);
                return (
                  <div key={srv.id} className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
                        {srv.location} {srv.name}
                        <span className={`w-1.5 h-1.5 rounded-full inline-block ${
                          srv.status === 'online' ? 'bg-emerald-500' : 'bg-slate-400'
                        }`} />
                      </span>
                      <span className="text-xs text-slate-400">
                        CPU {srv.resources.cpu_pct}% · 内存 {srv.resources.mem_used_pct}%
                      </span>
                    </div>
                    <ProgressBar
                      value={srv.slots.used}
                      max={srv.slots.dynamic_max}
                      color={slotPct >= 80 ? 'rose' : slotPct >= 50 ? 'amber' : 'blue'}
                      label={`Slot ${srv.slots.used}/${srv.slots.dynamic_max}`}
                    />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState msg="获取集群状态中..." />
        )}
      </div>
    </Card>
  );
};

// ── 主页面 ────────────────────────────────────────────

export default function TeamDashboardV1() {
  const [okrData, setOkrData] = useState<OkrData | null>(null);
  const [clusterData, setClusterData] = useState<ClusterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [okr, cluster] = await Promise.allSettled([
        fetchOkrCurrent(),
        fetchClusterStatus(),
      ]);

      if (okr.status === 'fulfilled') setOkrData(okr.value);
      if (cluster.status === 'fulfilled') setClusterData(cluster.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : '数据加载失败');
    } finally {
      setLoading(false);
      setLastRefresh(fmtSH());
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000); // 1min 自动刷新
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            团队 Dashboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            目标进度 · 系统资源 · 一眼全局
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-slate-400">
              更新于 {lastRefresh}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <KrProgressPanel data={okrData} />
        <ClusterUtilPanel data={clusterData} />
      </div>
    </div>
  );
}
