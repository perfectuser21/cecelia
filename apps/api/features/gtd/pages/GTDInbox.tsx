import React, { useState, useEffect, useCallback } from 'react';
import { Inbox, RefreshCw, CheckCircle2, Archive, Clock, Atom } from 'lucide-react';
import QuickCapture from '../components/QuickCapture';
import AtomReview from '../components/AtomReview';

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
type TabKey = 'captures' | 'review';

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
  const [activeTab, setActiveTab] = useState<TabKey>('captures');
  const [reviewCount, setReviewCount] = useState(0);

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

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'captures', label: 'Captures', icon: <Inbox size={14} /> },
    { key: 'review', label: 'Atom Review', icon: <Atom size={14} />, badge: reviewCount },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-900">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
          <Inbox className="w-4 h-4 text-slate-400" />
          <span>Capture 收件箱</span>
        </div>
        <button
          onClick={fetchCaptures}
          className="ml-auto p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
          title="刷新"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* QuickCapture */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-800/50">
        <QuickCapture onSuccess={fetchCaptures} />
      </div>

      {/* Tab 切换 */}
      <div className="shrink-0 flex gap-1 px-4 pt-3 pb-0">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors ${
              activeTab === tab.key
                ? 'bg-slate-800 text-gray-200 border border-b-0 border-slate-700/50'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/30'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-amber-500/20 text-amber-400">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {activeTab === 'captures' ? (
          <>
            {/* Captures 筛选 */}
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {filters.map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                    filter === f.key
                      ? 'bg-slate-600 text-white'
                      : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-300'
                  }`}
                >
                  {f.label}
                  {f.count !== undefined && filter === f.key && (
                    <span className="ml-1 text-slate-300">{f.count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Captures 列表 */}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
                <RefreshCw size={16} className="animate-spin" />
                <span className="text-sm">加载中...</span>
              </div>
            ) : captures.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-slate-500">
                <Inbox size={32} strokeWidth={1} />
                <p className="text-sm">
                  {filter === 'inbox' ? '收件箱为空，使用上方输入框快速捕获想法' : '暂无记录'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {captures.map(cap => (
                  <div
                    key={cap.id}
                    className="group p-3 rounded-lg border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 leading-relaxed">{cap.content}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="px-2 py-0.5 text-xs rounded-full bg-slate-700/50 text-slate-400">
                            {SOURCE_LABELS[cap.source] ?? cap.source}
                          </span>
                          <span className="px-2 py-0.5 text-xs rounded-full bg-slate-700/50 text-slate-400">
                            {STATUS_LABELS[cap.status] ?? cap.status}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-slate-600">
                            <Clock size={10} />
                            {formatTime(cap.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {cap.status === 'inbox' && (
                          <>
                            <button
                              onClick={() => updateStatus(cap.id, 'processing')}
                              disabled={updating === cap.id}
                              className="p-1.5 rounded-md hover:bg-blue-500/20 text-slate-500 hover:text-blue-400 transition-colors disabled:opacity-50"
                              title="标记为处理中"
                            >
                              <Clock size={14} />
                            </button>
                            <button
                              onClick={() => updateStatus(cap.id, 'done')}
                              disabled={updating === cap.id}
                              className="p-1.5 rounded-md hover:bg-green-500/20 text-slate-500 hover:text-green-400 transition-colors disabled:opacity-50"
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
                            className="p-1.5 rounded-md hover:bg-slate-500/20 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
                            title="归档"
                          >
                            <Archive size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <AtomReview onCountChange={setReviewCount} />
        )}
      </div>
    </div>
  );
}
