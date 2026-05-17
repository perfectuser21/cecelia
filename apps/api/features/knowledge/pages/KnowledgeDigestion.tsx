import { useState, useEffect, useCallback } from 'react';
import { Sparkles, RefreshCw, BookOpen, Check, Clock, Archive } from 'lucide-react';

interface RuminationStatus {
  daily_count: number;
  daily_budget: number;
  remaining: number;
  cooldown_remaining_ms: number;
  undigested_count: number;
  last_run_at: string | null;
}

interface Learning {
  id: string;
  title: string;
  content: string | null;
  category: string | null;
  digested: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

interface LearningsResponse {
  learnings: Learning[];
  total: number;
  limit: number;
  offset: number;
}

type FilterMode = 'all' | 'undigested' | 'digested';

export default function KnowledgeDigestion() {
  const [status, setStatus] = useState<RuminationStatus | null>(null);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/rumination/status');
      if (res.ok) setStatus(await res.json());
    } catch { /* non-critical */ }
  }, []);

  const fetchLearnings = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '30', offset: '0' });
      if (filter === 'undigested') params.set('digested', 'false');
      if (filter === 'digested') params.set('digested', 'true');

      const res = await fetch(`/api/brain/learnings?${params}`);
      if (res.ok) {
        const data: LearningsResponse = await res.json();
        setLearnings(data.learnings);
        setTotal(data.total);
      }
    } catch { /* non-critical */ }
  }, [filter]);

  useEffect(() => {
    Promise.all([fetchStatus(), fetchLearnings()]).finally(() => setLoading(false));
  }, [fetchStatus, fetchLearnings]);

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerResult(null);
    try {
      const res = await fetch('/api/brain/ruminate', { method: 'POST' });
      const data = await res.json();
      if (data.skipped) {
        setTriggerResult(`跳过：${data.skipped}`);
      } else {
        setTriggerResult(`消化 ${data.digested} 条知识`);
      }
      await Promise.all([fetchStatus(), fetchLearnings()]);
    } catch (err) {
      setTriggerResult('触发失败');
    } finally {
      setTriggering(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatCooldown = (ms: number) => {
    if (ms <= 0) return '就绪';
    const min = Math.ceil(ms / 60000);
    return `${min} 分钟`;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.3)' }}>
        <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
        加载中...
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900, margin: '0 auto' }}>
      {/* 页头 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Sparkles size={20} style={{ color: '#a78bfa' }} />
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.85)', margin: 0 }}>
          知识消化
        </h1>
      </div>

      {/* 状态卡片 */}
      {status && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
          marginBottom: 20,
        }}>
          <StatCard
            label="今日消化"
            value={`${status.daily_count}/${status.daily_budget}`}
            color="#10b981"
          />
          <StatCard
            label="未消化"
            value={String(status.undigested_count)}
            color={status.undigested_count > 0 ? '#f59e0b' : '#475569'}
          />
          <StatCard
            label="冷却"
            value={formatCooldown(status.cooldown_remaining_ms)}
            color={status.cooldown_remaining_ms > 0 ? '#ef4444' : '#10b981'}
          />
          <StatCard
            label="上次运行"
            value={status.last_run_at ? formatTime(status.last_run_at) : '从未'}
            color="#60a5fa"
          />
        </div>
      )}

      {/* 手动触发 + 筛选 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['all', 'undigested', 'digested'] as FilterMode[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600,
                background: filter === f ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.04)',
                color: filter === f ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                transition: 'all 0.15s',
              }}
            >
              {f === 'all' ? '全部' : f === 'undigested' ? '未消化' : '已消化'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {triggerResult && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
              {triggerResult}
            </span>
          )}
          <button
            onClick={handleTrigger}
            disabled={triggering}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8, border: 'none', cursor: triggering ? 'not-allowed' : 'pointer',
              background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
              color: '#fff', fontSize: 12, fontWeight: 600,
              opacity: triggering ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            <RefreshCw size={12} style={triggering ? { animation: 'spin 1s linear infinite' } : undefined} />
            {triggering ? '消化中...' : '手动触发反刍'}
          </button>
        </div>
      </div>

      {/* 知识列表 */}
      <div style={{
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        {learnings.length === 0 ? (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            color: 'rgba(255,255,255,0.2)', fontSize: 13,
          }}>
            <BookOpen size={24} style={{ marginBottom: 8, opacity: 0.3 }} />
            <p style={{ margin: 0 }}>暂无知识记录</p>
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 100px 80px 120px',
              padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
              fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.2)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              <span>标题</span>
              <span>分类</span>
              <span>状态</span>
              <span>时间</span>
            </div>
            {learnings.map(l => (
              <div
                key={l.id}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 100px 80px 120px',
                  padding: '10px 16px', alignItems: 'center',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <span style={{
                    fontSize: 12, color: 'rgba(255,255,255,0.7)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    display: 'block', maxWidth: 400,
                  }}>
                    {l.title}
                  </span>
                  {l.content && (
                    <span style={{
                      fontSize: 10, color: 'rgba(255,255,255,0.25)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      display: 'block', maxWidth: 400, marginTop: 2,
                    }}>
                      {l.content.slice(0, 80)}
                    </span>
                  )}
                </div>
                <span style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.3)',
                  padding: '2px 6px', borderRadius: 4,
                  background: 'rgba(255,255,255,0.04)',
                  display: 'inline-block', width: 'fit-content',
                }}>
                  {l.category || '-'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {l.archived ? (
                    <>
                      <Archive size={10} style={{ color: '#475569' }} />
                      <span style={{ fontSize: 10, color: '#475569' }}>归档</span>
                    </>
                  ) : l.digested ? (
                    <>
                      <Check size={10} style={{ color: '#10b981' }} />
                      <span style={{ fontSize: 10, color: '#10b981' }}>已消化</span>
                    </>
                  ) : (
                    <>
                      <Clock size={10} style={{ color: '#f59e0b' }} />
                      <span style={{ fontSize: 10, color: '#f59e0b' }}>待消化</span>
                    </>
                  )}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
                  {formatTime(l.created_at)}
                </span>
              </div>
            ))}
            {total > learnings.length && (
              <div style={{
                padding: '8px 16px', textAlign: 'center',
                fontSize: 10, color: 'rgba(255,255,255,0.2)',
              }}>
                显示 {learnings.length} / {total} 条
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}
