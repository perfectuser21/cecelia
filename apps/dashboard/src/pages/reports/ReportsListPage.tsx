/**
 * ReportsListPage — 系统简报列表页
 * 路由：/reports
 * 展示 48h 系统简报历史列表
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface Report {
  id: string;
  type: string;
  created_at: string;
  title: string | null;
  summary: string | null;
  metadata: {
    triggered_by?: string;
    trigger_time?: string;
    [key: string]: unknown;
  };
}

interface ReportsResponse {
  reports: Report[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}

const TYPE_LABELS: Record<string, string> = {
  '48h_system_report': '48h 系统简报',
  'daily_report': '日报',
  'weekly_report': '周报',
  'manual': '手动生成',
};

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffH < 24) return `${diffH} 小时前`;
  if (diffD < 7) return `${diffD} 天前`;

  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ReportsListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const fetchReports = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/brain/reports?limit=20&offset=0');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/brain/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: '48h_system_report' }),
      });
      if (!res.ok) throw new Error(`生成失败: HTTP ${res.status}`);
      await fetchReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
      color: '#e6edf3',
      padding: '32px',
    }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#e6edf3', margin: 0 }}>
            系统简报
          </h1>
          <p style={{ fontSize: '13px', color: '#8b949e', marginTop: '4px' }}>
            48h 自动生成的系统状态简报
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={fetchReports}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)',
              color: '#8b949e',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            刷新
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(56,189,248,0.3)',
              background: 'rgba(56,189,248,0.1)',
              color: '#38bdf8',
              fontSize: '13px',
              cursor: generating ? 'not-allowed' : 'pointer',
              opacity: generating ? 0.6 : 1,
            }}
          >
            {generating ? '生成中...' : '手动生成'}
          </button>
        </div>
      </div>

      {/* 状态 */}
      {loading && (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: '48px' }}>
          加载中...
        </div>
      )}

      {error && (
        <div style={{
          padding: '16px',
          borderRadius: '8px',
          background: 'rgba(248,81,73,0.1)',
          border: '1px solid rgba(248,81,73,0.2)',
          color: '#f85149',
          marginBottom: '16px',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* 统计 */}
      {data && !loading && (
        <div style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '20px',
        }}>
          <div style={{
            padding: '12px 20px',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>总简报数</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#e6edf3' }}>{data.total}</div>
          </div>
        </div>
      )}

      {/* 简报列表 */}
      {data && data.reports.length === 0 && !loading && (
        <div style={{
          textAlign: 'center',
          color: '#8b949e',
          padding: '48px',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.02)',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📊</div>
          <div style={{ fontSize: '14px' }}>暂无简报记录</div>
          <div style={{ fontSize: '12px', marginTop: '8px', color: '#6e7681' }}>
            点击「手动生成」创建第一份简报，或等待 48h 自动触发
          </div>
        </div>
      )}

      {data && data.reports.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {data.reports.map((report) => (
            <div
              key={report.id}
              onClick={() => navigate(`/reports/${report.id}`)}
              style={{
                padding: '16px 20px',
                borderRadius: '10px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
                transition: 'background 0.15s, border-color 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.06)';
                (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(56,189,248,0.2)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)';
                (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.08)';
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                  {/* 类型标签 */}
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(56,189,248,0.1)',
                    border: '1px solid rgba(56,189,248,0.2)',
                    color: '#38bdf8',
                    letterSpacing: '0.5px',
                  }}>
                    {TYPE_LABELS[report.type] || report.type}
                  </span>
                  {/* 标题 */}
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#e6edf3' }}>
                    {report.title || `简报 #${report.id.slice(0, 8)}`}
                  </span>
                </div>
                {/* 摘要 */}
                {report.summary && (
                  <p style={{
                    fontSize: '12px',
                    color: '#8b949e',
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '600px',
                  }}>
                    {report.summary}
                  </p>
                )}
              </div>
              {/* 时间 */}
              <div style={{ fontSize: '12px', color: '#6e7681', flexShrink: 0, marginLeft: '16px' }}>
                {formatRelativeTime(report.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
