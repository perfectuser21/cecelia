/**
 * SystemReportsPage — 系统简报列表页
 * 路由：/reports
 * 显示所有 48h 系统简报，包括生成时间、报告类型、推送状态
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, RefreshCw, AlertCircle, ChevronRight, Clock, CheckCircle2, XCircle } from 'lucide-react';

interface ReportRecord {
  id: string;
  type: string;
  created_at: string;
  metadata: {
    generated_by?: string;
    push_status?: string;
  };
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffD > 0) return `${diffD} 天前`;
  if (diffH > 0) return `${diffH} 小时前`;
  if (diffMin > 0) return `${diffMin} 分钟前`;
  return '刚刚';
}

function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function getTypeName(type: string): string {
  const typeNames: Record<string, string> = {
    '48h_briefing': '48h 系统简报',
    'daily': '每日简报',
    'weekly': '每周简报',
  };
  return typeNames[type] || type;
}

function PushStatusBadge({ status }: { status?: string }) {
  if (!status || status === 'not_pushed') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 11,
        background: '#21262d',
        color: '#8b949e',
        border: '1px solid #30363d',
      }}>
        <XCircle style={{ width: 10, height: 10 }} />
        未推送
      </span>
    );
  }
  if (status === 'pushed') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 11,
        background: '#0f2d1f',
        color: '#3fb950',
        border: '1px solid #238636',
      }}>
        <CheckCircle2 style={{ width: 10, height: 10 }} />
        已推送
      </span>
    );
  }
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      background: '#21262d',
      color: '#8b949e',
      border: '1px solid #30363d',
    }}>
      {status}
    </span>
  );
}

export default function SystemReportsPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/reports?limit=20');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok) {
        setRecords(data.records);
        setLastRefresh(new Date());
      } else {
        throw new Error(data.error || '获取简报失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
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
      const res = await fetch('/api/brain/reports/generate', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        await fetchReports();
      } else {
        setError(data.error || '生成失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{
      minHeight: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
      color: '#e6edf3',
      padding: '24px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    }}>
      {/* 页头 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <FileText style={{ width: 20, height: 20, color: '#58a6ff' }} />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e6edf3' }}>系统简报</h1>
          </div>
          {lastRefresh && (
            <div style={{ fontSize: 11, color: '#484f58 ' }}>
              <Clock style={{ width: 10, height: 10, display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              最后刷新：{lastRefresh.toLocaleTimeString('zh-CN')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={fetchReports}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: '1px solid #30363d',
              borderRadius: 6,
              color: '#8b949e',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 13,
              padding: '6px 12px',
            }}
          >
            <RefreshCw style={{ width: 13, height: 13, animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            刷新
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: generating ? '#21262d' : '#1f6feb',
              border: '1px solid #388bfd',
              borderRadius: 6,
              color: generating ? '#8b949e' : '#e6edf3',
              cursor: generating ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 16px',
            }}
          >
            {generating ? '生成中…' : '+ 生成简报'}
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          borderRadius: 8,
          background: '#1f0a0a',
          border: '1px solid #6e1313',
          color: '#f85149',
          fontSize: 13,
          marginBottom: 16,
        }}>
          <AlertCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
          {error}
        </div>
      )}

      {/* 简报列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#484f58', padding: '60px 0', fontSize: 14 }}>
          加载中…
        </div>
      ) : records.length === 0 ? (
        <div style={{
          textAlign: 'center',
          color: '#484f58',
          padding: '60px 0',
          fontSize: 14,
          border: '1px dashed #30363d',
          borderRadius: 10,
        }}>
          <FileText style={{ width: 40, height: 40, marginBottom: 12, opacity: 0.3 }} />
          <div style={{ marginBottom: 8 }}>暂无简报记录</div>
          <div style={{ fontSize: 12 }}>点击「生成简报」立即生成一份系统简报</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {records.map(record => (
            <div
              key={record.id}
              onClick={() => navigate(`/reports/${record.id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = '#58a6ff';
                (e.currentTarget as HTMLDivElement).style.background = '#1c2230';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = '#30363d';
                (e.currentTarget as HTMLDivElement).style.background = '#161b22';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: '#1f6feb22',
                  border: '1px solid #388bfd44',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <FileText style={{ width: 16, height: 16, color: '#58a6ff' }} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', marginBottom: 3 }}>
                    {getTypeName(record.type)}
                  </div>
                  <div style={{ fontSize: 11, color: '#484f58' }}>
                    {formatDateTime(record.created_at)}
                    <span style={{ margin: '0 6px', color: '#21262d' }}>·</span>
                    <span style={{ color: '#6e7681' }}>{formatRelativeTime(record.created_at)}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <PushStatusBadge status={record.metadata?.push_status} />
                <ChevronRight style={{ width: 14, height: 14, color: '#484f58' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
