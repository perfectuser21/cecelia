/**
 * SystemReportDetail — 系统简报详情页
 * 路由：/reports/:id
 * 展示完整简报内容（KR 进度、任务统计、系统健康、异常和风险）
 */

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FileText,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Activity,
  Target,
  BarChart3,
  Shield,
  AlertTriangle,
} from 'lucide-react';

interface ReportContent {
  summary?: string;
  task_stats?: {
    last_48h?: Record<string, number>;
    total?: number;
  };
  kr_progress?: Array<{
    id: string;
    title: string;
    status: string;
    progress: number;
  }>;
  system_health?: {
    brain?: string;
    database?: string;
    generated_at?: string;
  };
  anomalies?: Array<{ description?: string; [key: string]: unknown }>;
  risks?: Array<{ description?: string; [key: string]: unknown }>;
}

interface ReportRecord {
  id: string;
  type: string;
  content: ReportContent;
  metadata: {
    generated_by?: string;
    push_status?: string;
  };
  created_at: string;
}

function SectionCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: 10,
      padding: '16px 20px',
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {icon}
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#e6edf3' }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function HealthBadge({ status }: { status?: string }) {
  const isOk = status === 'ok';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 12,
      background: isOk ? '#0f2d1f' : '#1f0a0a',
      color: isOk ? '#3fb950' : '#f85149',
      border: `1px solid ${isOk ? '#238636' : '#6e1313'}`,
    }}>
      {isOk
        ? <CheckCircle2 style={{ width: 11, height: 11 }} />
        : <XCircle style={{ width: 11, height: 11 }} />
      }
      {status || '未知'}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const color = value >= 80 ? '#3fb950' : value >= 50 ? '#d29922' : '#58a6ff';
  return (
    <div style={{ height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden', flex: 1 }}>
      <div style={{
        height: '100%',
        width: `${Math.min(value, 100)}%`,
        background: color,
        borderRadius: 3,
        transition: 'width 0.3s ease',
      }} />
    </div>
  );
}

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      padding: '10px 16px',
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: 8,
      textAlign: 'center',
      minWidth: 80,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#484f58', marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function SystemReportDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [record, setRecord] = useState<ReportRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/brain/reports/${id}`);
        if (res.status === 404) {
          navigate('/reports', { replace: true });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.ok) {
          setRecord(data.record);
        } else {
          throw new Error(data.error || '获取简报详情失败');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [id, navigate]);

  if (loading) {
    return (
      <div style={{
        minHeight: '100%',
        background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
        color: '#e6edf3',
        padding: '24px',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center', color: '#484f58', fontSize: 14 }}>加载中…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100%',
        background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
        color: '#e6edf3',
        padding: '24px',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      }}>
        <button
          onClick={() => navigate('/reports')}
          style={{ background: 'none', border: '1px solid #30363d', borderRadius: 6, color: '#8b949e', cursor: 'pointer', fontSize: 13, padding: '4px 10px', marginBottom: 16 }}
        >
          ← 返回列表
        </button>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 8,
          background: '#1f0a0a', border: '1px solid #6e1313', color: '#f85149', fontSize: 13,
        }}>
          <AlertCircle style={{ width: 14, height: 14 }} />
          {error}
        </div>
      </div>
    );
  }

  if (!record) return null;

  const content = record.content;
  const taskStats = content.task_stats?.last_48h || {};
  const taskTotal = content.task_stats?.total || 0;
  const krProgress = content.kr_progress || [];
  const health = content.system_health || {};
  const anomalies = content.anomalies || [];
  const risks = content.risks || [];

  return (
    <div style={{
      minHeight: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
      color: '#e6edf3',
      padding: '24px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    }}>
      {/* 页头 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => navigate('/reports')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: '1px solid #30363d', borderRadius: 6,
            color: '#8b949e', cursor: 'pointer', fontSize: 13, padding: '4px 10px',
          }}
        >
          <ArrowLeft style={{ width: 13, height: 13 }} />
          返回
        </button>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText style={{ width: 18, height: 18, color: '#58a6ff' }} />
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e6edf3' }}>
              {record.type === '48h_briefing' ? '48h 系统简报' : record.type}
            </h1>
          </div>
          <div style={{ fontSize: 11, color: '#484f58', marginTop: 3 }}>
            {new Date(record.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          </div>
        </div>
      </div>

      {/* 摘要 */}
      {content.summary && (
        <div style={{
          padding: '12px 16px',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 8,
          fontSize: 13,
          color: '#8b949e',
          marginBottom: 16,
        }}>
          {content.summary}
        </div>
      )}

      {/* 任务统计 */}
      <SectionCard
        icon={<BarChart3 style={{ width: 16, height: 16, color: '#58a6ff' }} />}
        title="任务统计（近 48h）"
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatBadge label="已完成" value={taskStats.completed || 0} color="#3fb950" />
          <StatBadge label="进行中" value={taskStats.in_progress || 0} color="#58a6ff" />
          <StatBadge label="等待中" value={taskStats.queued || 0} color="#d29922" />
          <StatBadge label="失败" value={taskStats.failed || 0} color="#f85149" />
          <div style={{
            padding: '10px 16px',
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 8,
            textAlign: 'center',
            minWidth: 80,
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3' }}>{taskTotal}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>总计</div>
          </div>
        </div>
      </SectionCard>

      {/* KR 进度 */}
      {krProgress.length > 0 && (
        <SectionCard
          icon={<Target style={{ width: 16, height: 16, color: '#d29922' }} />}
          title="KR 进度"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {krProgress.map(kr => (
              <div key={kr.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#e6edf3' }}>{kr.title}</span>
                  <span style={{ fontSize: 12, color: '#484f58' }}>{kr.progress}%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ProgressBar value={kr.progress} />
                  <span style={{
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 8,
                    background: kr.status === 'completed' ? '#0f2d1f' : '#21262d',
                    color: kr.status === 'completed' ? '#3fb950' : '#8b949e',
                    border: `1px solid ${kr.status === 'completed' ? '#238636' : '#30363d'}`,
                    whiteSpace: 'nowrap',
                  }}>
                    {kr.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 系统健康 */}
      <SectionCard
        icon={<Activity style={{ width: 16, height: 16, color: '#3fb950' }} />}
        title="系统健康"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.entries(health).filter(([k]) => k !== 'generated_at').map(([key, value]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#8b949e', textTransform: 'capitalize' }}>{key}</span>
              <HealthBadge status={String(value)} />
            </div>
          ))}
        </div>
      </SectionCard>

      {/* 异常 */}
      <SectionCard
        icon={<AlertTriangle style={{ width: 16, height: 16, color: '#f85149' }} />}
        title={`异常（${anomalies.length}）`}
      >
        {anomalies.length === 0 ? (
          <div style={{ fontSize: 13, color: '#484f58', textAlign: 'center', padding: '8px 0' }}>
            <Shield style={{ width: 24, height: 24, opacity: 0.3, marginBottom: 4 }} />
            <div>无异常</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {anomalies.map((a, i) => (
              <div key={i} style={{
                padding: '8px 12px',
                background: '#1f0a0a',
                border: '1px solid #6e1313',
                borderRadius: 6,
                fontSize: 13,
                color: '#f85149',
              }}>
                {a.description || JSON.stringify(a)}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 风险 */}
      <SectionCard
        icon={<AlertCircle style={{ width: 16, height: 16, color: '#d29922' }} />}
        title={`风险（${risks.length}）`}
      >
        {risks.length === 0 ? (
          <div style={{ fontSize: 13, color: '#484f58', textAlign: 'center', padding: '8px 0' }}>
            <CheckCircle2 style={{ width: 24, height: 24, opacity: 0.3, marginBottom: 4 }} />
            <div>无已知风险</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {risks.map((r, i) => (
              <div key={i} style={{
                padding: '8px 12px',
                background: '#1f1400',
                border: '1px solid #6b3c00',
                borderRadius: 6,
                fontSize: 13,
                color: '#d29922',
              }}>
                {r.description || JSON.stringify(r)}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 元信息 */}
      <div style={{ fontSize: 11, color: '#484f58', marginTop: 8, textAlign: 'right' }}>
        ID: {record.id}
        {record.metadata?.generated_by && ` · 来源: ${record.metadata.generated_by}`}
      </div>
    </div>
  );
}
