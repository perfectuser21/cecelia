/**
 * ReportDetailPage — 系统简报详情页
 * 路由：/reports/:id
 * 展示简报完整内容（KR 进度、任务统计、系统健康、异常和风险）
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';

interface KRProgress {
  id?: string;
  title?: string;
  progress?: number;
  status?: string;
  [key: string]: unknown;
}

interface TaskStats {
  completed?: number;
  failed?: number;
  in_progress?: number;
  queued?: number;
  [key: string]: unknown;
}

interface SystemHealth {
  status?: string;
  uptime?: number;
  message?: string;
  [key: string]: unknown;
}

interface ReportContent {
  title?: string;
  summary?: string;
  kr_progress?: KRProgress[];
  task_stats?: TaskStats;
  system_health?: SystemHealth;
  anomalies?: string[];
  risks?: string[];
  generated_at?: string;
  generated_by?: string;
  // weekly_report 专属字段
  week_key?: string;
  start_date?: string;
  end_date?: string;
  report_text?: string;
  content_output?: { count: number; topics: string[] };
  publish_stats?: Array<{ platform: string; success: number; failed: number }>;
  engagement_data?: Array<{ platform: string; views: number; likes: number; comments: number; shares: number }>;
  failure_count?: number;
  top_topics?: Array<{ topic_keyword: string; heat_score: number; total_likes: number; total_comments: number; total_shares: number }>;
  roi_data?: Array<{ platform: string; content_count: number; avg_views_per_content: number; engagement_rate: number }>;
  [key: string]: unknown;
}

interface Report {
  id: string;
  type: string;
  created_at: string;
  content: ReportContent;
  metadata: {
    triggered_by?: string;
    trigger_time?: string;
    [key: string]: unknown;
  };
}

interface GoldenPath {
  id: string;
  title: string;
  one_liner: string;
  status: string;
  auto_release: boolean;
  est_scale?: string | null;
}

function GpActionPanel() {
  const [gps, setGps] = useState<GoldenPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchGps = useCallback(async () => {
    try {
      const [cRes, vRes] = await Promise.all([
        fetch('/api/brain/golden-paths?status=candidate'),
        fetch('/api/brain/golden-paths?status=converged'),
      ]);
      const cData = cRes.ok ? await cRes.json() : { golden_paths: [] };
      const vData = vRes.ok ? await vRes.json() : { golden_paths: [] };
      // also check proposed+auto_release for veto
      const prRes = await fetch('/api/brain/golden-paths?status=proposed');
      const prData = prRes.ok ? await prRes.json() : { golden_paths: [] };
      const autoReleases = (prData.golden_paths || []).filter((g: GoldenPath) => g.auto_release);
      setGps([...(cData.golden_paths || []), ...(vData.golden_paths || []), ...autoReleases]);
    } catch {
      // silently fail - panel is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGps(); }, [fetchGps]);

  const act = async (gpId: string, action: 'select' | 'approve' | 'veto', body?: object) => {
    setActioning(gpId + ':' + action);
    setMessage(null);
    try {
      const res = await fetch(`/api/brain/golden-paths/${gpId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json();
      if (res.ok) {
        setMessage(`✅ ${action} 成功`);
        await fetchGps();
      } else {
        setMessage(`❌ ${json.error || `${action} 失败`}`);
      }
    } catch (err) {
      setMessage(`❌ 网络错误`);
    } finally {
      setActioning(null);
    }
  };

  const handleBatchSelect = async () => {
    for (const id of selected) {
      await act(id, 'select');
    }
    setSelected(new Set());
  };

  const candidates = gps.filter(g => g.status === 'candidate');
  const reviewable = gps.filter(g => g.status === 'converged' || (g.status === 'proposed' && g.auto_release));

  if (loading) return null;
  if (candidates.length === 0 && reviewable.length === 0) return null;

  const btnStyle = (color: string, disabled: boolean): React.CSSProperties => ({
    padding: '5px 12px',
    borderRadius: '6px',
    border: 'none',
    background: disabled ? 'rgba(255,255,255,0.05)' : color,
    color: disabled ? '#6e7681' : '#fff',
    fontSize: '12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 500,
  });

  return (
    <div style={{
      marginTop: '16px',
      padding: '16px 20px',
      borderRadius: '10px',
      background: 'rgba(56,189,248,0.04)',
      border: '1px solid rgba(56,189,248,0.15)',
    }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8', margin: '0 0 12px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        GP 拍板控制台
      </h3>

      {message && (
        <div style={{
          padding: '8px 12px', borderRadius: '6px', marginBottom: '12px', fontSize: '13px',
          background: message.startsWith('✅') ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)',
          border: message.startsWith('✅') ? '1px solid rgba(63,185,80,0.2)' : '1px solid rgba(248,81,73,0.2)',
          color: message.startsWith('✅') ? '#3fb950' : '#f85149',
        }}>
          {message}
        </div>
      )}

      {candidates.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: '#6e7681', marginBottom: '8px' }}>候选方向（圈选）</div>
          {candidates.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <input
                type="checkbox"
                checked={selected.has(g.id)}
                onChange={e => {
                  const s = new Set(selected);
                  if (e.target.checked) s.add(g.id); else s.delete(g.id);
                  setSelected(s);
                }}
                style={{ accentColor: '#38bdf8', width: '14px', height: '14px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '13px', color: '#e6edf3', flex: 1 }}>
                {g.title} <span style={{ color: '#6e7681' }}>— {g.one_liner}</span>
                {g.est_scale && <span style={{ color: '#8b949e', fontSize: '11px' }}> ({g.est_scale})</span>}
              </span>
              <button
                onClick={() => act(g.id, 'select')}
                disabled={actioning === g.id + ':select'}
                style={btnStyle('#2d6a9f', actioning === g.id + ':select')}
              >
                {actioning === g.id + ':select' ? '...' : '圈选'}
              </button>
            </div>
          ))}
          {selected.size > 0 && (
            <button
              onClick={handleBatchSelect}
              disabled={!!actioning}
              style={{ ...btnStyle('#2d6a9f', !!actioning), marginTop: '6px' }}
            >
              批量圈选（{selected.size} 条）
            </button>
          )}
        </div>
      )}

      {reviewable.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', color: '#6e7681', marginBottom: '8px' }}>待批审 / 报备</div>
          {reviewable.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', color: '#e6edf3', flex: 1 }}>
                {g.title}
                {g.auto_release && <span style={{ color: '#d29922', fontSize: '11px' }}> [报备]</span>}
              </span>
              <button
                onClick={() => act(g.id, 'approve')}
                disabled={!!actioning}
                style={btnStyle('#1a6832', !!actioning)}
              >
                {actioning === g.id + ':approve' ? '...' : '批准'}
              </button>
              <button
                onClick={() => act(g.id, 'veto', { status_reason: '否决' })}
                disabled={!!actioning}
                style={btnStyle('#6e2028', !!actioning)}
              >
                {actioning === g.id + ':veto' ? '...' : '否决'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '16px 20px',
      borderRadius: '10px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      marginBottom: '12px',
    }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#8b949e', marginBottom: '12px', margin: '0 0 12px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function StatBox({ label, value, color = '#e6edf3' }: { label: string; value: number | string | undefined; color?: string }) {
  return (
    <div style={{
      padding: '12px 16px',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '11px', color: '#6e7681', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, color }}>{value ?? '-'}</div>
    </div>
  );
}

interface DesignDoc {
  id: string;
  title: string | null;
  content: string | null;
  created_at: string;
  [key: string]: unknown;
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isDesignDoc = searchParams.get('source') === 'design_docs';
  const [report, setReport] = useState<Report | null>(null);
  const [doc, setDoc] = useState<DesignDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    // design_docs 源（作战日报等）：独立获取路径，不动现有 reports 路径
    if (isDesignDoc) {
      const fetchDoc = async () => {
        try {
          setError(null);
          const res = await fetch(`/api/brain/design-docs/${id}`);
          if (res.status === 404) {
            setError('简报不存在');
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          setDoc(json.data ?? null);
        } catch (err) {
          setError(err instanceof Error ? err.message : '加载失败');
        } finally {
          setLoading(false);
        }
      };
      fetchDoc();
      return;
    }

    const fetchReport = async () => {
      try {
        setError(null);
        const res = await fetch(`/api/brain/reports/${id}`);
        if (res.status === 404) {
          setError('简报不存在');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setReport(json.report ?? json);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [id, isDesignDoc]);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#8b949e',
      }}>
        加载中...
      </div>
    );
  }

  // ── design_docs 源渲染（作战日报）：独立早返回分支，不动现有渲染路径 ──────────
  if (isDesignDoc) {
    if (error || !doc) {
      return (
        <div style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
          color: '#e6edf3',
          padding: '32px',
        }}>
          <button
            onClick={() => navigate('/reports')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)',
              color: '#8b949e',
              fontSize: '13px',
              cursor: 'pointer',
              marginBottom: '24px',
            }}
          >
            ← 返回列表
          </button>
          <div style={{
            padding: '16px',
            borderRadius: '8px',
            background: 'rgba(248,81,73,0.1)',
            border: '1px solid rgba(248,81,73,0.2)',
            color: '#f85149',
          }}>
            ⚠️ {error || '简报不存在'}
          </div>
        </div>
      );
    }

    const docCreatedAt = new Date(doc.created_at);
    const docDate = `${docCreatedAt.getFullYear()}/${docCreatedAt.getMonth() + 1}/${docCreatedAt.getDate()} ${String(docCreatedAt.getHours()).padStart(2, '0')}:${String(docCreatedAt.getMinutes()).padStart(2, '0')}`;

    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
        color: '#e6edf3',
        padding: '32px',
      }}>
        <button
          onClick={() => navigate('/reports')}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)',
            color: '#8b949e',
            fontSize: '13px',
            cursor: 'pointer',
            marginBottom: '16px',
          }}
        >
          ← 返回列表
        </button>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#e6edf3', margin: '0 0 4px 0' }}>
          {doc.title || `简报 #${doc.id.slice(0, 8)}`}
        </h1>
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#6e7681', marginBottom: '24px' }}>
          <span>生成时间：{docDate}</span>
        </div>
        <pre style={{ padding: '16px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '13px', color: '#e6edf3', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {doc.content}
        </pre>
        {doc.content?.includes('军师决策节 v2') && <GpActionPanel />}
      </div>
    );
  }

  if (error || !report) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
        color: '#e6edf3',
        padding: '32px',
      }}>
        <button
          onClick={() => navigate('/reports')}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)',
            color: '#8b949e',
            fontSize: '13px',
            cursor: 'pointer',
            marginBottom: '24px',
          }}
        >
          ← 返回列表
        </button>
        <div style={{
          padding: '16px',
          borderRadius: '8px',
          background: 'rgba(248,81,73,0.1)',
          border: '1px solid rgba(248,81,73,0.2)',
          color: '#f85149',
        }}>
          ⚠️ {error || '简报不存在'}
        </div>
      </div>
    );
  }

  const c = report.content || {};
  const createdAt = new Date(report.created_at);
  const formattedDate = `${createdAt.getFullYear()}/${createdAt.getMonth() + 1}/${createdAt.getDate()} ${String(createdAt.getHours()).padStart(2, '0')}:${String(createdAt.getMinutes()).padStart(2, '0')}`;

  // ── 周报专属渲染 ──────────────────────────────────────────────────────────────
  if (report.type === 'weekly_report') {
    const publishStats = c.publish_stats || [];
    const engagementData = c.engagement_data || [];
    const topTopics = c.top_topics || [];
    const totalSuccess = publishStats.reduce((s: number, r: { success: number }) => s + r.success, 0);
    const totalViews = engagementData.reduce((s: number, r: { views: number }) => s + r.views, 0);
    const totalLikes = engagementData.reduce((s: number, r: { likes: number }) => s + r.likes, 0);

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)', color: '#e6edf3', padding: '32px' }}>
        <button onClick={() => navigate('/reports')} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#8b949e', fontSize: '13px', cursor: 'pointer', marginBottom: '16px' }}>
          ← 返回列表
        </button>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#e6edf3', margin: '0 0 4px 0' }}>
          {c.title || `内容周报 ${c.week_key}`}
        </h1>
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#6e7681', marginBottom: '24px' }}>
          <span>生成时间：{formattedDate}</span>
          {c.start_date && c.end_date && <span>统计范围：{c.start_date} ~ {c.end_date}</span>}
        </div>

        {/* 概览数字 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
          <StatBox label="内容产出" value={c.content_output?.count ?? 0} color="#3fb950" />
          <StatBox label="全平台发布成功" value={totalSuccess} color="#38bdf8" />
          <StatBox label="总阅读量" value={totalViews.toLocaleString('zh-CN')} color="#818cf8" />
          <StatBox label="总点赞数" value={totalLikes.toLocaleString('zh-CN')} color="#f97316" />
        </div>

        {/* 发布平台明细 */}
        {publishStats.length > 0 && (
          <Section title="发布情况">
            {publishStats.map((stat: { platform: string; success: number; failed: number }, idx: number) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: idx < publishStats.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', fontSize: '13px' }}>
                <span style={{ color: '#e6edf3' }}>{stat.platform}</span>
                <span>
                  <span style={{ color: '#3fb950' }}>✓ {stat.success}</span>
                  {stat.failed > 0 && <span style={{ color: '#f85149', marginLeft: '12px' }}>✗ {stat.failed}</span>}
                </span>
              </div>
            ))}
          </Section>
        )}

        {/* 互动数据 */}
        {engagementData.length > 0 && (
          <Section title="数据回收">
            {engagementData.map((item: { platform: string; views: number; likes: number; comments: number; shares: number }, idx: number) => (
              <div key={idx} style={{ marginBottom: idx < engagementData.length - 1 ? '8px' : 0, padding: '10px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '13px' }}>
                <span style={{ color: '#e6edf3', fontWeight: 600 }}>{item.platform}</span>
                <span style={{ color: '#6e7681', marginLeft: '12px' }}>
                  阅读 {item.views.toLocaleString('zh-CN')} · 点赞 {item.likes.toLocaleString('zh-CN')} · 评论 {item.comments.toLocaleString('zh-CN')} · 转发 {item.shares.toLocaleString('zh-CN')}
                </span>
              </div>
            ))}
          </Section>
        )}

        {/* 爆款主题 */}
        {topTopics.length > 0 && (
          <Section title="爆款主题 TOP5">
            {topTopics.map((t: { topic_keyword: string; heat_score: number; total_likes: number; total_comments: number; total_shares: number }, idx: number) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: idx < topTopics.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', fontSize: '13px' }}>
                <span style={{ color: '#e6edf3' }}>{idx + 1}. {t.topic_keyword}</span>
                <span style={{ color: '#d29922' }}>热度 {t.heat_score.toFixed(1)}</span>
              </div>
            ))}
          </Section>
        )}

        {/* 完整周报文本 */}
        {c.report_text && (
          <details style={{ marginTop: '12px' }}>
            <summary style={{ cursor: 'pointer', fontSize: '12px', color: '#6e7681', padding: '8px 0' }}>
              查看完整周报文本（飞书格式）
            </summary>
            <pre style={{ padding: '16px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '12px', color: '#8b949e', overflow: 'auto', maxHeight: '500px', marginTop: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {c.report_text}
            </pre>
          </details>
        )}
      </div>
    );
  }

  // ── 标准报告渲染（48h_summary / daily_report 等）────────────────────────────
  const taskStats = c.task_stats || {};
  const health = c.system_health || {};
  const krProgress = c.kr_progress || [];
  const anomalies = c.anomalies || [];
  const risks = c.risks || [];

  const healthColor = health.status === 'ok' || health.status === 'healthy'
    ? '#3fb950'
    : health.status === 'warning'
      ? '#d29922'
      : '#f85149';

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
      color: '#e6edf3',
      padding: '32px',
    }}>
      {/* 返回 + 标题 */}
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/reports')}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)',
            color: '#8b949e',
            fontSize: '13px',
            cursor: 'pointer',
            marginBottom: '16px',
          }}
        >
          ← 返回列表
        </button>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#e6edf3', margin: '0 0 4px 0' }}>
          {c.title || `简报 #${report.id.slice(0, 8)}`}
        </h1>
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#6e7681' }}>
          <span>生成时间：{formattedDate}</span>
          <span>类型：{report.type}</span>
          {c.generated_by && <span>来源：{c.generated_by}</span>}
        </div>
      </div>

      {/* 摘要 */}
      {c.summary && (
        <Section title="摘要">
          <p style={{ fontSize: '14px', color: '#e6edf3', lineHeight: 1.6, margin: 0 }}>
            {c.summary}
          </p>
        </Section>
      )}

      {/* 系统健康 */}
      <Section title="系统健康">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: healthColor,
            flexShrink: 0,
          }} />
          <span style={{ fontSize: '14px', color: healthColor, fontWeight: 600 }}>
            {health.status === 'ok' || health.status === 'healthy' ? '正常' : health.status || '未知'}
          </span>
          {health.message && (
            <span style={{ fontSize: '13px', color: '#8b949e' }}>{health.message}</span>
          )}
        </div>
      </Section>

      {/* 任务统计 */}
      <Section title="任务统计">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          <StatBox label="已完成" value={taskStats.completed} color="#3fb950" />
          <StatBox label="进行中" value={taskStats.in_progress} color="#38bdf8" />
          <StatBox label="排队中" value={taskStats.queued} color="#d29922" />
          <StatBox label="失败" value={taskStats.failed} color="#f85149" />
        </div>
      </Section>

      {/* KR 进度 */}
      {krProgress.length > 0 && (
        <Section title="KR 进度">
          {krProgress.map((kr, idx) => (
            <div key={kr.id || idx} style={{
              marginBottom: idx < krProgress.length - 1 ? '12px' : 0,
              padding: '12px',
              borderRadius: '8px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: '#e6edf3' }}>{kr.title || `KR #${idx + 1}`}</span>
                <span style={{ fontSize: '12px', color: '#8b949e' }}>{kr.progress ?? 0}%</span>
              </div>
              {/* 进度条 */}
              <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${kr.progress ?? 0}%`,
                  background: 'linear-gradient(90deg, #38bdf8, #818cf8)',
                  borderRadius: '2px',
                  transition: 'width 0.3s',
                }} />
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* 异常 */}
      {anomalies.length > 0 && (
        <Section title="异常">
          {anomalies.map((item, idx) => (
            <div key={idx} style={{
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'rgba(248,81,73,0.08)',
              border: '1px solid rgba(248,81,73,0.15)',
              color: '#f85149',
              fontSize: '13px',
              marginBottom: idx < anomalies.length - 1 ? '6px' : 0,
            }}>
              ⚠️ {typeof item === 'string' ? item : JSON.stringify(item)}
            </div>
          ))}
        </Section>
      )}

      {/* 风险 */}
      {risks.length > 0 && (
        <Section title="风险">
          {risks.map((item, idx) => (
            <div key={idx} style={{
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'rgba(210,153,34,0.08)',
              border: '1px solid rgba(210,153,34,0.15)',
              color: '#d29922',
              fontSize: '13px',
              marginBottom: idx < risks.length - 1 ? '6px' : 0,
            }}>
              🔶 {typeof item === 'string' ? item : JSON.stringify(item)}
            </div>
          ))}
        </Section>
      )}

      {/* 原始数据（折叠） */}
      <details style={{ marginTop: '12px' }}>
        <summary style={{ cursor: 'pointer', fontSize: '12px', color: '#6e7681', padding: '8px 0' }}>
          查看原始数据
        </summary>
        <pre style={{
          padding: '16px',
          borderRadius: '8px',
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.06)',
          fontSize: '11px',
          color: '#8b949e',
          overflow: 'auto',
          maxHeight: '400px',
          marginTop: '8px',
        }}>
          {JSON.stringify(report, null, 2)}
        </pre>
      </details>
    </div>
  );
}
