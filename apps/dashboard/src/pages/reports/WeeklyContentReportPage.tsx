/**
 * WeeklyContentReportPage — 内容运营周报页
 * 路由：/weekly-reports
 * 展示各平台内容数据周报（浏览/互动/发布量 + 环比增长）
 */

import { useState, useEffect, useCallback } from 'react';

interface PlatformStat {
  platform: string;
  pieces: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

interface TopContent {
  platform: string;
  title: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  published_at: string | null;
}

interface WeeklyReportContent {
  summary: {
    total_pieces: number;
    total_views: number;
    total_likes: number;
    total_comments: number;
    total_shares: number;
  };
  by_platform: PlatformStat[];
  top_content: TopContent[];
  vs_last_week: {
    views_growth_pct: number;
    likes_growth_pct: number;
    pieces_growth_pct: number;
  };
}

interface WeeklyReport {
  id: string;
  week_label: string;
  period_start: string;
  period_end: string;
  content: WeeklyReportContent;
  metadata: { generated_at: string; dry_run?: boolean; data_rows?: number };
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  items: WeeklyReport[];
  total: number;
  limit: number;
  offset: number;
}

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  weibo: '微博',
  wechat: '公众号',
  kuaishou: '快手',
  toutiao: '头条',
  channels: '视频号',
  zhihu: '知乎',
};

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  return String(n);
}

function GrowthBadge({ pct }: { pct: number }) {
  const color = pct > 0 ? '#22c55e' : pct < 0 ? '#ef4444' : '#94a3b8';
  const sign = pct > 0 ? '+' : '';
  return (
    <span style={{ color, fontSize: '12px', fontWeight: 600 }}>
      {sign}{pct}%
    </span>
  );
}

function SummaryCards({ content }: { content: WeeklyReportContent }) {
  const { summary, vs_last_week } = content;
  const cards = [
    { label: '发布篇数', value: fmtNum(summary.total_pieces), growth: vs_last_week.pieces_growth_pct },
    { label: '总浏览量', value: fmtNum(summary.total_views), growth: vs_last_week.views_growth_pct },
    { label: '总点赞数', value: fmtNum(summary.total_likes), growth: vs_last_week.likes_growth_pct },
    { label: '总评论数', value: fmtNum(summary.total_comments), growth: null },
    { label: '总转发数', value: fmtNum(summary.total_shares), growth: null },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '24px' }}>
      {cards.map(c => (
        <div key={c.label} style={{
          background: '#1e293b', borderRadius: '8px', padding: '16px',
          border: '1px solid #334155',
        }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '6px' }}>{c.label}</div>
          <div style={{ color: '#f1f5f9', fontSize: '22px', fontWeight: 700 }}>{c.value}</div>
          {c.growth !== null && (
            <div style={{ marginTop: '4px' }}>
              <GrowthBadge pct={c.growth} />
              <span style={{ color: '#64748b', fontSize: '11px', marginLeft: '4px' }}>环比上周</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PlatformTable({ platforms }: { platforms: PlatformStat[] }) {
  if (platforms.length === 0) return <div style={{ color: '#64748b', textAlign: 'center', padding: '24px' }}>本周无采集数据</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
      <thead>
        <tr style={{ color: '#64748b', borderBottom: '1px solid #334155' }}>
          {['平台', '篇数', '浏览量', '点赞', '评论', '转发'].map(h => (
            <th key={h} style={{ padding: '8px 12px', textAlign: h === '平台' ? 'left' : 'right' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {platforms.map(p => (
          <tr key={p.platform} style={{ borderBottom: '1px solid #1e293b' }}>
            <td style={{ padding: '10px 12px', color: '#e2e8f0' }}>{PLATFORM_LABELS[p.platform] || p.platform}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8' }}>{p.pieces}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#f1f5f9', fontWeight: 600 }}>{fmtNum(p.views)}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8' }}>{fmtNum(p.likes)}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8' }}>{fmtNum(p.comments)}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8' }}>{fmtNum(p.shares)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TopContentList({ items }: { items: TopContent[] }) {
  if (items.length === 0) return <div style={{ color: '#64748b', textAlign: 'center', padding: '24px' }}>暂无数据</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {items.map((item, i) => (
        <div key={i} style={{
          background: '#1e293b', borderRadius: '6px', padding: '12px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
            <span style={{ color: '#475569', fontSize: '12px', fontWeight: 700, width: '20px' }}>#{i + 1}</span>
            <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.title}
            </span>
            <span style={{ color: '#475569', fontSize: '11px', flexShrink: 0 }}>
              {PLATFORM_LABELS[item.platform] || item.platform}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '16px', flexShrink: 0, marginLeft: '12px' }}>
            <span style={{ color: '#94a3b8', fontSize: '12px' }}>👁 {fmtNum(item.views)}</span>
            <span style={{ color: '#94a3b8', fontSize: '12px' }}>👍 {fmtNum(item.likes)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WeeklyContentReportPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [selected, setSelected] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/weekly-content-reports?limit=12');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ListResponse = await res.json();
      setData(json);
      if (json.items.length > 0 && !selected) setSelected(json.items[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => { fetchList(); }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/brain/weekly-content-reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchList();
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ padding: '24px', color: '#e2e8f0', fontFamily: 'monospace', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f1f5f9' }}>内容运营周报</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px' }}>
            全平台内容数据聚合 · 数据来源：content_analytics
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{
            background: generating ? '#334155' : '#3b82f6',
            color: '#fff', border: 'none', borderRadius: '6px',
            padding: '8px 16px', fontSize: '13px', cursor: generating ? 'not-allowed' : 'pointer',
          }}
        >
          {generating ? '生成中…' : '生成本周报告'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: '6px',
          padding: '12px 16px', color: '#fca5a5', marginBottom: '16px', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: '48px' }}>加载中…</div>
      ) : !data || data.items.length === 0 ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: '48px' }}>
          暂无周报，点击"生成本周报告"创建第一份
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '20px' }}>
          {/* 左侧周列表 */}
          <div style={{ background: '#0f172a', borderRadius: '8px', padding: '12px',
            border: '1px solid #1e293b', height: 'fit-content' }}>
            <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '8px', paddingLeft: '4px' }}>
              历史周报
            </div>
            {data.items.map(r => (
              <div
                key={r.id}
                onClick={() => setSelected(r)}
                style={{
                  padding: '10px 12px', borderRadius: '6px', cursor: 'pointer',
                  background: selected?.id === r.id ? '#1e3a5f' : 'transparent',
                  marginBottom: '2px',
                }}
              >
                <div style={{ color: selected?.id === r.id ? '#93c5fd' : '#cbd5e1',
                  fontSize: '13px', fontWeight: 600 }}>{r.week_label}</div>
                <div style={{ color: '#475569', fontSize: '11px', marginTop: '2px' }}>
                  {new Date(r.period_start).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                  {' — '}
                  {new Date(r.period_end).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            ))}
          </div>

          {/* 右侧详情 */}
          {selected && (
            <div>
              <div style={{ marginBottom: '20px' }}>
                <h2 style={{ margin: 0, fontSize: '16px', color: '#f1f5f9' }}>{selected.week_label}</h2>
                <span style={{ color: '#475569', fontSize: '12px' }}>
                  生成于 {new Date(selected.metadata.generated_at).toLocaleString('zh-CN')}
                </span>
              </div>

              <SummaryCards content={selected.content} />

              <div style={{ background: '#0f172a', borderRadius: '8px', padding: '16px',
                border: '1px solid #1e293b', marginBottom: '16px' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#94a3b8' }}>各平台数据</h3>
                <PlatformTable platforms={selected.content.by_platform} />
              </div>

              <div style={{ background: '#0f172a', borderRadius: '8px', padding: '16px',
                border: '1px solid #1e293b' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#94a3b8' }}>热门内容 TOP 10</h3>
                <TopContentList items={selected.content.top_content} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
