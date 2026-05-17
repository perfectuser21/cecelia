import React, { useState, useEffect, useCallback } from 'react';
import { Inbox, RefreshCw, CheckCircle2, Archive, Clock, Atom, MessageSquare } from 'lucide-react';
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

type TabKey = 'captures' | 'review';

const SOURCE_LABELS: Record<string, string> = {
  dashboard: '手动',
  conversation: '对话',
  feishu: '飞书',
  diary: '日记',
  api: 'API',
};

const SOURCE_COLORS: Record<string, string> = {
  dashboard: 'bg-blue-500/20 text-blue-400',
  conversation: 'bg-purple-500/20 text-purple-400',
  feishu: 'bg-green-500/20 text-green-400',
  diary: 'bg-amber-500/20 text-amber-400',
  api: 'bg-slate-500/20 text-slate-400',
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

interface KanbanColumnProps {
  title: string;
  status: 'inbox' | 'processing' | 'done';
  captures: Capture[];
  updating: string | null;
  onUpdateStatus: (id: string, status: string) => void;
}

function KanbanColumn({ title, status, captures, updating, onUpdateStatus }: KanbanColumnProps) {
  const headerColors: Record<string, string> = {
    inbox: 'text-blue-400 border-blue-500/30',
    processing: 'text-amber-400 border-amber-500/30',
    done: 'text-green-400 border-green-500/30',
  };

  return (
    <div className="flex flex-col min-w-0 flex-1">
      <div className={`shrink-0 flex items-center justify-between px-3 py-2 mb-2 border-b ${headerColors[status]}`}>
        <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
        <span className="text-xs text-slate-500">{captures.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
        {captures.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-6 text-slate-600">
            <Inbox size={20} strokeWidth={1} />
            <p className="text-xs">空</p>
          </div>
        ) : (
          captures.map(cap => (
            <div
              key={cap.id}
              className="group p-2.5 rounded-lg border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/60 transition-colors"
            >
              <p className="text-xs text-gray-200 leading-relaxed line-clamp-3 mb-2">{cap.content}</p>
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 flex-wrap">
                  <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${SOURCE_COLORS[cap.source] ?? 'bg-slate-700/50 text-slate-400'}`}>
                    {cap.source === 'conversation' && <MessageSquare size={8} className="inline mr-0.5" />}
                    {SOURCE_LABELS[cap.source] ?? cap.source}
                  </span>
                  <span className="flex items-center gap-0.5 text-[10px] text-slate-600">
                    <Clock size={8} />
                    {formatTime(cap.created_at)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {status === 'inbox' && (
                    <>
                      <button
                        onClick={() => onUpdateStatus(cap.id, 'processing')}
                        disabled={updating === cap.id}
                        className="p-1 rounded hover:bg-amber-500/20 text-slate-500 hover:text-amber-400 transition-colors disabled:opacity-50"
                        title="开始处理"
                      >
                        <Clock size={12} />
                      </button>
                      <button
                        onClick={() => onUpdateStatus(cap.id, 'done')}
                        disabled={updating === cap.id}
                        className="p-1 rounded hover:bg-green-500/20 text-slate-500 hover:text-green-400 transition-colors disabled:opacity-50"
                        title="标记完成"
                      >
                        <CheckCircle2 size={12} />
                      </button>
                    </>
                  )}
                  {status === 'processing' && (
                    <button
                      onClick={() => onUpdateStatus(cap.id, 'done')}
                      disabled={updating === cap.id}
                      className="p-1 rounded hover:bg-green-500/20 text-slate-500 hover:text-green-400 transition-colors disabled:opacity-50"
                      title="标记完成"
                    >
                      <CheckCircle2 size={12} />
                    </button>
                  )}
                  {(status === 'inbox' || status === 'processing') && (
                    <button
                      onClick={() => onUpdateStatus(cap.id, 'archived')}
                      disabled={updating === cap.id}
                      className="p-1 rounded hover:bg-slate-500/20 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
                      title="归档"
                    >
                      <Archive size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function GTDInbox(): React.ReactElement {
  const [allCaptures, setAllCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('captures');
  const [reviewCount, setReviewCount] = useState(0);

  const fetchCaptures = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/captures');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAllCaptures(data);
    } catch {
      setAllCaptures([]);
    } finally {
      setLoading(false);
    }
  }, []);

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

  // kanban columns
  const inbox = allCaptures.filter(c => c.status === 'inbox');
  const processing = allCaptures.filter(c => c.status === 'processing');
  const done = allCaptures.filter(c => c.status === 'done');

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
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
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
      <div className="flex-1 overflow-hidden px-4 py-3">
        {activeTab === 'captures' ? (
          loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
              <RefreshCw size={16} className="animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          ) : (
            // Kanban Board — 三列
            <div className="flex flex-row gap-3 h-full">
              <KanbanColumn
                title="Raw Input"
                status="inbox"
                captures={inbox}
                updating={updating}
                onUpdateStatus={updateStatus}
              />
              <KanbanColumn
                title="AI 加工中"
                status="processing"
                captures={processing}
                updating={updating}
                onUpdateStatus={updateStatus}
              />
              <KanbanColumn
                title="已拆解"
                status="done"
                captures={done}
                updating={updating}
                onUpdateStatus={updateStatus}
              />
            </div>
          )
        ) : (
          <AtomReview onCountChange={setReviewCount} />
        )}
      </div>
    </div>
  );
}
