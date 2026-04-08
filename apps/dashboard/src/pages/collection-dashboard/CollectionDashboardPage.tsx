/**
 * CollectionDashboardPage — 数据采集仪表盘
 * 路由：/collection-dashboard
 * 展示各平台每日数据量、延迟、失败率，验证每日数据流入正常率≥95%。
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── Types ─────────────────────────────────────────────────────────────────

interface DailyVolume {
  date: string;
  count: number;
}

interface ScraperStats {
  total: number;
  completed: number;
  failed: number;
  success_rate: number | null;
}

interface PlatformStats {
  platform: string;
  daily_volumes: DailyVolume[];
  last_collected_at: string | null;
  is_fresh: boolean;
  has_data: boolean;
  total_records: number;
  scraper_stats: ScraperStats;
}

interface CollectionHealth {
  overall_inflow_rate: number;
  target_rate: number;
  healthy: boolean;
  platforms_with_data: number;
  total_platforms: number;
}

interface CollectionStats {
  health: CollectionHealth;
  platforms: PlatformStats[];
  query_days: number;
  synced_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  douyin:       '抖音',
  kuaishou:     '快手',
  xiaohongshu:  '小红书',
  toutiao:      '今日头条',
  'toutiao-2':  '头条号',
  weibo:        '微博',
  channels:     '视频号',
  gongzhonghao: '公众号',
  zhihu:        '知乎',
  wechat:       '微信',
};

function fmtPlatform(p: string): string {
  return PLATFORM_LABELS[p] || p;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const diffH = Math.floor((now - d.getTime()) / 3600000);
  if (diffH < 1) return '< 1小时前';
  if (diffH < 24) return `${diffH}小时前`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}天前`;
}

function statusColor(p: PlatformStats): string {
  if (!p.has_data) return '#f85149';
  if (!p.is_fresh) return '#d29922';
  return '#3fb950';
}

function statusLabel(p: PlatformStats): string {
  if (!p.has_data) return '无数据';
  if (!p.is_fresh) return '数据过期';
  return '正常';
}

function healthColor(rate: number, target: number): string {
  if (rate >= target) return '#3fb950';
  if (rate >= target * 0.8) return '#d29922';
  return '#f85149';
}

function totalVol(p: PlatformStats): number {
  return p.daily_volumes.reduce((s, v) => s + v.count, 0);
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function CollectionDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/analytics/collection-stats?days=7');
      if (res.ok) {
        setStats(await res.json());
        setError(null);
      } else {
        setError(`加载失败 (HTTP ${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误，请检查服务状态');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const t = setInterval(fetchStats, 60000);
    return () => clearInterval(t);
  }, [fetchStats]);

  const handleTriggerScrape = async () => {
    setTriggering(true);
    setMsg('');
    try {
      const res = await fetch('/api/brain/analytics/trigger-platform-scrape', { method: 'POST' });
      const d = await res.json();
      setMsg(`✅ 已创建 ${d.created} 个采集任务，跳过 ${d.skipped} 个`);
    } catch { setMsg('❌ 触发失败'); } finally {
      setTriggering(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setMsg('');
    try {
      const res = await fetch('/api/brain/analytics/social-media-sync', { method: 'POST' });
      const d = await res.json();
      setMsg(`✅ 同步完成：新增 ${d.synced}，跳过 ${d.skipped}`);
      await fetchStats();
    } catch { setMsg('❌ 同步失败'); } finally {
      setSyncing(false);
    }
  };

  // ─── Styles ──────────────────────────────────────────────────────────────

  const s: Record<string, React.CSSProperties> = {
    page: {
      minHeight: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
      color: '#e6edf3',
      padding: '24px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    },
    header: {
      display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px',
    },
    backBtn: {
      background: 'none', border: '1px solid #30363d', borderRadius: '6px',
      color: '#8b949e', padding: '6px 12px', cursor: 'pointer', fontSize: '13px',
    },
    title: { fontSize: '20px', fontWeight: 700, color: '#e6edf3', margin: 0 },
    subtitle: { fontSize: '13px', color: '#8b949e', margin: 0 },
    healthBanner: (healthy: boolean) => ({
      background: healthy ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)',
      border: `1px solid ${healthy ? '#3fb950' : '#f85149'}`,
      borderRadius: '8px',
      padding: '16px 20px',
      marginBottom: '20px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    }),
    rateNum: (rate: number, target: number) => ({
      fontSize: '36px', fontWeight: 700,
      color: healthColor(rate, target),
    }),
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
      gap: '14px',
      marginBottom: '20px',
    },
    card: {
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: '8px',
      padding: '16px',
    },
    cardHeader: {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: '10px',
    },
    platformName: { fontSize: '15px', fontWeight: 600 },
    badge: (color: string) => ({
      fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }),
    metricRow: {
      display: 'flex', justifyContent: 'space-between',
      fontSize: '12px', color: '#8b949e', marginBottom: '4px',
    },
    metricVal: { color: '#e6edf3', fontWeight: 600 },
    volBar: {
      display: 'flex', alignItems: 'flex-end', gap: '3px', height: '32px',
      marginTop: '10px',
    },
    actions: {
      display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' as const,
    },
    btn: (disabled: boolean) => ({
      background: disabled ? '#21262d' : '#238636',
      border: '1px solid #30363d',
      borderRadius: '6px',
      color: disabled ? '#6e7681' : '#e6edf3',
      padding: '8px 16px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: '13px',
    }),
    btnSecondary: (disabled: boolean) => ({
      background: disabled ? '#21262d' : '#1f6feb',
      border: '1px solid #30363d',
      borderRadius: '6px',
      color: disabled ? '#6e7681' : '#e6edf3',
      padding: '8px 16px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: '13px',
    }),
    msgBox: {
      marginTop: '12px', padding: '8px 14px',
      background: '#161b22', border: '1px solid #30363d', borderRadius: '6px',
      fontSize: '12px',
    },
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={s.page}>
        <div style={{ textAlign: 'center', padding: '60px', color: '#8b949e' }}>加载中…</div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div style={s.page}>
        <div style={{ textAlign: 'center', padding: '60px', color: '#f85149' }}>
          ⚠️ {error}
          <br />
          <button style={{ marginTop: '16px', padding: '8px 16px', cursor: 'pointer', background: '#21262d', color: '#e6edf3', border: '1px solid #30363d', borderRadius: '6px' }} onClick={fetchStats}>重试</button>
        </div>
      </div>
    );
  }

  const health = stats?.health;
  const platforms = stats?.platforms ?? [];
  const maxVol = Math.max(...platforms.flatMap(p => p.daily_volumes.map(v => v.count)), 1);

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => navigate(-1)}>← 返回</button>
        <div>
          <h1 style={s.title}>数据采集仪表盘</h1>
          <p style={s.subtitle}>
            各平台每日数据量 · 采集健康率
            {stats && ` · 更新于 ${fmtTime(stats.synced_at)}`}
          </p>
        </div>
      </div>

      {/* Health Banner */}
      {health && (
        <div style={s.healthBanner(health.healthy)}>
          <div>
            <div style={s.rateNum(health.overall_inflow_rate, health.target_rate)}>
              {health.overall_inflow_rate}%
            </div>
            <div style={{ fontSize: '12px', color: '#8b949e' }}>
              数据流入率（目标 ≥{health.target_rate}%）
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: '13px', textAlign: 'right' }}>
            <div style={{ color: '#e6edf3', marginBottom: '4px' }}>
              {health.platforms_with_data} / {health.total_platforms} 平台有数据
            </div>
            <div style={{ color: health.healthy ? '#3fb950' : '#f85149', fontWeight: 600 }}>
              {health.healthy ? '✅ 健康' : '⚠️ 低于目标'}
            </div>
          </div>
        </div>
      )}

      {/* Platform Cards */}
      <div style={s.grid}>
        {platforms.map(p => {
          const color = statusColor(p);
          const vol7d = totalVol(p);
          return (
            <div key={p.platform} style={s.card}>
              <div style={s.cardHeader}>
                <span style={s.platformName}>{fmtPlatform(p.platform)}</span>
                <span style={s.badge(color)}>{statusLabel(p)}</span>
              </div>

              <div style={s.metricRow}>
                <span>最后采集</span>
                <span style={s.metricVal}>{fmtTime(p.last_collected_at)}</span>
              </div>
              <div style={s.metricRow}>
                <span>7天数据量</span>
                <span style={s.metricVal}>{vol7d.toLocaleString()} 条</span>
              </div>
              <div style={s.metricRow}>
                <span>总存档</span>
                <span style={s.metricVal}>{p.total_records.toLocaleString()} 条</span>
              </div>
              {p.scraper_stats.total > 0 && (
                <div style={s.metricRow}>
                  <span>采集成功率</span>
                  <span style={{
                    ...s.metricVal,
                    color: p.scraper_stats.success_rate !== null && p.scraper_stats.success_rate >= 95
                      ? '#3fb950' : '#d29922',
                  }}>
                    {p.scraper_stats.success_rate !== null
                      ? `${p.scraper_stats.success_rate}%`
                      : '—'}
                  </span>
                </div>
              )}

              {/* Mini bar chart */}
              {p.daily_volumes.length > 0 && (
                <div style={s.volBar}>
                  {p.daily_volumes.slice(-7).map((v, i) => (
                    <div
                      key={i}
                      title={`${v.date}: ${v.count} 条`}
                      style={{
                        flex: 1,
                        height: `${Math.max(4, Math.round((v.count / maxVol) * 28))}px`,
                        background: '#238636',
                        borderRadius: '2px',
                        opacity: 0.7 + 0.3 * (i / Math.max(1, p.daily_volumes.length - 1)),
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={s.actions}>
        <button
          style={s.btnSecondary(syncing)}
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? '同步中…' : '🔄 同步 social_media_raw'}
        </button>
        <button
          style={s.btn(triggering)}
          onClick={handleTriggerScrape}
          disabled={triggering}
        >
          {triggering ? '创建中…' : '▶ 立即触发全平台采集'}
        </button>
        <button
          style={s.backBtn}
          onClick={fetchStats}
        >
          ↺ 刷新
        </button>
      </div>

      {msg && <div style={s.msgBox}>{msg}</div>}

      <div style={{ marginTop: '24px', fontSize: '11px', color: '#484f58' }}>
        Brain API: /api/brain/analytics/collection-stats · 每60s自动刷新
      </div>
    </div>
  );
}
