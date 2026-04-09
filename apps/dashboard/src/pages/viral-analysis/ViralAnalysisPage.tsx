/**
 * ViralAnalysisPage — 爆款分析仪表盘
 * 路由：/viral-analysis
 * 数据链路：Brain /api/brain/analytics/platform-summary + /api/brain/analytics/content
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PlatformSummary {
  platform: string;
  content_count: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  avg_views: number;
  engagement_rate: number;
  last_collected_at: string | null;
}

interface ContentItem {
  id: string;
  platform: string;
  title: string | null;
  content_id: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagement_rate?: number;
  published_at: string | null;
  collected_at: string;
}

interface PlatformSummaryResponse {
  since: string;
  days: number;
  platforms: PlatformSummary[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  kuaishou: '快手',
  xiaohongshu: '小红书',
  toutiao: '今日头条',
  weibo: '微博',
  channels: '视频号',
  gongzhonghao: '公众号',
  zhihu: '知乎',
  wechat: '微信',
};

const DAYS_OPTIONS = [7, 14, 30];

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtPlatform(p: string): string {
  return PLATFORM_LABELS[p] || p;
}

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffH = Math.floor((Date.now() - d.getTime()) / 3600000);
  if (diffH < 1) return '< 1小时前';
  if (diffH < 24) return `${diffH}小时前`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}天前`;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = {
  page: { background: '#0d1117', minHeight: '100%', padding: '24px', color: '#e6edf3', fontFamily: 'system-ui, sans-serif' } as const,
  header: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' as const },
  backBtn: { background: 'transparent', border: '1px solid #30363d', borderRadius: '6px', color: '#8b949e', padding: '6px 12px', cursor: 'pointer', fontSize: '13px' },
  title: { fontSize: '22px', fontWeight: 700, margin: 0 },
  subtitle: { fontSize: '13px', color: '#8b949e', margin: '4px 0 0' },
  controls: { display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' as const },
  select: { background: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#e6edf3', padding: '6px 10px', fontSize: '13px', cursor: 'pointer' },
  section: { marginBottom: '28px' },
  sectionTitle: { fontSize: '14px', fontWeight: 600, color: '#8b949e', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' },
  card: { background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' },
  cardTitle: { fontSize: '14px', fontWeight: 600, marginBottom: '12px' },
  metricRow: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#8b949e', marginBottom: '4px' },
  metricVal: { color: '#e6edf3', fontWeight: 600 },
  engRate: (rate: number) => ({
    fontSize: '20px', fontWeight: 700,
    color: rate >= 5 ? '#3fb950' : rate >= 2 ? '#d29922' : '#8b949e',
  }),
  contentList: { background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', overflow: 'hidden' },
  contentRow: (hover: boolean) => ({
    padding: '12px 16px',
    borderBottom: '1px solid #21262d',
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    background: hover ? '#1f2937' : 'transparent',
    cursor: 'default',
    transition: 'background .1s',
  }),
  rank: (n: number) => ({
    fontSize: '13px', fontWeight: 700, minWidth: '24px', textAlign: 'center' as const,
    color: n === 1 ? '#d4a017' : n === 2 ? '#aaa' : n === 3 ? '#cd7f32' : '#484f58',
  }),
  contentTitle: { fontSize: '13px', flex: 1, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  platform: { fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: '#21262d', color: '#8b949e', whiteSpace: 'nowrap' as const },
  metrics: { display: 'flex', gap: '10px', fontSize: '12px', color: '#8b949e', whiteSpace: 'nowrap' as const },
  metricBadge: { color: '#e6edf3' },
  empty: { textAlign: 'center' as const, padding: '48px 24px', color: '#484f58' },
  emptyIcon: { fontSize: '32px', marginBottom: '8px' },
  emptyText: { fontSize: '14px', marginBottom: '4px', color: '#6e7681' },
  emptySub: { fontSize: '12px', color: '#484f58' },
  refreshBtn: { background: 'transparent', border: '1px solid #30363d', borderRadius: '6px', color: '#8b949e', padding: '6px 12px', cursor: 'pointer', fontSize: '13px' },
};

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div style={s.empty}>
      <div style={s.emptyIcon}>📊</div>
      <div style={s.emptyText}>暂无内容数据</div>
      <div style={s.emptySub}>平台数据采集后将在此展示爆款内容分析</div>
      <button style={{ ...s.refreshBtn, marginTop: '16px' }} onClick={onRefresh}>↺ 刷新</button>
    </div>
  );
}

// ─── Platform Card ──────────────────────────────────────────────────────────

function PlatformCard({ p }: { p: PlatformSummary }) {
  return (
    <div style={s.card}>
      <div style={s.cardTitle}>{fmtPlatform(p.platform)}</div>
      <div style={{ marginBottom: '10px', textAlign: 'center' as const }}>
        <div style={s.engRate(p.engagement_rate)}>{p.engagement_rate.toFixed(1)}‰</div>
        <div style={{ fontSize: '11px', color: '#484f58' }}>互动率</div>
      </div>
      <div style={s.metricRow}><span>内容数</span><span style={s.metricVal}>{p.content_count}</span></div>
      <div style={s.metricRow}><span>总播放</span><span style={s.metricVal}>{fmtNum(p.total_views)}</span></div>
      <div style={s.metricRow}><span>均播放</span><span style={s.metricVal}>{fmtNum(p.avg_views)}</span></div>
      <div style={s.metricRow}><span>点赞</span><span style={s.metricVal}>{fmtNum(p.total_likes)}</span></div>
      <div style={s.metricRow}><span>评论</span><span style={s.metricVal}>{fmtNum(p.total_comments)}</span></div>
      <div style={s.metricRow}><span>最后采集</span><span style={s.metricVal}>{fmtTime(p.last_collected_at)}</span></div>
    </div>
  );
}

// ─── Content Row ─────────────────────────────────────────────────────────────

function ContentRow({ item, rank }: { item: ContentItem; rank: number }) {
  const [hover, setHover] = useState(false);
  const v = Number(item.views), l = Number(item.likes), c = Number(item.comments), sh = Number(item.shares);
  const engRate = v > 0 ? ((l + c + sh) / v * 1000).toFixed(1) : '0';
  return (
    <div style={s.contentRow(hover)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={s.rank(rank)}>{rank}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={s.platform}>{fmtPlatform(item.platform)}</span>
          <span style={s.contentTitle}>{item.title || item.content_id || '(无标题)'}</span>
        </div>
        <div style={s.metrics}>
          <span>👁 <span style={s.metricBadge}>{fmtNum(v)}</span></span>
          <span>❤️ <span style={s.metricBadge}>{fmtNum(l)}</span></span>
          <span>💬 <span style={s.metricBadge}>{fmtNum(c)}</span></span>
          <span>🔗 <span style={s.metricBadge}>{engRate}‰</span></span>
          <span style={{ marginLeft: 'auto', color: '#484f58' }}>{fmtTime(item.collected_at)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ViralAnalysisPage() {
  const navigate = useNavigate();
  const [days, setDays] = useState(7);
  const [platform, setPlatform] = useState('');
  const [summary, setSummary] = useState<PlatformSummaryResponse | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (platform) params.set('platform', platform);

      const [summaryRes, contentRes] = await Promise.all([
        fetch(`/api/brain/analytics/platform-summary?${params}`),
        fetch(`/api/brain/analytics/content?days=${days}&limit=20${platform ? `&platform=${platform}` : ''}`),
      ]);

      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (contentRes.ok) setContent(await contentRes.json());

      setLastUpdated(new Date());
    } catch {
      // 静默失败，保留上次数据
    } finally {
      setLoading(false);
    }
  }, [days, platform]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const t = setInterval(fetchData, 120_000);
    return () => clearInterval(t);
  }, [fetchData]);

  const platforms = summary?.platforms ?? [];
  const hasData = platforms.length > 0 || content.length > 0;

  const knownPlatforms = Object.keys(PLATFORM_LABELS);

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => navigate(-1)}>← 返回</button>
        <div>
          <h1 style={s.title}>爆款分析</h1>
          <p style={s.subtitle}>
            各平台内容互动率 · 热门内容排行
            {lastUpdated && ` · 更新于 ${fmtTime(lastUpdated.toISOString())}`}
          </p>
        </div>
        <div style={s.controls}>
          <select style={s.select} value={platform} onChange={e => setPlatform(e.target.value)}>
            <option value="">全部平台</option>
            {knownPlatforms.map(p => (
              <option key={p} value={p}>{fmtPlatform(p)}</option>
            ))}
          </select>
          <select style={s.select} value={days} onChange={e => setDays(Number(e.target.value))}>
            {DAYS_OPTIONS.map(d => (
              <option key={d} value={d}>近 {d} 天</option>
            ))}
          </select>
          <button style={s.refreshBtn} onClick={fetchData}>↺ 刷新</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#8b949e' }}>加载中…</div>
      ) : !hasData ? (
        <EmptyState onRefresh={fetchData} />
      ) : (
        <>
          {/* Platform Summary */}
          {platforms.length > 0 && (
            <div style={s.section}>
              <div style={s.sectionTitle}>各平台互动概览（近 {days} 天）</div>
              <div style={s.grid}>
                {platforms.map(p => <PlatformCard key={p.platform} p={p} />)}
              </div>
            </div>
          )}

          {/* Top Content */}
          <div style={s.section}>
            <div style={s.sectionTitle}>
              热门内容 TOP {Math.min(content.length, 20)}
              {platform ? ` · ${fmtPlatform(platform)}` : ''}
            </div>
            {content.length === 0 ? (
              <div style={{ ...s.empty, padding: '32px' }}>
                <div style={s.emptyText}>暂无内容数据</div>
              </div>
            ) : (
              <div style={s.contentList}>
                {content.map((item, i) => (
                  <ContentRow key={item.id ?? item.content_id ?? String(i)} item={item} rank={i + 1} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: '24px', fontSize: '11px', color: '#484f58' }}>
        数据源：Brain /api/brain/analytics/platform-summary · /api/brain/analytics/content · 每2分钟自动刷新
      </div>
    </div>
  );
}
