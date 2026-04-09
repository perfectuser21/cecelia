/**
 * ContentStudio — 选题决策审核中心
 *
 * 功能：
 * 1. 展示今日待审核选题（pending topic suggestions）
 * 2. 人工 approve / reject 操作
 * 3. 审核率统计面板（7日通过率）
 * 4. 手动触发选题生成
 */

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  Zap,
} from 'lucide-react';

const BRAIN_API = '/api/brain';

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface TopicSuggestion {
  id: string;
  selected_date: string;
  keyword: string;
  content_type: string;
  title_candidates: string[];
  hook: string;
  why_hot: string;
  priority_score: number;
  status: 'pending' | 'approved' | 'rejected' | 'auto_promoted';
  created_at: string;
}

interface TopicStats {
  days: number;
  total: number;
  approved: number;
  rejected: number;
  auto_promoted: number;
  pending: number;
  reviewed: number;
  approval_rate: number | null;
  target_approval_rate: number;
  meets_target: boolean | null;
}

// ── 工具 ──────────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 0.8) return '#a78bfa';
  if (score >= 0.6) return '#60a5fa';
  return '#94a3b8';
}

function statusBadge(status: TopicSuggestion['status']) {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: '待审核', color: '#f59e0b' },
    approved: { label: '已通过', color: '#10b981' },
    rejected: { label: '已拒绝', color: '#ef4444' },
    auto_promoted: { label: '自动晋级', color: '#6366f1' },
  };
  const s = map[status] || { label: status, color: '#64748b' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
      background: s.color + '22', color: s.color, border: `1px solid ${s.color}44`,
    }}>
      {s.label}
    </span>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function ContentStudio() {
  const [suggestions, setSuggestions] = useState<TopicSuggestion[]>([]);
  const [stats, setStats] = useState<TopicStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sugRes, statsRes] = await Promise.all([
        fetch(`${BRAIN_API}/topics/suggestions?status=${tab}`),
        fetch(`${BRAIN_API}/topics/stats?days=7`),
      ]);
      const sugData = await sugRes.json();
      const statsData = await statsRes.json();
      setSuggestions(sugData.data || []);
      setStats(statsData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleApprove(id: string) {
    setActioning(id);
    try {
      await fetch(`${BRAIN_API}/topics/suggestions/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer: 'alex' }),
      });
      await fetchData();
    } finally {
      setActioning(null);
    }
  }

  async function handleReject(id: string) {
    setActioning(id);
    try {
      await fetch(`${BRAIN_API}/topics/suggestions/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer: 'alex' }),
      });
      await fetchData();
    } finally {
      setActioning(null);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      await fetch(`${BRAIN_API}/topics/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setTab('pending');
      await fetchData();
    } finally {
      setGenerating(false);
    }
  }

  const approvalPct = stats?.approval_rate != null
    ? Math.round(stats.approval_rate * 100)
    : null;

  return (
    <div style={{ minHeight: '100vh', background: '#07050f', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #1e1b2e', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, background: 'linear-gradient(90deg, #a78bfa, #60a5fa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            选题决策中心
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>每日选题建议 · 人工审核 · 通过率追踪</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchData} style={btnStyle('#1e1b2e', '#a78bfa')} disabled={loading}>
            <RefreshCw size={14} />
            刷新
          </button>
          <button onClick={handleGenerate} style={btnStyle('#312e6e', '#a78bfa')} disabled={generating}>
            {generating
              ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              : <Zap size={14} />}
            手动生成选题
          </button>
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 960, margin: '0 auto' }}>

        {/* Stats Panel */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
            <StatCard label="今日待审核" value={stats.pending} icon={<Clock size={16} color="#f59e0b" />} color="#f59e0b" />
            <StatCard label="7日已通过" value={stats.approved} icon={<CheckCircle size={16} color="#10b981" />} color="#10b981" />
            <StatCard label="7日已拒绝" value={stats.rejected} icon={<XCircle size={16} color="#ef4444" />} color="#ef4444" />
            <div style={{
              background: '#0f0d1a',
              border: `1px solid ${approvalPct != null && approvalPct >= 70 ? '#10b981' : '#f59e0b'}44`,
              borderRadius: 10, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <TrendingUp size={16} color={approvalPct != null && approvalPct >= 70 ? '#10b981' : '#f59e0b'} />
                <span style={{ fontSize: 12, color: '#64748b' }}>7日审核通过率</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: approvalPct != null && approvalPct >= 70 ? '#10b981' : '#f59e0b' }}>
                {approvalPct != null ? `${approvalPct}%` : '—'}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>目标 ≥ 70%</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid #1e1b2e' }}>
          {(['pending', 'approved', 'rejected'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: 'none', border: 'none', padding: '8px 18px', cursor: 'pointer',
              color: tab === t ? '#a78bfa' : '#64748b',
              borderBottom: tab === t ? '2px solid #a78bfa' : '2px solid transparent',
              fontSize: 14, fontWeight: tab === t ? 600 : 400,
            }}>
              {{ pending: '待审核', approved: '已通过', rejected: '已拒绝' }[t]}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', marginBottom: 16 }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}

        {/* Empty */}
        {!loading && !error && suggestions.length === 0 && (
          <div style={{ textAlign: 'center', padding: 48, color: '#475569' }}>
            <Clock size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div>{tab === 'pending' ? '今日暂无待审核选题，可手动触发生成' : '暂无记录'}</div>
          </div>
        )}

        {/* Suggestion Cards */}
        {!loading && suggestions.map(s => (
          <div key={s.id} style={{
            background: '#0f0d1a', border: '1px solid #1e1b2e', borderRadius: 12,
            padding: '18px 20px', marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1 }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{s.keyword}</span>
                  <span style={{ fontSize: 11, color: '#475569', background: '#1e1b2e', padding: '2px 8px', borderRadius: 6 }}>{s.content_type}</span>
                  {statusBadge(s.status)}
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: scoreColor(s.priority_score) }}>
                    {Math.round(s.priority_score * 100)}分
                  </span>
                </div>

                {/* Hook */}
                {s.hook && (
                  <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6, fontStyle: 'italic' }}>
                    "{s.hook}"
                  </div>
                )}

                {/* Why hot */}
                {s.why_hot && (
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{s.why_hot}</div>
                )}

                {/* Title candidates */}
                {s.title_candidates?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {s.title_candidates.map((t, i) => (
                      <span key={i} style={{
                        fontSize: 11, background: '#1a1730', border: '1px solid #312e6e',
                        borderRadius: 6, padding: '3px 8px', color: '#94a3b8',
                      }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              {s.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => handleApprove(s.id)}
                    disabled={actioning === s.id}
                    style={btnStyle('#0f2e1a', '#10b981')}
                  >
                    {actioning === s.id
                      ? <Loader2 size={13} />
                      : <CheckCircle size={13} />}
                    通过
                  </button>
                  <button
                    onClick={() => handleReject(s.id)}
                    disabled={actioning === s.id}
                    style={btnStyle('#2e0f0f', '#ef4444')}
                  >
                    {actioning === s.id
                      ? <Loader2 size={13} />
                      : <XCircle size={13} />}
                    拒绝
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── 子组件 ────────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div style={{ background: '#0f0d1a', border: `1px solid ${color}22`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {icon}
        <span style={{ fontSize: 12, color: '#64748b' }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function btnStyle(bg: string, borderColor: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '7px 12px', borderRadius: 7, border: `1px solid ${borderColor}44`,
    background: bg, color: borderColor, fontSize: 12, fontWeight: 600,
    cursor: 'pointer',
  };
}
