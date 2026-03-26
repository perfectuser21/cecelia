import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Atom, Filter, Sparkles } from 'lucide-react';

interface CaptureAtom {
  id: string;
  capture_id: string | null;
  content: string;
  target_type: string;
  target_subtype: string | null;
  suggested_area_id: string | null;
  status: string;
  confidence: number;
  ai_reason: string | null;
  created_at: string;
}

const TARGET_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  note: { label: '笔记', color: 'bg-blue-500/20 text-blue-400' },
  knowledge: { label: '知识', color: 'bg-purple-500/20 text-purple-400' },
  content: { label: '内容', color: 'bg-pink-500/20 text-pink-400' },
  task: { label: '任务', color: 'bg-amber-500/20 text-amber-400' },
  decision: { label: '决策', color: 'bg-green-500/20 text-green-400' },
  event: { label: '事件', color: 'bg-cyan-500/20 text-cyan-400' },
};

const ALL_TYPES = ['all', 'note', 'knowledge', 'content', 'task', 'decision', 'event'] as const;

interface AtomReviewProps {
  onCountChange?: (count: number) => void;
}

export default function AtomReview({ onCountChange }: AtomReviewProps): React.ReactElement {
  const [atoms, setAtoms] = useState<CaptureAtom[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [acting, setActing] = useState<string | null>(null);

  const fetchAtoms = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterType !== 'all'
        ? `?status=pending_review&target_type=${filterType}`
        : '?status=pending_review';
      const res = await fetch(`/api/capture-atoms${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAtoms(data);
      onCountChange?.(data.length);
    } catch {
      setAtoms([]);
      onCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [filterType, onCountChange]);

  useEffect(() => { fetchAtoms(); }, [fetchAtoms]);

  const handleAction = async (id: string, action: 'confirm' | 'dismiss') => {
    setActing(id);
    try {
      const res = await fetch(`/api/capture-atoms/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error('操作失败');
      await fetchAtoms();
    } finally {
      setActing(null);
    }
  };

  const formatConfidence = (c: number) => `${Math.round(c * 100)}%`;

  const formatTime = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    return d.toLocaleDateString('zh-CN');
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 筛选栏 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={14} className="text-slate-500" />
        {ALL_TYPES.map(t => {
          const info = t === 'all' ? { label: '全部', color: '' } : TARGET_TYPE_LABELS[t];
          return (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                filterType === t
                  ? 'bg-slate-600 text-white'
                  : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-300'
              }`}
            >
              {info?.label ?? t}
            </button>
          );
        })}
        <button
          onClick={fetchAtoms}
          className="ml-auto p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      ) : atoms.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-slate-500">
          <Atom size={32} strokeWidth={1} />
          <p className="text-sm">暂无待审阅的 Atom</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {atoms.map(atom => {
            const typeInfo = TARGET_TYPE_LABELS[atom.target_type] ?? { label: atom.target_type, color: 'bg-slate-500/20 text-slate-400' };
            return (
              <div
                key={atom.id}
                className="group p-3 rounded-lg border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 leading-relaxed">{atom.content}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${typeInfo.color}`}>
                        {typeInfo.label}
                      </span>
                      {atom.target_subtype && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-slate-700/50 text-slate-400">
                          {atom.target_subtype}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Sparkles size={10} />
                        {formatConfidence(atom.confidence)}
                      </span>
                      <span className="text-xs text-slate-600">{formatTime(atom.created_at)}</span>
                    </div>
                    {atom.ai_reason && (
                      <p className="mt-1.5 text-xs text-slate-500 italic leading-relaxed">
                        {atom.ai_reason}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleAction(atom.id, 'confirm')}
                      disabled={acting === atom.id}
                      className="p-1.5 rounded-md hover:bg-green-500/20 text-slate-500 hover:text-green-400 transition-colors disabled:opacity-50"
                      title="确认"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    <button
                      onClick={() => handleAction(atom.id, 'dismiss')}
                      disabled={acting === atom.id}
                      className="p-1.5 rounded-md hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50"
                      title="驳回"
                    >
                      <XCircle size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
