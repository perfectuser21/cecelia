/**
 * TeamDashboardV1 — 团队数据一览
 * 面向非工程师，每日打开一眼知全局
 *
 * 5 个面板：
 *  publishStats     昨日发布统计（目标 5条/天）
 *  successRate      各平台发布成功率
 *  contentRanking   近7日内容效果排行
 *  krProgress       KR 进度可视化
 *  clusterUtil      算力利用率实时
 */

import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  BarChart2,
  Target,
  Cpu,
  TrendingUp,
  Clock,
  AlertCircle,
} from 'lucide-react';
import {
  fetchPublishStats,
  fetchOkrCurrent,
  fetchClusterStatus,
  fetchContentPerformance,
  type PublishStats,
  type OkrData,
  type ClusterStatus,
  type ContentPerformance,
} from '../api/team-dashboard.api';

// ── 工具 ──────────────────────────────────────────────

const DAILY_TARGET = 5; // 目标每天发布条数

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

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  kuaishou: '快手',
  xiaohongshu: '小红书',
  wechat: '公众号',
  weibo: '微博',
  zhihu: '知乎',
  toutiao: '头条',
};

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

// ── 面板 1: 昨日发布统计 ──────────────────────────────

const publishStats = 'publishStats';

const PublishStatsPanel = ({ data }: { data: PublishStats | null }) => {
  const total = data?.total ?? 0;
  const color = total >= DAILY_TARGET ? 'emerald' : total >= DAILY_TARGET / 2 ? 'amber' : 'rose';

  return (
    <Card>
      <CardHeader icon={BarChart2} title="昨日发布" subtitle="目标 5 条/天" color="blue" />
      <div className="p-5 space-y-4">
        {/* 主进度 */}
        <div className="flex items-end gap-3">
          <span className={`text-4xl font-bold ${
            color === 'emerald' ? 'text-emerald-600' :
            color === 'amber'   ? 'text-amber-500'  : 'text-rose-500'
          }`}>{total}</span>
          <span className="text-slate-400 text-sm mb-1">/ {DAILY_TARGET} 条</span>
          {total >= DAILY_TARGET
            ? <CheckCircle2 className="w-5 h-5 text-emerald-500 mb-1" />
            : <AlertCircle className="w-5 h-5 text-amber-400 mb-1" />}
        </div>
        <ProgressBar value={total} max={DAILY_TARGET} color={color} />

        {/* 按平台分布 */}
        {data && data.by_platform.length > 0 ? (
          <div className="space-y-2 pt-2">
            {data.by_platform.map((p) => (
              <div key={p.platform} className="flex items-center gap-2">
                <span className="text-xs w-16 text-slate-500 dark:text-slate-400 shrink-0">
                  {PLATFORM_LABELS[p.platform] ?? p.platform}
                </span>
                <div className="flex-1">
                  <ProgressBar value={p.total_count} max={Math.max(data.total, 1)} color="blue" />
                </div>
                <span className="text-xs text-slate-400 w-4 text-right">{p.total_count}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState msg="数据采集中，稍后更新" />
        )}
      </div>
    </Card>
  );
};

// ── 面板 2: 各平台发布成功率 ─────────────────────────

const successRate = 'successRate';

const SuccessRatePanel = ({ data }: { data: PublishStats | null }) => (
  <Card>
    <CardHeader icon={CheckCircle2} title="平台成功率" subtitle="近 24h" color="emerald" />
    <div className="p-5">
      {data && data.by_platform.length > 0 ? (
        <div className="space-y-3">
          {data.by_platform.map((p) => (
            <div key={p.platform} className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-300 font-medium">
                  {PLATFORM_LABELS[p.platform] ?? p.platform}
                </span>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-emerald-600 flex items-center gap-0.5">
                    <CheckCircle2 className="w-3 h-3" /> {p.success_count}
                  </span>
                  {p.fail_count > 0 && (
                    <span className="text-rose-500 flex items-center gap-0.5">
                      <XCircle className="w-3 h-3" /> {p.fail_count}
                    </span>
                  )}
                </div>
              </div>
              <ProgressBar
                value={p.success_count}
                max={p.total_count}
                color={
                  p.success_rate === null ? 'blue' :
                  p.success_rate >= 80 ? 'emerald' :
                  p.success_rate >= 50 ? 'amber' : 'rose'
                }
              />
              {p.fail_reasons.length > 0 && (
                <p className="text-xs text-rose-400 truncate" title={p.fail_reasons.join(' | ')}>
                  ⚠ {p.fail_reasons[0]}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState msg="数据采集中，稍后更新" />
      )}
    </div>
  </Card>
);

// ── 面板 3: 近7日内容效果排行 ────────────────────────

const contentRanking = 'contentRanking';

const ContentRankingPanel = ({ data }: { data: ContentPerformance | null }) => (
  <Card className="col-span-2">
    <CardHeader icon={TrendingUp} title="近7日内容排行" subtitle="浏览 · 互动数" color="violet" />
    <div className="p-5">
      {data?.has_data ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700">
                <th className="pb-2 text-left w-8">#</th>
                <th className="pb-2 text-left">内容</th>
                <th className="pb-2 text-right">平台</th>
                <th className="pb-2 text-right">浏览</th>
                <th className="pb-2 text-right">互动</th>
              </tr>
            </thead>
            <tbody>
              {data.posts.map((post, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-100 dark:border-slate-700/50 last:border-0"
                >
                  <td className="py-2 text-slate-400 text-xs">{i + 1}</td>
                  <td className="py-2 text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
                    {post.title || post.author || '—'}
                  </td>
                  <td className="py-2 text-right text-xs text-slate-500">
                    {PLATFORM_LABELS[post.platform] ?? post.platform}
                  </td>
                  <td className="py-2 text-right text-slate-600 dark:text-slate-400">
                    {post.view_count?.toLocaleString() ?? '—'}
                  </td>
                  <td className="py-2 text-right text-slate-600 dark:text-slate-400">
                    {post.like_count !== undefined
                      ? (post.like_count + (post.comment_count ?? 0)).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState msg="内容效果数据采集进行中（数据闭环任务）" />
      )}
    </div>
  </Card>
);

// ── 面板 4: KR 进度 ──────────────────────────────────

const krProgress = 'krProgress';

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

// ── 面板 5: 算力利用率 ───────────────────────────────

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
  const [publishData, setPublishData] = useState<PublishStats | null>(null);
  const [okrData, setOkrData] = useState<OkrData | null>(null);
  const [clusterData, setClusterData] = useState<ClusterStatus | null>(null);
  const [contentData, setContentData] = useState<ContentPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pub, okr, cluster, content] = await Promise.allSettled([
        fetchPublishStats(1),
        fetchOkrCurrent(),
        fetchClusterStatus(),
        fetchContentPerformance(7),
      ]);

      if (pub.status === 'fulfilled') setPublishData(pub.value);
      if (okr.status === 'fulfilled') setOkrData(okr.value);
      if (cluster.status === 'fulfilled') setClusterData(cluster.value);
      if (content.status === 'fulfilled') setContentData(content.value);
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
            内容运营 · 系统状态 · 一眼全局
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

      {/* Grid: 2 + 2 + 2 layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Row 1 */}
        <PublishStatsPanel data={publishData} />
        <SuccessRatePanel data={publishData} />

        {/* Row 2: full width */}
        <ContentRankingPanel data={contentData} />

        {/* Row 3 */}
        <KrProgressPanel data={okrData} />
        <ClusterUtilPanel data={clusterData} />
      </div>
    </div>
  );
}
