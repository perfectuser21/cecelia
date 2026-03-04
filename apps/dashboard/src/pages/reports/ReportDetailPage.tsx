/**
 * ReportDetailPage — 系统简报详情页
 * 路由：/reports/:id
 * 展示简报完整内容（KR 进度、任务统计、系统健康、异常和风险）
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

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

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

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
  }, [id]);

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
  const taskStats = c.task_stats || {};
  const health = c.system_health || {};
  const krProgress = c.kr_progress || [];
  const anomalies = c.anomalies || [];
  const risks = c.risks || [];

  const createdAt = new Date(report.created_at);
  const formattedDate = `${createdAt.getFullYear()}/${createdAt.getMonth() + 1}/${createdAt.getDate()} ${String(createdAt.getHours()).padStart(2, '0')}:${String(createdAt.getMinutes()).padStart(2, '0')}`;

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
