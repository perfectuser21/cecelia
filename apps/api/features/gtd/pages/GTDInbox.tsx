import React, { useState, useEffect, useCallback } from 'react';
import { Inbox, RefreshCw, CheckCircle2, Archive, Clock } from 'lucide-react';
import QuickCapture from '../components/QuickCapture';

interface Capture {
  id: string;
  content: string;
  source: string;
  status: string;
  area_id: string | null;
  owner: string;
  created_at: string;
  updated_at: string;
}

type FilterStatus = 'inbox' | 'processing' | 'done' | 'all';

const SOURCE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  feishu: '飞书',
  diary: '日记',
  api: 'API',
};

const STATUS_LABELS: Record<string, string> = {
  inbox: '待处理',
  processing: '处理中',
  done: '已完成',
  archived: '已归档',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString('zh-CN');
}

export default function GTDInbox(): React.ReactElement {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('inbox');
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchCaptures = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await fetch(`/api/captures${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCaptures(data);
    } catch {
      setCaptures([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchCaptures(); }, [fetchCaptures]);

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    try {
      const res = await fetch(`/api/captures/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('更新失败');
      await fetchCaptures();
    } finally {
      setUpdating(null);
    }
  };

  const filters: { key: FilterStatus; label: string; count?: number }[] = [
    { key: 'inbox', label: '待处理', count: filter === 'inbox' ? captures.length : undefined },
    { key: 'processing', label: '处理中' },
    { key: 'done', label: '已完成' },
    { key: 'all', label: '全部' },
  ];

  return (
    <div className="gtd-inbox-page">
      <div className="gtd-inbox-header">
        <div className="gtd-inbox-title">
          <Inbox size={22} />
          <h2>Capture 收件箱</h2>
        </div>
        <button onClick={fetchCaptures} className="gtd-inbox-refresh" title="刷新">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="gtd-inbox-capture">
        <QuickCapture onSuccess={fetchCaptures} />
      </div>

      <div className="gtd-inbox-filters">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`gtd-inbox-filter-btn ${filter === f.key ? 'active' : ''}`}
          >
            {f.label}
            {f.count !== undefined && filter === f.key && (
              <span className="gtd-inbox-count">{f.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="gtd-inbox-list">
        {loading ? (
          <div className="gtd-inbox-loading">
            <RefreshCw size={20} className="spin" />
            <span>加载中...</span>
          </div>
        ) : captures.length === 0 ? (
          <div className="gtd-inbox-empty">
            <Inbox size={40} strokeWidth={1} />
            <p>
              {filter === 'inbox' ? '收件箱为空，使用上方输入框快速捕获想法' : '暂无记录'}
            </p>
          </div>
        ) : (
          captures.map(cap => (
            <div key={cap.id} className={`gtd-inbox-item status-${cap.status}`}>
              <div className="gtd-inbox-item-content">
                <p className="gtd-inbox-item-text">{cap.content}</p>
                <div className="gtd-inbox-item-meta">
                  <span className="gtd-inbox-source">{SOURCE_LABELS[cap.source] ?? cap.source}</span>
                  <span className="gtd-inbox-status">{STATUS_LABELS[cap.status] ?? cap.status}</span>
                  <span className="gtd-inbox-time">
                    <Clock size={12} />
                    {formatTime(cap.created_at)}
                  </span>
                </div>
              </div>
              <div className="gtd-inbox-item-actions">
                {cap.status === 'inbox' && (
                  <>
                    <button
                      onClick={() => updateStatus(cap.id, 'processing')}
                      disabled={updating === cap.id}
                      className="gtd-inbox-action-btn"
                      title="标记为处理中"
                    >
                      <Clock size={14} />
                    </button>
                    <button
                      onClick={() => updateStatus(cap.id, 'done')}
                      disabled={updating === cap.id}
                      className="gtd-inbox-action-btn success"
                      title="标记完成"
                    >
                      <CheckCircle2 size={14} />
                    </button>
                  </>
                )}
                {(cap.status === 'processing' || cap.status === 'inbox') && (
                  <button
                    onClick={() => updateStatus(cap.id, 'archived')}
                    disabled={updating === cap.id}
                    className="gtd-inbox-action-btn muted"
                    title="归档"
                  >
                    <Archive size={14} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
